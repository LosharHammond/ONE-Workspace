'use client';
import {useMemo,useState} from 'react';
import {api,useApi,go,ago,dateOnly,cx,downloadCsv,parseCsv,pref,setPref} from './lib';
import {useApp,Btn,Chip,Header,Field,Who,Avatar,Thread,ErrorNote,Skeleton,Empty,Icon,Segmented,Menu,Inspector,Tabs,Modal,Note,PersonSelect,Card} from './kit';
import {ConnectedContext} from './context';
import {CustomFields} from './studio-runtime';
import {AiActions} from './assistant';

// Unified tasks: personal, department, project, space, ticket and purchasing tasks in one place.
export type TaskItem={id:string,number:string,title:string,description:string,type:string,status:string,priority:string,owner_id:string,department:string,project_id:string|null,space_id:string|null,parent_id:string|null,milestone:number,start_date:string|null,due_date:string|null,baseline_start?:string|null,baseline_due?:string|null,estimate_min:number,actual_min:number,progress:number,tags:string,recurrence:string,reminder_at:string|null,approval_status:string,approver_id:string|null,source_type:string,source_id:string,assignees:string[],watchers:string[],checklist?:{total:number,done:number}|null,updated_at:string,created_by:string};
export const STATUSES=['To do','In progress','Blocked','In review','Done','Cancelled'];
const PRIORITIES=['Low','Medium','High','Critical'];
const TYPES=['task','milestone','deliverable','requirement','epic','feature','story','bug','test','checklist','approval','inspection','meeting'];
const statusTone:Record<string,string>={'To do':'gray','In progress':'blue','Blocked':'red','In review':'amber','Done':'green','Cancelled':'gray'};
const prioTone:Record<string,string>={Low:'gray',Medium:'blue',High:'amber',Critical:'red'};
export const taskViews=[{id:'mine',label:'My tasks',icon:'UserCheck'},{id:'assigned-by-me',label:'Assigned by me',icon:'Send'},{id:'department',label:'My department',icon:'Users'},{id:'overdue',label:'Overdue',icon:'AlarmClock'},{id:'all',label:'All I can see',icon:'ListTodo'},{id:'workload',label:'Workload',icon:'ChartBar'}];
const today=()=>new Date().toISOString().slice(0,10);
const late=(t:TaskItem)=>!!t.due_date&&t.due_date<today()&&!['Done','Cancelled'].includes(t.status);

export default function Tasks({parts}:{parts:string[]}){
 const view=parts[0]||'mine';const openId=parts[1];
 if(view==='workload')return <Workload/>;
 return <TaskBoard view={view} openId={openId}/>;
}
export function TaskBoard({view,openId,project,space,embedded}:{view:string,openId?:string,project?:string,space?:string,embedded?:boolean}){
 const {toast,ask,s}=useApp();
 const qs=new URLSearchParams({view:project||space?'all':view});if(project)qs.set('project',project);if(space)qs.set('space',space);
 const {data,error,reload}=useApi<{tasks:TaskItem[],canCreate:boolean}>(`/api/tasks?${qs}`);
 const [layout,setLayoutS]=useState(()=>pref('tasks.layout','list') as string);const setLayout=(v:string)=>{setLayoutS(v);setPref('tasks.layout',v)};
 const [q,setQ]=useState('');const [status,setStatus]=useState('open');const [prio,setPrio]=useState('');const [sel,setSel]=useState<Set<string>>(new Set());
 const [creating,setCreating]=useState(openId==='new');const [importing,setImporting]=useState(false);
 const base=project?`projects/${project}/tasks`:`tasks/${view}`;
 const rows=useMemo(()=>(data?.tasks||[]).filter(t=>(status==='open'?!['Done','Cancelled'].includes(t.status):status?t.status===status:true)&&(!prio||t.priority===prio)&&(!q||`${t.title} ${t.number} ${t.tags}`.toLowerCase().includes(q.toLowerCase()))),[data,q,status,prio]);
 async function bulk(op:string,value?:string){try{const r=await api<{results:{ok:boolean,error?:string}[]}>('/api/tasks',{action:'bulk',ids:[...sel],op,value});const bad=r.results.filter(x=>!x.ok);toast(bad.length?`${r.results.length-bad.length} updated, ${bad.length} refused: ${bad[0].error}`:`${r.results.length} updated`,bad.length?'error':'ok');setSel(new Set());reload()}catch(e){toast((e as Error).message,'error')}}
 async function move(t:TaskItem,st:string){try{await api('/api/tasks',{action:'status',id:t.id,status:st});reload()}catch(e){toast((e as Error).message,'error')}}
 const title=taskViews.find(v=>v.id===view)?.label||'Tasks';
 const toolbar=<div className="toolbar">
  <input className="search" placeholder="Filter tasks…" value={q} onChange={e=>setQ(e.target.value)} aria-label="Filter tasks"/>
  <select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Status"><option value="open">Open</option><option value="">Any status</option>{STATUSES.map(x=><option key={x}>{x}</option>)}</select>
  <select value={prio} onChange={e=>setPrio(e.target.value)} aria-label="Priority"><option value="">Any priority</option>{PRIORITIES.map(x=><option key={x}>{x}</option>)}</select>
  <Segmented value={layout} onChange={setLayout} items={[{id:'list',label:'',icon:'List'},{id:'board',label:'',icon:'Columns3'},{id:'calendar',label:'',icon:'CalendarDays'},{id:'timeline',label:'',icon:'ChartGantt'}]}/>
  <SavedFilters state={{q,status,prio,layout}} onApply={x=>{setQ(String(x.q||''));setStatus(String(x.status??'open'));setPrio(String(x.prio||''));if(x.layout)setLayout(String(x.layout))}}/>
  <div className="grow"/>
  <Menu trigger={o=><Btn variant="ghost" icon="Ellipsis" title="More" onClick={o}/>} items={[{label:'Export CSV',icon:'Download',onClick:()=>downloadCsv('tasks.csv',[['Number','Title','Status','Priority','Start','Due','Assignees','Project','Tags'],...rows.map(t=>[t.number,t.title,t.status,t.priority,t.start_date||'',t.due_date||'',t.assignees.map(a=>s.people.find(p=>p.id===a)?.name||a).join('; '),t.project_id||'',t.tags])])},{label:'Import CSV',icon:'Upload',onClick:()=>setImporting(true),hidden:!data?.canCreate}]}/>
  {data?.canCreate&&<Btn variant="primary" icon="Plus" onClick={()=>setCreating(true)}>New task</Btn>}
 </div>;
 return <div className={embedded?'':'page'}>
  {!embedded&&<Header icon="ListTodo" tone="green" title={title} subtitle="Personal, department, project and space tasks in one list." actions={<AiActions only={['tasks.overdue']}/>}/>}
  {toolbar}
  <ErrorNote error={error} onRetry={reload}/>
  {sel.size>0&&<div className="bulk-bar"><b>{sel.size} selected</b><select onChange={e=>{if(e.target.value)bulk('status',e.target.value);e.target.value=''}} aria-label="Set status"><option value="">Set status…</option>{STATUSES.map(x=><option key={x}>{x}</option>)}</select><select onChange={e=>{if(e.target.value)bulk('priority',e.target.value);e.target.value=''}} aria-label="Set priority"><option value="">Set priority…</option>{PRIORITIES.map(x=><option key={x}>{x}</option>)}</select><input type="date" aria-label="Set due date" onChange={e=>e.target.value&&bulk('due',e.target.value)}/><div style={{minWidth:200}}><PersonSelect value={null} placeholder="Assign to…" onChange={id=>id&&bulk('assign',id)}/></div><Btn size="sm" variant="danger" icon="Trash2" onClick={async()=>{if(await ask({title:`Delete ${sel.size} tasks?`,body:'They can be restored by an administrator.',confirm:'Delete',danger:true})!==false)bulk('delete')}}>Delete</Btn><Btn size="sm" variant="ghost" onClick={()=>setSel(new Set())}>Clear</Btn></div>}
  {!data?<Skeleton rows={8}/>:!rows.length?<Empty icon="ListTodo" title="No tasks here" action={data.canCreate&&<Btn variant="primary" icon="Plus" onClick={()=>setCreating(true)}>New task</Btn>}>Nothing matches these filters.</Empty>:
   layout==='board'?<Board rows={(data.tasks||[]).filter(t=>(!prio||t.priority===prio)&&(!q||t.title.toLowerCase().includes(q.toLowerCase())))} onOpen={t=>go(`${base}/${t.id}`)} onMove={move}/>:
   layout==='calendar'?<TaskCalendar rows={rows} onOpen={t=>go(`${base}/${t.id}`)}/>:
   layout==='timeline'?<Gantt rows={rows} onOpen={t=>go(`${base}/${t.id}`)}/>:
   <TaskTable rows={rows} sel={sel} setSel={setSel} onOpen={t=>go(`${base}/${t.id}`)} onToggle={t=>move(t,t.status==='Done'?'To do':'Done')}/>}
  {openId&&openId!=='new'&&<TaskPanel id={openId} onClose={()=>go(base)} onChange={reload}/>}
  {creating&&<TaskForm project={project} space={space||new URLSearchParams(location.hash.split('?')[1]||'').get('space')||undefined} onClose={()=>{setCreating(false);if(openId==='new')go(base)}} onDone={id=>{setCreating(false);reload();go(`${base}/${id}`)}}/>}
  {importing&&<ImportTasks project={project} onClose={()=>setImporting(false)} onDone={()=>{setImporting(false);reload()}}/>}
 </div>;
}
function TaskTable({rows,sel,setSel,onOpen,onToggle}:{rows:TaskItem[],sel:Set<string>,setSel:(s:Set<string>)=>void,onOpen:(t:TaskItem)=>void,onToggle:(t:TaskItem)=>void}){
 const {person}=useApp();const all=rows.length>0&&rows.every(r=>sel.has(r.id));
 return <div className="table-wrap"><table className="grid-table task-table"><thead><tr><th style={{width:32}}><input type="checkbox" aria-label="Select all" checked={all} onChange={()=>setSel(all?new Set():new Set(rows.map(r=>r.id)))}/></th><th style={{width:32}}/><th>Task</th><th>Status</th><th>Priority</th><th>Due</th><th>Assignees</th><th>Checklist</th></tr></thead>
  <tbody>{rows.map(t=><tr key={t.id} className={cx(late(t)&&'row-late')} onClick={()=>onOpen(t)}>
   <td onClick={e=>e.stopPropagation()}><input type="checkbox" aria-label={`Select ${t.title}`} checked={sel.has(t.id)} onChange={()=>{const n=new Set(sel);n.has(t.id)?n.delete(t.id):n.add(t.id);setSel(n)}}/></td>
   <td onClick={e=>{e.stopPropagation();onToggle(t)}}><button className="icon-btn" aria-label={t.status==='Done'?'Mark not done':'Mark done'}><Icon name={t.status==='Done'?'CircleCheck':'Circle'} size={17}/></button></td>
   <td><b className={cx(t.status==='Done'&&'strike')}>{t.milestone?'◆ ':''}{t.title}</b><br/><small className="muted">{t.number}{t.type!=='task'?` · ${t.type}`:''}{t.recurrence?` · repeats ${t.recurrence}`:''}{t.approval_status==='pending'?' · awaiting approval':''}{t.source_type?` · from ${t.source_type}`:''}</small></td>
   <td><Chip tone={statusTone[t.status]}>{t.status}</Chip></td><td><Chip tone={prioTone[t.priority]}>{t.priority}</Chip></td>
   <td className={cx(late(t)&&'text-danger')}>{t.due_date?dateOnly(t.due_date):'—'}</td>
   <td><span className="avatars">{t.assignees.slice(0,4).map(a=><Avatar key={a} name={person(a)?.name} size={22}/>)}</span></td>
   <td>{t.checklist?`${t.checklist.done}/${t.checklist.total}`:''}</td></tr>)}</tbody></table></div>;
}
function Board({rows,onOpen,onMove}:{rows:TaskItem[],onOpen:(t:TaskItem)=>void,onMove:(t:TaskItem,s:string)=>void}){
 const {person}=useApp();const [drag,setDrag]=useState<string|null>(null);
 return <div className="kanban">{STATUSES.filter(s=>s!=='Cancelled').map(st=><section key={st} className="kanban-col" onDragOver={e=>e.preventDefault()} onDrop={()=>{const t=rows.find(r=>r.id===drag);if(t&&t.status!==st)onMove(t,st);setDrag(null)}}>
  <h3><Chip tone={statusTone[st]}>{st}</Chip><small>{rows.filter(t=>t.status===st).length}</small></h3>
  {rows.filter(t=>t.status===st).map(t=><article key={t.id} className={cx('kanban-card',late(t)&&'late')} draggable onDragStart={()=>setDrag(t.id)} onClick={()=>onOpen(t)} tabIndex={0} onKeyDown={e=>{if(e.key==='Enter')onOpen(t)}}>
   <b>{t.milestone?'◆ ':''}{t.title}</b><div className="row-gap"><Chip tone={prioTone[t.priority]}>{t.priority}</Chip>{t.due_date&&<small className={cx(late(t)&&'text-danger')}>{dateOnly(t.due_date)}</small>}<span className="grow"/>{t.assignees.slice(0,3).map(a=><Avatar key={a} name={person(a)?.name} size={20}/>)}</div>
   <label className="sr-only">Move to<select value={t.status} onClick={e=>e.stopPropagation()} onChange={e=>onMove(t,e.target.value)}>{STATUSES.map(x=><option key={x}>{x}</option>)}</select></label>
  </article>)}
 </section>)}</div>;
}
function TaskCalendar({rows,onOpen}:{rows:TaskItem[],onOpen:(t:TaskItem)=>void}){
 const [month,setMonth]=useState(()=>today().slice(0,7));
 const first=new Date(month+'-01T00:00:00Z');const startDow=(first.getUTCDay()+6)%7;const days=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
 const cells=[...Array(startDow).fill(null),...Array.from({length:days},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`)];
 const shift=(n:number)=>{const d=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+n,1));setMonth(d.toISOString().slice(0,7))};
 const undated=rows.filter(t=>!t.due_date);
 return <div><div className="between"><Btn size="sm" icon="ChevronLeft" onClick={()=>shift(-1)} title="Previous month"/><b>{first.toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'})}</b><Btn size="sm" icon="ChevronRight" onClick={()=>shift(1)} title="Next month"/></div>
  <div className="cal-grid">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=><div key={d} className="cal-head">{d}</div>)}{cells.map((d,i)=><div key={i} className={cx('cal-cell',d===today()&&'today',!d&&'blank')}>{d&&<><small>{Number(d.slice(8))}</small>{rows.filter(t=>t.due_date===d).map(t=><button key={t.id} className={cx('cal-item',late(t)&&'late',t.status==='Done'&&'done')} onClick={()=>onOpen(t)}>{t.milestone?'◆ ':''}{t.title}</button>)}</>}</div>)}</div>
  {undated.length>0&&<p className="muted small">{undated.length} task(s) without a due date are not shown.</p>}
 </div>;
}
// Timeline / Gantt: bars from start to due; baselines as a thin line; critical-path tasks highlighted.
export function Gantt({rows,onOpen,critical,deps}:{rows:TaskItem[],onOpen:(t:TaskItem)=>void,critical?:string[],deps?:{task_id:string,depends_on:string}[]}){
 const dated=rows.filter(t=>t.start_date||t.due_date);
 if(!dated.length)return <Empty icon="ChartGantt" title="Nothing to draw">Give tasks start and due dates to see them on the timeline.</Empty>;
 const d0=(t:TaskItem)=>t.start_date||t.due_date!;const d1=(t:TaskItem)=>t.due_date||t.start_date!;
 const all=dated.flatMap(t=>[d0(t),d1(t),t.baseline_start||d0(t),t.baseline_due||d1(t)]).sort();
 const min=Date.parse(all[0]),max=Date.parse(all[all.length-1])+86400000;const span=Math.max(1,(max-min)/86400000);
 const pct=(d:string)=>((Date.parse(d)-min)/86400000)/span*100;const width=(a:string,b:string)=>Math.max(.8,((Date.parse(b)-Date.parse(a))/86400000+1)/span*100);
 const months:string[]=[];for(let x=new Date(min);x.getTime()<max;x=new Date(Date.UTC(x.getUTCFullYear(),x.getUTCMonth()+1,1)))months.push(x.toISOString().slice(0,10));
 const crit=new Set(critical||[]);const t0=today();
 return <div className="gantt" role="table" aria-label="Timeline">
  <div className="gantt-row gantt-head"><span className="gantt-label">Task</span><span className="gantt-track">{months.map(m=><i key={m} style={{left:`${Math.max(0,pct(m))}%`}}>{new Date(m).toLocaleDateString('en-GB',{month:'short',year:'2-digit'})}</i>)}{Date.parse(t0)>=min&&Date.parse(t0)<=max&&<b className="gantt-today" style={{left:`${pct(t0)}%`}} title="Today"/>}</span></div>
  {dated.map(t=><div key={t.id} className="gantt-row" role="row"><button className="gantt-label" onClick={()=>onOpen(t)} title={t.title}>{t.milestone?'◆ ':''}{t.title}{deps?.some(d=>d.task_id===t.id)&&<small className="muted"> ← {deps.filter(d=>d.task_id===t.id).length}</small>}</button>
   <span className="gantt-track">{t.baseline_start&&t.baseline_due&&<span className="gantt-baseline" style={{left:`${pct(t.baseline_start)}%`,width:`${width(t.baseline_start,t.baseline_due)}%`}} title={`Baseline ${t.baseline_start} → ${t.baseline_due}`}/>}
    {t.milestone?<span className={cx('gantt-milestone',crit.has(t.id)&&'critical')} style={{left:`${pct(d1(t))}%`}} title={`${t.title}: ${d1(t)}`}/>:<span className={cx('gantt-bar',`st-${t.status.replace(/ /g,'-').toLowerCase()}`,crit.has(t.id)&&'critical',late(t)&&'late')} style={{left:`${pct(d0(t))}%`,width:`${width(d0(t),d1(t))}%`}} title={`${t.title}: ${d0(t)} → ${d1(t)} · ${t.status}${crit.has(t.id)?' · critical path':''}`}><i style={{width:`${t.status==='Done'?100:t.progress}%`}}/></span>}
   </span></div>)}
  {crit.size>0&&<p className="muted small"><span className="legend-swatch critical"/> Critical path · <span className="legend-swatch baseline"/> Baseline</p>}
 </div>;
}
function Workload(){
 const {person}=useApp();const {data,error,reload}=useApi<{workload:{memberId:string,open:number,estimateMin:number,overdue:number}[]}>('/api/tasks?view=workload');
 const max=Math.max(1,...(data?.workload||[]).map(w=>w.open));
 return <div className="page"><Header icon="ChartBar" tone="green" title="Workload" subtitle="Open tasks per person, across everything you can see."/><ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:!data.workload.length?<Empty icon="ChartBar" title="No open tasks"/>:<table className="plain workload"><thead><tr><th>Person</th><th>Open tasks</th><th>Estimated</th><th>Overdue</th></tr></thead><tbody>{data.workload.map(w=><tr key={w.memberId}><td><Who id={w.memberId} sub/></td><td><span className="bar-cell"><span style={{width:`${w.open/max*100}%`}}/><b>{w.open}</b></span></td><td>{Math.round(w.estimateMin/60)} h</td><td className={cx(w.overdue>0&&'text-danger')}>{w.overdue||'—'}</td></tr>)}</tbody></table>}
  {void person}
 </div>;
}
type Detail={task:TaskItem&{custom:Record<string,unknown>},project:{id:string,code:string,name:string}|null,checklist:{id:string,title:string,done:number}[],deps:{id:string,title:string,status:string,kind:string}[],blocking:{id:string,title:string,status:string}[],subtasks:TaskItem[],comments:any[],files:{id:string,name:string,mime:string}[],time:{id:string,minutes:number,date:string,note:string,who:string}[],activity:{action:string,createdAt:string,who:string}[],canEdit:boolean};
export function TaskPanel({id,onClose,onChange}:{id:string,onClose:()=>void,onChange:()=>void}){
 const {toast,ask,s}=useApp();const {data,error,reload}=useApi<Detail>(`/api/tasks?id=${encodeURIComponent(id)}`);const [tab,setTab]=useState('details');const [edit,setEdit]=useState(false);const [newItem,setNewItem]=useState('');
 const act=async(body:Record<string,unknown>,msg?:string)=>{try{await api('/api/tasks',{id,...body});if(msg)toast(msg);reload();onChange()}catch(e){toast((e as Error).message,'error')}};
 const t=data?.task;
 return <Inspector open onClose={onClose} width={640} eyebrow={t?`${t.number}${data?.project?` · ${data.project.code}`:''}`:'Task'} title={t?.title||'Loading…'} subtitle={t&&<span className="row-gap"><Chip tone={statusTone[t.status]}>{t.status}</Chip><Chip tone={prioTone[t.priority]}>{t.priority}</Chip>{t.due_date&&<span className={cx(late(t)&&'text-danger')}>Due {dateOnly(t.due_date)}</span>}</span>} actions={data?.canEdit&&<><Btn size="sm" icon="Pencil" onClick={()=>setEdit(true)}>Edit</Btn><Menu trigger={o=><Btn size="sm" variant="ghost" icon="Ellipsis" title="More" onClick={o}/>} items={[{label:'Watch',icon:'Eye',onClick:()=>act({action:'watch',on:true},'Watching')},{label:'Save as template',icon:'LayoutTemplate',onClick:async()=>{const n=await ask({title:'Save as a task template',body:'Title, description, type, priority, estimate, recurrence, tags and checklist are saved. Assignees and dates are not.',input:{label:'Template name',required:true},confirm:'Save'});if(n===false||!data)return;try{await api('/api/tasks',{action:'template-save',name:n,payload:{title:t!.title,description:t!.description,type:t!.type,priority:t!.priority,estimateMin:t!.estimate_min,recurrence:t!.recurrence,tags:t!.tags,checklist:data.checklist.map(c=>c.title)}});toast('Template saved')}catch(e){toast((e as Error).message,'error')}}},{label:'Request approval',icon:'Stamp',onClick:async()=>{const n=await ask({title:'Who should approve?',input:{label:'Approver email',required:true}});if(n===false)return;const p=s.people.find(x=>x.email.toLowerCase()===n.trim().toLowerCase()||x.name.toLowerCase()===n.trim().toLowerCase());if(!p){toast('No active person with that name or email','error');return}act({action:'request-approval',approverId:p.id},'Approval requested')}},'-',{label:'Delete',icon:'Trash2',danger:true,onClick:async()=>{if(await ask({title:'Delete this task?',confirm:'Delete',danger:true})!==false){await act({action:'delete'},'Deleted');onClose()}}}]}/></>}>
  <ErrorNote error={error} onRetry={reload}/>
  {!data||!t?<Skeleton/>:<>
   {t.approval_status==='pending'&&<Note tone="warn">Waiting for approval from {s.people.find(p=>p.id===t.approver_id)?.name||'the approver'}.{t.approver_id===s.user.id&&<> <Btn size="sm" variant="primary" onClick={()=>act({action:'decide',approve:true},'Approved')}>Approve</Btn> <Btn size="sm" onClick={()=>act({action:'decide',approve:false},'Rejected')}>Reject</Btn></>}</Note>}
   <div className="row-gap">{data.canEdit&&<select value={t.status} onChange={e=>act({action:'status',status:e.target.value})} aria-label="Status">{STATUSES.map(x=><option key={x}>{x}</option>)}</select>}<AiActions entity="task" entityId={t.id}/></div>
   <Tabs value={tab} onChange={setTab} items={[{id:'details',label:'Details'},{id:'checklist',label:'Checklist',count:data.checklist.length},{id:'deps',label:'Dependencies',count:data.deps.length},{id:'time',label:'Time'},{id:'discussion',label:'Discussion',count:data.comments.length},{id:'connected',label:'Connected'},{id:'activity',label:'Activity'}]}/>
   {tab==='connected'&&<><CustomFields type="task" id={t.id}/><ConnectedContext type="task" id={t.id} compact/></>}
   {tab==='details'&&<div className="stack">
    {t.description?<p className="prewrap">{t.description}</p>:<p className="muted">No description.</p>}
    <dl className="kv">
     <div><dt>Assignees</dt><dd>{t.assignees.length?t.assignees.map(a=><div key={a}><Who id={a}/></div>):'—'}</dd></div>
     <div><dt>Owner</dt><dd><Who id={t.owner_id}/></dd></div>
     {data.project&&<div><dt>Project</dt><dd><a href={`#/projects/${data.project.id}`}>{data.project.code} · {data.project.name}</a></dd></div>}
     <div><dt>Dates</dt><dd>{t.start_date?dateOnly(t.start_date):'—'} → {t.due_date?dateOnly(t.due_date):'—'}</dd></div>
     <div><dt>Estimate / logged</dt><dd>{Math.round(t.estimate_min/60*10)/10} h / {Math.round(t.actual_min/60*10)/10} h</dd></div>
     {t.recurrence&&<div><dt>Repeats</dt><dd>{t.recurrence}</dd></div>}
     {t.reminder_at&&<div><dt>Reminder</dt><dd>{new Date(t.reminder_at).toLocaleString()}</dd></div>}
     {t.watchers.length>0&&<div><dt>Watchers</dt><dd>{t.watchers.map(w=>s.people.find(p=>p.id===w)?.name).filter(Boolean).join(', ')}</dd></div>}
     {t.tags&&<div><dt>Tags</dt><dd>{t.tags}</dd></div>}
     {t.source_type&&<div><dt>Created from</dt><dd>{t.source_type}</dd></div>}
    </dl>
    {data.subtasks.length>0&&<Card title="Subtasks">{data.subtasks.map(x=><a key={x.id} className="mini-row" href={`#/tasks/all/${x.id}`}><Icon name={x.status==='Done'?'CircleCheck':'Circle'} size={14}/><span>{x.title}<small>{x.status}</small></span></a>)}</Card>}
    {data.files.length>0&&<Card title="Files">{data.files.map(f=><a key={f.id} className="mini-row" href={`#/files/root/${f.id}`}><Icon name="Paperclip" size={14}/><span>{f.name}</span></a>)}</Card>}
    {data.canEdit&&<Btn size="sm" icon="Plus" onClick={async()=>{const n=await ask({title:'New subtask',input:{label:'Title',required:true}});if(n===false)return;try{await api('/api/tasks',{action:'save',title:n,parentId:t.id,projectId:t.project_id||undefined});reload();onChange()}catch(e){toast((e as Error).message,'error')}}}>Add subtask</Btn>}
   </div>}
   {tab==='checklist'&&<div className="stack">{data.checklist.map(c=><label key={c.id} className="check"><input type="checkbox" checked={!!c.done} disabled={!data.canEdit} onChange={()=>act({action:'checklist',op:'toggle',itemId:c.id})}/><span className={cx(!!c.done&&'strike')}>{c.title}</span>{data.canEdit&&<button className="icon-btn" aria-label={`Remove ${c.title}`} onClick={()=>act({action:'checklist',op:'delete',itemId:c.id})}><Icon name="X" size={14}/></button>}</label>)}
    {data.canEdit&&<form className="row-gap" onSubmit={e=>{e.preventDefault();if(newItem.trim()){act({action:'checklist',op:'add',title:newItem.trim()});setNewItem('')}}}><input value={newItem} onChange={e=>setNewItem(e.target.value)} placeholder="Add an item" aria-label="New checklist item"/><Btn type="submit" size="sm">Add</Btn></form>}</div>}
   {tab==='deps'&&<div className="stack"><h4>Waits for</h4>{data.deps.map(d=><div key={d.id} className="mini-row"><Icon name={d.status==='Done'?'CircleCheck':'Clock'} size={14}/><a href={`#/tasks/all/${d.id}`}>{d.title}</a><small className="muted">{d.status} · {d.kind}</small>{data.canEdit&&<button className="icon-btn" aria-label="Remove dependency" onClick={()=>act({action:'dependency',dependsOn:d.id,remove:true})}><Icon name="X" size={14}/></button>}</div>)}{!data.deps.length&&<p className="muted small">No dependencies.</p>}
    {data.canEdit&&<DepPicker taskId={t.id} projectId={t.project_id} onPick={x=>act({action:'dependency',dependsOn:x},'Dependency added')}/>}
    <h4>Blocks</h4>{data.blocking.map(d=><a key={d.id} className="mini-row" href={`#/tasks/all/${d.id}`}><Icon name="ArrowRight" size={14}/><span>{d.title}<small>{d.status}</small></span></a>)}{!data.blocking.length&&<p className="muted small">Nothing waits for this task.</p>}</div>}
   {tab==='time'&&<div className="stack"><TimeForm onLog={(minutes,note,date)=>act({action:'time',minutes,note,date},'Time logged')}/><table className="plain"><tbody>{data.time.map(e=><tr key={e.id}><td>{e.date}</td><td>{e.who}</td><td>{Math.round(e.minutes/6)/10} h</td><td className="muted">{e.note}</td></tr>)}</tbody></table>{!data.time.length&&<p className="muted small">No time logged.</p>}</div>}
   {tab==='discussion'&&<Thread comments={data.comments} onPost={async body=>{await api('/api/comments',{type:'task',id:t.id,body});reload()}}/>}
   {tab==='activity'&&<ol className="timeline">{data.activity.map((a,i)=><li key={i}><span className="dot"/><div><b>{a.action}</b><small>{a.who||'System'} · {ago(a.createdAt)}</small></div></li>)}</ol>}
  </>}
  {edit&&t&&<TaskForm task={t} onClose={()=>setEdit(false)} onDone={()=>{setEdit(false);reload();onChange()}}/>}
 </Inspector>;
}
function DepPicker({taskId,projectId,onPick}:{taskId:string,projectId:string|null,onPick:(id:string)=>void}){
 const {data}=useApi<{tasks:TaskItem[]}>(`/api/tasks?view=all${projectId?`&project=${projectId}`:''}`);
 return <select value="" onChange={e=>e.target.value&&onPick(e.target.value)} aria-label="Add a dependency"><option value="">Add “waits for”…</option>{(data?.tasks||[]).filter(x=>x.id!==taskId).slice(0,300).map(x=><option key={x.id} value={x.id}>{x.number} · {x.title}</option>)}</select>;
}
function TimeForm({onLog}:{onLog:(m:number,note:string,date:string)=>void}){const [h,setH]=useState('1');const [note,setNote]=useState('');const [d,setD]=useState(today());return <form className="row-gap" onSubmit={e=>{e.preventDefault();const m=Math.round(Number(h)*60);if(m>0){onLog(m,note,d);setNote('')}}}><input type="number" step="0.25" min="0.25" value={h} onChange={e=>setH(e.target.value)} aria-label="Hours" style={{width:80}}/><span className="muted small">hours on</span><input type="date" value={d} onChange={e=>setD(e.target.value)} aria-label="Date"/><input value={note} onChange={e=>setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note"/><Btn type="submit" size="sm" icon="Timer">Log time</Btn></form>}

export function TaskForm({task,project,space,onClose,onDone,defaults}:{task?:TaskItem,project?:string,space?:string,onClose:()=>void,onDone:(id:string)=>void,defaults?:Partial<TaskItem>}){
 const {toast,s}=useApp();const {data:projects}=useApi<{projects:{id:string,code:string,name:string}[]}>('/api/projects');
 const t={...defaults,...task} as Partial<TaskItem>;
 const [v,setV]=useState({title:t.title||'',description:t.description||'',type:t.type||'task',status:t.status||'To do',priority:t.priority||'Medium',startDate:t.start_date||'',dueDate:t.due_date||'',estimateH:t.estimate_min?String(t.estimate_min/60):'',milestone:!!t.milestone,tags:t.tags||'',recurrence:t.recurrence||'',reminderAt:t.reminder_at?t.reminder_at.slice(0,16):'',projectId:t.project_id||project||'',assignees:t.assignees||[s.user.id],checklist:''});
 const [busy,setBusy]=useState(false);
 const {data:tpls}=useApi<{templates:{id:string,name:string,shared:boolean,payload:{title:string,description:string,type:string,priority:string,estimateMin:number,recurrence:string,tags:string,checklist:string[]}}[]}>(task?null:'/api/tasks?view=templates');
 const applyTemplate=(id:string)=>{const p=tpls?.templates.find(x=>x.id===id)?.payload;if(p)setV(x=>({...x,title:p.title,description:p.description,type:p.type,priority:p.priority,estimateH:p.estimateMin?String(p.estimateMin/60):'',recurrence:p.recurrence,tags:p.tags,checklist:(p.checklist||[]).join(String.fromCharCode(10))}))};
 async function save(){setBusy(true);try{const r=await api<{id:string}>('/api/tasks',{action:'save',id:task?.id,title:v.title,description:v.description,type:v.type,status:v.status,priority:v.priority,startDate:v.startDate||null,dueDate:v.dueDate||null,estimateMin:v.estimateH?Math.round(Number(v.estimateH)*60):0,milestone:v.milestone,tags:v.tags,recurrence:v.recurrence,reminderAt:v.reminderAt?new Date(v.reminderAt).toISOString():null,projectId:v.projectId||null,spaceId:space,assignees:v.assignees,checklist:task?undefined:v.checklist.split('\n').map(x=>x.trim()).filter(Boolean)});toast(task?'Saved':'Task created');onDone(r.id)}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}
 return <Modal open wide onClose={onClose} title={task?'Edit task':'New task'} footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!v.title.trim()} onClick={save}>{task?'Save':'Create task'}</Btn></>}>
  <div className="form-grid">
   {!task&&!!tpls?.templates.length&&<Field label="Start from a template" wide><select value="" onChange={e=>applyTemplate(e.target.value)}><option value="">Choose a template…</option>{tpls.templates.map(x=><option key={x.id} value={x.id}>{x.name}{x.shared?' (shared)':''}</option>)}</select></Field>}
   <Field label="Title" wide><input autoFocus value={v.title} onChange={e=>setV({...v,title:e.target.value})}/></Field>
   <Field label="Description" wide><textarea rows={3} value={v.description} onChange={e=>setV({...v,description:e.target.value})}/></Field>
   <Field label="Assignees" wide><AssigneePicker value={v.assignees} onChange={a=>setV({...v,assignees:a})}/></Field>
   <Field label="Type"><select value={v.type} onChange={e=>setV({...v,type:e.target.value})}>{TYPES.map(x=><option key={x}>{x}</option>)}</select></Field>
   <Field label="Status"><select value={v.status} onChange={e=>setV({...v,status:e.target.value})}>{STATUSES.map(x=><option key={x}>{x}</option>)}</select></Field>
   <Field label="Priority"><select value={v.priority} onChange={e=>setV({...v,priority:e.target.value})}>{PRIORITIES.map(x=><option key={x}>{x}</option>)}</select></Field>
   <Field label="Project"><select value={v.projectId} onChange={e=>setV({...v,projectId:e.target.value})}><option value="">None</option>{(projects?.projects||[]).map(p=><option key={p.id} value={p.id}>{p.code} · {p.name}</option>)}</select></Field>
   <Field label="Start"><input type="date" value={v.startDate} onChange={e=>setV({...v,startDate:e.target.value})}/></Field>
   <Field label="Due"><input type="date" value={v.dueDate} onChange={e=>setV({...v,dueDate:e.target.value})}/></Field>
   <Field label="Estimate (hours)"><input type="number" min="0" step="0.5" value={v.estimateH} onChange={e=>setV({...v,estimateH:e.target.value})}/></Field>
   <Field label="Repeats"><select value={v.recurrence} onChange={e=>setV({...v,recurrence:e.target.value})}><option value="">Never</option><option value="daily">Daily</option><option value="weekdays">Weekdays</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></Field>
   <Field label="Reminder"><input type="datetime-local" value={v.reminderAt} onChange={e=>setV({...v,reminderAt:e.target.value})}/></Field>
   <Field label="Tags"><input value={v.tags} onChange={e=>setV({...v,tags:e.target.value})} placeholder="comma separated"/></Field>
   <label className="check"><input type="checkbox" checked={v.milestone} onChange={e=>setV({...v,milestone:e.target.checked})}/>Milestone</label>
   {!task&&<Field label="Checklist (one per line)" wide><textarea rows={3} value={v.checklist} onChange={e=>setV({...v,checklist:e.target.value})}/></Field>}
  </div>
 </Modal>;
}
function AssigneePicker({value,onChange}:{value:string[],onChange:(v:string[])=>void}){
 const {person}=useApp();
 return <div className="stack-sm"><div className="row-gap">{value.map(a=><span key={a} className="chip chip-gray">{person(a)?.name||a}<button className="icon-btn" aria-label={`Remove ${person(a)?.name}`} onClick={()=>onChange(value.filter(x=>x!==a))}><Icon name="X" size={12}/></button></span>)}</div><PersonSelect value={null} placeholder="Add an assignee…" onChange={id=>{if(id&&!value.includes(id))onChange([...value,id])}}/></div>;
}
function ImportTasks({project,onClose,onDone}:{project?:string,onClose:()=>void,onDone:()=>void}){
 const {toast}=useApp();const [rows,setRows]=useState<Record<string,string>[]|null>(null);const [preview,setPreview]=useState<{create:number,errors:{row:number,reason:string}[]}|null>(null);
 return <Modal open onClose={onClose} title="Import tasks from CSV" footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={!preview?.create} onClick={async()=>{try{const r=await api<{created:number}>('/api/tasks',{action:'import',rows,projectId:project});toast(`${r.created} tasks imported`);onDone()}catch(e){toast((e as Error).message,'error')}}}>Import {preview?.create||''}</Btn></>}>
  <p className="muted small">Columns: title (required), description, status, priority, start, due (YYYY-MM-DD).</p>
  <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;const table=parseCsv(await f.text());const [head,...body]=table;const objs=body.map(r=>Object.fromEntries(head.map((h,i)=>[h.trim().toLowerCase(),r[i]||''])));setRows(objs);try{setPreview(await api('/api/tasks',{action:'import',rows:objs,projectId:project,preview:true}))}catch(err){toast((err as Error).message,'error')}}}/>
  {preview&&<Note tone={preview.errors.length?'warn':'ok'}>{preview.create} ready to import{preview.errors.length?`; ${preview.errors.length} rows skipped (e.g. row ${preview.errors[0].row}: ${preview.errors[0].reason})`:''}.</Note>}
 </Modal>;
}

// Saved filters are personal and stored on the server (saved_views), so they follow the person across devices.
function SavedFilters({state,onApply}:{state:Record<string,unknown>,onApply:(s:Record<string,unknown>)=>void}){
 const {toast,ask}=useApp();const {data,reload}=useApi<{views:{id:string,name:string,state:Record<string,unknown>}[]}>('/api/views?grid=tasks');
 return <Menu trigger={o=><Btn icon="Filter" onClick={o}>Saved filters</Btn>} items={[...(data?.views||[]).map(v=>({label:v.name,icon:'Filter',onClick:()=>onApply(v.state)})),...(data?.views.length?['-' as const]:[]),{label:'Save current filters…',icon:'Save',onClick:async()=>{const n=await ask({title:'Save these filters',input:{label:'Name',required:true},confirm:'Save'});if(n===false)return;try{await api('/api/views',{grid:'tasks',name:n,state});toast('Saved');reload()}catch(e){toast((e as Error).message,'error')}}},...(data?.views||[]).map(v=>({label:`Delete “${v.name}”`,icon:'Trash2',danger:true,onClick:async()=>{await api('/api/views',{action:'delete',id:v.id});reload()}}))]}/>;
}
