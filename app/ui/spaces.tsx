'use client';
import {useEffect,useMemo,useState} from 'react';
import {api,useApi,go,ago,dateOnly,dateTime,hue,cx,bytes} from './lib';
import {useApp,Btn,Chip,Header,Field,Who,Avatar,Markdown,Thread,ErrorNote,Skeleton,Empty,Icon,Segmented,Menu,Tabs,Modal,Note,TagPicker,AudiencePicker,Card} from './kit';
import {AiActions} from './assistant';
import {UploadDialog,fileIcon} from './files';
import {pageKinds} from '../data';

// Spaces: collaboration hubs (company, department, project and custom). Each tab reuses the module that owns
// the data (pages/announcements, Files, Projects, Tasks, Messages), filtered by the server.
type Acl={mode:string,departments?:string[],people?:string[],roles?:string[],groups?:string[],locations?:string[],projectId?:string|null,spaceId?:string|null,editors?:string[]};
type Page={id:string,department:string,parent_id:string|null,kind:string,title:string,excerpt?:string,body?:string,icon:string,status:string,pinned:number,author_id:string,updated_by:string,created_at:string,updated_at:string,version:number,acl?:Acl|null,space_id?:string|null,priority?:string,requires_ack?:number,publish_at?:string|null,expires_at?:string|null,approval_status?:string,live?:boolean,acknowledged?:boolean,deleted_at?:string|null};
type SpaceRow={id:string,key:string,kind:string,name:string,department:string,project_id:string|null,description:string,icon:string,color:string,visibility:string,status:string,members?:number,isMember?:boolean};
const kindLabel:Record<string,string>={page:'Page',announcement:'Announcement',policy:'Policy',procedure:'Procedure',research:'Research note'};
const kindIcon:Record<string,string>={page:'FileText',announcement:'Megaphone',policy:'Scale',procedure:'ListChecks',research:'FlaskConical'};
const spaceColor=(name:string,color?:string)=>color||`hsl(${hue(name)} 65% 58%)`;
const TABS=[['overview','Overview'],['announcements','Announcements'],['files','Files'],['pages','Pages'],['projects','Projects'],['tasks','Tasks'],['messages','Messages'],['members','Members'],['calendar','Calendar'],['activity','Activity']];

export default function Spaces({parts}:{parts:string[]}){
 if(parts[0]==='page'&&parts[1])return <Reader id={parts[1]}/>;
 if(parts[0]==='edit')return <Editor id={parts[1]==='new'?undefined:parts[1]} space={parts[2]} parent={parts[3]}/>;
 if(parts[0]==='s'&&parts[1])return <SpaceHub id={parts[1]} tab={parts[2]||'overview'}/>;
 // Canonical hub routes: #/spaces/:spaceId and #/spaces/:spaceId/:tab
 if(parts[0]&&/^[0-9a-f-]{32,36}$/i.test(parts[0]))return <SpaceHub id={parts[0]} tab={parts[1]||'overview'}/>;
 if(parts[0]==='d')return <LegacySpace name={parts[1]==='company'?'':parts[1]||''}/>;
 if(parts[0]==='approvals')return <Approvals/>;
 if(parts[0]==='recycle')return <Recycle/>;
 return <AllSpaces/>;
}
// Old department links (#/spaces/d/Finance) open the department's space.
function LegacySpace({name}:{name:string}){const {data}=useApi<{spaces:SpaceRow[]}>('/api/spaces');useEffect(()=>{const s=data?.spaces.find(x=>name?x.kind==='department'&&x.department.toLowerCase()===decodeURIComponent(name).toLowerCase():x.kind==='company');if(s)go(`spaces/${s.id}`)},[data,name]);return <div className="page"><Skeleton/></div>}
function AllSpaces(){
 const {s,toast}=useApp();const {data,error,reload}=useApi<{spaces:SpaceRow[],canCreate:boolean}>('/api/spaces');const [creating,setCreating]=useState(false);
 const groups:[string,SpaceRow[]][]=[['Company & departments',(data?.spaces||[]).filter(x=>['company','department'].includes(x.kind))],['Projects',(data?.spaces||[]).filter(x=>x.kind==='project')],['Custom spaces',(data?.spaces||[]).filter(x=>x.kind==='custom')]];
 return <div className="page">
  <Header icon="LibraryBig" tone="pink" title="Spaces" subtitle="Every team's hub: announcements, files, pages, projects, tasks, messages and a shared calendar." actions={<><Btn icon="Stamp" onClick={()=>go('spaces/approvals')}>Approvals</Btn><Btn icon="Trash2" onClick={()=>go('spaces/recycle')}>Recycle bin</Btn>{data?.canCreate&&<Btn icon="Plus" onClick={()=>setCreating(true)}>New space</Btn>}<Btn variant="primary" icon="PenLine" onClick={()=>go('spaces/edit/new')}>Write a page</Btn></>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:groups.filter(([,l])=>l.length).map(([g,list])=><section key={g}><h2 className="section-title">{g}</h2><div className="space-grid">{list.map(sp=><a key={sp.id} href={`#/spaces/${sp.id}`} className={cx('space-card',sp.status==='archived'&&'muted')} style={{'--sc':spaceColor(sp.name,sp.color)} as React.CSSProperties}><span className="space-card-band"/><b>{sp.name}</b><small>{sp.description||(sp.kind==='department'?`${sp.name} department`:sp.kind==='company'?'Everyone':'')}</small><span className="row-gap">{sp.kind==='custom'&&<Chip tone={sp.visibility==='company'?'green':'gray'}>{sp.visibility==='company'?'Open':'Members only'}</Chip>}{sp.isMember&&<Chip tone="blue">Member</Chip>}{sp.status==='archived'&&<Chip>Archived</Chip>}</span></a>)}</div></section>)}
  {creating&&<NewSpace onClose={()=>setCreating(false)} onDone={id=>{setCreating(false);toast('Space created');go(`spaces/${id}`)}} people={s.people}/>}
 </div>;
}
function NewSpace({onClose,onDone,people}:{onClose:()=>void,onDone:(id:string)=>void,people:{id:string,name:string,active:number}[]}){
 const {toast}=useApp();const [v,setV]=useState({name:'',description:'',visibility:'members',members:[] as string[]});
 return <Modal open onClose={onClose} title="New space" footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={!v.name.trim()} onClick={async()=>{try{const r=await api<{id:string}>('/api/spaces',{action:'create',...v,members:v.members.map(n=>people.find(p=>p.name===n)?.id).filter(Boolean)});onDone(r.id)}catch(e){toast((e as Error).message,'error')}}}>Create</Btn></>}>
  <div className="form-grid"><Field label="Name"><input autoFocus value={v.name} onChange={e=>setV({...v,name:e.target.value})}/></Field><Field label="Who can see it"><select value={v.visibility} onChange={e=>setV({...v,visibility:e.target.value})}><option value="members">Members only</option><option value="company">Everyone in the company</option></select></Field><Field label="Description" wide><input value={v.description} onChange={e=>setV({...v,description:e.target.value})}/></Field><Field label="Members" wide><TagPicker values={v.members} options={people.filter(p=>p.active).map(p=>p.name)} onChange={m=>setV({...v,members:m})} placeholder="Add people"/></Field></div>
 </Modal>;
}
type Hub={space:SpaceRow,canManage:boolean,isMember:boolean,announcements:Page[],pages:Page[],files:{id:string,name:string,mime:string,bytes:number,updated_at:string,processing_status:string,pinned:number,uploaded_by:string}[],tasks:{id:string,title:string,status:string,due_date:string|null,priority:string,assignees:string[]}[],projects:{id:string,code:string,name:string,stage:string,health:string,progress:number,target:string|null}[],members:{id:string,name:string,title:string,department:string,role?:string}[],channelId:string|null,calendar:{date:string,type:string,title:string,link:string,overdue:boolean}[],activity:{at:string,type:string,title:string,link:string}[]};
function SpaceHub({id,tab}:{id:string,tab:string}){
 const {s,toast,ask,person}=useApp();const {data,error,reload}=useApi<Hub>(`/api/spaces?id=${encodeURIComponent(id)}`);const [upload,setUpload]=useState(false);
 if(error)return <div className="page"><ErrorNote error={error} onRetry={reload}/></div>;
 if(!data)return <div className="page"><Skeleton rows={10}/></div>;
 const sp=data.space;const color=spaceColor(sp.name,sp.color);const pinned=[...data.announcements,...data.pages].filter(p=>p.pinned);
 const openChannel=async()=>{try{const r=data.channelId?{id:data.channelId}:await api<{id:string}>('/api/spaces',{action:'channel',id:sp.id});go(`messages/${r.id}`)}catch(e){toast((e as Error).message,'error')}};
 return <div className="page">
  <section className="space-hero" style={{'--sc':color} as React.CSSProperties}><div className="space-hero-band"/>
   <div className="space-hero-body"><div><span className="eyebrow">{sp.kind==='company'?'Company space':sp.kind==='department'?'Department space':sp.kind==='project'?'Project space':'Space'}</span><h1>{sp.name}</h1><p>{sp.description}</p></div>
    <div className="space-hero-side"><AiActions entity="space" entityId={sp.id}/>{data.members.length>0&&<span className="avatars">{data.members.slice(0,7).map(m=><Avatar key={m.id} name={m.name} size={28}/>)}</span>}{sp.project_id&&<Btn size="sm" icon="FolderKanban" onClick={()=>go(`projects/${sp.project_id}`)}>Open project</Btn>}{data.canManage&&sp.kind==='custom'&&<Menu trigger={o=><Btn size="sm" variant="ghost" icon="Ellipsis" onClick={o}/>} items={[{label:sp.status==='archived'?'Restore space':'Archive space',icon:'Archive',onClick:async()=>{if(sp.status==='archived'||await ask({title:'Archive this space?',confirm:'Archive',danger:true})!==false){await api('/api/spaces',{action:sp.status==='archived'?'restore':'archive',id:sp.id});reload()}}}]}/>}</div></div>
  </section>
  <Tabs value={tab} onChange={t=>go(`spaces/${sp.id}/${t}`)} items={TABS.map(([i,l])=>({id:i,label:l,count:i==='announcements'?data.announcements.length:i==='files'?data.files.length:i==='tasks'?data.tasks.filter(t=>t.status!=='Done').length:undefined}))}/>
  {tab==='overview'&&<div className="split-2"><div>
    {pinned.length>0&&<div className="pinned">{pinned.map(p=><a key={p.id} href={`#/spaces/page/${p.id}`} className="pinned-card"><Icon name="Pin" size={14}/><b>{p.title}</b><small>{p.excerpt?.slice(0,110)}</small></a>)}</div>}
    <Card title="Latest announcements" actions={<Btn size="sm" icon="Megaphone" onClick={()=>go(`spaces/edit/new/${sp.id}?kind=announcement`)}>Announce</Btn>}>{data.announcements.slice(0,5).map(p=><PageRow key={p.id} p={p}/>)}{!data.announcements.length&&<p className="muted small">No announcements yet.</p>}</Card>
    <Card title="Recent files" actions={<Btn size="sm" icon="Upload" onClick={()=>setUpload(true)}>Upload</Btn>}><FileList files={data.files.slice(0,6)}/></Card>
   </div><div>
    <Card title="Open tasks" actions={<Btn size="sm" icon="Plus" onClick={()=>go(`tasks/all/new?space=${sp.id}`)}>Task</Btn>}><TaskList tasks={data.tasks.filter(t=>t.status!=='Done').slice(0,8)}/></Card>
    <Card title="Coming up"><CalendarList items={data.calendar.filter(c=>c.date>=new Date().toISOString().slice(0,10)).slice(0,8)}/></Card>
    <Btn icon="MessageSquare" onClick={openChannel}>Open space conversation</Btn>
   </div></div>}
  {tab==='announcements'&&<><div className="between"><span/><Btn variant="primary" icon="Megaphone" onClick={()=>go(`spaces/edit/new/${sp.id}?kind=announcement`)}>New announcement</Btn></div>{data.announcements.map(p=><PageRow key={p.id} p={p}/>)}{!data.announcements.length&&<Empty icon="Megaphone" title="No announcements"/>}</>}
  {tab==='pages'&&<><div className="between"><span/><Btn variant="primary" icon="PenLine" onClick={()=>go(`spaces/edit/new/${sp.id}`)}>Write a page</Btn></div>{data.pages.map(p=><PageRow key={p.id} p={p}/>)}{!data.pages.length&&<Empty icon="FileText" title="No pages yet"/>}</>}
  {tab==='files'&&<><div className="between"><span/><Btn variant="primary" icon="Upload" onClick={()=>setUpload(true)}>Upload to this space</Btn></div><FileList files={data.files}/>{!data.files.length&&<Empty icon="FolderOpen" title="No files in this space"/>}</>}
  {tab==='projects'&&<>{data.projects.map(p=><a key={p.id} className="page-row" href={`#/projects/${p.id}`}><span className="page-row-icon"><Icon name="FolderKanban" size={17}/></span><span className="page-row-main"><b>{p.code} · {p.name}</b><small>{p.stage} · {p.progress}%{p.target?` · target ${dateOnly(p.target)}`:''}</small></span><Chip tone={p.health==='green'?'green':p.health==='amber'?'amber':'red'}>{p.health}</Chip></a>)}{!data.projects.length&&<Empty icon="FolderKanban" title="No projects in this space"/>}</>}
  {tab==='tasks'&&<><div className="between"><span/><Btn variant="primary" icon="Plus" onClick={()=>go(`tasks/all/new?space=${sp.id}`)}>New task</Btn></div><TaskList tasks={data.tasks}/></>}
  {tab==='messages'&&<Empty icon="MessageSquare" title="Space conversation" action={<Btn variant="primary" icon="MessageSquare" onClick={openChannel}>Open conversation</Btn>}>Messages for this space are in Messages, visible to its members.</Empty>}
  {tab==='members'&&<><MembersTab hub={data} onChange={reload}/></>}
  {tab==='calendar'&&<CalendarList items={data.calendar}/>}
  {tab==='activity'&&<div className="mini-list">{data.activity.map((a,i)=><a key={i} className="mini-row" href={a.link}><Icon name="History" size={14}/><span>{a.type}: {a.title}<small>{ago(a.at)}</small></span></a>)}{!data.activity.length&&<p className="muted">No activity yet.</p>}</div>}
  {upload&&<UploadDialog initial={[]} folderId={null} spaceId={sp.id} defaultAcl={sp.kind==='department'?{mode:'department',departments:[sp.department]}:sp.kind==='company'?{mode:'department',departments:[s.user.department]}:{mode:'space',spaceId:sp.id}} onClose={()=>setUpload(false)} onDone={()=>{setUpload(false);reload()}}/>}
  {void person}
 </div>;
}
function MembersTab({hub,onChange}:{hub:Hub,onChange:()=>void}){
 const {s,toast}=useApp();const [add,setAdd]=useState<string[]>([]);const sp=hub.space;
 return <div>{hub.canManage&&['custom','project'].includes(sp.kind)&&<div className="row-gap"><TagPicker values={add} options={s.people.filter(p=>p.active).map(p=>p.name)} onChange={setAdd} placeholder="Add people"/><Btn variant="primary" disabled={!add.length} onClick={async()=>{try{await api('/api/spaces',{action:'members',id:sp.id,add:add.map(n=>s.people.find(p=>p.name===n)?.id).filter(Boolean)});setAdd([]);toast('Members added');onChange()}catch(e){toast((e as Error).message,'error')}}}>Add</Btn></div>}
  {sp.kind==='company'?<Note>Everyone in {s.tenant.name} is a member of this space.</Note>:<table className="plain"><tbody>{hub.members.map(m=><tr key={m.id}><td><Who id={m.id} sub/></td><td>{m.role||'member'}</td><td>{hub.canManage&&['custom','project'].includes(sp.kind)&&<Btn size="sm" variant="ghost" icon="X" title="Remove" onClick={async()=>{await api('/api/spaces',{action:'members',id:sp.id,remove:[m.id]});onChange()}}/>}</td></tr>)}</tbody></table>}</div>;
}
function FileList({files}:{files:Hub['files']}){return <div className="mini-list">{files.map(f=><a key={f.id} className="mini-row" href={`#/files/root/${f.id}`}><Icon name={fileIcon(f.mime)} size={15}/><span>{f.name}{f.pinned?' 📌':''}<small>{bytes(f.bytes)} · {ago(f.updated_at)}{f.processing_status==='ready'?' · summary ready':''}</small></span></a>)}</div>}
function TaskList({tasks}:{tasks:Hub['tasks']}){const {person}=useApp();return <div className="mini-list">{tasks.map(t=><a key={t.id} className="mini-row" href={`#/tasks/all/${t.id}`}><Icon name={t.status==='Done'?'CircleCheck':'Circle'} size={15}/><span>{t.title}<small>{t.status}{t.due_date?` · due ${dateOnly(t.due_date)}`:''}{t.assignees?.length?` · ${t.assignees.map(a=>person(a)?.name).filter(Boolean).join(', ')}`:''}</small></span></a>)}{!tasks.length&&<p className="muted small">No tasks.</p>}</div>}
function CalendarList({items}:{items:Hub['calendar']}){return <ul className="lb-cal">{items.map((e,i)=><li key={i} className={cx(e.overdue&&'overdue')}><span className="lb-date">{e.date}</span><Chip tone="gray">{e.type}</Chip><a href={e.link}>{e.title}</a></li>)}{!items.length&&<li className="muted">Nothing scheduled.</li>}</ul>}
function PageRow({p}:{p:Page}){return <a href={`#/spaces/page/${p.id}`} className="page-row"><span className="page-row-icon">{p.icon&&!/^[a-z]+$/.test(p.icon)?p.icon:<Icon name={kindIcon[p.kind]||'FileText'} size={17}/>}</span><span className="page-row-main"><b>{p.title}</b><small>{p.excerpt?.slice(0,140)}</small></span><span className="row-gap">{p.priority&&['High','Urgent'].includes(p.priority)&&<Chip tone="red">{p.priority}</Chip>}{p.requires_ack&&!p.acknowledged?<Chip tone="amber">Please acknowledge</Chip>:null}{p.status!=='Published'&&<Chip>{p.approval_status==='pending'?'Awaiting approval':p.status}</Chip>}{p.publish_at&&p.publish_at>new Date().toISOString()&&<Chip tone="blue">Scheduled</Chip>}<small className="muted">{ago(p.updated_at)}</small></span></a>}
function Approvals(){const {data,error,reload}=useApi<{pages:Page[]}>('/api/pages?view=approvals');return <div className="page"><Header icon="Stamp" tone="pink" title="Content awaiting approval" subtitle="Announcements and pages submitted by people who cannot publish them."/><ErrorNote error={error} onRetry={reload}/>{!data?<Skeleton/>:data.pages.length?data.pages.map(p=><PageRow key={p.id} p={p}/>):<Empty icon="Stamp" title="Nothing waiting for you"/>}</div>}
function Recycle(){const {toast,ask}=useApp();const {data,error,reload}=useApi<{pages:Page[]}>('/api/pages?view=recycle');return <div className="page"><Header icon="Trash2" tone="pink" title="Deleted pages and announcements" subtitle="Restore them, or (administrators) delete them permanently."/><ErrorNote error={error} onRetry={reload}/>{!data?<Skeleton/>:!data.pages.length?<Empty icon="Trash2" title="Nothing deleted"/>:<table className="plain"><tbody>{data.pages.map(p=><tr key={p.id}><td><b>{p.title}</b><br/><small className="muted">{kindLabel[p.kind]} · deleted {ago(p.deleted_at)}</small></td><td className="row-gap"><Btn size="sm" icon="RotateCcw" onClick={async()=>{await api('/api/pages',{action:'restore',id:p.id});toast('Restored');reload()}}>Restore</Btn><Btn size="sm" variant="danger" onClick={async()=>{const v=await ask({title:'Delete permanently?',body:<>Type <b>{p.title}</b> to confirm.</>,confirm:'Delete',danger:true,input:{label:'Title',required:true}});if(v===false)return;try{await api('/api/pages',{action:'purge',id:p.id,confirm:v});toast('Deleted');reload()}catch(e){toast((e as Error).message,'error')}}}>Delete permanently</Btn></td></tr>)}</tbody></table>}</div>}

type ReaderData={page:Page,comments:any[],files:{id:string,name:string,mime:string,bytes:number}[],children:{id:string,title:string,icon:string,status:string}[],revisions:{version:number,title:string,createdAt:string,who:string}[],reactions:Record<string,{count:number,mine:boolean}>,receipt:{read:boolean,acknowledged:boolean},receipts:{audience:number,read:number,acknowledged:number,pending:string[]}|null,canEdit:boolean,canPublish:boolean,isAdmin:boolean};
function Reader({id}:{id:string}){
 const {toast,ask,s,person}=useApp();const {data,error,reload}=useApi<ReaderData>('/api/pages?id='+encodeURIComponent(id));const [showRev,setShowRev]=useState(false);
 const p=data?.page;
 async function act(body:Record<string,unknown>,msg:string){try{await api('/api/pages',{id,...body});toast(msg);reload()}catch(e){toast((e as Error).message,'error')}}
 if(error)return <div className="page"><ErrorNote error={error} onRetry={reload}/></div>;
 if(!p)return <div className="page"><Skeleton rows={10}/></div>;
 const back=p.space_id?`#/spaces/${p.space_id}`:p.department?`#/spaces/d/${encodeURIComponent(p.department)}`:'#/spaces/d/company';
 const pending=p.approval_status==='pending';
 return <div className="page reader">
  <div className="doc-top"><a className="btn btn-ghost" href={back}><Icon name="ArrowLeft" size={17}/><span>{p.department||'Company'}</span></a><div className="grow"/><AiActions entity="page" entityId={p.id}/>
   {data.canPublish&&pending&&<><Btn variant="primary" icon="Check" onClick={()=>act({action:'approve'},'Approved and published')}>Approve</Btn><Btn onClick={async()=>{const n=await ask({title:'Send back to the author?',confirm:'Send back',input:{label:'Note (optional)'}});if(n!==false)act({action:'reject',note:n},'Sent back')}}>Send back</Btn></>}
   {data.canPublish&&!pending&&p.status!=='Published'&&<Btn variant="primary" icon="Send" onClick={()=>act({action:'status',status:'Published'},'Published')}>Publish</Btn>}
   {data.canEdit&&<Btn icon="Pencil" onClick={()=>go(`spaces/edit/${id}`)}>Edit</Btn>}
   {(data.canEdit||data.canPublish)&&<Menu trigger={o=><Btn variant="ghost" icon="Ellipsis" title="More" onClick={o}/>} items={[{label:'Unpublish (back to draft)',icon:'Undo2',onClick:()=>act({action:'status',status:'Draft'},'Unpublished'),hidden:!data.canPublish||p.status!=='Published'},{label:p.pinned?'Unpin':'Pin',icon:'Pin',hidden:!data.canPublish,onClick:()=>act({action:'pin',on:!p.pinned},p.pinned?'Unpinned':'Pinned')},{label:'Archive',icon:'Archive',onClick:()=>act({action:'status',status:'Archived'},'Archived'),hidden:!data.canPublish},{label:'Version history',icon:'History',hidden:!data.canEdit,onClick:()=>setShowRev(true)},'-',{label:'Delete',icon:'Trash2',danger:true,hidden:!data.canEdit,onClick:async()=>{if(await ask({title:`Delete “${p.title}”?`,body:'It moves to the recycle bin.',confirm:'Delete',danger:true})!==false){await act({action:'delete'},'Moved to the recycle bin');go('spaces')}}}]}/>}
  </div>
  {pending&&<Note tone="warn">Waiting for approval before it is published.</Note>}
  <article className="article">
   <div className="article-meta"><Chip tone="gray">{kindLabel[p.kind]}</Chip>{p.status!=='Published'&&<Chip>{p.status}</Chip>}{p.priority&&p.priority!=='Normal'&&<Chip tone={['High','Urgent'].includes(p.priority)?'red':'gray'}>{p.priority}</Chip>}{p.publish_at&&p.publish_at>new Date().toISOString()&&<Chip tone="blue">Publishes {dateTime(p.publish_at)}</Chip>}{p.expires_at&&<Chip tone="gray">Expires {dateTime(p.expires_at)}</Chip>}<span className="muted small">By {person(p.author_id)?.name||'—'} · updated {ago(p.updated_at)}</span></div>
   <h1>{p.icon&&!/^[a-z]+$/.test(p.icon)&&<span className="article-icon">{p.icon}</span>}{p.title}</h1>
   <Markdown text={p.body||''}/>
   {data.files.length>0&&<div className="attachments">{data.files.map(f=>f.mime.startsWith('image/')?<img key={f.id} className="article-media" src={`/api/files?preview=${f.id}`} alt={f.name}/>:f.mime.startsWith('video/')?<video key={f.id} className="article-media" controls src={`/api/files?preview=${f.id}`}/>:f.mime.startsWith('audio/')?<audio key={f.id} controls src={`/api/files?preview=${f.id}`}/>:<a key={f.id} className="chip-link" href={`#/files/root/${f.id}`}><Icon name={fileIcon(f.mime)} size={14}/>{f.name}</a>)}</div>}
   {data.children.length>0&&<div className="children"><h3>In this section</h3>{data.children.map(c=><a key={c.id} href={`#/spaces/page/${c.id}`}><Icon name="CornerDownRight" size={15}/>{c.title}{c.status!=='Published'&&<Chip>{c.status}</Chip>}</a>)}</div>}
   <div className="row-gap reactions">{['👍','❤️','🎉','👏','😮','🙏'].map(e=><button key={e} className={cx('chip-btn',data.reactions[e]?.mine&&'on')} aria-label={`React ${e}`} onClick={()=>act({action:'react',emoji:e},'')}>{e} {data.reactions[e]?.count||''}</button>)}</div>
   {p.kind==='announcement'&&p.requires_ack?(data.receipt.acknowledged?<Note tone="ok">You acknowledged this announcement.</Note>:<Btn variant="primary" icon="CircleCheck" onClick={()=>act({action:'ack'},'Acknowledged')}>I have read and understood this</Btn>):null}
   {data.receipts&&<Card title="Read receipts"><p>{data.receipts.read} of {data.receipts.audience} have read it{p.requires_ack?` · ${data.receipts.acknowledged} acknowledged`:''}.</p>{p.requires_ack&&data.receipts.pending.length>0&&<details><summary>{data.receipts.pending.length} still to acknowledge</summary><p className="small">{data.receipts.pending.map(i=>person(i)?.name||i).join(', ')}</p></details>}</Card>}
   <p className="muted small">Created {dateOnly(p.created_at)}{p.acl?` · visible to ${p.acl.mode==='company'?'everyone':p.acl.mode}`:''}</p>
  </article>
  <section className="article-comments no-print"><h3>Discussion</h3><Thread comments={data.comments} onPost={async body=>{await api('/api/comments',{type:'page',id,body});reload()}}/></section>
  {showRev&&<Modal open wide onClose={()=>setShowRev(false)} title="Version history" footer={<Btn onClick={()=>setShowRev(false)}>Close</Btn>}><table className="plain"><thead><tr><th>Version</th><th>Title</th><th>By</th><th>When</th><th/></tr></thead><tbody>{data.revisions.map(r=><tr key={r.version}><td>v{r.version}</td><td>{r.title}</td><td>{r.who}</td><td className="muted">{dateTime(r.createdAt)}</td><td><Btn size="sm" onClick={async()=>{if(await ask({title:`Restore version ${r.version}?`,body:'The current text is kept as a revision.',confirm:'Restore'})!==false){await act({action:'restore-revision',version:r.version},'Restored');setShowRev(false)}}}>Restore</Btn></td></tr>)}{!data.revisions.length&&<tr><td colSpan={5} className="muted">No earlier versions.</td></tr>}</tbody></table></Modal>}
  {void s}
 </div>;
}

function Editor({id,space,parent}:{id?:string,space?:string,parent?:string}){
 const {s,toast,can}=useApp();const existing=useApi<{page:Page,canPublish:boolean,files:{id:string,name:string,mime:string}[]}>(id?'/api/pages?id='+encodeURIComponent(id):null);
 const {data:spacesData}=useApi<{spaces:SpaceRow[]}>('/api/spaces');const {data:projects}=useApi<{projects:{id:string,name:string,code:string}[]}>(can('projects')?'/api/projects':null);
 const kindParam=/kind=([a-z]+)/.exec(location.hash)?.[1];
 const [v,setV]=useState({title:'',body:'',icon:'',kind:kindParam||'page',spaceId:'',parentId:parent||'',pinned:false,priority:'Normal',requiresAck:false,publishAt:'',expiresAt:''});
 const [acl,setAcl]=useState<Acl|null>(null);const [attach,setAttach]=useState<{id:string,name:string}[]>([]);const [uploading,setUploading]=useState(false);
 const [loaded,setLoaded]=useState(!id);const [mode,setMode]=useState('split');const [busy,setBusy]=useState('');
 const spaces=spacesData?.spaces.filter(x=>x.status!=='archived')||[];
 useEffect(()=>{if(!spaces.length||v.spaceId||id)return;const sp=space?spaces.find(x=>x.id===space||x.department===decodeURIComponent(space)):spaces.find(x=>x.kind==='department'&&x.department.toLowerCase()===s.user.department.toLowerCase())||spaces.find(x=>x.kind==='company');if(sp)setV(x=>({...x,spaceId:sp.id}))},[spaces,space,id,v.spaceId,s.user.department]);
 useEffect(()=>{const p=existing.data?.page;if(!p||loaded)return;const sp=spaces.find(x=>x.id===p.space_id)||spaces.find(x=>x.kind==='department'&&x.department===p.department)||spaces.find(x=>x.kind==='company'&&!p.department);if(!sp&&spaces.length===0)return;setV({title:p.title,body:p.body||'',icon:/^[a-z]+$/.test(p.icon)?'':p.icon,kind:p.kind,spaceId:sp?.id||'',parentId:p.parent_id||'',pinned:!!p.pinned,priority:p.priority||'Normal',requiresAck:!!p.requires_ack,publishAt:p.publish_at?p.publish_at.slice(0,16):'',expiresAt:p.expires_at?p.expires_at.slice(0,16):''});setAcl(p.acl||null);setAttach(existing.data!.files||[]);setLoaded(true)},[existing.data,loaded,spaces]);
 const sp=spaces.find(x=>x.id===v.spaceId);
 const defaultAudience:Acl=sp?.kind==='department'?{mode:'department',departments:[sp.department]}:sp?.kind==='company'?{mode:'company'}:{mode:'space',spaceId:sp?.id||null};
 async function save(publish:boolean){setBusy(publish?'publish':'save');try{
  const r=await api<{id:string,status?:string,approval?:string,scheduled?:boolean}>('/api/pages',{action:'save',id,version:existing.data?.page.version,...v,publishAt:v.publishAt?new Date(v.publishAt).toISOString():null,expiresAt:v.expiresAt?new Date(v.expiresAt).toISOString():null,parentId:v.parentId||null,acl:acl||undefined,publish});
  for(const f of attach)await api('/api/files',{action:'link',id:f.id,entityType:'page',entityId:r.id}).catch(()=>{});
  if(id&&publish&&existing.data?.canPublish)await api('/api/pages',{action:'status',id,status:'Published'});
  toast(r.approval==='pending'?'Submitted for approval':r.scheduled?'Scheduled':publish?'Published':'Saved');go(`spaces/page/${r.id}`)}catch(e){toast((e as Error).message,'error')}finally{setBusy('')}}
 const insert=(before:string,after='')=>setV(x=>({...x,body:x.body+(x.body&&!x.body.endsWith('\n')?'\n':'')+before+after}));
 if(id&&!loaded)return <div className="page"><ErrorNote error={existing.error}/><Skeleton rows={8}/></div>;
 return <div className="page editor-page">
  <div className="doc-top"><Btn variant="ghost" icon="X" onClick={()=>history.back()}>Close</Btn><div className="grow"/><Segmented value={mode} onChange={setMode} items={[{id:'write',label:'Write'},{id:'split',label:'Split'},{id:'preview',label:'Preview'}]}/><Btn busy={busy==='save'} onClick={()=>save(false)}>Save draft</Btn><Btn variant="primary" icon="Send" busy={busy==='publish'} onClick={()=>save(true)}>{v.publishAt&&new Date(v.publishAt)>new Date()?'Schedule':'Publish'}</Btn></div>
  <div className="page-settings"><input className="emoji-in" maxLength={4} value={v.icon} placeholder="📄" onChange={e=>setV({...v,icon:e.target.value})} aria-label="Page icon"/><input className="title-in" value={v.title} placeholder="Untitled page" onChange={e=>setV({...v,title:e.target.value})} autoFocus={!id}/></div>
  <div className="settings-row">
   <Field label="Space"><select value={v.spaceId} onChange={e=>{setV({...v,spaceId:e.target.value});setAcl(null)}}>{spaces.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
   <Field label="Type"><select value={v.kind} onChange={e=>setV({...v,kind:e.target.value})}>{pageKinds.map(k=><option key={k} value={k}>{kindLabel[k]}</option>)}</select></Field>
   <label className="check"><input type="checkbox" checked={v.pinned} onChange={e=>setV({...v,pinned:e.target.checked})}/>Pin</label>
  </div>
  {v.kind==='announcement'&&<div className="settings-row"><Field label="Priority"><select value={v.priority} onChange={e=>setV({...v,priority:e.target.value})}>{['Low','Normal','High','Urgent'].map(p=><option key={p}>{p}</option>)}</select></Field><Field label="Publish at (optional)"><input type="datetime-local" value={v.publishAt} onChange={e=>setV({...v,publishAt:e.target.value})}/></Field><Field label="Expires (optional)"><input type="datetime-local" value={v.expiresAt} onChange={e=>setV({...v,expiresAt:e.target.value})}/></Field><label className="check"><input type="checkbox" checked={v.requiresAck} onChange={e=>setV({...v,requiresAck:e.target.checked})}/>Require acknowledgement</label></div>}
  <details className="audience-box" open={v.kind==='announcement'}><summary>Audience: {acl?acl.mode:`space default (${defaultAudience.mode==='department'?defaultAudience.departments?.[0]:defaultAudience.mode})`}</summary><AudiencePicker value={acl||defaultAudience} onChange={setAcl} projects={(projects?.projects||[]).map(p=>({id:p.id,name:`${p.code} · ${p.name}`}))} spaces={spaces.map(x=>({id:x.id,name:x.name}))}/><p className="muted small">If you cannot publish in this space, publishing submits it for approval instead.</p></details>
  <div className="row-gap attachments-row"><span className="muted small">Attachments (images, video, audio, documents):</span>{attach.map(f=><Chip key={f.id}>{f.name}</Chip>)}<Btn size="sm" icon="Paperclip" busy={uploading} onClick={()=>{const i=document.createElement('input');i.type='file';i.multiple=true;i.onchange=async()=>{setUploading(true);try{for(const f of [...(i.files||[])]){const fd=new FormData();fd.set('file',f);fd.set('acl',JSON.stringify(acl||defaultAudience));if(v.spaceId)fd.set('spaceId',v.spaceId);const r=await fetch('/api/files',{method:'POST',body:fd});const d=await r.json() as {id?:string,error?:string};if(!r.ok)throw new Error(d.error||'Upload failed');setAttach(a=>[...a,{id:d.id!,name:f.name}])}}catch(e){toast((e as Error).message,'error')}finally{setUploading(false)}};i.click()}}>Attach</Btn></div>
  <div className={cx('md-editor',`mode-${mode}`)}>
   {mode!=='preview'&&<div className="md-write"><div className="md-tools">{[['Heading2','## '],['Bold','**bold**'],['List','- '],['ListChecks','- [ ] '],['ListOrdered','1. '],['Quote','> '],['Link','[text](https://)'],['Table','| Column | Column |\n|---|---|\n| | |']].map(([icon,t])=><button key={icon} type="button" title={icon} onClick={()=>insert(t)}><Icon name={icon} size={15}/></button>)}</div><textarea value={v.body} onChange={e=>setV({...v,body:e.target.value})} placeholder="Write in Markdown…"/></div>}
   {mode!=='write'&&<div className="md-preview"><h1>{v.icon} {v.title||'Untitled page'}</h1><Markdown text={v.body}/></div>}
  </div>
 </div>;
}
export {useMemo};
