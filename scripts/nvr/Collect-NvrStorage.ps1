param([string]$ConfigPath = "$PSScriptRoot\private\config.json", [switch]$FunctionsOnly)
$ErrorActionPreference = 'Stop'

function Convert-NvrStorage([string]$Content) {
    $settings = [System.Xml.XmlReaderSettings]::new()
    $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
    $reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($Content), $settings)
    $xml = [System.Xml.XmlDocument]::new()
    try { $xml.Load($reader) } finally { $reader.Dispose() }
    $disks = @(); $seen = @{}
    foreach ($disk in $xml.SelectNodes('//*[local-name()="hdd"]')) {
        $values = @{}
        foreach ($child in $disk.ChildNodes) { $values[$child.LocalName] = $child.InnerText }
        foreach ($key in @('id','capacity','freeSpace','status')) {
            if (-not $values.ContainsKey($key)) { throw "Missing NVR field: $key" }
        }
        $number = [int]::Parse($values.id, [cultureinfo]::InvariantCulture)
        $capacity = [double]::Parse($values.capacity, [cultureinfo]::InvariantCulture) / 1024
        $remaining = [double]::Parse($values.freeSpace, [cultureinfo]::InvariantCulture) / 1024
        if ($number -lt 1 -or $number -gt 256 -or $seen.ContainsKey($number) -or
            [double]::IsNaN($capacity) -or [double]::IsInfinity($capacity) -or
            [double]::IsNaN($remaining) -or [double]::IsInfinity($remaining) -or
            $capacity -lt 0 -or $capacity -gt 100000000 -or $remaining -lt 0 -or $remaining -gt $capacity) {
            throw 'Invalid storage values; no reading saved.'
        }
        $seen[$number] = $true
        $status = switch -Regex ($values.status.ToLowerInvariant()) {
            '^(normal|ok)$' {'Normal'; break}
            '^(unformatted|uninitialized)$' {'Uninitialized'; break}
            '^(error|abnormal)$' {'Error'; break}
            '^(notexist|not exist|not-exist|nonexistent)$' {'Not Exist'; break}
            default {'Unknown'}
        }
        $attribute = switch -Regex ([string]$values.property) {
            '^(RW|R/W|readwrite)$' {'R/W'; break}
            '^(RO|readOnly|read-only)$' {'Read-only'; break}
            default {'Unknown'}
        }
        $type = switch -Regex ([string]$values.hddType) {
            '^(SATA|local|esata)$' {'Local'; break}
            '^(NAS|NFS)$' {'NAS'; break}
            '^(SAN|iSCSI)$' {'SAN'; break}
            default {'Unknown'}
        }
        $disks += @{disk=$number;capacity=$capacity;remaining=$remaining;status=$status;attribute=$attribute;type=$type}
    }
    if ($disks.Count -lt 1 -or $disks.Count -gt 64) { throw 'No supported HDD list returned.' }
    return ,$disks
}

function Get-StorageXml($Device, [string]$Root) {
    # GET only. Default operating-system certificate validation stays enabled.
    Add-Type -AssemblyName System.Net.Http
    $credential = Import-Clixml -LiteralPath (Join-Path $Root $Device.credentialFile)
    $handler = [System.Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $handler.UseProxy = $false
    $credentials = [System.Net.CredentialCache]::new()
    $credentials.Add([uri]$Device.address, 'Digest', $credential.GetNetworkCredential())
    $handler.Credentials = $credentials
    $client = [System.Net.Http.HttpClient]::new($handler)
    $client.Timeout = [timespan]::FromSeconds(20)
    try {
        foreach ($path in @('/ISAPI/ContentMgmt/Storage/hdd','/ISAPI/ContentMgmt/Storage')) {
            $response = $client.GetAsync(([string]$Device.address).TrimEnd('/') + $path).GetAwaiter().GetResult()
            try {
                if ([int]$response.StatusCode -in @(404,405)) { continue }
                if (-not $response.IsSuccessStatusCode) { throw "NVR HTTP $([int]$response.StatusCode)" }
                $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                if ($content.Length -gt 1048576) { throw 'NVR response too large.' }
                return $content
            } finally { $response.Dispose() }
        }
        throw 'Storage API is not supported at the standard endpoints.'
    } finally { $client.Dispose() }
}

function Invoke-Collector([string]$Path) {
    $config = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    $root = Split-Path -Parent ([IO.Path]::GetFullPath($Path))
    $queue = Join-Path $root 'queue'
    $history = Join-Path $root 'history'
    New-Item -ItemType Directory -Force -Path $queue,$history | Out-Null
    $lock = $null
    try { $lock = [IO.File]::Open((Join-Path $root 'run.lock'), 'OpenOrCreate', 'ReadWrite', 'None') }
    catch { throw 'Another collector run is active.' }
    $failed = $false
    try {
        $date = [datetime]::UtcNow.ToString('yyyy-MM-dd') # Ghana is UTC all year.
        foreach ($device in $config.devices) {
            try {
                if ($device.key -notmatch '^[a-zA-Z0-9_-]+$') { throw 'Invalid local device key.' }
                $address = [uri]$device.address
                $approvedHttp = $address.Scheme -eq 'http' -and $device.allowLocalHttp -eq $true -and $address.Host -in @('192.168.3.20','192.168.3.50')
                if (($address.Scheme -ne 'https' -and -not $approvedHttp) -or $address.UserInfo -or $address.AbsolutePath -ne '/') {
                    throw 'Configure HTTPS, or explicitly approved local HTTP, without embedded credentials or paths.'
                }
                $filename = "$date-$($device.key).json"
                if ((Test-Path (Join-Path $queue $filename)) -or (Test-Path (Join-Path $history $filename))) { continue }
                $xml = Get-StorageXml $device $root
                $disks = Convert-NvrStorage $xml
                $registeredAddress = if ($device.registeredAddress) { [string]$device.registeredAddress } else { $address.GetLeftPart([UriPartial]::Authority) }
                if (([uri]$registeredAddress).Host -ne $address.Host) { throw 'Registered NVR and collection host must match.' }
                $reading = @{address=$registeredAddress;date=$date;disks=$disks;
                    notes="Automatic ISAPI reading at $([datetime]::UtcNow.ToString('o')) from $($address.GetLeftPart([UriPartial]::Authority)); source units MB divided by 1024. Raw XML retained locally."}
                $xml | Set-Content -LiteralPath (Join-Path $history "$date-$($device.key).xml") -Encoding UTF8
                $temporary = Join-Path $queue "$filename.tmp"
                $reading | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $temporary -Encoding UTF8
                Move-Item -LiteralPath $temporary -Destination (Join-Path $queue $filename)
                Write-Output "$($device.key): collected $($disks.Count) disk(s)."
            } catch {
                $failed = $true
                # Do not log credentials, HTTP bodies or exception objects.
                $cause = $_.Exception
                while ($cause.InnerException) { $cause = $cause.InnerException }
                $reason = switch -Regex ($cause.Message) {
                    'RemoteCertificate|certificate|SSL connection' { 'HTTPS certificate validation failed. Verify the recorder certificate and hostname before trusting it; login was not tested.'; break }
                    'NVR HTTP 401' { 'NVR rejected authentication. Check the saved username/password.'; break }
                    'NVR HTTP 403' { 'NVR account does not have permission to read storage.'; break }
                    'timed out|Timeout|canceled|unreachable|refused' { 'NVR connection failed or timed out. Check the CCTV network and recorder address.'; break }
                    'Missing NVR field|Invalid storage values|No supported HDD|Storage API is not supported' { 'Recorder returned unsupported or incomplete storage data; no values were saved.'; break }
                    default { 'Collection failed. Check the saved credential file and recorder API compatibility.' }
                }
                Write-Warning "$($device.key): $reason"
            }
        }
        $pending = @(Get-ChildItem -LiteralPath $queue -Filter '*.json')
        if ($pending.Count) {
            $portal = ([string]$config.portal).TrimEnd('/')
            $portalUri = [uri]$portal
            if ($portalUri.Scheme -ne 'https' -or $portalUri.UserInfo) { throw 'Portal must use HTTPS.' }
            $credential = Import-Clixml -LiteralPath (Join-Path $root $config.portalCredentialFile)
            $webSession = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
            $headers = @{Origin=$portal}
            $body = @{login=$credential.UserName;password=$credential.GetNetworkCredential().Password} | ConvertTo-Json
            $login = Invoke-RestMethod -Uri "$portal/api/auth/login" -Method Post -ContentType 'application/json' -Body $body -Headers $headers -WebSession $webSession -TimeoutSec 30 -MaximumRedirection 0
            $body = $null
            if ($login.mustChange) { throw 'Change the collector account initial password in the portal first.' }
            foreach ($file in $pending) {
                try {
                    $reading = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
                    $offset = 0; $rows = @(); $device = $null
                    do {
                        $result = Invoke-RestMethod -Uri "$portal/api/it?date=$($reading.date)&offset=$offset" -Headers $headers -WebSession $webSession -TimeoutSec 30 -MaximumRedirection 0
                        $matches = @($result.devices | Where-Object { $_.address.TrimEnd('/') -eq $reading.address.TrimEnd('/') })
                        if ($matches.Count -ne 1) { throw 'Register this exact NVR address in the IT page first.' }
                        $device = $matches[0]; $rows += $result.readings; $offset += 100
                    } while ($result.hasMore)
                    $existing = @($rows | Where-Object { $_.nvr_id -eq $device.id } | ForEach-Object { [int]$_.disk_no })
                    $missing = @($reading.disks | Where-Object { [int]$_.disk -notin $existing })
                    if ($missing.Count) {
                        $payload = @{action='reading';nvrId=$device.id;date=$reading.date;notes=$reading.notes;disks=$missing} | ConvertTo-Json -Depth 8
                        $saved = Invoke-RestMethod -Uri "$portal/api/it" -Method Post -ContentType 'application/json' -Body $payload -Headers $headers -WebSession $webSession -TimeoutSec 30 -MaximumRedirection 0
                        if (-not $saved.ok) { throw 'Portal did not confirm saving.' }
                    }
                    Move-Item -LiteralPath $file.FullName -Destination (Join-Path $history $file.Name)
                    Write-Output "$($file.Name): synced (existing daily readings preserved)."
                } catch { $failed=$true; Write-Warning "$($file.Name): upload pending; will retry next run." }
            }
        }
    } finally { if ($lock) { $lock.Dispose() } }
    if ($failed) { throw 'One or more NVR operations need attention; inspect configuration and pending queue.' }
}
if (-not $FunctionsOnly) { Invoke-Collector $ConfigPath }
