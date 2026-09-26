'use client';
import {useApi,dateOnly} from './lib';
import {useApp,Header,Grid,ErrorNote,Skeleton,Empty,Chip,Who,type Col} from './kit';
// Maintenance (first version of the screen): work orders and preventive plans.
// Plan/work-order forms and completion are available through /api/maintenance; their screens are still to come.
type WO={id:string,number:string,title:string,status:string,assignee_id:string|null,due_at:string|null,asset_code:string|null};
type Plan={id:string,title:string,interval_value:number,interval_unit:string,next_due:string,assignee_id:string|null,asset_code:string|null};
export default function Maintenance({parts}:{parts:string[]}){
 const {s}=useApp();const view=parts[0]||'orders';const {data,error}=useApi<{orders:WO[],plans:Plan[]}>('/api/maintenance');
 if(view==='plans')return <div className="page"><Header icon="CalendarClock" tone="indigo" title="Preventive plans"/><ErrorNote error={error}/>{!data?<Skeleton/>:<Grid id="mnt-plans" rows={data.plans} exportName="maintenance-plans" cols={[{key:'title',label:'Plan'},{key:'asset_code',label:'Asset'},{key:'interval',label:'Every',render:p=>`${p.interval_value} ${p.interval_unit}`},{key:'next_due',label:'Next due',render:p=>dateOnly(p.next_due)},{key:'assignee_id',label:'Technician',render:p=><Who id={p.assignee_id}/>}]} empty={<Empty icon="CalendarClock" title="No preventive plans"/>}/>}</div>;
 const rows=(data?.orders||[]).filter(w=>view!=='mine'||w.assignee_id===s.user.id);
 const cols:Col<WO>[]=[{key:'number',label:'Number',width:140},{key:'title',label:'Work order'},{key:'asset_code',label:'Asset'},{key:'status',label:'Status',render:w=><Chip>{w.status}</Chip>},{key:'due_at',label:'Due',render:w=><span className={w.due_at&&Date.parse(w.due_at)<Date.now()&&!['Completed','Cancelled'].includes(w.status)?'text-red':''}>{dateOnly(w.due_at)}</span>},{key:'assignee_id',label:'Technician',render:w=><Who id={w.assignee_id}/>}];
 return <div className="page"><Header icon="Wrench" tone="indigo" title={view==='mine'?'My work orders':'Work orders'}/><ErrorNote error={error}/>{!data?<Skeleton/>:<Grid id={'mnt-'+view} rows={rows} cols={cols} exportName="work-orders" empty={<Empty icon="Wrench" title="No work orders"/>}/>}</div>;
}
