$ErrorActionPreference='Stop'
. "$PSScriptRoot\Collect-NvrStorage.ps1" -FunctionsOnly
$xml='<Storage xmlns="http://www.hikvision.com/ver20/XMLSchema"><hddList><hdd><id>1</id><capacity>2048</capacity><freeSpace>1024</freeSpace><status>normal</status><property>RW</property><hddType>SATA</hddType></hdd></hddList></Storage>'
$result=Convert-NvrStorage $xml
if ($result.Count -ne 1 -or $result[0].capacity -ne 2 -or $result[0].remaining -ne 1 -or $result[0].status -ne 'Normal') { throw 'Valid namespaced fixture failed' }
foreach ($bad in @($xml.Replace('<freeSpace>1024</freeSpace>',''),$xml.Replace('1024','9999'),$xml.Replace('2048','NaN'),'<html>Login</html>','<!DOCTYPE x [<!ENTITY e SYSTEM "file:///test">]><Storage>&e;</Storage>')) {
    $rejected=$false
    try { Convert-NvrStorage $bad | Out-Null } catch { $rejected=$true }
    if (-not $rejected) { throw 'Unsafe or incomplete fixture was accepted' }
}
$unknown=Convert-NvrStorage ($xml.Replace('normal','sleep'))
if ($unknown[0].status -ne 'Unknown') { throw 'Unknown state incorrectly labeled healthy' }
Write-Output 'PASS: XML namespaces, units, missing values, invalid capacities, login response, DTD rejection and unknown status.'
