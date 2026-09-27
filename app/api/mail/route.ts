import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,oneOf,idOf,auditStatement,parseJson} from '../../server/core';
import {loadConnector,typeOf,outbound,authHeaders,apiBase,logStatement,canUseConnector,type ConnectorRow} from '../../server/connectors';
import {entityVisible,LINK_TYPES} from '../../server/collab';
import {defaultAcl} from '../../server/acl';
import {storeFile} from '../../server/file-store';
import {grantedCapabilities} from '../../connector-capabilities';
import type {Member} from '../../server/policy';

// Integrated mailbox and calendar for connected Outlook / Microsoft 365 and Gmail / Google Calendar accounts.
// Only capabilities covered by the connection's GRANTED scopes are available. Sending, replying, forwarding,
// moving, deleting and changing meetings need explicit confirmation, carry an idempotency key, and are audited.
// Email content is untrusted: it is returned as data and never interpreted as instructions.
type Ctx={c:ConnectorRow,family:'microsoft'|'google',caps:Set<string>};
async function open(u:Member,id:string):Promise<Ctx>{
 const c=await loadConnector(u.tenantId,id);const t=typeOf(c);
 if(!t.family)throw new HttpError(400,'This connector has no mailbox.');
 // Personal connections are used only by their owner; company mailboxes by people the connector is enabled for.
 const ok=c.scope==='user'?c.owner_member_id===u.id:(u.role==='admin'||canUseConnector(u,c,'app-pages')||canUseConnector(u,c,'assistant'));
 if(!ok)throw new HttpError(404,'Connector not found.');
 if(c.paused)throw new HttpError(409,`${c.name} is paused.`);if(c.status==='disabled')throw new HttpError(409,`${c.name} is disabled.`);
 return {c,family:t.family,caps:new Set(grantedCapabilities(t.family,c.granted_scopes||'').map(x=>x.id))};
}
function need(x:Ctx,cap:string,label:string){if(!x.caps.has(cap))throw new HttpError(403,`This connection was not granted permission to ${label}. Reconnect and grant it to use this.`)}
async function call(u:Member,x:Ctx,path:string,init:RequestInit={},op='read'){
 const base=apiBase(x.c);const started=Date.now();
 const r=await outbound(x.c,`${base}${path}`,{...init,retry:(init.method||'GET')==='GET',headers:{Accept:'application/json',...(init.body?{'Content-Type':'application/json'}:{}),...await authHeaders(x.c),...(init.headers as Record<string,string>||{})}});
 await logStatement(x.c,u.id,`mail.${op}`,r.ok?'ok':'error',Date.now()-started,{status:r.status}).run();
 if(r.status===401||r.status===403)throw new HttpError(403,`${x.c.name} refused the request. The permission may have been withdrawn; reconnect.`);
 if(!r.ok)throw new HttpError(502,`${x.c.name} answered ${r.status}.`);
 return r.status===202||r.status===204?null:r.json() as Promise<any>;
}
const clip=(s:unknown,n=400)=>String(s??'').slice(0,n);
const addr=(a:any)=>a?.emailAddress?`${a.emailAddress.name||''} <${a.emailAddress.address||''}>`.trim():'';
function gHeader(m:any,n:string){return (m.payload?.headers||[]).find((h:any)=>h.name.toLowerCase()===n.toLowerCase())?.value||''}
function gText(p:any):string{if(!p)return '';if(p.mimeType==='text/plain'&&p.body?.data)return atob(p.body.data.replace(/-/g,'+').replace(/_/g,'/'));for(const x of p.parts||[]){const t=gText(x);if(t)return t}return ''}
// Consequential actions: explicit confirmation, idempotency and audit.
async function confirmed(u:Member,x:Ctx,b:Record<string,unknown>,summary:string,run:()=>Promise<unknown>){
 if(b.confirm!==true)return {needsConfirmation:true,summary};
 const key=typeof b.idempotencyKey==='string'&&/^[\w-]{8,80}$/.test(b.idempotencyKey)?`mail:${x.c.id}:${b.idempotencyKey}`:null;
 if(key){const prev=await first<{response_json:string}>('SELECT response_json FROM idempotency_keys WHERE tenant_id=? AND key=?',u.tenantId,key);if(prev)return {...parseJson(prev.response_json,{}),replayed:true}}
 const out=await run();const res={ok:true,result:out??null};
 await batch([auditStatement(u,`Connected mailbox: ${summary}`,x.c.id,u.department,null,{connector:x.c.id,action:String(b.action)}),...(key?[stmt('INSERT OR IGNORE INTO idempotency_keys(id,tenant_id,key,response_json,created_at) VALUES(?,?,?,?,?)',uid(),u.tenantId,key,JSON.stringify(res),now())]:[])]);
 return res;
}
const recipients=(v:unknown)=>{const list=(Array.isArray(v)?v:String(v||'').split(/[;,]/)).map(s=>String(s).trim()).filter(Boolean).slice(0,50);if(!list.length)throw new HttpError(400,'Add at least one recipient.');for(const a of list)if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(a))throw new HttpError(400,`“${a}” is not a valid email address.`);return list};

export const GET=route(async(req,u)=>{
 const url=new URL(req.url);const q=(k:string)=>url.searchParams.get(k);
 const x=await open(u,idOf(q('connector'),'Connector'));const op=q('op')||'list';
 if(op==='capabilities')return {capabilities:[...x.caps],account:x.c.account_identity||'',provider:x.c.provider};
 if(x.family==='microsoft'){
  switch(op){
   case 'folders':need(x,'mail.read','read email');return {folders:((await call(u,x,'/me/mailFolders?$top=50'))?.value||[]).map((f:any)=>({id:f.id,name:f.displayName,unread:f.unreadItemCount,total:f.totalItemCount}))};
   case 'list':case 'search':{need(x,'mail.read','read email');const folder=q('folder')?encodeURIComponent(String(q('folder'))):'inbox';const sel='$select=id,subject,from,receivedDateTime,isRead,hasAttachments,bodyPreview,categories&$top=25';const path=op==='search'?`/me/messages?$search="${encodeURIComponent(str(q('q'),'Search',120).replace(/"/g,''))}"&${sel}`:`/me/mailFolders/${folder}/messages?${sel}&$orderby=receivedDateTime desc`;const d=await call(u,x,path);return {messages:(d?.value||[]).map((m:any)=>({id:m.id,subject:clip(m.subject,300),from:addr(m.from),receivedAt:m.receivedDateTime,isRead:m.isRead,hasAttachments:m.hasAttachments,preview:clip(m.bodyPreview,240),categories:m.categories||[]}))}}
   case 'read':{need(x,'mail.read','read email');const id=encodeURIComponent(str(q('id'),'Message',400));const m=await call(u,x,`/me/messages/${id}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,hasAttachments,categories,conversationId`,{headers:{Prefer:'outlook.body-content-type="text"'}});const att=m.hasAttachments?((await call(u,x,`/me/messages/${id}/attachments?$select=id,name,contentType,size`))?.value||[]):[];const links=await all('SELECT entity_type AS type,entity_id AS id,title FROM connector_links WHERE tenant_id=? AND connector_id=? AND external_id=?',u.tenantId,x.c.id,m.id);return {message:{id:m.id,subject:clip(m.subject,300),from:addr(m.from),to:(m.toRecipients||[]).map(addr),cc:(m.ccRecipients||[]).map(addr),receivedAt:m.receivedDateTime,body:clip(m.body?.content,100000),categories:m.categories||[],attachments:att.map((a:any)=>({id:a.id,name:a.name,contentType:a.contentType,size:a.size}))},links,untrusted:true}}
   case 'events':{need(x,'calendar.read','read the calendar');const start=q('start')||new Date().toISOString();const end=q('end')||new Date(Date.now()+14*86400000).toISOString();const d=await call(u,x,`/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$select=id,subject,start,end,location,organizer,attendees,isOnlineMeeting&$top=100`);return {events:(d?.value||[]).map((e:any)=>({id:e.id,subject:clip(e.subject,300),start:e.start?.dateTime,end:e.end?.dateTime,timeZone:e.start?.timeZone,location:e.location?.displayName||'',organizer:addr(e.organizer),attendees:(e.attendees||[]).map((a:any)=>addr(a)).slice(0,50)}))}}
   case 'contacts':{need(x,'contacts.read','read contacts');const d=await call(u,x,'/me/contacts?$top=100&$select=id,displayName,emailAddresses,companyName,jobTitle');return {contacts:(d?.value||[]).map((c:any)=>({id:c.id,name:c.displayName,email:c.emailAddresses?.[0]?.address||'',company:c.companyName||'',title:c.jobTitle||''}))}}
  }
 }else{
  switch(op){
   case 'folders':need(x,'mail.read','read email');return {folders:((await call(u,x,'/gmail/v1/users/me/labels'))?.labels||[]).map((l:any)=>({id:l.id,name:l.name}))};
   case 'list':case 'search':{need(x,'mail.read','read email');const ql=op==='search'?`&q=${encodeURIComponent(str(q('q'),'Search',120))}`:`&labelIds=${encodeURIComponent(q('folder')||'INBOX')}`;const ids=((await call(u,x,`/gmail/v1/users/me/messages?maxResults=20${ql}`))?.messages||[]).slice(0,20);const out=[];for(const m of ids){const d=await call(u,x,`/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);out.push({id:d.id,subject:clip(gHeader(d,'Subject'),300),from:clip(gHeader(d,'From'),200),receivedAt:new Date(Number(d.internalDate)).toISOString(),isRead:!(d.labelIds||[]).includes('UNREAD'),preview:clip(d.snippet,240),categories:d.labelIds||[]})}return {messages:out}}
   case 'read':{need(x,'mail.read','read email');const d=await call(u,x,`/gmail/v1/users/me/messages/${encodeURIComponent(str(q('id'),'Message',200))}?format=full`);const links=await all('SELECT entity_type AS type,entity_id AS id,title FROM connector_links WHERE tenant_id=? AND connector_id=? AND external_id=?',u.tenantId,x.c.id,d.id);return {message:{id:d.id,subject:clip(gHeader(d,'Subject'),300),from:clip(gHeader(d,'From')),to:[gHeader(d,'To')],cc:[gHeader(d,'Cc')].filter(Boolean),receivedAt:new Date(Number(d.internalDate)).toISOString(),body:clip(gText(d.payload),100000),categories:d.labelIds||[],attachments:[]},links,untrusted:true}}
   case 'events':{need(x,'calendar.read','read the calendar');const start=q('start')||new Date().toISOString();const end=q('end')||new Date(Date.now()+14*86400000).toISOString();const d=await call(u,x,`/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(start)}&timeMax=${encodeURIComponent(end)}&singleEvents=true&orderBy=startTime&maxResults=100`);return {events:(d?.items||[]).map((e:any)=>({id:e.id,subject:clip(e.summary,300),start:e.start?.dateTime||e.start?.date,end:e.end?.dateTime||e.end?.date,location:e.location||'',organizer:e.organizer?.email||'',attendees:(e.attendees||[]).map((a:any)=>a.email).slice(0,50)}))}}
  }
 }
 throw new HttpError(400,'Unsupported mailbox operation for this provider.');
});

export const POST=route(async(req,u)=>{
 const b=await readBody(req,500000);const action=String(b.action||'');const x=await open(u,idOf(b.connector,'Connector'));
 const ms=x.family==='microsoft';
 switch(action){
  case 'draft':{need(x,'mail.draft','create drafts');const to=recipients(b.to);const subject=str(b.subject,'Subject',300);const body=str(b.body,'Message',100000,false);
   const r=ms?await call(u,x,'/me/messages',{method:'POST',body:JSON.stringify({subject,body:{contentType:'Text',content:body},toRecipients:to.map(a=>({emailAddress:{address:a}}))})},'draft'):await call(u,x,'/gmail/v1/users/me/drafts',{method:'POST',body:JSON.stringify({message:{raw:rfc822(to,subject,body)}})},'draft');
   await auditStatement(u,'Connected mailbox: draft created',x.c.id,u.department,null,{recipients:to.length}).run();return {ok:true,id:r?.id||null};
  }
  case 'send':{need(x,'mail.send','send email');const to=recipients(b.to);const subject=str(b.subject,'Subject',300);const body=str(b.body,'Message',100000,false);
   return confirmed(u,x,b,`send “${subject}” to ${to.join(', ')}`,()=>ms?call(u,x,'/me/sendMail',{method:'POST',body:JSON.stringify({message:{subject,body:{contentType:'Text',content:body},toRecipients:to.map(a=>({emailAddress:{address:a}}))},saveToSentItems:true})},'send'):call(u,x,'/gmail/v1/users/me/messages/send',{method:'POST',body:JSON.stringify({raw:rfc822(to,subject,body)})},'send'));
  }
  case 'reply':case 'forward':{need(x,'mail.send','send email');if(!ms)throw new HttpError(400,'Reply and forward are available for Outlook.');const id=encodeURIComponent(str(b.id,'Message',400));const comment=str(b.body,'Message',100000,false);const to=action==='forward'?recipients(b.to):[];
   return confirmed(u,x,b,action==='reply'?'reply to a message':`forward a message to ${to.join(', ')}`,()=>call(u,x,`/me/messages/${id}/${action}`,{method:'POST',body:JSON.stringify(action==='reply'?{comment}:{comment,toRecipients:to.map(a=>({emailAddress:{address:a}}))})},action));
  }
  case 'move':case 'categorize':case 'delete':{need(x,'mail.organize','organise email');if(!ms)throw new HttpError(400,'Available for Outlook.');const id=encodeURIComponent(str(b.id,'Message',400));
   if(action==='move'){const dest=str(b.destination,'Folder',400);return confirmed(u,x,b,'move a message',()=>call(u,x,`/me/messages/${id}/move`,{method:'POST',body:JSON.stringify({destinationId:dest})},'move'))}
   if(action==='categorize'){const cats=(Array.isArray(b.categories)?b.categories:[]).map(String).slice(0,10);return confirmed(u,x,b,'categorise a message',()=>call(u,x,`/me/messages/${id}`,{method:'PATCH',body:JSON.stringify({categories:cats})},'categorize'))}
   return confirmed(u,x,b,'delete a message',()=>call(u,x,`/me/messages/${id}`,{method:'DELETE'},'delete'));
  }
  case 'event-create':case 'event-update':{need(x,'calendar.write','create and change meetings');if(!ms)throw new HttpError(400,'Available for Outlook.');
   const ev={subject:str(b.subject,'Subject',300),start:{dateTime:str(b.start,'Start',40),timeZone:str(b.timeZone||'UTC','Time zone',60)},end:{dateTime:str(b.end,'End',40),timeZone:str(b.timeZone||'UTC','Time zone',60)},location:{displayName:str(b.location,'Location',200,false)},attendees:(Array.isArray(b.attendees)?b.attendees:[]).map((a:unknown)=>({emailAddress:{address:String(a)},type:'required'})).slice(0,100),body:{contentType:'Text',content:str(b.body,'Details',20000,false)}};
   return confirmed(u,x,b,action==='event-create'?`create meeting “${ev.subject}”`:`change meeting “${ev.subject}”`,()=>action==='event-create'?call(u,x,'/me/events',{method:'POST',body:JSON.stringify(ev)},'event-create'):call(u,x,`/me/events/${encodeURIComponent(str(b.id,'Event',400))}`,{method:'PATCH',body:JSON.stringify(ev)},'event-update'));
  }
  case 'save-attachment':{need(x,'mail.read','read email');if(!ms)throw new HttpError(400,'Available for Outlook.');const a=await call(u,x,`/me/messages/${encodeURIComponent(str(b.id,'Message',400))}/attachments/${encodeURIComponent(str(b.attachmentId,'Attachment',400))}`,{},'attachment');
   if(!a?.contentBytes)throw new HttpError(415,'This attachment cannot be saved.');const bytes=Uint8Array.from(atob(a.contentBytes),c=>c.charCodeAt(0));
   const links:{type:string,id:string}[]=[];if(b.entityType){const type=oneOf(b.entityType,LINK_TYPES,'record type');const id=idOf(b.entityId,'Record');await entityVisible(u,type,id);links.push({type,id})}
   // Saved attachments start private to the person saving them (or their department), like any upload.
   const fileId=await storeFile(u,{name:str(a.name,'File name',200),mime:String(a.contentType||'application/octet-stream'),bytes,acl:defaultAcl(u),links,description:'Saved from email'});return {fileId};
  }
  case 'link':case 'unlink':{
   const type=oneOf(b.entityType,LINK_TYPES,'record type');const id=idOf(b.entityId,'Record');await entityVisible(u,type,id);const ext=str(b.externalId,'Message',400);
   if(action==='link')await batch([stmt('INSERT INTO connector_links(id,tenant_id,connector_id,external_type,external_id,entity_type,entity_id,title,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,x.c.id,oneOf(b.externalType||'message',['message','event'] as const,'item type'),ext,type,id,str(b.title,'Title',300,false),u.id,now()),auditStatement(u,'Email linked to a record',id,u.department,null,{type,connector:x.c.id})]);
   else await batch([stmt('DELETE FROM connector_links WHERE tenant_id=? AND connector_id=? AND external_id=? AND entity_type=? AND entity_id=?',u.tenantId,x.c.id,ext,type,id),auditStatement(u,'Email unlinked from a record',id,u.department,null,{type})]);
   return {ok:true};
  }
 }
 throw new HttpError(400,'Unknown action.');
});
function rfc822(to:string[],subject:string,body:string){const s=`To: ${to.join(', ')}\r\nSubject: ${subject.replace(/[\r\n]/g,' ')}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${body}`;return btoa(unescape(encodeURIComponent(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
