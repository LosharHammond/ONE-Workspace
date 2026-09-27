'use client';
import {useEffect,useRef,useState} from 'react';
import {api,useApi,go,ago,cx,bytes,downloadCsv} from './lib';
import {useApp,Btn,Chip,Header,Field,Avatar,Markdown,ErrorNote,Skeleton,Empty,Icon,Menu,Modal,Note,PersonSelect,DeptSelect} from './kit';
import {AiActions} from './assistant';
import {useRecorder} from './voice';
import {fileIcon} from './files';

// Company messaging: channels, direct and group conversations, threads, reactions, pins, bookmarks,
// attachments (shared with exactly the channel's audience), voice notes, search and moderation.
// Updates arrive by short polling every few seconds while the conversation is open.
type Channel={id:string,kind:string,name:string,description:string,refId:string,posting:string,lastMessageAt:string|null,unread:number,notify:string,canModerate:boolean};
type Msg={id:string,channelId:string,threadId:string|null,authorId:string,body:string,kind:string,deleted:boolean,hidden:boolean,editedAt:string|null,pinned:boolean,createdAt:string,reactions:Record<string,{count:number,mine:boolean}>,bookmarked:boolean,files:{id:string,name:string,mime:string,bytes:number,status:string}[],replies:number};
type ChannelData={channel:{id:string,kind:string,name:string,description:string,posting:string,refId:string},messages:Msg[],pinned:Msg[],typing:string[],members:{id:string,name:string,role:string,lastReadAt?:string,online?:boolean}[],presence?:boolean,canPost:boolean,canModerate:boolean,now:string};
const REACTIONS=['👍','❤️','😂','🎉','👀','🙏','✅'];
const kindIcon:Record<string,string>={company:'Building2',department:'Users',project:'FolderKanban',space:'LibraryBig',group:'UsersRound',custom:'Hash',announcement:'Megaphone',dm:'User',multi:'Users'};

export default function Messages({parts}:{parts:string[]}){
 const {s,toast}=useApp();const {data,error,reload}=useApi<{channels:Channel[]}>('/api/messages');const [creating,setCreating]=useState<string|null>(null);const [q,setQ]=useState('');
 useEffect(()=>{const t=setInterval(()=>{if(!document.hidden)reload()},15000);return()=>clearInterval(t)},[reload]);
 const view=parts[0]||'';const threadId=parts[1]==='t'?parts[2]:undefined;
 const current=data?.channels.find(c=>c.id===view);
 useEffect(()=>{if(!view&&data?.channels.length&&window.innerWidth>900){const g=data.channels.find(c=>c.kind==='company')||data.channels[0];go(`messages/${g.id}`)}},[view,data]);
 const groups:[string,Channel[]][]=[['Channels',(data?.channels||[]).filter(c=>!['dm','multi'].includes(c.kind))],['Direct messages',(data?.channels||[]).filter(c=>['dm','multi'].includes(c.kind))]];
 return <div className={cx('page messenger',view&&'has-channel')}>
  <aside className="msg-list" aria-label="Conversations">
   <div className="msg-list-head"><h1>Messages</h1><Menu trigger={o=><Btn size="sm" variant="primary" icon="Plus" title="New conversation" onClick={o}/>} items={[{label:'Message someone',icon:'User',onClick:()=>setCreating('dm')},{label:'New channel',icon:'Hash',onClick:()=>setCreating('channel')}]}/></div>
   <form onSubmit={e=>{e.preventDefault();if(q.trim().length>1)go(`messages/search?q=${encodeURIComponent(q.trim())}`)}}><input className="search" value={q} onChange={e=>setQ(e.target.value)} placeholder="Search messages…" aria-label="Search messages"/></form>
   <ErrorNote error={error} onRetry={reload}/>
   {!data?<Skeleton/>:groups.map(([g,list])=><div key={g}><p className="rail-section">{g}</p>{list.map(c=><a key={c.id} href={`#/messages/${c.id}`} className={cx('msg-chan',c.id===view&&'on',c.unread>0&&'unread')}><Icon name={kindIcon[c.kind]||'Hash'} size={15}/><span>{['dm','multi'].includes(c.kind)?c.name:`#${c.name}`}</span>{c.unread>0&&<b className="badge">{c.unread>99?'99+':c.unread}</b>}</a>)}{!list.length&&<p className="muted small">None yet.</p>}</div>)}
   <p className="rail-section">More</p><a className={cx('msg-chan',view==='bookmarks'&&'on')} href="#/messages/bookmarks"><Icon name="Bookmark" size={15}/><span>Saved messages</span></a>{s.user.role==='admin'&&<><a className={cx('msg-chan',view==='reports'&&'on')} href="#/messages/reports"><Icon name="Flag" size={15}/><span>Reports</span></a><a className={cx('msg-chan',view==='settings'&&'on')} href="#/messages/settings"><Icon name="Settings" size={15}/><span>Messaging policies</span></a></>}
  </aside>
  <section className="msg-main">
   {view==='search'?<Search/>:view==='bookmarks'?<Bookmarks/>:view==='reports'?<Reports/>:view==='settings'?<Policies/>:current?<Conversation key={current.id} channel={current} threadId={threadId} onRead={reload}/>:view&&data?<Empty icon="MessageSquare" title="Conversation not found">It may have been archived, or you are no longer a member.</Empty>:<Empty icon="MessageSquare" title="Choose a conversation"/>}
  </section>
  {creating&&<NewConversation mode={creating} onClose={()=>setCreating(null)} onDone={id=>{setCreating(null);reload();go(`messages/${id}`)}}/>}
  {void toast}
 </div>;
}
function Conversation({channel,threadId,onRead}:{channel:Channel,threadId?:string,onRead:()=>void}){
 const {toast,ask,person,s}=useApp();const [data,setData]=useState<ChannelData|null>(null);const [error,setError]=useState('');const [older,setOlder]=useState(true);
 const since=useRef<string>('');const listRef=useRef<HTMLDivElement>(null);const atBottom=useRef(true);
 const merge=(list:Msg[],incoming:Msg[])=>{const m=new Map(list.map(x=>[x.id,x]));for(const x of incoming)m.set(x.id,x);return [...m.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt))};
 async function load(full=false){try{const qs=new URLSearchParams({channel:channel.id});if(!full&&since.current)qs.set('since',since.current);const d=await api<ChannelData>(`/api/messages?${qs}`);since.current=d.now;setData(cur=>full||!cur?d:{...d,messages:merge(cur.messages,d.messages),pinned:cur.pinned});setError('')}catch(e){setError((e as Error).message)}}
 useEffect(()=>{since.current='';setData(null);load(true).then(()=>api('/api/messages',{action:'read',channelId:channel.id}).then(onRead).catch(()=>{}));const t=setInterval(()=>{if(!document.hidden)load()},4000);return()=>clearInterval(t)// eslint-disable-next-line react-hooks/exhaustive-deps
 },[channel.id]);
 useEffect(()=>{if(atBottom.current&&listRef.current)listRef.current.scrollTop=listRef.current.scrollHeight},[data?.messages.length]);
 const lastSeen=useRef(0);useEffect(()=>{const n=data?.messages.length||0;if(n>lastSeen.current&&lastSeen.current>0)api('/api/messages',{action:'read',channelId:channel.id}).catch(()=>{});lastSeen.current=n},[data?.messages.length,channel.id]);
 async function loadOlder(){if(!data?.messages.length)return;const d=await api<ChannelData>(`/api/messages?channel=${channel.id}&before=${encodeURIComponent(data.messages[0].createdAt)}`);if(d.messages.length<60)setOlder(false);setData(cur=>cur&&{...cur,messages:merge(cur.messages,d.messages)})}
 const msgAct=async(m:Msg,body:Record<string,unknown>,msg?:string)=>{try{await api('/api/messages',{messageId:m.id,...body});if(msg)toast(msg);since.current='';load(true)}catch(e){toast((e as Error).message,'error')}};
 if(error&&!data)return <ErrorNote error={error} onRetry={()=>load(true)}/>;
 if(!data)return <Skeleton rows={8}/>;
 const c=data.channel;const dm=['dm','multi'].includes(c.kind);
 const readBy=(m:Msg)=>dm?data.members.filter(x=>x.id!==s.user.id&&x.lastReadAt&&x.lastReadAt>=m.createdAt).map(x=>x.name):[];
 return <div className="conversation">
  <header className="conv-head"><Btn size="sm" variant="ghost" icon="ArrowLeft" className="only-mobile" title="Back" onClick={()=>go('messages')}/><div><h2>{dm?channel.name:`#${c.name}`}</h2><small className="muted">{c.description||(c.kind==='announcement'?'Announcements only':c.kind)}{data.members.length>0&&` · ${data.members.length} people`}{data.presence&&dm&&data.members.filter(x=>x.id!==s.user.id).map(x=><span key={x.id} className={cx('presence',x.online&&'on')} title={x.online?`${x.name} is active`:`${x.name} is away`}> {x.online?'● active':'○ away'}</span>)}</small></div><div className="grow"/>
   <AiActions entity="channel" entityId={c.id}/>
   <Menu trigger={o=><Btn size="sm" variant="ghost" icon="Ellipsis" title="Conversation options" onClick={o}/>} items={[{label:`Notifications: ${channel.notify}`,icon:'Bell',onClick:async()=>{const next=channel.notify==='all'?'mentions':channel.notify==='mentions'?'none':'all';await api('/api/messages',{action:'notify',channelId:c.id,level:next});toast(`Notifications: ${next}`);onRead()}},{label:'Export conversation',icon:'Download',hidden:s.user.role!=='admin',onClick:async()=>{const r=await api<{messages:{createdAt:string,author:string,body:string,deletedAt:string|null}[]}>('/api/messages',{action:'export',channelId:c.id});downloadCsv(`${c.name}.csv`,[['Time','Author','Message','Deleted'],...r.messages.map(m=>[m.createdAt,m.author,m.body,m.deletedAt||''])])}},{label:'Manage members',icon:'Users',hidden:!['custom','multi','announcement'].includes(c.kind),onClick:async()=>{const n=await ask({title:'Add someone',input:{label:'Name or email',required:true}});if(n===false)return;const p=s.people.find(x=>x.active&&(x.email.toLowerCase()===n.trim().toLowerCase()||x.name.toLowerCase()===n.trim().toLowerCase()));if(!p){toast('No active person with that name or email','error');return}try{await api('/api/messages',{action:'members',channelId:c.id,add:[p.id]});toast('Added');load(true)}catch(e){toast((e as Error).message,'error')}}},'-',{label:'Archive channel',icon:'Archive',danger:true,hidden:!data.canModerate||c.kind==='company',onClick:async()=>{if(await ask({title:`Archive #${c.name}?`,confirm:'Archive',danger:true})===false)return;await api('/api/messages',{action:'archive',channelId:c.id});onRead();go('messages')}}]}/>
  </header>
  {data.pinned.length>0&&<details className="pins"><summary><Icon name="Pin" size={13}/> {data.pinned.length} pinned</summary>{data.pinned.map(m=><p key={m.id} className="small"><b>{person(m.authorId)?.name}</b>: {m.body.slice(0,200)}</p>)}</details>}
  <div className="conv-body" ref={listRef} onScroll={e=>{const el=e.currentTarget;atBottom.current=el.scrollHeight-el.scrollTop-el.clientHeight<80}} role="log" aria-live="polite">
   {older&&data.messages.length>=60&&<Btn size="sm" variant="ghost" onClick={loadOlder}>Load earlier messages</Btn>}
   {!data.messages.length&&<Empty icon="MessageSquare" title="No messages yet">Say hello.</Empty>}
   {data.messages.map((m,i)=>{const prev=data.messages[i-1];const grouped=prev&&prev.authorId===m.authorId&&Date.parse(m.createdAt)-Date.parse(prev.createdAt)<5*60000;const rb=readBy(m);
    return <MessageRow key={m.id} m={m} grouped={!!grouped} mine={m.authorId===s.user.id} canModerate={data.canModerate} dm={dm} readBy={i===data.messages.length-1?rb:[]} onThread={()=>go(`messages/${c.id}/t/${m.id}`)} act={(b,msg)=>msgAct(m,b,msg)}/>})}
  </div>
  {data.typing.length>0&&<p className="typing muted small">{data.typing.join(', ')} {data.typing.length>1?'are':'is'} typing…</p>}
  {data.canPost?<Composer channelId={c.id} onSent={()=>{atBottom.current=true;load()}}/>:<Note>Only administrators post in this channel.</Note>}
  {threadId&&<ThreadPanel channelId={c.id} threadId={threadId} canPost={data.canPost} canModerate={data.canModerate} onClose={()=>go(`messages/${c.id}`)}/>}
 </div>;
}
function MessageRow({m,grouped,mine,canModerate,dm,readBy,onThread,act,inThread}:{m:Msg,grouped:boolean,mine:boolean,canModerate:boolean,dm:boolean,readBy:string[],onThread?:()=>void,act:(b:Record<string,unknown>,msg?:string)=>void,inThread?:boolean}){
 const {person,ask}=useApp();const [editing,setEditing]=useState(false);const [text,setText]=useState(m.body);const name=person(m.authorId)?.name||'Someone';
 return <article className={cx('msg',grouped&&'grouped',m.hidden&&'hidden-msg')} aria-label={`${name}, ${ago(m.createdAt)}`}>
  {!grouped?<Avatar name={name} size={32}/>:<span className="msg-gutter"/>}
  <div className="msg-main-col">
   {!grouped&&<div className="msg-meta"><b>{name}</b><time dateTime={m.createdAt} title={new Date(m.createdAt).toLocaleString()}>{ago(m.createdAt)}</time>{m.pinned&&<Icon name="Pin" size={12}/>}</div>}
   {m.deleted?<p className="muted small"><i>This message was deleted.</i></p>:m.hidden&&!m.body?<p className="muted small"><i>Hidden by a moderator.</i></p>:editing?<form onSubmit={e=>{e.preventDefault();act({action:'edit',body:text},'Edited');setEditing(false)}}><textarea value={text} onChange={e=>setText(e.target.value)} rows={2} aria-label="Edit message"/><div className="row-gap"><Btn size="sm" type="submit" variant="primary">Save</Btn><Btn size="sm" variant="ghost" onClick={()=>setEditing(false)}>Cancel</Btn></div></form>:<div className="msg-body">{m.hidden&&<Chip tone="amber">Hidden</Chip>}<Markdown text={m.body}/>{m.editedAt&&<small className="muted"> (edited)</small>}</div>}
   {m.files.length>0&&<div className="msg-files">{m.files.map(f=>f.mime.startsWith('audio/')?<audio key={f.id} controls src={`/api/files?preview=${f.id}`} aria-label={`Voice note ${f.name}`}/>:f.mime.startsWith('image/')?<a key={f.id} href={`#/files/root/${f.id}`}><img src={`/api/files?preview=${f.id}`} alt={f.name} className="msg-img"/></a>:<a key={f.id} className="chip-link" href={`#/files/root/${f.id}`}><Icon name={fileIcon(f.mime)} size={14}/>{f.name} <small className="muted">{bytes(f.bytes)}</small></a>)}</div>}
   {Object.keys(m.reactions).length>0&&<div className="row-gap reactions">{Object.entries(m.reactions).map(([e,r])=><button key={e} className={cx('chip-btn',r.mine&&'on')} onClick={()=>act({action:'react',emoji:e})} aria-label={`${e} ${r.count}`}>{e} {r.count}</button>)}</div>}
   {!inThread&&m.replies>0&&<button className="link small" onClick={onThread}>{m.replies} {m.replies===1?'reply':'replies'}</button>}
   {readBy.length>0&&<small className="muted">Seen by {readBy.join(', ')}</small>}
  </div>
  {!m.deleted&&<div className="msg-tools">
   <Menu trigger={o=><button className="icon-btn" aria-label="React" onClick={o}><Icon name="Smile" size={15}/></button>} items={REACTIONS.map(e=>({label:e,onClick:()=>act({action:'react',emoji:e})}))}/>
   {!inThread&&<button className="icon-btn" aria-label="Reply in thread" onClick={onThread}><Icon name="MessageSquareReply" size={15}/></button>}
   <Menu trigger={o=><button className="icon-btn" aria-label="More actions" onClick={o}><Icon name="Ellipsis" size={15}/></button>} items={[{label:m.bookmarked?'Remove from saved':'Save',icon:'Bookmark',onClick:()=>act({action:'bookmark',on:!m.bookmarked},m.bookmarked?'Removed':'Saved')},{label:m.pinned?'Unpin':'Pin',icon:'Pin',hidden:!canModerate&&!dm,onClick:()=>act({action:'pin',on:!m.pinned})},{label:'Edit',icon:'Pencil',hidden:!mine,onClick:()=>setEditing(true)},{label:m.hidden?'Unhide':'Hide',icon:'EyeOff',hidden:!canModerate,onClick:()=>act({action:'hide',on:!m.hidden})},{label:'Report',icon:'Flag',hidden:mine,onClick:async()=>{const r=await ask({title:'Report this message?',body:'Administrators will review it.',input:{label:'Reason',required:true},confirm:'Report'});if(r!==false)act({action:'report',reason:r},'Reported')}},'-',{label:'Delete',icon:'Trash2',danger:true,hidden:!mine&&!canModerate,onClick:async()=>{if(await ask({title:'Delete this message?',confirm:'Delete',danger:true})!==false)act({action:'delete'},'Deleted')}}]}/>
  </div>}
 </article>;
}
function Composer({channelId,threadId,onSent}:{channelId:string,threadId?:string,onSent:()=>void}){
 const {toast}=useApp();const [text,setText]=useState('');const [files,setFiles]=useState<{id:string,name:string}[]>([]);const [busy,setBusy]=useState(false);const rec=useRecorder(120000);const typed=useRef(0);
 async function upload(f:File|Blob,name:string){const fd=new FormData();fd.set('file',f instanceof File?f:new File([f],name,{type:f.type}));fd.set('acl',JSON.stringify({mode:'private'}));const r=await fetch('/api/files',{method:'POST',body:fd});const d=await r.json() as {id?:string,error?:string};if(!r.ok||!d.id)throw new Error(d.error||'Upload failed');return d.id}
 async function send(kind='text',extra:string[]=[]){const ids=[...files.map(f=>f.id),...extra];if(!text.trim()&&!ids.length)return;setBusy(true);try{await api('/api/messages',{action:'send',channelId,threadId,body:text.trim(),fileIds:ids,kind});setText('');setFiles([]);onSent()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}
 return <form className="composer" onSubmit={e=>{e.preventDefault();send()}}>
  {files.length>0&&<div className="row-gap">{files.map(f=><span key={f.id} className="chip chip-gray">{f.name}<button type="button" className="icon-btn" aria-label={`Remove ${f.name}`} onClick={()=>setFiles(files.filter(x=>x.id!==f.id))}><Icon name="X" size={12}/></button></span>)}</div>}
  <div className="composer-row">
   <Btn variant="ghost" icon="Paperclip" title="Attach files" onClick={()=>{const i=document.createElement('input');i.type='file';i.multiple=true;i.onchange=async()=>{setBusy(true);try{const picked=[...(i.files||[])].slice(0,10);const up=await Promise.all(picked.map(async f=>({id:await upload(f,f.name),name:f.name})));setFiles(x=>[...x,...up])}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}};i.click()}}/>
   <textarea value={text} rows={1} placeholder={threadId?'Reply…':'Write a message… (@ to mention, Shift+Enter for a new line)'} aria-label="Message" onChange={e=>{setText(e.target.value);if(Date.now()-typed.current>4000){typed.current=Date.now();api('/api/messages',{action:'typing',channelId}).catch(()=>{})}}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send()}}}/>
   <Btn variant="ghost" icon={rec.recording?'Square':'Mic'} title={rec.recording?'Stop recording':'Record a voice note'} onClick={async()=>{if(rec.recording){rec.stop();return}try{const blob=await rec.record();if(!blob)return;setBusy(true);const id=await upload(blob,`Voice note ${new Date().toLocaleString()}.webm`);await send('voice',[id])}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}/>
   <Btn type="submit" variant="primary" icon="Send" busy={busy} title="Send" disabled={files.some(f=>!f.id)}/>
  </div>
  {rec.recording&&<p className="muted small" role="status"><span className="rec-dot"/> Recording… stops after a pause (max 2 minutes).</p>}
 </form>;
}
function ThreadPanel({channelId,threadId,canPost,canModerate,onClose}:{channelId:string,threadId:string,canPost:boolean,canModerate:boolean,onClose:()=>void}){
 const {toast,s}=useApp();const [data,setData]=useState<ChannelData|null>(null);
 const load=async()=>{try{setData(await api<ChannelData>(`/api/messages?channel=${channelId}&thread=${threadId}`))}catch(e){toast((e as Error).message,'error')}};
 useEffect(()=>{load();const t=setInterval(()=>{if(!document.hidden)load()},5000);return()=>clearInterval(t)// eslint-disable-next-line react-hooks/exhaustive-deps
 },[threadId]);
 return <aside className="thread-panel" aria-label="Thread"><div className="between"><h3>Thread</h3><Btn size="sm" variant="ghost" icon="X" title="Close thread" onClick={onClose}/></div>
  {!data?<Skeleton/>:<div className="conv-body">{data.messages.map((m,i)=><MessageRow key={m.id} m={m} grouped={false} mine={m.authorId===s.user.id} canModerate={canModerate} dm={false} readBy={[]} inThread act={async b=>{try{await api('/api/messages',{messageId:m.id,...b});load()}catch(e){toast((e as Error).message,'error')}}}/>)}{data.messages.length<=1&&<p className="muted small">No replies yet.</p>}</div>}
  {canPost&&<Composer channelId={channelId} threadId={threadId} onSent={load}/>}
 </aside>;
}
function Search(){
 const q=new URLSearchParams(location.hash.split('?')[1]||'').get('q')||'';const {person}=useApp();
 const {data,error}=useApi<{results:{id:string,channel_id:string,thread_id:string|null,author_id:string,body:string,created_at:string,channelName:string}[]}>(`/api/messages?search=${encodeURIComponent(q)}`);
 return <div className="stack"><Header title={`Results for “${q}”`}/><ErrorNote error={error}/>{!data?<Skeleton/>:!data.results.length?<Empty icon="Search" title="No messages found"/>:data.results.map(r=><a key={r.id} className="page-row" href={`#/messages/${r.channel_id}${r.thread_id?`/t/${r.thread_id}`:''}`}><span className="page-row-main"><b>{person(r.author_id)?.name} in {r.channelName}</b><small>{r.body.slice(0,240)}</small></span><small className="muted">{ago(r.created_at)}</small></a>)}</div>;
}
function Bookmarks(){const {person}=useApp();const {data,error}=useApi<{messages:Msg[]}>('/api/messages?bookmarks');return <div className="stack"><Header title="Saved messages"/><ErrorNote error={error}/>{!data?<Skeleton/>:!data.messages.length?<Empty icon="Bookmark" title="Nothing saved yet"/>:data.messages.map(m=><a key={m.id} className="page-row" href={`#/messages/${m.channelId}`}><span className="page-row-main"><b>{person(m.authorId)?.name}</b><small>{m.body.slice(0,240)}</small></span><small className="muted">{ago(m.createdAt)}</small></a>)}</div>}
function Reports(){const {toast,ask}=useApp();const {data,error,reload}=useApi<{reports:{id:string,reason:string,status:string,createdAt:string,body:string,messageId:string,channelId:string,reporter:string}[]}>('/api/messages?reports');return <div className="stack"><Header title="Reported messages" subtitle="Review reports; hide or delete messages from the conversation."/><ErrorNote error={error} onRetry={reload}/>{!data?<Skeleton/>:!data.reports.length?<Empty icon="Flag" title="No reports"/>:<table className="grid-table"><thead><tr><th>Message</th><th>Reason</th><th>Reported by</th><th>Status</th><th/></tr></thead><tbody>{data.reports.map(r=><tr key={r.id}><td><a href={`#/messages/${r.channelId}`}>{r.body.slice(0,140)||'(deleted)'}</a></td><td>{r.reason}</td><td>{r.reporter} · {ago(r.createdAt)}</td><td><Chip tone={r.status==='open'?'amber':'green'}>{r.status}</Chip></td><td>{r.status==='open'&&<Btn size="sm" onClick={async()=>{const o=await ask({title:'Resolve report',input:{label:'Outcome'},confirm:'Resolve'});if(o===false)return;try{await api('/api/messages',{action:'resolve-report',id:r.id,outcome:o});reload()}catch(e){toast((e as Error).message,'error')}}}>Resolve</Btn>}</td></tr>)}</tbody></table>}</div>}
function Policies(){
 const {s,toast,refresh}=useApp();const st=s.tenant.settings||{};const [days,setDays]=useState(String(st.messageRetentionDays||0));const [rr,setRr]=useState(st.readReceipts!==false);const [pr,setPr]=useState(st.presence!==false);
 return <div className="stack"><Header title="Messaging policies"/><Field label="Keep messages for (days, 0 = forever)" hint="Older messages (except pinned ones) are removed when you save and whenever the policy runs."><input type="number" min="0" max="3650" value={days} onChange={e=>setDays(e.target.value)}/></Field><label className="check"><input type="checkbox" checked={rr} onChange={e=>setRr(e.target.checked)}/>Show read receipts in direct messages</label><label className="check"><input type="checkbox" checked={pr} onChange={e=>setPr(e.target.checked)}/>Show who is active (presence)</label><div><Btn variant="primary" onClick={async()=>{try{await api('/api/messages',{action:'settings',retentionDays:Number(days),readReceipts:rr,presence:pr});toast('Saved');refresh()}catch(e){toast((e as Error).message,'error')}}}>Save</Btn></div></div>;
}
function NewConversation({mode,onClose,onDone}:{mode:string,onClose:()=>void,onDone:(id:string)=>void}){
 const {toast,person,s}=useApp();const [people,setPeople]=useState<string[]>([]);const [v,setV]=useState({name:'',description:'',kind:'custom',refId:'',posting:'all'});
 const {data:projects}=useApi<{projects:{id:string,code:string,name:string}[]}>(mode==='channel'?'/api/projects':null);
 async function create(){try{const r=await api<{id:string}>('/api/messages',mode==='dm'?{action:'dm',members:people}:{action:'create',...v,members:people});onDone(r.id)}catch(e){toast((e as Error).message,'error')}}
 return <Modal open onClose={onClose} title={mode==='dm'?'New message':'New channel'} footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={mode==='dm'?!people.length:!v.name.trim()} onClick={create}>{mode==='dm'?'Start':'Create'}</Btn></>}>
  <div className="form-grid">
   {mode==='channel'&&<><Field label="Name"><input autoFocus value={v.name} onChange={e=>setV({...v,name:e.target.value})} placeholder="e.g. site-safety"/></Field><Field label="Type"><select value={v.kind} onChange={e=>setV({...v,kind:e.target.value,refId:''})}><option value="custom">Members only</option>{s.user.role==='admin'&&<option value="announcement">Announcements (admins post)</option>}{s.user.role==='admin'&&<option value="department">Department</option>}<option value="project">Project team</option></select></Field>
    {v.kind==='department'&&<Field label="Department"><DeptSelect value={v.refId} onChange={x=>setV({...v,refId:x})}/></Field>}
    {v.kind==='project'&&<Field label="Project"><select value={v.refId} onChange={e=>setV({...v,refId:e.target.value})}><option value="">Choose…</option>{(projects?.projects||[]).map(p=><option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>}
    <Field label="Description" wide><input value={v.description} onChange={e=>setV({...v,description:e.target.value})}/></Field></>}
   {['custom','announcement'].includes(v.kind)&&<Field label={mode==='dm'?'To':'Members'} wide><div className="row-gap">{people.map(p=><span key={p} className="chip chip-gray">{person(p)?.name}<button className="icon-btn" aria-label="Remove" onClick={()=>setPeople(people.filter(x=>x!==p))}><Icon name="X" size={12}/></button></span>)}</div><PersonSelect value={null} placeholder="Add people…" filter={p=>p.id!==s.user.id&&!!p.active} onChange={id=>{if(id&&!people.includes(id))setPeople([...people,id])}}/></Field>}
  </div></Modal>;
}
