import {hasAction,canActOn} from '../../access-policy';
import {route,all} from '../../server/core';
import {myApprovals} from '../../server/studio';
import {pendingAgentApprovals} from '../../server/agents';
import {pendingActions} from '../../server/fabric';
import type {Member} from '../../server/policy';

// Universal Work Inbox: everything waiting for the signed-in person across modules, each item checked
// against the same rules the owning module uses. Actions are taken through the owning module's API.
type Item={id:string,source:string,kind:string,title:string,detail:string,link:string,since:string,due?:string|null,risk?:string,actionable?:string};
async function safe<T>(f:()=>Promise<T>,fallback:T){try{return await f()}catch{return fallback}}
export const GET=route(async(_req,u)=>{
 const items:Item[]=[];
 const push=(x:Item)=>items.push(x);
 if(hasAction(u,'requests')||hasAction(u,'procurement'))for(const d of await all<{id:string,kind:string,number:string,title:string,total:number,step:string,since:string}>("SELECT d.id,d.kind,d.number,d.title,d.total,a.step_name AS step,a.created_at AS since FROM approvals a JOIN purchase_docs d ON d.id=a.doc_id AND d.tenant_id=a.tenant_id WHERE a.tenant_id=? AND a.status='Pending' AND d.requester_id!=? AND EXISTS(SELECT 1 FROM json_each(a.approver_ids) j WHERE j.value=?) ORDER BY a.created_at LIMIT 100",u.tenantId,u.id,u.id))push({id:`pur:${d.id}`,source:'Purchasing',kind:'approval',title:`${d.number} · ${d.title}`,detail:`${d.step} · ${d.total.toLocaleString()}`,link:`#/purchasing/${d.kind.toLowerCase()}/${d.id}`,since:d.since});
 if(hasAction(u,'projects'))for(const p of await all<{id:string,code:string,name:string,approval_status:string,department:string,created_by:string,updated_at:string,sponsor_id:string|null}>("SELECT id,code,name,approval_status,department,created_by,updated_at,sponsor_id FROM projects WHERE tenant_id=? AND approval_status LIKE 'pending:%' LIMIT 50",u.tenantId))if(u.role==='admin'||p.sponsor_id===u.id||(hasAction(u,'projects','approve')&&canActOn(u,'projects','approve',p.department,p.created_by)))push({id:`prj:${p.id}`,source:'Projects',kind:'approval',title:`${p.code} · ${p.name}`,detail:`Stage change to ${p.approval_status.slice(8)}`,link:`#/projects/${p.id}`,since:p.updated_at});
 for(const t of await all<{id:string,title:string,updated_at:string}>("SELECT id,title,updated_at FROM tasks WHERE tenant_id=? AND approval_status='pending' AND approver_id=? AND deleted_at IS NULL LIMIT 50",u.tenantId,u.id))push({id:`tsa:${t.id}`,source:'Tasks',kind:'approval',title:t.title,detail:'Task approval requested',link:`#/tasks/all/${t.id}`,since:t.updated_at});
 if(hasAction(u,'studio'))for(const a of await safe(()=>myApprovals(u),[]))push({id:`stu:${a.id}`,source:'Workspace Studio',kind:'approval',title:a.title,detail:a.stage,link:a.link,since:a.since,due:a.dueAt,actionable:'studio'});
 if(hasAction(u,'agents'))for(const a of await safe(()=>pendingAgentApprovals(u),[]))push({id:`ai:${a.id}`,source:`AI · ${a.agent}`,kind:'ai-approval',title:a.toolLabel,detail:a.effect,link:'#/inbox',since:a.createdAt,risk:a.risk,actionable:'agent'});
 if(hasAction(u,'connectors','use_connectors')||u.role==='admin')for(const a of await safe(()=>pendingActions(u),[]))push({id:`con:${a.id}`,source:`Connector · ${a.connector}`,kind:'connector-confirmation',title:a.action,detail:JSON.stringify(a.input).slice(0,200),link:'#/inbox',since:a.createdAt,actionable:'connector'});
 if(u.role==='admin'){
  for(const a of await all<{id:string,name:string,updated_at:string,updated_by:string}>("SELECT id,name,updated_at,updated_by FROM studio_apps WHERE tenant_id=? AND approval_status='pending' LIMIT 20",u.tenantId))if(a.updated_by!==u.id)push({id:`pub:${a.id}`,source:'Workspace Studio',kind:'approval',title:`Publish ${a.name}`,detail:'Submitted for publishing approval',link:`#/studio/apps/${a.id}`,since:a.updated_at});
  for(const r of await all<{id:string,name:string,reason:string,created_at:string}>("SELECT id,name,reason,created_at FROM connector_install_requests WHERE tenant_id=? AND status='pending' LIMIT 20",u.tenantId))push({id:`ins:${r.id}`,source:'Connectors',kind:'approval',title:`Install ${r.name}`,detail:r.reason,link:'#/admin/connectors/installs',since:r.created_at});
 }
 const today=new Date().toISOString().slice(0,10);
 const tasks=hasAction(u,'tasks')?await all<{id:string,title:string,due_date:string|null,priority:string,status:string,updated_at:string,project_id:string|null,source_type:string}>("SELECT t.id,t.title,t.due_date,t.priority,t.status,t.updated_at,t.project_id,t.source_type FROM tasks t WHERE t.tenant_id=? AND t.deleted_at IS NULL AND t.status NOT IN ('Done','Cancelled') AND (t.owner_id=? OR EXISTS(SELECT 1 FROM task_assignees a WHERE a.task_id=t.id AND a.tenant_id=t.tenant_id AND a.member_id=? AND a.kind='assignee')) ORDER BY t.due_date IS NULL,t.due_date LIMIT 100",u.tenantId,u.id,u.id):[];
 const mentions=await all<{id:string,kind:string,title:string,body:string,link:string,created_at:string}>('SELECT id,kind,title,body,link,created_at FROM notifications WHERE tenant_id=? AND member_id=? AND read_at IS NULL ORDER BY created_at DESC LIMIT 50',u.tenantId,u.id);
 return {approvals:items.sort((a,b)=>a.since.localeCompare(b.since)),tasks:tasks.map(t=>({id:t.id,title:t.title,due:t.due_date,overdue:!!t.due_date&&t.due_date<today,priority:t.priority,status:t.status,fromAutomation:['automation','agent'].includes(t.source_type),link:`#/tasks/mine/${t.id}`})),updates:mentions.map(n=>({id:n.id,kind:n.kind,title:n.title,body:n.body,link:n.link,at:n.created_at})),counts:{approvals:items.length,tasks:tasks.length,overdue:tasks.filter(t=>t.due_date&&t.due_date<today).length,updates:mentions.length}};
});
export type {Member};
