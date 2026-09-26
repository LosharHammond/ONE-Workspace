# -Portal is the One Workspace address, e.g. https://workspace.example.com (required on first setup).
param([string]$Portal,[switch]$InstallSchedule)
$ErrorActionPreference='Stop'
$private=Join-Path $PSScriptRoot 'private'
New-Item -ItemType Directory -Force -Path $private | Out-Null
# DPAPI credential files can only be decrypted by this Windows user on this PC.
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $private /inheritance:r /grant:r "${identity}:(OI)(CI)F" 'SYSTEM:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict credential directory permissions.' }
$path=Join-Path $private 'config.json'
if (-not (Test-Path $path)) {
    if (-not $Portal -or $Portal -notmatch '^https://') { throw 'Pass -Portal with your One Workspace https:// address.' }
    Get-Credential -Message 'NVR read-only account for 192.168.3.50 (not an API key)' | Export-Clixml (Join-Path $private 'nvr-01.credential.xml')
    Get-Credential -Message 'HQ Warehouse NVR read-only account for 192.168.3.20' | Export-Clixml (Join-Path $private 'nvr-warehouse.credential.xml')
    Get-Credential -Message 'One Workspace account with IT view and create permissions; use its changed password' | Export-Clixml (Join-Path $private 'portal.credential.xml')
    @{
        portal=$Portal.TrimEnd('/')
        portalCredentialFile='portal.credential.xml'
        devices=@(@{key='nvr-01';address='https://192.168.3.50';credentialFile='nvr-01.credential.xml'},@{key='nvr-warehouse';address='https://192.168.3.20';credentialFile='nvr-warehouse.credential.xml'})
    } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path -Encoding UTF8
}
& "$PSScriptRoot\Collect-NvrStorage.ps1" -ConfigPath $path
# Never enable a schedule before the real collection and upload have passed.
if ($InstallSchedule) {
    if ([TimeZoneInfo]::Local.GetUtcOffset([datetime]::Now) -ne [timespan]::Zero -or [TimeZoneInfo]::Local.SupportsDaylightSavingTime) {
        throw 'Set this computer to Ghana/UTC without daylight saving before installing the 9 a.m. task.'
    }
    $exe="$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $action=New-ScheduledTaskAction -Execute $exe -Argument "-NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File `"$PSScriptRoot\Run-ScheduledCollector.ps1`"" -WorkingDirectory $PSScriptRoot
    $trigger=New-ScheduledTaskTrigger -Daily -At '09:30'
    $principal=New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
    $settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
    Register-ScheduledTask -TaskName 'Procus NVR Storage (No AI)' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Daily read-only ISAPI collection and One Workspace upload; no AI credits. User must be signed in.' -Force | Out-Null
    Write-Output 'Installed: daily 09:30 Ghana time. This Windows user must stay signed in; screen may be locked.'
}
