'use client';
import {useMemo,useState} from 'react';
import {api,useApi,go,ago,until,dateTime,cx} from './lib';
import {useApp,Attachments,Btn,Chip,Header,Grid,Inspector,Modal,Field,DeptSelect,LocationInput,PersonSelect,Who,Markdown,Thread,Timeline,Tabs,Segmented,ErrorNote,Skeleton,Empty,KV,type Col,LookupSelect} from './kit';
import {AiActions} from './assistant';
import {ticketStatuses,ticketPriorities,ticketTypes} from '../data';

type Ticket={id:string,number:string,title:string,excerpt:string,type:string,category:string,priority:string,status:string,department:string,assignee_id:string|null,requester_id:string,asset_id:string|null,location:string,due_at:string|null,resolved_at:string|null,created_at:string,updated_at:string,version:number,subcategory:string,impact:string,urgency:string,affected_user_id:string|null,approval_status:string,approver_id:string|null,escalated_at:string|null};
const views=['mine','requested','department','queue','board','all'];
const done=(t:Ticket)=>['Resolved','Closed'].includes(t.status);
const overdue=(t:Ticket)=>!done(t)&&!!t.due_at&&Date.parse(t.due_at)<Date.now();

export default function Tickets({parts}:{parts:string[]}){
 const {s,person,can,toast}=useApp();
 const view=views.includes(parts[0])?parts[0]:parts[0]==='new'?'mine':parts[0]?'all':'mine';
 const rawId=views.includes(parts[0])?parts[1]:parts[0];
 const openId=rawId&&rawId!=='new'?rawId:undefined;
 const creating=parts[0]==='new'||parts[1]==='new';
 const {data,error,reload,setData}=useApi<{tickets:Ticket[],canCreate:boolean}>('/api/tickets');
 const [status,setStatus]=useState<'open'|'done'|'any'>('open');
 const rows=useMemo(()=>{const all=data?.tickets||[];let r=view==='mine'?all.filter(t=>t.assignee_id===s.user.id):view==='requested'?all.filter(t=>t.requester_id===s.user.id):view==='department'?all.filter(t=>t.department.toLowerCase()===s.user.department.toLowerCase()):view==='queue'?all.filter(t=>t.requester_id!==s.user.id||t.assignee_id===s.user.id):all;if(view!=='board')r=r.filter(t=>status==='any'||(status==='open'?!done(t):done(t)));return r},[data,view,status,s.user.id,s.user.department]);
 const titles:Record<string,[string,string]>={mine:['Assigned to me','Tickets you are responsible for, soonest due first.'],requested:['Raised by me','Follow up on the issues and requests you reported.'],department:['My department','Tickets handled by your department.'],queue:['Team queue','Everything your team can pick up and work.'],board:['Board','Drag cards between columns to update status.'],all:['All tickets','Every ticket you have access to.']};
 const cols:Col<Ticket>[]=[
  {key:'number',label:'Ticket',width:130,render:t=><span className="mono">{t.number}</span>},
  {key:'title',label:'Summary',render:t=><div className="cell-title"><b>{t.title}</b>{t.excerpt&&<small>{t.excerpt}</small>}</div>},
  {key:'status',label:'Status',width:120,render:t=><Chip>{t.status}</Chip>},
  {key:'priority',label:'Priority',width:100,render:t=><Chip>{t.priority}</Chip>,value:t=>ticketPriorities.indexOf(t.priority as never)},
  {key:'department',label:'Team',width:130},
  {key:'assignee',label:'Assignee',width:170,render:t=><Who id={t.assignee_id}/>,value:t=>person(t.assignee_id)?.name||''},
  {key:'requester',label:'Requester',width:170,render:t=><Who id={t.requester_id}/>,value:t=>person(t.requester_id)?.name||'',hide:view==='requested'},
  {key:'due',label:'Due',width:120,render:t=>done(t)?<span className="muted">{t.status}</span>:<span className={overdue(t)?'text-red':'muted'}>{until(t.due_at)}</span>,value:t=>t.due_at||''},
  {key:'updated',label:'Updated',width:110,render:t=><span className="muted">{ago(t.updated_at)}</span>,value:t=>t.updated_at},
  {key:'type',label:'Type',hide:true},{key:'category',label:'Category',hide:true},{key:'location',label:'Location',hide:true},
 ];
 async function move(t:Ticket,next:string){setData(d=>d?{...d,tickets:d.tickets.map(x=>x.id===t.id?{...x,status:next}:x)}:d);try{await api('/api/tickets',{action:'status',id:t.id,status:next,version:t.version})}catch(e){toast((e as Error).message,'error')}reload()}
 return <div className="page">
  <Header icon="LifeBuoy" tone="orange" title={titles[view][0]} subtitle={titles[view][1]} actions={<>{view!=='board'&&<Segmented value={status} onChange={v=>setStatus(v as never)} items={[{id:'open',label:'Open'},{id:'done',label:'Done'},{id:'any',label:'All'}]}/>}{can('maintenance','create')&&<Btn variant="primary" icon="Plus" onClick={()=>go(`tickets/${view}/new`)}>New ticket</Btn>}</>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:view==='board'?<Board rows={rows} onMove={move}/>:
   <Grid id={'tickets-'+view} rows={rows} cols={cols} onOpen={t=>go(`tickets/${view}/${t.id}`)} activeId={openId} exportName={`tickets-${view}`} initialSort={view==='mine'?['due','asc']:undefined}
    empty={<Empty icon={view==='mine'?'Coffee':'LifeBuoy'} title={view==='mine'?'No tickets assigned to you':'No tickets here'}>{view==='requested'?'Raise a ticket whenever something needs fixing or you need help.':'New tickets will appear here.'}</Empty>}/>}
  {openId&&<TicketPanel id={openId} onClose={()=>go(`tickets/${view}`)} onChanged={reload}/>}
  {creating&&<NewTicket onClose={()=>go(`tickets/${view}`)} onCreated={id=>{reload();go(`tickets/${view==='board'?'all':view}/${id}`)}}/>}
 </div>;
}

function Board({rows,onMove}:{rows:Ticket[],onMove:(t:Ticket,s:string)=>void}){
 const cols=['New','Open','In progress','On hold','Resolved'];const [drag,setDrag]=useState<string|null>(null),[over,setOver]=useState('');
 return <div className="board">{cols.map(c=>{const items=rows.filter(t=>t.status===c).sort((a,b)=>ticketPriorities.indexOf(b.priority as never)-ticketPriorities.indexOf(a.priority as never));return <section key={c} className={cx('board-col',over===c&&'over')} onDragOver={e=>{e.preventDefault();setOver(c)}} onDragLeave={()=>setOver('')} onDrop={e=>{e.preventDefault();setOver('');const t=rows.find(x=>x.id===drag);if(t&&t.status!==c)onMove(t,c)}}>
  <header><Chip>{c}</Chip><b>{items.length}</b></header>
  <div className="board-cards">{items.slice(0,150).map(t=><a key={t.id} href={`#/tickets/board/${t.id}`} draggable onDragStart={()=>setDrag(t.id)} className={cx('board-card',`prio-${t.priority.toLowerCase()}`)}><div className="board-card-top"><span className="mono">{t.number}</span>{overdue(t)&&<span className="text-red small">Overdue</span>}</div><b>{t.title}</b><div className="board-card-foot"><Chip>{t.priority}</Chip><span className="muted small">{t.department}</span><Who id={t.assignee_id} fallback="—"/></div></a>)}{!items.length&&<p className="board-empty">Drop here</p>}</div>
 </section>})}</div>;
}

function TicketPanel({id,onClose,onChanged}:{id:string,onClose:()=>void,onChanged:()=>void}){
 const {toast,s}=useApp();const {data,error,reload}=useApi<any>('/api/tickets?id='+encodeURIComponent(id));const [tab,setTab]=useState('conversation'),[busy,setBusy]=useState(false),[editing,setEditing]=useState(false);
 const t:Ticket&{description:string}|undefined=data?.ticket;
 async function act(body:Record<string,unknown>,msg:string){setBusy(true);try{await api('/api/tickets',{id,...body});toast(msg);await reload();onChanged()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}
 const {ask}=useApp();const [approval,setApproval]=useState(false);
 async function escalate(){const reason=await ask({title:`Escalate ${t!.number}?`,body:'Raises the priority one level, shortens the response target and alerts the team lead.',confirm:'Escalate',input:{label:'Reason',required:true,multiline:true}});if(reason!==false)act({action:'escalate',reason},'Ticket escalated')}
 async function decide(decision:'Approved'|'Rejected'){const note=await ask({title:`${decision==='Approved'?'Approve':'Reject'} ${t!.number}?`,confirm:decision==='Approved'?'Approve':'Reject',danger:decision==='Rejected',input:{label:decision==='Approved'?'Comment (optional)':'Reason',required:decision==='Rejected',multiline:true}});if(note!==false)act({action:'approval-decision',decision,note},`Ticket ${decision.toLowerCase()}`)}
 return <Inspector open onClose={onClose} width={640} eyebrow={t?.number} title={t?.title||'Loading…'} subtitle={t&&<><Chip>{t.status}</Chip><Chip>{t.priority}</Chip><span className="muted small">{t.type} · opened {ago(t.created_at)}</span></>} actions={t&&<><AiActions entity="ticket" entityId={t.id} onApply={{'ticket.update':async(d:{priority:string,category:string})=>{await api('/api/tickets',{action:'update',id:t.id,priority:d.priority,category:d.category});reload()},'ticket.comment':async(d:{reply:string})=>{await api('/api/comments',{type:'ticket',id:t.id,body:d.reply});reload()},'ticket.assign':async(d:{assigneeId:string|null})=>{if(!d.assigneeId)throw new Error('No valid person was suggested.');await api('/api/tickets',{action:'assign',id:t.id,assigneeId:d.assigneeId});reload()}}}/>{(data.canWork||t.requester_id===s.user.id)&&<Btn size="sm" variant="ghost" icon="Pencil" title="Edit ticket" onClick={()=>setEditing(true)}/>}</>}>
  <ErrorNote error={error} onRetry={reload}/>
  {!t?<Skeleton/>:<>
   <div className="action-strip">
    {data.canWork?<label className="inline-field"><span>Status</span><select value={t.status} disabled={busy} onChange={e=>act({action:'status',status:e.target.value,version:t.version},`Moved to ${e.target.value}`)}>{ticketStatuses.map(x=><option key={x}>{x}</option>)}</select></label>:t.requester_id===s.user.id&&!['Closed'].includes(t.status)&&<>{t.status==='Resolved'&&<Btn size="sm" icon="RotateCcw" onClick={()=>act({action:'status',status:'Open',version:t.version},'Ticket reopened')}>Reopen</Btn>}<Btn size="sm" icon="CircleCheck" onClick={()=>act({action:'status',status:'Closed',version:t.version},'Ticket closed')}>Close ticket</Btn></>}
    {data.canAssign?<label className="inline-field grow"><span>Assignee</span><PersonSelect value={t.assignee_id} onChange={v=>act({action:'assign',assigneeId:v},v?'Assigned':'Unassigned')} placeholder="Assign to…"/></label>:<div className="inline-field grow"><span>Assignee</span><Who id={t.assignee_id}/></div>}
    {!t.assignee_id&&data.canWork&&!data.canAssign&&<Btn size="sm" variant="primary" icon="Hand" onClick={()=>act({action:'assign',assigneeId:s.user.id},'You took this ticket')}>Take it</Btn>}
    {data.canAssign&&t.assignee_id!==s.user.id&&<Btn size="sm" variant="ghost" icon="Hand" onClick={()=>act({action:'assign',assigneeId:s.user.id},'You took this ticket')}>Assign to me</Btn>}
    {!done(t)&&(data.canWork||t.requester_id===s.user.id)&&<Btn size="sm" variant="ghost" icon="Flame" onClick={escalate}>Escalate</Btn>}
    {!done(t)&&data.canWork&&t.approval_status!=='Pending'&&<Btn size="sm" variant="ghost" icon="Stamp" onClick={()=>setApproval(true)}>Request approval</Btn>}
   </div>
   {t.approval_status==='Pending'&&<div className="note note-warn"><span className="grow">Waiting for approval from <b>{s.people.find(p=>p.id===t.approver_id)?.name||'—'}</b>.</span>{data.canDecide&&<div className="row-gap"><Btn size="sm" variant="primary" onClick={()=>decide('Approved')}>Approve</Btn><Btn size="sm" variant="danger" onClick={()=>decide('Rejected')}>Reject</Btn></div>}</div>}
   {t.approval_status&&t.approval_status!=='Pending'&&<p className="small muted">Approval: {t.approval_status}</p>}
   {t.escalated_at&&<p className="small text-red">Escalated {ago(t.escalated_at)}</p>}
   <KV items={[['Requester',<Who key="r" id={t.requester_id} sub/>],['Affected user',t.affected_user_id&&<Who key="af" id={t.affected_user_id}/>],['Team',t.department],['Category',[t.category,t.subcategory].filter(Boolean).join(' / ')],['Impact / urgency',`${t.impact} / ${t.urgency}`],['Location',t.location],['Asset',data.asset&&<a key="a" href={`#/assets/all/${data.asset.id}`}>{data.asset.code} · {data.asset.name}</a>],['Due',t.due_at&&<span key="d" className={overdue(t)?'text-red':''}>{dateTime(t.due_at)} · {until(t.due_at)}</span>],['Resolved',t.resolved_at&&dateTime(t.resolved_at)]]}/>
   <div className="prose-box">{t.description?<Markdown text={t.description}/>:<p className="muted">No description provided.</p>}</div>
   <Tabs value={tab} onChange={setTab} items={[{id:'conversation',label:'Conversation',count:data.comments.length},{id:'files',label:'Attachments',count:data.files.length},{id:'activity',label:'Activity'}]}/>
   {tab==='files'?<Attachments type="ticket" id={id} files={data.files} onChange={reload}/>:tab==='conversation'?<Thread comments={data.comments} allowInternal={data.canWork} onPost={async(body,internal)=>{try{await api('/api/comments',{type:'ticket',id,body,internal});await reload()}catch(e){toast((e as Error).message,'error')}}}/>:<Timeline events={data.history}/>}
  </>}
  {approval&&t&&<Modal open onClose={()=>setApproval(false)} title={`Request approval · ${t.number}`}><ApprovalForm onSubmit={async(approverId,note)=>{await act({action:'request-approval',approverId,note},'Approval requested');setApproval(false)}}/></Modal>}
  {editing&&t&&<EditTicket t={t} onClose={()=>setEditing(false)} onSaved={async()=>{setEditing(false);await reload();onChanged()}}/>}
 </Inspector>;
}

function TicketForm({init,onSubmit,busy,submitLabel}:{init:Partial<Ticket&{description:string}>,onSubmit:(v:Record<string,unknown>)=>void,busy:boolean,submitLabel:string}){
 const {s}=useApp();
 const [v,setV]=useState({impact:init.impact||'Medium',urgency:init.urgency||'Medium',subcategory:init.subcategory||'',affectedUserId:init.affected_user_id||null as string|null,title:init.title||'',type:init.type||'Incident',priority:init.priority||'Medium',department:init.department||s.departments.find(d=>/^it$/i.test(d.name))?.name||s.user.department,category:init.category||'',location:init.location??s.user.location??'',description:init.description||'',assetId:init.asset_id||''});
 const {data:assets}=useApi<{assets:{id:string,code:string,name:string,assigned_to:string|null}[]}>('/api/assets');
 const mine=(assets?.assets||[]).filter(a=>a.assigned_to===s.user.id);
 return <form className="form-grid" onSubmit={e=>{e.preventDefault();onSubmit(v)}}>
  <Field label="Summary" wide><input required autoFocus maxLength={200} value={v.title} placeholder="e.g. Printer on 2nd floor jams on every page" onChange={e=>setV({...v,title:e.target.value})}/></Field>
  <Field label="Send to team"><DeptSelect value={v.department} required onChange={x=>setV({...v,department:x})}/></Field>
  <Field label="Impact"><select value={v.impact} onChange={e=>setV({...v,impact:e.target.value,priority:derive(e.target.value,v.urgency)})}>{['Low','Medium','High'].map(x=><option key={x}>{x}</option>)}</select></Field>
  <Field label="Urgency"><select value={v.urgency} onChange={e=>setV({...v,urgency:e.target.value,priority:derive(v.impact,e.target.value)})}>{['Low','Medium','High'].map(x=><option key={x}>{x}</option>)}</select></Field>
  <Field label="Priority" hint="Suggested from impact × urgency; you can override it."><div className="prio-picker">{ticketPriorities.map(p=><button type="button" key={p} className={cx('prio-opt',`prio-${p.toLowerCase()}`,v.priority===p&&'on')} onClick={()=>setV({...v,priority:p})}>{p}</button>)}</div></Field>
  <Field label="Type"><select value={v.type} onChange={e=>setV({...v,type:e.target.value})}>{ticketTypes.map(x=><option key={x}>{x}</option>)}</select></Field>
  <Field label="Subcategory"><LookupSelect list="ticket-subcategories" label="Ticket subcategories" parent={v.category} value={v.subcategory} onChange={x=>setV({...v,subcategory:x})}/></Field>
  <Field label="Affected user" hint="If different from you."><PersonSelect value={v.affectedUserId} onChange={x=>setV({...v,affectedUserId:x})}/></Field>
  <Field label="Category"><LookupSelect list="ticket-categories" label="Ticket categories" value={v.category} onChange={x=>setV({...v,category:x,subcategory:''})}/></Field>
  <Field label="Location"><LocationInput value={v.location} onChange={x=>setV({...v,location:x})}/></Field>
  <Field label="Related asset" hint={mine.length?'Assets assigned to you are listed first.':undefined}><select value={v.assetId} onChange={e=>setV({...v,assetId:e.target.value})}><option value="">None</option>{mine.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}{(assets?.assets||[]).filter(a=>a.assigned_to!==s.user.id).slice(0,500).map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></Field>
  <Field label="Details" wide hint="Markdown supported: **bold**, lists, links."><textarea rows={6} maxLength={8000} value={v.description} placeholder="What happened, since when, what have you tried?" onChange={e=>setV({...v,description:e.target.value})}/></Field>
  <div className="form-actions"><Btn type="submit" variant="primary" busy={busy}>{submitLabel}</Btn></div>
 </form>;
}
function NewTicket({onClose,onCreated}:{onClose:()=>void,onCreated:(id:string)=>void}){const {toast}=useApp();const [busy,setBusy]=useState(false);return <Modal open onClose={onClose} wide title="Raise a ticket" subtitle="The receiving team is notified and the clock starts on its response target."><TicketForm init={{}} busy={busy} submitLabel="Raise ticket" onSubmit={async v=>{setBusy(true);try{const d=await api<{id:string,number:string}>('/api/tickets',{action:'create',...v});toast(`${d.number} raised`);onCreated(d.id)}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}/></Modal>}
function EditTicket({t,onClose,onSaved}:{t:Ticket&{description:string},onClose:()=>void,onSaved:()=>void}){const {toast}=useApp();const [busy,setBusy]=useState(false);return <Modal open onClose={onClose} wide title={`Edit ${t.number}`}><TicketForm init={t} busy={busy} submitLabel="Save changes" onSubmit={async v=>{setBusy(true);try{await api('/api/tickets',{action:'update',id:t.id,...v});toast('Ticket updated');onSaved()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}/></Modal>}

const derive=(i:string,u:string)=>{const l=['Low','Medium','High'];const n=l.indexOf(i)+l.indexOf(u);return n>=4?'Urgent':n===3?'High':n===2?'Medium':'Low'};
function ApprovalForm({onSubmit}:{onSubmit:(approverId:string,note:string)=>Promise<void>}){const [who,setWho]=useState<string|null>(null),[note,setNote]=useState(''),[busy,setBusy]=useState(false);return <div className="form-grid"><Field label="Approver" wide><PersonSelect value={who} onChange={setWho}/></Field><Field label="What needs approving" wide><textarea rows={3} value={note} onChange={e=>setNote(e.target.value)}/></Field><div className="form-actions"><Btn variant="primary" busy={busy} disabled={!who} onClick={async()=>{setBusy(true);try{await onSubmit(who!,note)}finally{setBusy(false)}}}>Send for approval</Btn></div></div>}
