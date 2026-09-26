# Procus daily NVR collection without AI

No OpenAI, AssemblyAI or Groq key is used. Run inside the company network. The hosted site cannot directly reach private NVR IP addresses.

## Recommended methods, in order

1. **Direct Hikvision ISAPI (primary).** This folder implements read-only Digest-authenticated GET requests to `/ISAPI/ContentMgmt/Storage/hdd`, with `/ISAPI/ContentMgmt/Storage` as an endpoint compatibility fallback. It reads all returned HDDs, retains raw XML, queues each daily observation and uploads through the existing permission-checked One Workspace IT API. It preserves existing daily readings. No new website deployment is needed for this local collector.
2. **SNMPv3 monitoring (secondary, conditional).** Use a local Zabbix server/proxy and read-only SNMP credentials. First verify the NVR's actual MIB exposes disk size, free/used capacity and disk identity; some devices expose only uptime and network statistics. Confirm units and compare against the HDD page. An SNMP adapter must not manufacture missing storage values. This adapter is not installed or verified here.
3. **Scripted browser automation with Playwright (third).** Use a separate local automation profile and deterministic selectors for the storage table. Requires a valid certificate, authenticated session, verified selectors and page-refresh/readiness checks for each firmware version. This adapter is not installed or verified here. Do not automate format, initialization, repair or footage controls.

Another option is Hikvision's native HCNetSDK, which documents HDD capacity, free space and status fields. It needs the correct vendor runtime for the NVR and host architecture and a device-specific integration. It is preferable to browser scraping if ISAPI is absent and the SDK is supported. No SDK package was installed.

These are possible fallback methods, not three currently enabled collectors. An authentication failure or invalid certificate should be fixed, not bypassed by silently using another credential or accepting any certificate. Software can avoid per-reading AI fees, but an available local computer/server and maintenance are still necessary.

## Current live checks (22 September 2026)

- `192.168.3.50:443` is reachable when network access is available.
- The HTTPS storage request fails TLS validation on this computer.
- No authenticated storage request or portal upload has been tested with real credentials.
- The previous browser-based daily automation was retired; the replacement Windows task is not yet installed.
- Parser tests pass for namespaces, MB conversion, missing data, invalid numbers, unexpected HTML, unsafe XML and unknown status.

## Setup on this Windows PC

1. IT must resolve the NVR certificate validation: use a valid certificate/name, or verify the device certificate/issuing authority independently before installing the appropriate trust. Do not disable TLS validation. Use the same trusted origin in the IT page and local config.
2. Create/use an NVR account with permission to read storage only. Create/use a One Workspace account with IT `view` and `create` actions, without admin privileges; complete its initial password change first.
3. In PowerShell, run the script below. It prompts locally for both credentials; do not paste passwords into chat. It encrypts them with Windows DPAPI and restricts the local private folder. It runs a real collection/upload before installing the schedule.

```powershell
& 'C:\Users\Procus\Documents\Codex\2026-09-10\check-if-i-have-mcp-server\scripts\nvr\Setup-NvrCollector.ps1' -Portal https://your-one-workspace-address -InstallSchedule
```

The task runs at 09:00 on a Ghana/UTC computer. The configured Windows user must remain signed in (a locked screen is fine). For unattended operation while signed out, IT should install a service or password-backed task under a dedicated Windows account and create the DPAPI credentials under that account. This installer deliberately does not store a Windows login password.

The PC must be powered on and connected to the NVR network. Start-when-available handles a missed task when the scheduler becomes available, but never fabricates readings for missed dates. Inspect Windows Task Scheduler's Last Run Result and `private/queue` for failures. A successful upload moves the queued JSON into `private/history`; raw XML stays there too. Retention is manual for now.

## Add further NVRs

Register each recorder in the site's IT page first. Add an entry to `private/config.json` with a unique safe `key`, HTTPS `address` origin and `credentialFile`. Create its credential file with `Get-Credential | Export-Clixml` inside the protected private folder. Only explicitly configured devices are contacted. Adding a portal NVR does not automatically grant this collector credentials for it.

Never commit the private directory or share its contents. No credentials belong in frontend code or site bundles.

## Sources

- [Hikvision integration documentation](https://tpp.hikvision.com/IntegrationCenter)
- [Hikvision HDD SDK field definitions and MB units](https://open.hikvision.com/hardware/structures/NET_DVR_SINGLE_HD.html)
- [Zabbix SNMP monitoring](https://www.zabbix.com/documentation/7.4/en/manual/config/items/itemtypes/snmp)
- [Playwright browser automation](https://playwright.dev/)
