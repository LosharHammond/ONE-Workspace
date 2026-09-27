'use client';
import {useState} from 'react';
import {api,useApi,go,dateOnly,money,until} from './lib';
import {ConnectedContext} from './context';
import {CustomFields} from './studio-runtime';
import {useApp,Btn,Chip,Header,Grid,Inspector,Modal,Field,DeptSelect,PersonSelect,Who,Timeline,ErrorNote,Skeleton,Empty,KV,Note,Stat,Attachments,Markdown,type Col} from './kit';

type WO={id:string,number:string,plan_id:string|null,asset_id:string|null,title:string,status:string,priority:string,assignee_id:string|null,department:string,due_at:string|null,completed_at:string|null,parts_cost:number,labor_cost:number,asset_code:string|null,asset_name:string|null};
type Plan={id:string,asset_id:string|null,title:string,description:string,interval_value:number,interval_unit:string,next_due:string,assignee_id:string|null,department:string,checklist:string,estimated_cost:number,active:number,asset_code:string|null,asset_name:string|null};
const open=(w:WO)=>!['Completed','Cancelled'].includes(w.status);
const overdue=(w:WO)=>open(w)&&!!w.due_at&&Date.parse(w.due_at)<Date.now();

export default function Maintenance({parts}:{parts:string[]}){
 const {s}=useApp();const view=['orders','mine','plans'].includes(parts[0])?parts[0]:'orders';const openId=parts[1];
 const {data,error,reload}=useApi<{orders:WO[],plans:Plan[],canCreate:boolean}>('/api/maintenance');
 const [status,setStatus]=useState('open');
 if(view==='plans')return <Plans data={data} error={error} reload={reload} openId={openId}/>;
 const rows=(data?.orders||[]).filter(w=>(view!=='mine'||w.assignee_id===s.user.id)&&(status==='all'||(status==='open'?open(w):!open(w))));
 const cols:Col<WO>[]=[
  {key:'number',label:'Number',width:140,render:w=><span className="mono">{w.number}</span>},
  {key:'title',label:'Work order',render:w=><div className="cell-title"><b>{w.title}</b><small>{w.plan_id?'Preventive':'Corrective'}{w.asset_code?` · ${w.asset_code} ${w.asset_name}`:''}</small></div>},
  {key:'status',label:'Status',width:120,render:w=><Chip>{w.status}</Chip>},
  {key:'priority',label:'Priority',width:100,render:w=><Chip>{w.priority}</Chip>},
  {key:'due_at',label:'Due',width:130,render:w=>open(w)?<span className={overdue(w)?'text-red':'muted'}>{until(w.due_at)||'—'}</span>:<span className="muted">{dateOnly(w.completed_at)}</span>,value:w=>w.due_at||''},
  {key:'assignee',label:'Technician',width:170,render:w=><Who id={w.assignee_id}/>},
  {key:'department',label:'Team',width:130,hide:true},
  {key:'cost',label:'Cost',width:110,align:'right',render:w=>w.parts_cost+w.labor_cost?money(w.parts_cost+w.labor_cost,s.tenant.currency,0):'—',value:w=>w.parts_cost+w.labor_cost},
 ];
 const all=data?.orders||[];
 return <div className="page">
  <Header icon="Wrench" tone="indigo" title={view==='mine'?'My work orders':'Work orders'} subtitle="Preventive work is generated automatically a week before it falls due; corrective work can be raised here or from a ticket." actions={data?.canCreate&&<Btn variant="primary" icon="Plus" onClick={()=>go(`maintenance/${view}/new`)}>New work order</Btn>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {data&&<div className="stats compact"><Stat label="Open" value={all.filter(open).length}/><Stat label="Overdue" value={all.filter(overdue).length}/><Stat label="Completed this month" value={all.filter(w=>w.completed_at?.startsWith(new Date().toISOString().slice(0,7))).length}/></div>}
  {!data?<Skeleton/>:<Grid id={'wo-'+view} rows={rows} cols={cols} activeId={openId} onOpen={w=>go(`maintenance/${view}/${w.id}`)} exportName="work-orders" initialSort={['due_at','asc']} toolbar={<select className="grid-select" value={status} onChange={e=>setStatus(e.target.value)} aria-label="Status"><option value="open">Open</option><option value="done">Completed / cancelled</option><option value="all">All</option></select>} empty={<Empty icon="Wrench" title="No work orders"/>}/>}
  {openId==='new'&&<OrderForm onClose={()=>go(`maintenance/${view}`)} onSaved={id=>{reload();go(`maintenance/${view}/${id}`)}}/>}
  {openId&&openId!=='new'&&<OrderPanel id={openId} onClose={()=>go(`maintenance/${view}`)} onChanged={reload}/>}
 </div>;
}

function Plans({data,error,reload,openId}:{data:{plans:Plan[],canCreate:boolean}|null,error:string,reload:()=>void,openId?:string}){
 const plan=data?.plans.find(p=>p.id===openId);
 const cols:Col<Plan>[]=[{key:'title',label:'Plan',render:p=><div className="cell-title"><b>{p.title}</b><small>{p.asset_code?`${p.asset_code} ${p.asset_name}`:'No asset'}</small></div>},{key:'every',label:'Every',width:130,render:p=>`${p.interval_value} ${p.interval_unit}`},{key:'next_due',label:'Next due',width:130,render:p=><span className={Date.parse(p.next_due)<Date.now()?'text-red':''}>{dateOnly(p.next_due)}</span>},{key:'assignee',label:'Technician',width:170,render:p=><Who id={p.assignee_id}/>},{key:'department',label:'Team',width:130},{key:'active',label:'Status',width:100,render:p=><Chip tone={p.active?'green':'gray'}>{p.active?'Active':'Paused'}</Chip>}];
 return <div className="page"><Header icon="CalendarClock" tone="indigo" title="Preventive plans" subtitle="Recurring maintenance schedules. A work order is created automatically when a plan is within a week of its due date; completing it schedules the next one." actions={data?.canCreate&&<Btn variant="primary" icon="Plus" onClick={()=>go('maintenance/plans/new')}>New plan</Btn>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:<Grid id="mnt-plans" rows={data.plans} cols={cols} onOpen={p=>go(`maintenance/plans/${p.id}`)} exportName="maintenance-plans" empty={<Empty icon="CalendarClock" title="No preventive plans yet"/>}/>}
  {(openId==='new'||plan)&&<PlanForm plan={plan} onClose={()=>go('maintenance/plans')} onSaved={()=>{reload();go('maintenance/plans')}}/>}
 </div>;
}
function AssetPick({value,onChange}:{value:string,onChange:(v:string)=>void}){const {data}=useApi<{assets:{id:string,code:string,name:string}[]}>('/api/assets');return <select value={value} onChange={e=>onChange(e.target.value)}><option value="">No asset</option>{(data?.assets||[]).slice(0,2000).map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>}
function PlanForm({plan,onClose,onSaved}:{plan?:Plan,onClose:()=>void,onSaved:()=>void}){
 const {s,toast}=useApp();const [busy,setBusy]=useState(false);
 const [v,setV]=useState({title:plan?.title||'',assetId:plan?.asset_id||'',intervalValue:String(plan?.interval_value||3),intervalUnit:plan?.interval_unit||'months',nextDue:plan?.next_due||new Date().toISOString().slice(0,10),assigneeId:plan?.assignee_id||null as string|null,department:plan?.department||s.user.department,description:plan?.description||'',checklist:plan?.checklist||'',estimatedCost:String(plan?.estimated_cost||''),active:plan?!!plan.active:true});
 return <Modal open wide onClose={onClose} title={plan?'Edit plan':'New preventive plan'} footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!v.title} onClick={async()=>{setBusy(true);try{await api('/api/maintenance',{action:'plan',id:plan?.id,...v,assetId:v.assetId||null});toast('Plan saved');onSaved()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}>Save plan</Btn></>}>
  <div className="form-grid"><Field label="Title" wide><input autoFocus value={v.title} onChange={e=>setV({...v,title:e.target.value})} placeholder="e.g. Generator service"/></Field><Field label="Asset"><AssetPick value={v.assetId} onChange={x=>setV({...v,assetId:x})}/></Field><Field label="Team"><DeptSelect value={v.department} onChange={x=>setV({...v,department:x})}/></Field><Field label="Every"><div className="row-gap"><input type="number" min={1} style={{width:90}} value={v.intervalValue} onChange={e=>setV({...v,intervalValue:e.target.value})}/><select value={v.intervalUnit} onChange={e=>setV({...v,intervalUnit:e.target.value})}>{['days','weeks','months','years'].map(u=><option key={u}>{u}</option>)}</select></div></Field><Field label="Next due"><input type="date" value={v.nextDue} onChange={e=>setV({...v,nextDue:e.target.value})}/></Field><Field label="Technician" wide><PersonSelect value={v.assigneeId} onChange={x=>setV({...v,assigneeId:x})}/></Field><Field label={`Estimated cost (${s.tenant.currency})`}><input type="number" min="0" value={v.estimatedCost} onChange={e=>setV({...v,estimatedCost:e.target.value})}/></Field>{plan&&<Field label="Status"><select value={v.active?'1':'0'} onChange={e=>setV({...v,active:e.target.value==='1'})}><option value="1">Active</option><option value="0">Paused</option></select></Field>}<Field label="Instructions" wide><textarea rows={3} value={v.description} onChange={e=>setV({...v,description:e.target.value})}/></Field><Field label="Checklist" wide hint="One step per line; copied into each work order."><textarea rows={4} value={v.checklist} onChange={e=>setV({...v,checklist:e.target.value})} placeholder={'- [ ] Check oil level\n- [ ] Replace filter'}/></Field></div>
 </Modal>;
}
function OrderForm({onClose,onSaved}:{onClose:()=>void,onSaved:(id:string)=>void}){
 const {s,toast}=useApp();const [busy,setBusy]=useState(false);const [v,setV]=useState({title:'',assetId:'',priority:'Medium',department:s.user.department,assigneeId:null as string|null,dueAt:'',description:''});
 return <Modal open wide onClose={onClose} title="New work order" footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!v.title} onClick={async()=>{setBusy(true);try{const r=await api<{id:string,number:string}>('/api/maintenance',{action:'order',...v,assetId:v.assetId||null});toast(`${r.number} created`);onSaved(r.id)}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}>Create</Btn></>}>
  <div className="form-grid"><Field label="Title" wide><input autoFocus value={v.title} onChange={e=>setV({...v,title:e.target.value})}/></Field><Field label="Asset"><AssetPick value={v.assetId} onChange={x=>setV({...v,assetId:x})}/></Field><Field label="Priority"><select value={v.priority} onChange={e=>setV({...v,priority:e.target.value})}>{['Low','Medium','High','Urgent'].map(x=><option key={x}>{x}</option>)}</select></Field><Field label="Team"><DeptSelect value={v.department} onChange={x=>setV({...v,department:x})}/></Field><Field label="Due"><input type="date" value={v.dueAt} onChange={e=>setV({...v,dueAt:e.target.value})}/></Field><Field label="Technician" wide><PersonSelect value={v.assigneeId} onChange={x=>setV({...v,assigneeId:x})}/></Field><Field label="Description" wide><textarea rows={4} value={v.description} onChange={e=>setV({...v,description:e.target.value})}/></Field></div>
 </Modal>;
}
function OrderPanel({id,onClose,onChanged}:{id:string,onClose:()=>void,onChanged:()=>void}){
 const {s,toast}=useApp();const {data,error,reload}=useApi<any>('/api/maintenance?id='+encodeURIComponent(id));const [complete,setComplete]=useState(false);
 const w=data?.order;
 async function act(body:Record<string,unknown>,msg:string){try{await api('/api/maintenance',{id,...body});toast(msg);reload();onChanged()}catch(e){toast((e as Error).message,'error')}}
 return <Inspector open onClose={onClose} width={620} eyebrow={w?.number} title={w?.title||'Loading…'} subtitle={w&&<><Chip>{w.status}</Chip><Chip>{w.priority}</Chip>{w.due_at&&<span className={overdue(w)?'text-red small':'muted small'}>{open(w)?until(w.due_at):`completed ${dateOnly(w.completed_at)}`}</span>}</>}>
  <ErrorNote error={error} onRetry={reload}/>
  {!w?<Skeleton/>:<>
   {open(w)&&<div className="action-strip">
    {data.canWork&&<label className="inline-field"><span>Status</span><select value={w.status} onChange={e=>act({action:'status',status:e.target.value},`Marked ${e.target.value.toLowerCase()}`)}>{['Open','In progress','On hold','Cancelled'].map(x=><option key={x}>{x}</option>)}</select></label>}
    {data.canAssign?<label className="inline-field grow"><span>Technician</span><PersonSelect value={w.assignee_id} onChange={v=>act({action:'assign',assigneeId:v},'Assigned')}/></label>:<div className="inline-field grow"><span>Technician</span><Who id={w.assignee_id}/></div>}
    {data.canWork&&<Btn variant="primary" icon="CircleCheck" onClick={()=>setComplete(true)}>Complete</Btn>}
   </div>}
   <KV items={[['Asset',data.asset&&<a key="a" href={`#/assets/all/${data.asset.id}`}>{data.asset.code} · {data.asset.name}</a>],['Team',w.department],['Type',w.plan_id?'Preventive (from schedule)':'Corrective'],['Due',w.due_at&&dateOnly(w.due_at)],['Parts cost',w.parts_cost?money(w.parts_cost,s.tenant.currency):''],['Labour cost',w.labor_cost?money(w.labor_cost,s.tenant.currency):''],['Completed by',w.completed_by&&<Who key="c" id={w.completed_by}/>]]}/>
   {w.description&&<div className="prose-box"><Markdown text={w.description}/></div>}
   {w.status==='Completed'&&<><h4 className="section-title">Completion</h4><div className="prose-box"><p>{w.completion_notes}</p></div>{w.parts?.length>0&&<div className="mini-list">{w.parts.map((p:{sku:string,name:string,qty:number,location:string,cost:number},i:number)=><div key={i} className="mini-row"><span className="mono">{p.sku}</span><span>{p.name}<small>{p.qty} from {p.location}</small></span><b>{money(p.cost,s.tenant.currency)}</b></div>)}</div>}{data.evidence&&<p className="small">Evidence: <a href={`/api/files?download=${data.evidence.id}`}>{data.evidence.name}</a></p>}</>}
   <h4 className="section-title">Photos & evidence</h4>
   <Attachments type="work_order" id={id} files={data.files} onChange={reload} canUpload={data.canWork}/>
   <h4 className="section-title">History</h4><Timeline events={data.history}/>
   <CustomFields type="work_order" id={id}/><ConnectedContext type="work_order" id={id} compact/>
  </>}
  {complete&&w&&<CompleteDialog order={w} onClose={()=>setComplete(false)} onDone={()=>{setComplete(false);reload();onChanged()}}/>}
 </Inspector>;
}
function CompleteDialog({order,onClose,onDone}:{order:WO,onClose:()=>void,onDone:()=>void}){
 const {s,toast}=useApp();const {data:inv}=useApi<{items:{id:string,sku:string,name:string,unit:string,on_hand:number}[]}>('/api/inventory');
 const [notes,setNotes]=useState(''),[labor,setLabor]=useState(''),[parts,setParts]=useState<{itemId:string,qty:string,location:string}[]>([]),[busy,setBusy]=useState(false);
 return <Modal open wide onClose={onClose} title={`Complete ${order.number}`} subtitle="Parts are issued from stock and costed at their unit cost." footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!notes.trim()} onClick={async()=>{setBusy(true);try{await api('/api/maintenance',{action:'complete',id:order.id,completionNotes:notes,laborCost:labor||0,parts:parts.filter(p=>p.itemId&&p.qty)});toast('Work order completed');onDone()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}>Complete work order</Btn></>}>
  <Field label="What was done" hint="Required. Attach photos as evidence on the work order."><textarea autoFocus rows={4} value={notes} onChange={e=>setNotes(e.target.value)}/></Field>
  <Field label={`Labour cost (${s.tenant.currency})`}><input type="number" min="0" step="0.01" value={labor} onChange={e=>setLabor(e.target.value)}/></Field>
  <h4 className="section-title">Parts used</h4>
  {parts.map((p,i)=><div key={i} className="step-row"><select value={p.itemId} onChange={e=>setParts(parts.map((x,j)=>j===i?{...x,itemId:e.target.value}:x))}><option value="">Choose a stock item…</option>{(inv?.items||[]).map(it=><option key={it.id} value={it.id}>{it.sku} · {it.name} ({it.on_hand} {it.unit})</option>)}</select><input type="number" min="0" step="any" placeholder="Qty" style={{width:90}} value={p.qty} onChange={e=>setParts(parts.map((x,j)=>j===i?{...x,qty:e.target.value}:x))}/><input placeholder="From store" value={p.location} onChange={e=>setParts(parts.map((x,j)=>j===i?{...x,location:e.target.value}:x))}/><Btn size="sm" variant="ghost" icon="Trash2" title="Remove" onClick={()=>setParts(parts.filter((_,j)=>j!==i))}/></div>)}
  <Btn size="sm" icon="Plus" onClick={()=>setParts([...parts,{itemId:'',qty:'1',location:''}])}>Add part</Btn>
  {!inv?.items?.length&&<Note>No inventory items available to you; parts can't be issued from stock.</Note>}
 </Modal>;
}
