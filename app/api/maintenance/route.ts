import {hasAction,canActOn} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,num,oneOf,idOf,date,auditStatement,nextNumber,tenantOf,tenantSettings} from '../../server/core';
import {notify} from '../../server/notify';
import {moveStatements,reorderAlert} from '../../server/stock';
import type {Member} from '../../server/policy';

// Preventive maintenance plans and work orders. Plans that fall due (within the lead time)
// generate a work order automatically; completing it moves the plan to its next date.
type Plan={id:string,asset_id:string|null,title:string,description:string,interval_value:number,interval_unit:string,next_due:string,assignee_id:string|null,department:string,checklist:string,estimated_cost:number,active:number};
type WO={id:string,number:string,plan_id:string|null,asset_id:string|null,title:string,status:string,assignee_id:string|null,department:string,due_at:string|null,created_by:string,parts_json:string};
const units=['days','weeks','months','years'] as const;
const LEAD_DAYS=7;
function addInterval(d:string,v:number,unit:string){const x=new Date(d+'T00:00:00Z');if(unit==='days')x.setUTCDate(x.getUTCDate()+v);else if(unit==='weeks')x.setUTCDate(x.getUTCDate()+7*v);else if(unit==='months')x.setUTCMonth(x.getUTCMonth()+v);else x.setUTCFullYear(x.getUTCFullYear()+v);return x.toISOString().slice(0,10)}
const canSee=(u:Member,w:{department:string,assignee_id:string|null,created_by:string})=>w.assignee_id===u.id||canActOn(u,'schedules','view',w.department||u.department,w.created_by);

async function woNumber(u:Member){const t=await tenantOf(u);return nextNumber(u.tenantId,String(tenantSettings(t).woPrefix||'WO'))}
// Creates work orders for plans that are due soon and have no open work order yet.
async function generateDue(u:Member,req:Request){
 const horizon=new Date(Date.now()+LEAD_DAYS*86400000).toISOString().slice(0,10);
 const due=await all<Plan>("SELECT p.* FROM maintenance_plans p WHERE p.tenant_id=? AND p.active=1 AND p.next_due<=? AND NOT EXISTS(SELECT 1 FROM work_orders w WHERE w.tenant_id=p.tenant_id AND w.plan_id=p.id AND w.status IN ('Open','In progress','On hold')) LIMIT 50",u.tenantId,horizon);
 for(const p of due){
  const id=uid(),number=await woNumber(u);
  await batch([stmt('INSERT INTO work_orders(id,tenant_id,number,plan_id,asset_id,title,description,status,priority,assignee_id,department,due_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,number,p.id,p.asset_id,p.title,[p.description,p.checklist?`Checklist:\n${p.checklist}`:''].filter(Boolean).join('\n\n'),'Open','Medium',p.assignee_id,p.department,p.next_due+'T17:00:00.000Z','system',now(),now()),auditStatement(u,`Work order ${number} generated from schedule`,id,p.department,null,{plan:p.title,due:p.next_due})]);
  await notify({id:'system',tenantId:u.tenantId},[p.assignee_id],{kind:'maintenance',title:`Maintenance due: ${p.title}`,body:`${number} is due ${p.next_due}.`,link:`#/maintenance/orders/${id}`},req);
 }
}

export const GET=route(async(req,u)=>{
 if(!hasAction(u,'schedules'))throw new HttpError(403,'Schedules & maintenance are not available to your account.');
 await generateDue(u,req);
 const url=new URL(req.url),id=url.searchParams.get('id');
 if(id){
  const w=await first<WO&Record<string,unknown>>('SELECT * FROM work_orders WHERE id=? AND tenant_id=?',idOf(id,'Work order'),u.tenantId);if(!w||!canSee(u,w))throw new HttpError(404,'Work order not found.');
  const [asset,history,evidence]=await Promise.all([w.asset_id?first('SELECT id,code,name,location FROM assets WHERE id=? AND tenant_id=?',w.asset_id,u.tenantId):null,all('SELECT id,action,actor,created_at AS createdAt FROM audit WHERE tenant_id=? AND record_id=? ORDER BY created_at DESC',u.tenantId,w.id),w.evidence_file_id?first('SELECT id,name FROM files WHERE id=? AND tenant_id=?',w.evidence_file_id,u.tenantId):null]);
  return {order:{...w,parts:JSON.parse(w.parts_json||'[]')},asset,history,evidence,canWork:w.assignee_id===u.id||canActOn(u,'schedules','update',w.department||u.department,w.created_by),canAssign:hasAction(u,'schedules','assign')};
 }
 const [plans,orders]=await Promise.all([
  all<Plan&{asset_code:string|null,asset_name:string|null,created_by:string}>('SELECT p.*,a.code AS asset_code,a.name AS asset_name FROM maintenance_plans p LEFT JOIN assets a ON a.id=p.asset_id AND a.tenant_id=p.tenant_id WHERE p.tenant_id=? ORDER BY p.next_due',u.tenantId),
  all<WO&{asset_code:string|null,asset_name:string|null}>('SELECT w.id,w.number,w.plan_id,w.asset_id,w.title,w.status,w.priority,w.assignee_id,w.department,w.due_at,w.completed_at,w.parts_cost,w.labor_cost,w.created_by,w.created_at,a.code AS asset_code,a.name AS asset_name FROM work_orders w LEFT JOIN assets a ON a.id=w.asset_id AND a.tenant_id=w.tenant_id WHERE w.tenant_id=? ORDER BY w.due_at LIMIT 3000',u.tenantId),
 ]);
 return {plans:plans.filter(p=>canSee(u,{department:p.department,assignee_id:p.assignee_id,created_by:p.created_by})),orders:orders.filter(w=>canSee(u,w)),canCreate:hasAction(u,'schedules','create')};
},{module:'maintenance'});

export const POST=route(async(req,u)=>{
 const b=await readBody(req);const action=String(b.action||'');
 const person=async(v:unknown)=>{if(!v)return null;const id=idOf(v,'Person');if(!await first('SELECT id FROM members WHERE id=? AND tenant_id=? AND active=1',id,u.tenantId))throw new HttpError(400,'Choose an active person.');return id};
 const asset=async(v:unknown)=>{if(!v)return null;const id=idOf(v,'Asset');if(!await first('SELECT id FROM assets WHERE id=? AND tenant_id=?',id,u.tenantId))throw new HttpError(400,'Asset not found.');return id};
 if(action==='plan'){
  const department=str(b.department,'Department',160,false)||u.department;
  if(!canActOn(u,'schedules',b.id?'update':'create',department,u.id))throw new HttpError(403,'Managing maintenance plans is not part of your role.');
  const v={asset_id:await asset(b.assetId),title:str(b.title,'Title',160),description:str(b.description,'Description',4000,false),interval_value:Math.round(num(b.intervalValue,'Interval',1,1000)),interval_unit:oneOf(b.intervalUnit,units,'interval unit'),next_due:date(b.nextDue,'First due date',true)!,assignee_id:await person(b.assigneeId),department,checklist:str(b.checklist,'Checklist',4000,false),estimated_cost:b.estimatedCost?num(b.estimatedCost,'Estimated cost',0,1e11):0,active:b.active===false?0:1};
  if(b.id){const id=idOf(b.id,'Plan');const r=await batch([stmt('UPDATE maintenance_plans SET asset_id=?,title=?,description=?,interval_value=?,interval_unit=?,next_due=?,assignee_id=?,department=?,checklist=?,estimated_cost=?,active=? WHERE id=? AND tenant_id=?',v.asset_id,v.title,v.description,v.interval_value,v.interval_unit,v.next_due,v.assignee_id,v.department,v.checklist,v.estimated_cost,v.active,id,u.tenantId),auditStatement(u,'Maintenance plan updated',id,department,null,v)]);if(!r[0].meta.changes)throw new HttpError(404,'Plan not found.');return {id}}
  const id=uid();await batch([stmt('INSERT INTO maintenance_plans(id,tenant_id,asset_id,title,description,interval_value,interval_unit,next_due,assignee_id,department,checklist,estimated_cost,active,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,v.asset_id,v.title,v.description,v.interval_value,v.interval_unit,v.next_due,v.assignee_id,v.department,v.checklist,v.estimated_cost,v.active,u.id,now()),auditStatement(u,'Maintenance plan created',id,department,null,v)]);return {id};
 }
 if(action==='order'){
  const department=str(b.department,'Department',160,false)||u.department;
  if(!canActOn(u,'schedules','create',department,u.id))throw new HttpError(403,'Creating work orders is not part of your role.');
  const id=uid(),number=await woNumber(u),assignee=await person(b.assigneeId);
  await batch([stmt('INSERT INTO work_orders(id,tenant_id,number,asset_id,ticket_id,title,description,status,priority,assignee_id,department,due_at,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,number,await asset(b.assetId),b.ticketId?idOf(b.ticketId,'Ticket'):null,str(b.title,'Title',160),str(b.description,'Description',4000,false),'Open',oneOf(b.priority||'Medium',['Low','Medium','High','Urgent'] as const,'priority'),assignee,department,b.dueAt?date(b.dueAt,'Due date')+'T17:00:00.000Z':null,u.id,now(),now()),auditStatement(u,`Work order ${number} created`,id,department,null,{title:b.title})]);
  await notify(u,[assignee],{kind:'maintenance',title:`Work order ${number} assigned to you`,body:String(b.title||''),link:`#/maintenance/orders/${id}`},req);
  return {id,number};
 }
 const w=await first<WO&{parts_cost:number,labor_cost:number}>('SELECT * FROM work_orders WHERE id=? AND tenant_id=?',idOf(b.id,'Work order'),u.tenantId);if(!w||!canSee(u,w))throw new HttpError(404,'Work order not found.');
 const canWork=w.assignee_id===u.id||canActOn(u,'schedules','update',w.department||u.department,w.created_by);
 if(action==='assign'){
  if(!hasAction(u,'schedules','assign')&&!(canWork&&b.assigneeId===u.id))throw new HttpError(403,'Assigning work orders is not part of your role.');
  const to=await person(b.assigneeId);await batch([stmt('UPDATE work_orders SET assignee_id=?,updated_at=? WHERE id=? AND tenant_id=?',to,now(),w.id,u.tenantId),auditStatement(u,'Work order assigned',w.id,w.department,{assignee:w.assignee_id},{assignee:to})]);
  await notify(u,[to],{kind:'maintenance',title:`Work order ${w.number} assigned to you`,body:w.title,link:`#/maintenance/orders/${w.id}`},req);return {ok:true};
 }
 if(!canWork)throw new HttpError(403,'Only the assigned technician or the maintenance team can update this work order.');
 if(action==='status'){const status=oneOf(b.status,['Open','In progress','On hold','Cancelled'] as const,'status');await batch([stmt('UPDATE work_orders SET status=?,updated_at=? WHERE id=? AND tenant_id=?',status,now(),w.id,u.tenantId),auditStatement(u,`Work order ${status.toLowerCase()}`,w.id,w.department,{status:w.status},{status})]);return {ok:true}}
 // Parts are issued from inventory at completion; costs, notes and evidence are recorded.
 if(action==='complete'){
  if(['Completed','Cancelled'].includes(w.status))throw new HttpError(409,`This work order is already ${w.status.toLowerCase()}.`);
  const parts=Array.isArray(b.parts)?(b.parts as Record<string,unknown>[]).slice(0,30):[];
  const s:D1PreparedStatement[]=[];let partsCost=0;const used:{itemId:string,sku:string,name:string,qty:number,location:string,cost:number}[]=[];
  for(const p of parts){const item=await first<{id:string,sku:string,name:string,unit_cost:number}>('SELECT id,sku,name,unit_cost FROM inventory_items WHERE id=? AND tenant_id=?',idOf(p.itemId,'Part'),u.tenantId);if(!item)throw new HttpError(400,'Part not found.');const qty=num(p.qty,'Part quantity',0.0001,1e6);const location=str(p.location,'Part location',200);s.push(...await moveStatements(u,{itemId:item.id,type:'issue',qty,from:location,reference:w.number,note:'Used on work order'}));const cost=qty*item.unit_cost;partsCost+=cost;used.push({itemId:item.id,sku:item.sku,name:item.name,qty,location,cost})}
  const evidence=b.evidenceFileId?idOf(b.evidenceFileId,'Evidence'):null;if(evidence&&!await first('SELECT id FROM files WHERE id=? AND tenant_id=?',evidence,u.tenantId))throw new HttpError(400,'Evidence file not found.');
  const notes=str(b.completionNotes,'Completion notes',4000);const labor=b.laborCost?num(b.laborCost,'Labour cost',0,1e11):0;
  s.push(stmt("UPDATE work_orders SET status='Completed',completion_notes=?,parts_json=?,parts_cost=?,labor_cost=?,evidence_file_id=?,completed_at=?,completed_by=?,updated_at=? WHERE id=? AND tenant_id=?",notes,JSON.stringify(used),partsCost,labor,evidence,now(),u.id,now(),w.id,u.tenantId));
  if(w.plan_id){const p=await first<Plan>('SELECT * FROM maintenance_plans WHERE id=? AND tenant_id=?',w.plan_id,u.tenantId);if(p){let next=addInterval(p.next_due,p.interval_value,p.interval_unit);const today=new Date().toISOString().slice(0,10);while(next<=today)next=addInterval(next,p.interval_value,p.interval_unit);s.push(stmt('UPDATE maintenance_plans SET next_due=? WHERE id=? AND tenant_id=?',next,p.id,u.tenantId))}}
  s.push(auditStatement(u,`Work order ${w.number} completed`,w.id,w.department,{status:w.status},{notes,partsCost,labor}));
  if(w.asset_id)s.push(auditStatement(u,`Maintenance completed · ${w.number}`,w.asset_id,w.department,null,{title:w.title}));
  await batch(s);
  for(const p of used)await reorderAlert(u,p.itemId,req);
  return {ok:true};
 }
 throw new HttpError(400,'Unknown action.');
},{module:'maintenance'});
