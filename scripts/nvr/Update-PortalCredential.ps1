$ErrorActionPreference='Stop'
$path=Join-Path $PSScriptRoot 'private/portal.credential.xml'
$config=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'private/config.json') -Raw | ConvertFrom-Json
$portal=$config.portal
if (-not $portal) { throw 'Run Setup-NvrCollector.ps1 -Portal <address> first.' }
$credential=Get-Credential -Message 'Enter your working One Workspace password (not the NVR password)'
if (-not $credential) { throw 'Cancelled. Existing credentials were preserved.' }
$body=@{login=$credential.UserName;password=$credential.GetNetworkCredential().Password}|ConvertTo-Json
try {
    $result=Invoke-RestMethod "$portal/api/auth/login" -Method Post -ContentType 'application/json' -Headers @{Origin=$portal} -Body $body -TimeoutSec 30
    if ($result.mustChange) { throw 'Change your initial password on the website first.' }
    $credential | Export-Clixml -LiteralPath $path
    Write-Output 'One Workspace login verified and encrypted credentials updated.'
} finally { $body=$null }
