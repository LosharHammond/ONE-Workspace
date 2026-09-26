$ErrorActionPreference='Stop'
$logDirectory=Join-Path $PSScriptRoot 'private/logs'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$log=Join-Path $logDirectory ([datetime]::UtcNow.ToString('yyyy-MM-dd')+'.log')
try {
    "Started $([datetime]::UtcNow.ToString('o'))" | Add-Content $log
    & "$PSScriptRoot\Collect-NvrStorage.ps1" *>> $log
    "Finished $([datetime]::UtcNow.ToString('o'))" | Add-Content $log
    exit 0
} catch {
    "Failed $([datetime]::UtcNow.ToString('o')). Pending readings remain queued. Inspect credentials, connectivity and earlier log entries." | Add-Content $log
    exit 1
}
