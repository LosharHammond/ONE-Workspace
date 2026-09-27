// Connector capability registry. A capability is offered in One Workspace only when the connection's GRANTED
// scopes include one of its scopes. When connecting, users choose capabilities; the least-privilege scope set is
// requested (the first scope of each chosen capability).
export type Capability={id:string,label:string,description:string,scopes:string[],mutating:boolean};
const ms=(id:string,label:string,description:string,scopes:string[],mutating=false):Capability=>({id,label,description,scopes,mutating});
export const microsoftCapabilities:Capability[]=[
 ms('mail.read','Read email','Inbox, folders, search and messages.',['Mail.Read','Mail.ReadWrite']),
 ms('mail.draft','Create drafts','Save drafts in the mailbox.',['Mail.ReadWrite'],true),
 ms('mail.send','Send email','Send, reply and forward (always confirmed).',['Mail.Send'],true),
 ms('mail.organize','Move, categorise and delete email','Always confirmed.',['Mail.ReadWrite'],true),
 ms('calendar.read','Read calendar','Events and meetings.',['Calendars.Read','Calendars.ReadWrite']),
 ms('calendar.write','Create and change meetings','Always confirmed.',['Calendars.ReadWrite'],true),
 ms('contacts.read','Read contacts','Contacts.',['Contacts.Read','Contacts.ReadWrite']),
 ms('files.read','Read OneDrive files','Files in OneDrive.',['Files.Read','Files.Read.All','Files.ReadWrite']),
 ms('sites.read','Read SharePoint sites','Sites and document libraries.',['Sites.Read.All']),
 ms('teams.read','Read Teams','Joined teams and channels.',['Team.ReadBasic.All']),
];
const g=(s:string)=>`https://www.googleapis.com/auth/${s}`;
export const googleCapabilities:Capability[]=[
 ms('mail.read','Read email','Gmail messages and search.',[g('gmail.readonly'),g('gmail.modify')]),
 ms('mail.draft','Create drafts','Gmail drafts.',[g('gmail.compose')],true),
 ms('mail.send','Send email','Always confirmed.',[g('gmail.send')],true),
 ms('mail.organize','Label and delete email','Always confirmed.',[g('gmail.modify')],true),
 ms('calendar.read','Read calendar','Google Calendar events.',[g('calendar.readonly'),g('calendar.events')]),
 ms('calendar.write','Create and change events','Always confirmed.',[g('calendar.events')],true),
 ms('files.read','Read Drive files','Google Drive.',[g('drive.readonly')]),
];
export const capabilitiesFor=(family?:string)=>family==='microsoft'?microsoftCapabilities:family==='google'?googleCapabilities:[];
export function grantedCapabilities(family:string|undefined,granted:string){
 const have=new Set(granted.split(/[\s,]+/).filter(Boolean).map(s=>s.toLowerCase()));
 return capabilitiesFor(family).filter(c=>c.scopes.some(s=>have.has(s.toLowerCase())||have.has(s.split('/').pop()!.toLowerCase())));
}
export function scopesFor(family:string|undefined,capabilityIds:string[]){const caps=capabilitiesFor(family).filter(c=>capabilityIds.includes(c.id));return [...new Set(caps.map(c=>c.scopes[0]))]}
