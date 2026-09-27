'use client';
import {useState} from 'react';
import {api,useApi,ago,dateTime,cx} from './lib';
import {useApp,Btn,Chip,Header,Field,ErrorNote,Skeleton,Empty,Icon,Modal,Note,Tabs} from './kit';

// Connected mailbox and calendar (Outlook / Microsoft 365, Gmail / Google Calendar). Only actions covered by
// the connection's granted permissions are offered. Sending, replying, forwarding, moving, deleting and
// meeting changes are confirmed first (the server also refuses them without confirmation) and audited.
// Email content is untrusted and shown as plain text.
type Cap={capabilities:string[],account:string,provider:string};
type MsgRow={id:string,subject:string,from:string,receivedAt:string,isRead?:boolean,hasAttachments?:boolean,preview:string};
type Full={id:string,subject:string,from:string,to:string[],cc?:string[],receivedAt:string,body:string,attachments?:{id:string,name:string,contentType:string,size:number}[],links?:{type:string,id:string,title:string}[]};
const key=()=>Array.from(crypto.getRandomValues(new Uint8Array(12)),x=>x.toString(16).padStart(2,'0')).join('');

export default function Mailbox({connectorId}:{connectorId:string}){
 const {data:cap,error}=useApi<Cap>(`/api/mail?connector=${connectorId}&op=capabilities`);const [tab,setTab]=useState('mail');
 if(error)return <ErrorNote error={error}/>;
 if(!cap)return <Skeleton/>;
 const has=(c:string)=>cap.capabilities.includes(c);
 const tabs=[...(has('mail.read')?[{id:'mail',label:'Mail'}]:[]),...(has('calendar.read')?[{id:'calendar',label:'Calendar'}]:[]),...(has('contacts.read')?[{id:'contacts',label:'Contacts'}]:[])];
 if(!tabs.length)return <Note>This connection was not granted permission to read mail, calendar or contacts. Reconnect and grant the capabilities you need.</Note>;
 const cur=tabs.some(t=>t.id===tab)?tab:tabs[0].id;
 return <div className="stack">
  <p className="muted small">Signed in as <b>{cap.account||'unknown account'}</b>. Granted: {cap.capabilities.join(', ')}. Email content is shown as untrusted text.</p>
  <Tabs value={cur} onChange={setTab} items={tabs}/>
  {cur==='mail'&&<Mail connectorId={connectorId} has={has}/>}
  {cur==='calendar'&&<Calendar connectorId={connectorId} has={has}/>}
  {cur==='contacts'&&<Contacts connectorId={connectorId}/>}
 </div>;
}
// Every consequential action: the server answers needsConfirmation first; we show its summary and resend with confirm.
function useConfirmed(connectorId:string){
 const {ask,toast}=useApp();
 return async(body:Record<string,unknown>,done:string)=>{try{const idem=key();const first=await api<{needsConfirmation?:boolean,summary?:string}>('/api/mail',{connector:connectorId,...body,idempotencyKey:idem});
  if(first.needsConfirmation){if(await ask({title:'Confirm',body:<>This will {first.summary}. It happens in the connected account and is recorded in the audit log.</>,confirm:'Confirm',danger:body.action==='delete'})===false)return false;await api('/api/mail',{connector:connectorId,...body,idempotencyKey:idem,confirm:true})}
  toast(done);return true}catch(e){toast((e as Error).message,'error');return false}};
}
function Mail({connectorId,has}:{connectorId:string,has:(c:string)=>boolean}){
 const [q,setQ]=useState('');const [search,setSearch]=useState('');const [open,setOpen]=useState<string|null>(null);const [compose,setCompose]=useState<{to:string,subject:string,body:string,mode:'new'|'reply'|'forward',id?:string}|null>(null);
 const {data,error,reload}=useApi<{messages:MsgRow[]}>(`/api/mail?connector=${connectorId}&op=${search?'search':'list'}${search?`&q=${encodeURIComponent(search)}`:''}`);
 return <div className="mailbox">
  <div className="toolbar"><form onSubmit={e=>{e.preventDefault();setSearch(q.trim())}}><input className="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search mail…" aria-label="Search mail"/></form><Btn icon="RefreshCw" title="Refresh" onClick={reload}/><div className="grow"/>{(has('mail.send')||has('mail.draft'))&&<Btn variant="primary" icon="PenLine" onClick={()=>setCompose({to:'',subject:'',body:'',mode:'new'})}>New message</Btn>}</div>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:!data.messages.length?<Empty icon="Inbox" title="No messages"/>:<div className="mini-list">{data.messages.map(m=><button key={m.id} className={cx('mini-row mail-row',m.isRead===false&&'unread',open===m.id&&'on')} onClick={()=>setOpen(m.id)}><Icon name={m.hasAttachments?'Paperclip':'Mail'} size={15}/><span><b>{m.subject||'(no subject)'}</b><small>{m.from} · {ago(m.receivedAt)}</small><small className="muted">{m.preview}</small></span></button>)}</div>}
  {open&&<Reader connectorId={connectorId} id={open} has={has} onClose={()=>setOpen(null)} onChanged={()=>{setOpen(null);reload()}} onReply={(m,mode)=>setCompose({to:mode==='reply'?m.from:'',subject:`${mode==='reply'?'Re':'Fw'}: ${m.subject}`,body:'',mode,id:m.id})}/>}
  {compose&&<Compose connectorId={connectorId} has={has} v={compose} onClose={()=>setCompose(null)} onSent={()=>{setCompose(null);reload()}}/>}
 </div>;
}
function Reader({connectorId,id,has,onClose,onChanged,onReply}:{connectorId:string,id:string,has:(c:string)=>boolean,onClose:()=>void,onChanged:()=>void,onReply:(m:Full,mode:'reply'|'forward')=>void}){
 const {toast,ask}=useApp();const {data,error}=useApi<{message:Full}>(`/api/mail?connector=${connectorId}&op=read&id=${encodeURIComponent(id)}`);const confirm=useConfirmed(connectorId);
 const m=data?.message;
 return <Modal open wide onClose={onClose} title={m?.subject||'Message'} subtitle={m&&`${m.from} · ${dateTime(m.receivedAt)}`} footer={m&&<>
  {has('mail.send')&&<><Btn icon="Reply" onClick={()=>onReply(m,'reply')}>Reply</Btn><Btn icon="Forward" onClick={()=>onReply(m,'forward')}>Forward</Btn></>}
  <Btn icon="Link" onClick={async()=>{const t=await ask({title:'Link this email to a record',body:'Enter the record as type:id (for example project:abc123 or task:xyz).',input:{label:'Record',required:true},confirm:'Link'});if(t===false)return;const [entityType,entityId]=t.split(':').map(s=>s.trim());try{await api('/api/mail',{connector:connectorId,action:'link',entityType,entityId,externalId:m.id,title:m.subject});toast('Linked')}catch(e){toast((e as Error).message,'error')}}}>Link to record</Btn>
  <Btn icon="ListTodo" onClick={async()=>{try{const r=await api<{id:string}>('/api/tasks',{action:'save',title:m.subject.slice(0,200)||'Email follow-up',description:`From ${m.from} on ${dateTime(m.receivedAt)}:

${m.body.slice(0,4000)}`,assignees:[]});await api('/api/mail',{connector:connectorId,action:'link',entityType:'task',entityId:r.id,externalId:m.id,title:m.subject}).catch(()=>{});toast('Task created');location.hash=`#/tasks/mine/${r.id}`}catch(e){toast((e as Error).message,'error')}}}>Create task</Btn>
  <Btn icon="LifeBuoy" onClick={async()=>{try{const r=await api<{id:string}>('/api/tickets',{action:'create',title:m.subject.slice(0,200)||'Email request',description:`From ${m.from}:

${m.body.slice(0,4000)}`});await api('/api/mail',{connector:connectorId,action:'link',entityType:'ticket',entityId:r.id,externalId:m.id,title:m.subject}).catch(()=>{});toast('Ticket created');location.hash=`#/tickets/${r.id}`}catch(e){toast((e as Error).message,'error')}}}>Create ticket</Btn>
  <div className="grow"/>{has('mail.organize')&&<Btn variant="danger" icon="Trash2" onClick={async()=>{if(await confirm({action:'delete',id:m.id},'Deleted'))onChanged()}}>Delete</Btn>}</>}>
  <ErrorNote error={error}/>{!m?<Skeleton/>:<>
   <p className="small muted">To: {m.to.join(', ')}{m.cc?.length?` · Cc: ${m.cc.join(', ')}`:''}</p>
   <pre className="mail-body">{m.body}</pre>
   {!!m.attachments?.length&&<div className="stack-sm"><b>Attachments</b>{m.attachments.map(a=><div key={a.id} className="mini-row"><Icon name="Paperclip" size={14}/><span>{a.name}<small>{a.contentType} · {Math.round(a.size/1024)} KB</small></span><Btn size="sm" icon="FolderInput" onClick={async()=>{try{const r=await api<{fileId:string}>('/api/mail',{connector:connectorId,action:'save-attachment',id:m.id,attachmentId:a.id});toast('Saved to Files (private to you until you share it)');location.hash=`#/files/root/${r.fileId}`}catch(e){toast((e as Error).message,'error')}}}>Save to Files</Btn></div>)}</div>}
   {!!m.links?.length&&<p className="small">Linked to: {m.links.map(l=>`${l.type} ${l.title||l.id}`).join(', ')}</p>}
  </>}
 </Modal>;
}
function Compose({connectorId,has,v,onClose,onSent}:{connectorId:string,has:(c:string)=>boolean,v:{to:string,subject:string,body:string,mode:'new'|'reply'|'forward',id?:string},onClose:()=>void,onSent:()=>void}){
 const {toast}=useApp();const [f,setF]=useState(v);const confirm=useConfirmed(connectorId);const [busy,setBusy]=useState(false);
 const to=f.to.split(/[;,]/).map(s=>s.replace(/.*<([^>]+)>.*/,'$1').trim()).filter(Boolean);
 async function send(){setBusy(true);const body=f.mode==='new'?{action:'send',to,subject:f.subject,body:f.body}:f.mode==='reply'?{action:'reply',id:f.id,body:f.body}:{action:'forward',id:f.id,to,body:f.body};if(await confirm(body,'Sent'))onSent();setBusy(false)}
 return <Modal open wide onClose={onClose} title={f.mode==='new'?'New message':f.mode==='reply'?'Reply':'Forward'} footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn>{f.mode==='new'&&has('mail.draft')&&<Btn onClick={async()=>{try{await api('/api/mail',{connector:connectorId,action:'draft',to,subject:f.subject,body:f.body});toast('Draft saved in the mailbox');onSent()}catch(e){toast((e as Error).message,'error')}}}>Save draft</Btn>}{has('mail.send')&&<Btn variant="primary" icon="Send" busy={busy} disabled={f.mode!=='reply'&&!to.length} onClick={send}>Send…</Btn>}</>}>
  <div className="form-grid">{f.mode!=='reply'&&<Field label="To" wide hint="Separate addresses with commas."><input value={f.to} onChange={e=>setF({...f,to:e.target.value})}/></Field>}{f.mode==='new'&&<Field label="Subject" wide><input value={f.subject} onChange={e=>setF({...f,subject:e.target.value})}/></Field>}<Field label="Message" wide><textarea rows={10} value={f.body} onChange={e=>setF({...f,body:e.target.value})}/></Field></div>
  <Note>Nothing is sent until you confirm the recipients and subject in the next step.</Note>
 </Modal>;
}
function Calendar({connectorId,has}:{connectorId:string,has:(c:string)=>boolean}){
 const {data,error,reload}=useApi<{events:{id:string,subject:string,start:string,end:string,location:string,organizer:string,attendees:string[]}[]}>(`/api/mail?connector=${connectorId}&op=events`);const [edit,setEdit]=useState<{id?:string,subject:string,start:string,end:string,location:string,attendees:string,body:string}|null>(null);const confirm=useConfirmed(connectorId);
 return <div className="stack"><div className="toolbar"><span className="muted small">Next 14 days</span><div className="grow"/>{has('calendar.write')&&<Btn variant="primary" icon="CalendarPlus" onClick={()=>setEdit({subject:'',start:'',end:'',location:'',attendees:'',body:''})}>New meeting</Btn>}</div><ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:!data.events.length?<Empty icon="CalendarDays" title="No meetings in the next 14 days"/>:<table className="plain"><tbody>{data.events.map(e=><tr key={e.id}><td>{dateTime(e.start)}</td><td><b>{e.subject}</b><br/><small className="muted">{e.location}{e.organizer?` · ${e.organizer}`:''}</small></td><td className="small muted">{e.attendees.length} attendees</td><td>{has('calendar.write')&&<Btn size="sm" icon="Pencil" onClick={()=>setEdit({id:e.id,subject:e.subject,start:e.start?.slice(0,16)||'',end:e.end?.slice(0,16)||'',location:e.location,attendees:e.attendees.map(a=>a.replace(/.*<([^>]+)>.*/,'$1')).join(', '),body:''})}>Change</Btn>}</td></tr>)}</tbody></table>}
  {edit&&<Modal open onClose={()=>setEdit(null)} title={edit.id?'Change meeting':'New meeting'} footer={<><Btn variant="ghost" onClick={()=>setEdit(null)}>Cancel</Btn><Btn variant="primary" disabled={!edit.subject||!edit.start||!edit.end} onClick={async()=>{if(await confirm({action:edit.id?'event-update':'event-create',id:edit.id,subject:edit.subject,start:edit.start+':00',end:edit.end+':00',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone,location:edit.location,attendees:edit.attendees.split(/[;,]/).map(s=>s.trim()).filter(Boolean),body:edit.body},edit.id?'Meeting changed':'Meeting created')){setEdit(null);reload()}}}>Save…</Btn></>}>
   <div className="form-grid"><Field label="Subject" wide><input value={edit.subject} onChange={e=>setEdit({...edit,subject:e.target.value})}/></Field><Field label="Start"><input type="datetime-local" value={edit.start} onChange={e=>setEdit({...edit,start:e.target.value})}/></Field><Field label="End"><input type="datetime-local" value={edit.end} onChange={e=>setEdit({...edit,end:e.target.value})}/></Field><Field label="Location" wide><input value={edit.location} onChange={e=>setEdit({...edit,location:e.target.value})}/></Field><Field label="Attendees" wide hint="Email addresses, comma separated. They receive invitations."><input value={edit.attendees} onChange={e=>setEdit({...edit,attendees:e.target.value})}/></Field><Field label="Details" wide><textarea rows={3} value={edit.body} onChange={e=>setEdit({...edit,body:e.target.value})}/></Field></div>
  </Modal>}
 </div>;
}
function Contacts({connectorId}:{connectorId:string}){const {data,error}=useApi<{contacts:{id:string,name:string,email:string,company:string,title:string}[]}>(`/api/mail?connector=${connectorId}&op=contacts`);return <><ErrorNote error={error}/>{!data?<Skeleton/>:!data.contacts.length?<Empty icon="Contact" title="No contacts"/>:<table className="plain"><tbody>{data.contacts.map(c=><tr key={c.id}><td><b>{c.name}</b></td><td>{c.email}</td><td className="muted">{[c.title,c.company].filter(Boolean).join(' · ')}</td></tr>)}</tbody></table>}</>}
export {Header,Chip};
