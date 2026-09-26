import {canActOn,hasAction,departmentKey} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,oneOf,idOf,auditStatement,nextNumber,tenantOf,tenantSettings} from '../../server/core';
import {canSeeTicket,canWorkTicket,type TicketRow} from '../../server/entities';
import {notify} from '../../server/notify';
import type {Member} from '../../server/policy';
import {ticketStatuses,ticketPriorities,ticketTypes,slaHours} from '../../data';

async function load(u:Member,id:string){const t=await first<TicketRow>('SELECT * FROM tickets WHERE id=? AND tenant_id=?',id,u.tenantId);if(!t||!canSeeTicket(u,t))throw new HttpError(404,'Ticket not found.');return t}
const dueFrom=(start:string,priority:string)=>new Date(Date.parse(start)+(slaHours[priority]||72)*3600000).toISOString();
// Heads of the receiving team hear about new tickets that nobody has picked up yet.
async function teamLeads(u:Member,department:string){const d=await first<{head_id:string|null}>('SELECT head_id FROM departments WHERE tenant_id=? AND lower(name)=lower(?)',u.tenantId,department);if(d?.head_id)return [d.head_id];return (await all<{id:string,department:string}>("SELECT id,department FROM members WHERE tenant_id=? AND active=1 AND role='manager'",u.tenantId)).filter(m=>departmentKey(m.department)===departmentKey(department)).map(m=>m.id)}

export const GET=route(async(req,u)=>{
 const id=new URL(req.url).searchParams.get('id');
 if(id){
  const t=await load(u,idOf(id,'Ticket'));
  const [comments,history,asset]=await Promise.all([
   all("SELECT id,author_id AS authorId,body,internal,created_at AS createdAt FROM comments WHERE tenant_id=? AND entity_type='ticket' AND entity_id=? ORDER BY created_at",u.tenantId,t.id),
   all('SELECT id,action,actor,created_at AS createdAt FROM audit WHERE tenant_id=? AND record_id=? ORDER BY created_at DESC LIMIT 50',u.tenantId,t.id),
   t.asset_id?first('SELECT id,code,name,location FROM assets WHERE id=? AND tenant_id=?',t.asset_id,u.tenantId):null,
  ]);
  const work=canWorkTicket(u,t);
  // Internal notes are for the resolving team only.
  return {ticket:t,asset,history,comments:(comments as {internal:number}[]).filter(c=>work||!c.internal),canWork:work,canAssign:canActOn(u,'maintenance','assign',t.department,t.requester_id)};
 }
 const rows=await all<TicketRow>('SELECT * FROM tickets WHERE tenant_id=? ORDER BY created_at DESC LIMIT 5000',u.tenantId);
 return {tickets:rows.filter(t=>canSeeTicket(u,t)).map(({description,...t})=>({...t,excerpt:description.slice(0,160)})),canCreate:hasAction(u,'maintenance','create')};
});

export const POST=route(async(req,u)=>{
 const b=await readBody(req);const action=String(b.action||'');
 if(action==='create'){
  if(!hasAction(u,'maintenance','create'))throw new HttpError(403,'Raising tickets is not available to your account.');
  const title=str(b.title,'Summary',200),description=str(b.description,'Description',8000,false),priority=oneOf(b.priority||'Medium',ticketPriorities,'priority'),type=oneOf(b.type||'Incident',ticketTypes,'ticket type');
  const department=str(b.department,'Team',160);
  const assetId=b.assetId?idOf(b.assetId,'Asset'):null;if(assetId&&!await first('SELECT id FROM assets WHERE id=? AND tenant_id=?',assetId,u.tenantId))throw new HttpError(400,'Asset not found.');
  const t=await tenantOf(u);const number=await nextNumber(u.tenantId,String(tenantSettings(t).ticketPrefix||'TKT'));
  const id=uid(),ts=now();
  await batch([stmt('INSERT INTO tickets(id,tenant_id,number,title,description,type,category,priority,status,department,requester_id,asset_id,location,due_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,number,title,description,type,str(b.category,'Category',80,false),priority,'New',department,u.id,assetId,str(b.location,'Location',200,false)||u.location||'',dueFrom(ts,priority),ts,ts),auditStatement(u,'Ticket raised',id,department,null,{number,title,priority})]);
  await notify(u,await teamLeads(u,department),{kind:'ticket',title:`New ${priority.toLowerCase()} ticket ${number}`,body:`${title}\nRaised by ${u.name} for ${department}`,link:`#/tickets/${id}`},req);
  return {id,number};
 }
 const t=await load(u,idOf(b.id,'Ticket'));const link=`#/tickets/${t.id}`;
 if(action==='status'){
  const next=oneOf(b.status,ticketStatuses,'status');if(next===t.status)return {ok:true};
  const requesterMove=t.requester_id===u.id&&((['Resolved'].includes(t.status)&&['Closed','Open'].includes(next))||next==='Closed');
  if(!canWorkTicket(u,t)&&!requesterMove)throw new HttpError(403,'Only the assigned team can move this ticket.');
  const ts=now();
  const res=await batch([stmt('UPDATE tickets SET status=?,resolved_at=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=? AND version=?',next,['Resolved','Closed'].includes(next)?(t.resolved_at||ts):null,ts,t.id,u.tenantId,Number(b.version??t.version)),auditStatement(u,`Status: ${t.status} → ${next}`,t.id,t.department,{status:t.status},{status:next})]);
  if(!res[0].meta.changes)throw new HttpError(409,'This ticket changed. Refresh to see the latest.');
  await notify(u,[t.requester_id,t.assignee_id],{kind:'ticket',title:`${t.number} is now ${next}`,body:t.title,link},req);
  return {ok:true};
 }
 if(action==='assign'){
  const to=b.assigneeId?idOf(b.assigneeId,'Assignee'):null;
  const self=to===u.id&&canWorkTicket(u,{...t,assignee_id:null});
  if(!self&&!canActOn(u,'maintenance','assign',t.department,t.requester_id))throw new HttpError(403,'Assigning tickets is not part of your role.');
  const person=to?await first<{name:string}>('SELECT name FROM members WHERE id=? AND tenant_id=? AND active=1',to,u.tenantId):null;if(to&&!person)throw new HttpError(400,'Choose an active person.');
  await batch([stmt("UPDATE tickets SET assignee_id=?,status=CASE WHEN status='New' AND ? IS NOT NULL THEN 'Open' ELSE status END,updated_at=?,version=version+1 WHERE id=? AND tenant_id=?",to,to,now(),t.id,u.tenantId),auditStatement(u,to?`Assigned to ${person!.name}`:'Unassigned',t.id,t.department,{assignee:t.assignee_id},{assignee:to})]);
  if(to)await notify(u,[to],{kind:'ticket',title:`${t.number} is assigned to you`,body:`${t.title}\nPriority: ${t.priority}`,link},req);
  return {ok:true};
 }
 if(action==='update'){
  if(!canWorkTicket(u,t)&&t.requester_id!==u.id)throw new HttpError(403,'You cannot edit this ticket.');
  const priority=oneOf(b.priority||t.priority,ticketPriorities,'priority');
  const department=b.department===undefined?t.department:str(b.department,'Team',160);
  const values={title:str(b.title??t.title,'Summary',200),description:str(b.description??t.description,'Description',8000,false),type:oneOf(b.type||t.type,ticketTypes,'ticket type'),category:str(b.category??t.category,'Category',80,false),priority,department,location:str(b.location??t.location,'Location',200,false)};
  const due=priority!==t.priority?dueFrom(t.created_at,priority):t.due_at;
  await batch([stmt('UPDATE tickets SET title=?,description=?,type=?,category=?,priority=?,department=?,location=?,due_at=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=?',values.title,values.description,values.type,values.category,values.priority,values.department,values.location,due,now(),t.id,u.tenantId),auditStatement(u,'Ticket updated',t.id,department,t,values)]);
  return {ok:true};
 }
 throw new HttpError(400,'Unknown action.');
});
