import {hasAction,canActOn,departmentKey,actionScope} from '../access-policy';
import {all,first,stmt,batch,uid,now,HttpError,parseJson} from './core';
import {aclOf,canView,canManage} from './acl';
import {visibleEntity} from './entities';
import type {Member} from './policy';

// Shared rules for Spaces, Projects, Tasks and Messaging. Every list and detail endpoint, search, AI retrieval
// and notification uses these functions, so access is decided in one place.

// ── Spaces ──────────────────────────────────────────────────────────────────
export type SpaceRow={id:string,tenant_id:string,key:string,kind:string,name:string,department:string,project_id:string|null,description:string,icon:string,color:string,visibility:string,status:string,created_by:string,created_at:string,updated_at:string};
// Company and department spaces exist for every company; they are created on first use.
export async function ensureSpaces(u:{tenantId:string,id:string}){
 const depts=await all<{name:string,color:string,description:string}>("SELECT name,color,description FROM departments WHERE tenant_id=? AND status!='Inactive'",u.tenantId);
 const have=new Set((await all<{key:string}>('SELECT key FROM spaces WHERE tenant_id=?',u.tenantId)).map(r=>r.key));
 const ts=now();const s:D1PreparedStatement[]=[];
 if(!have.has('company'))s.push(stmt("INSERT OR IGNORE INTO spaces(id,tenant_id,key,kind,name,description,icon,visibility,created_by,created_at,updated_at) VALUES(?,?,'company','company','Company','Company-wide announcements, policies and files.','Megaphone','company','system',?,?)",uid(),u.tenantId,ts,ts));
 for(const d of depts)if(!have.has(`dept:${d.name.toLowerCase()}`))s.push(stmt("INSERT OR IGNORE INTO spaces(id,tenant_id,key,kind,name,department,description,color,visibility,created_by,created_at,updated_at) VALUES(?,?,?,'department',?,?,?,?,'company','system',?,?)",uid(),u.tenantId,`dept:${d.name.toLowerCase()}`,d.name,d.name,d.description||'',d.color||'',ts,ts));
 for(let i=0;i<s.length;i+=80)await batch(s.slice(i,i+80));
}
export const isSpaceMember=(u:Member,s:SpaceRow)=>u.role==='admin'||!!u.spaceIds?.includes(s.id)||s.kind==='company'||(s.kind==='department'&&departmentKey(s.department)===departmentKey(u.department));
export const canSeeSpace=(u:Member,s:SpaceRow)=>hasAction(u,'knowledge')&&s.status!=='archived'&&(s.visibility==='company'||isSpaceMember(u,s));
export const canManageSpace=(u:Member,s:SpaceRow)=>u.role==='admin'||(s.kind==='department'&&canActOn(u,'knowledge','publish',s.department,null))||s.created_by===u.id;
export async function loadSpace(u:Member,id:string){const s=await first<SpaceRow>('SELECT * FROM spaces WHERE (id=? OR key=?) AND tenant_id=?',id,id,u.tenantId);if(!s||!canSeeSpace(u,s))throw new HttpError(404,'Space not found.');return s}

// ── Projects ────────────────────────────────────────────────────────────────
export type ProjectRow={id:string,tenant_id:string,code:string,name:string,type:string,methodology:string,description:string,business_case:string,department:string,location:string,owner_id:string|null,manager_id:string|null,sponsor_id:string|null,start_date:string|null,target_date:string|null,actual_end:string|null,priority:string,stage:string,workflow_id:string|null,health:string,currency:string,approved_budget:number,progress:number,tags:string,custom_json:string,acl_json:string|null,space_id:string|null,approval_status:string,archived_at:string|null,created_by:string,created_at:string,updated_at:string};
const leads=(u:Member,p:ProjectRow)=>[p.owner_id,p.manager_id,p.sponsor_id].includes(u.id);
export function canSeeProject(u:Member,p:ProjectRow){
 if(u.disabledPages?.includes('projects'))return false;
 if(u.role==='admin'||leads(u,p)||u.projectIds?.includes(p.id)||p.created_by===u.id)return true;
 if(!hasAction(u,'projects'))return false;
 if(p.acl_json)return canView(u,aclOf(p.acl_json),p.owner_id);
 return canActOn(u,'projects','view',p.department,p.created_by);
}
export const canManageProject=(u:Member,p:ProjectRow)=>!u.disabledPages?.includes('projects')&&(u.role==='admin'||leads(u,p)||(hasAction(u,'projects','update')&&canActOn(u,'projects','update',p.department,p.created_by)));
export async function loadProject(u:Member,id:string){const p=await first<ProjectRow>('SELECT * FROM projects WHERE id=? AND tenant_id=?',id,u.tenantId);if(!p||!canSeeProject(u,p))throw new HttpError(404,'Project not found.');return p}
// Default lifecycles per project type. Companies edit these in the workflow builder.
export type Stage={id:string,name:string,requires?:string[],approval?:boolean,approverRole?:string,next:string[]};
const chain=(ids:[string,string,Partial<Stage>?][]):Stage[]=>ids.map(([id,name,x],i)=>({id,name,next:[...(ids[i+1]?[ids[i+1][0]]:[]),...(i>0?[ids[i-1][0]]:[]),...(id!=='archived'?['archived']:[])].filter((v,j,a)=>a.indexOf(v)===j&&v!==id),...x}));
export const defaultWorkflows:Record<string,{name:string,stages:Stage[]}>={
 capital:{name:'Physical / capital project',stages:chain([['request','Request',{requires:['description']}],['business-case','Business case',{requires:['businessCase']}],['budget-approval','Budget approval',{approval:true,approverRole:'admin',requires:['approvedBudget']}],['planning','Planning',{requires:['startDate','targetDate','managerId']}],['procurement','Procurement'],['execution','Execution'],['handover','Handover'],['closure','Closure'],['post-review','Post-project review'],['archived','Archived']])},
 it:{name:'IT / software project',stages:chain([['request','Request',{requires:['description']}],['review','Review'],['approval','Approval',{approval:true,approverRole:'manager'}],['planning','Planning',{requires:['managerId']}],['execution','Build'],['testing','Testing'],['release','Release'],['maintenance','Maintenance'],['closure','Closure'],['archived','Archived']])},
 service:{name:'Service / client project',stages:chain([['request','Request'],['planning','Planning',{requires:['managerId']}],['execution','Delivery'],['monitoring','Monitoring'],['handover','Handover'],['closure','Closure'],['archived','Archived']])},
 internal:{name:'Internal project',stages:chain([['idea','Idea'],['planning','Planning'],['execution','Execution'],['closure','Closure'],['archived','Archived']])},
};
export async function workflowFor(p:{tenant_id:string,workflow_id:string|null,type:string}):Promise<{id:string|null,name:string,stages:Stage[]}>{
 if(p.workflow_id){const w=await first<{id:string,name:string,stages_json:string}>('SELECT id,name,stages_json FROM project_workflows WHERE id=? AND tenant_id=?',p.workflow_id,p.tenant_id);if(w)return {id:w.id,name:w.name,stages:parseJson(w.stages_json,[])}}
 const byType=await first<{id:string,name:string,stages_json:string}>('SELECT id,name,stages_json FROM project_workflows WHERE tenant_id=? AND project_type=? ORDER BY is_default DESC LIMIT 1',p.tenant_id,p.type);
 if(byType)return {id:byType.id,name:byType.name,stages:parseJson(byType.stages_json,[])};
 const d=defaultWorkflows[p.type]||defaultWorkflows[['construction','maintenance','procurement'].includes(p.type)?'capital':['software','it'].includes(p.type)?'it':['client','service'].includes(p.type)?'service':'internal'];
 return {id:null,...d};
}
// Project finance from real linked records only. Nothing is estimated here.
export async function projectFinance(tenantId:string,p:ProjectRow){
 const [docs,lines,costs,budgets,time]=await Promise.all([
  all<{id:string,kind:string,number:string,title:string,status:string,total:number,pr_id:string|null}>('SELECT id,kind,number,title,status,total,pr_id FROM purchase_docs WHERE tenant_id=? AND project_id=?',tenantId,p.id),
  all<{kind:string,status:string,qty:number,received_qty:number,returned_qty:number,unit_price:number,tax_rate:number}>('SELECT d.kind,d.status,l.qty,l.received_qty,l.returned_qty,l.unit_price,l.tax_rate FROM purchase_lines l JOIN purchase_docs d ON d.id=l.doc_id AND d.tenant_id=l.tenant_id WHERE l.tenant_id=? AND d.project_id=?',tenantId,p.id),
  all<{kind:string,amount:number,status:string}>('SELECT kind,amount,status FROM project_costs WHERE tenant_id=? AND project_id=?',tenantId,p.id),
  all<{id:string,name:string,amount:number}>('SELECT id,name,amount FROM budgets WHERE tenant_id=? AND project_id=?',tenantId,p.id),
  first<{cost:number,minutes:number}>('SELECT coalesce(sum(minutes*rate/60.0),0) AS cost,coalesce(sum(minutes),0) AS minutes FROM time_entries WHERE tenant_id=? AND project_id=?',tenantId,p.id),
 ]);
 const dead=['Draft','Rejected','Cancelled'];
 const prs=docs.filter(d=>d.kind==='PR'&&!dead.includes(d.status));const pos=docs.filter(d=>d.kind==='PO'&&!dead.includes(d.status));
 const converted=new Set(pos.map(p=>p.pr_id).filter(Boolean));
 const requested=prs.reduce((n,d)=>n+d.total,0);
 const ordered=pos.reduce((n,d)=>n+d.total,0);
 // Committed: approved requisitions not yet ordered, plus open (not fully received) purchase orders.
 const openPrs=prs.filter(d=>d.status==='Approved'&&!converted.has(d.id)).reduce((n,d)=>n+d.total,0);
 const received=lines.filter(l=>l.kind==='PO').reduce((n,l)=>n+Math.max(0,l.received_qty-l.returned_qty)*l.unit_price*(1+l.tax_rate/100),0);
 const committed=openPrs+Math.max(0,ordered-received);
 const invoices=costs.filter(c=>c.kind==='invoice').reduce((n,c)=>n+c.amount,0),payments=costs.filter(c=>c.kind==='payment').reduce((n,c)=>n+c.amount,0);
 const expenses=costs.filter(c=>c.kind==='expense').reduce((n,c)=>n+c.amount,0),forecastExtra=costs.filter(c=>c.kind==='forecast').reduce((n,c)=>n+c.amount,0);
 const labour=time?.cost||0;
 // Actual: received goods and services (or invoiced, whichever is higher), plus expenses and logged labour.
 const actual=Math.max(received,invoices)+expenses+labour;
 const approved=p.approved_budget||budgets.reduce((n,b)=>n+b.amount,0);
 const forecast=actual+committed+forecastExtra;
 const r=(n:number)=>Math.round(n*100)/100;
 return {currency:p.currency,approved:r(approved),requested:r(requested),committed:r(committed),ordered:r(ordered),received:r(received),invoiced:r(invoices),paid:r(payments),labour:r(labour),labourMinutes:time?.minutes||0,expenses:r(expenses),actual:r(actual),remaining:r(approved-actual-committed),forecastAtCompletion:r(forecast),variance:r(approved-forecast),documents:docs,budgets};
}

// ── Tasks ───────────────────────────────────────────────────────────────────
export type TaskRow={id:string,tenant_id:string,number:string,title:string,description:string,type:string,status:string,priority:string,owner_id:string,department:string,project_id:string|null,space_id:string|null,parent_id:string|null,phase_id:string|null,sprint_id:string|null,milestone:number,start_date:string|null,due_date:string|null,baseline_start:string|null,baseline_due:string|null,completed_at:string|null,estimate_min:number,actual_min:number,progress:number,tags:string,custom_json:string,acl_json:string|null,recurrence:string,reminder_at:string|null,approval_status:string,approver_id:string|null,sort:number,source_type:string,source_id:string,deleted_at:string|null,created_by:string,created_at:string,updated_at:string,assignees?:string|null,watchers?:string|null};
export const TASK_SELECT="t.*,(SELECT group_concat(member_id) FROM task_assignees a WHERE a.task_id=t.id AND a.tenant_id=t.tenant_id AND a.kind='assignee') AS assignees,(SELECT group_concat(member_id) FROM task_assignees a WHERE a.task_id=t.id AND a.tenant_id=t.tenant_id AND a.kind='watcher') AS watchers";
export const assigneesOf=(t:TaskRow)=>(t.assignees||'').split(',').filter(Boolean);
export function canSeeTask(u:Member,t:TaskRow,projects?:Map<string,ProjectRow>,spaces?:Map<string,SpaceRow>){
 if(t.deleted_at||u.disabledPages?.includes('tasks'))return false;
 if(u.role==='admin'||t.owner_id===u.id||t.created_by===u.id||assigneesOf(t).includes(u.id)||(t.watchers||'').split(',').includes(u.id))return true;
 if(t.project_id){const p=projects?.get(t.project_id);if(p)return canSeeProject(u,p)}
 if(t.space_id){const s=spaces?.get(t.space_id);if(s&&isSpaceMember(u,s))return true}
 if(!hasAction(u,'tasks'))return false;
 if(t.acl_json)return canView(u,aclOf(t.acl_json),t.owner_id);
 return canActOn(u,'tasks','view',t.department,t.owner_id)&&actionScope(u,'tasks','view')!=='own';
}
export function canEditTask(u:Member,t:TaskRow,p?:ProjectRow|null){return u.role==='admin'||t.owner_id===u.id||t.created_by===u.id||assigneesOf(t).includes(u.id)||(!!p&&canManageProject(u,p))||(!!t.acl_json&&canManage(u,aclOf(t.acl_json),t.owner_id))}
// Loads the projects and spaces referenced by a set of tasks, for canSeeTask.
export async function taskContext(u:Member,rows:TaskRow[]){
 const pids=[...new Set(rows.map(r=>r.project_id).filter(Boolean))] as string[];const sids=[...new Set(rows.map(r=>r.space_id).filter(Boolean))] as string[];
 const projects=pids.length?await all<ProjectRow>(`SELECT * FROM projects WHERE tenant_id=? AND id IN (${pids.map(()=>'?').join(',')})`,u.tenantId,...pids):[];
 const spaces=sids.length?await all<SpaceRow>(`SELECT * FROM spaces WHERE tenant_id=? AND id IN (${sids.map(()=>'?').join(',')})`,u.tenantId,...sids):[];
 return {projects:new Map(projects.map(p=>[p.id,p])),spaces:new Map(spaces.map(s=>[s.id,s]))};
}
export async function loadTask(u:Member,id:string){
 const t=await first<TaskRow>(`SELECT ${TASK_SELECT} FROM tasks t WHERE t.id=? AND t.tenant_id=?`,id,u.tenantId);if(!t)throw new HttpError(404,'Task not found.');
 const ctx=await taskContext(u,[t]);if(!canSeeTask(u,t,ctx.projects,ctx.spaces))throw new HttpError(404,'Task not found.');
 return {task:t,project:t.project_id?ctx.projects.get(t.project_id)||null:null};
}

// ── Messaging ───────────────────────────────────────────────────────────────
export type ChannelRow={id:string,tenant_id:string,kind:string,name:string,description:string,ref_id:string,posting:string,archived_at:string|null,last_message_at:string|null,created_by:string,created_at:string};
// Membership: company channel = everyone; department = that department; project = project team; space = space
// members; group = group members; direct and custom channels = their listed members.
export async function canAccessChannel(u:Member,c:ChannelRow,explicit?:Set<string>):Promise<boolean>{
 if(u.disabledPages?.includes('messages')||!hasAction(u,'messages'))return u.role==='admin'&&!u.disabledPages?.includes('messages');
 if(u.role==='admin'&&!['dm','multi'].includes(c.kind))return true;
 const mine=explicit??new Set((await all<{channel_id:string}>('SELECT channel_id FROM channel_members WHERE tenant_id=? AND member_id=?',u.tenantId,u.id)).map(r=>r.channel_id));
 switch(c.kind){
  case 'company':case 'announcement':return true;
  case 'department':return departmentKey(c.ref_id)===departmentKey(u.department)||!!u.extraDepartments?.some(d=>departmentKey(d)===departmentKey(c.ref_id))||mine.has(c.id);
  case 'project':return !!u.projectIds?.includes(c.ref_id)||mine.has(c.id)||!!(await first<ProjectRow>('SELECT * FROM projects WHERE id=? AND tenant_id=?',c.ref_id,u.tenantId).then(p=>p&&[p.owner_id,p.manager_id,p.sponsor_id].includes(u.id)));
  case 'space':return !!u.spaceIds?.includes(c.ref_id)||mine.has(c.id);
  case 'group':return !!u.groupIds?.includes(c.ref_id)||mine.has(c.id);
  default:return mine.has(c.id);
 }
}
export function canModerateChannel(u:Member,c:ChannelRow){return u.role==='admin'||(c.kind==='department'&&hasAction(u,'messages','moderate')&&canActOn(u,'messages','moderate',c.ref_id,null))||(['custom','project','space','group'].includes(c.kind)&&c.created_by===u.id)}

// ── Links between files/messages and other records ─────────────────────────
export const LINK_TYPES=['space','department','project','task','ticket','asset','PR','PO','vendor','person','message','page','work_order'] as const;
export async function entityVisible(u:Member,type:string,id:string){
 switch(type){
  case 'ticket':case 'asset':case 'PR':case 'PO':case 'page':case 'work_order':return visibleEntity(u,type,id);
  case 'space':return loadSpace(u,id);
  case 'project':return loadProject(u,id);
  case 'task':return loadTask(u,id);
  case 'department':{if(!await first('SELECT id FROM departments WHERE (id=? OR name=?) AND tenant_id=?',id,id,u.tenantId))throw new HttpError(404,'Department not found.');return}
  case 'vendor':{if(!hasAction(u,'suppliers')||!await first('SELECT id FROM vendors WHERE id=? AND tenant_id=?',id,u.tenantId))throw new HttpError(404,'Vendor not found.');return}
  case 'person':{if(!await first('SELECT id FROM members WHERE id=? AND tenant_id=?',id,u.tenantId))throw new HttpError(404,'Person not found.');return}
  case 'message':{const m=await first<{channel_id:string}>('SELECT channel_id FROM messages WHERE id=? AND tenant_id=? AND deleted_at IS NULL',id,u.tenantId);const c=m?await first<ChannelRow>('SELECT * FROM channels WHERE id=? AND tenant_id=?',m.channel_id,u.tenantId):null;if(!c||!await canAccessChannel(u,c))throw new HttpError(404,'Message not found.');return}
 }
 throw new HttpError(400,'Unsupported record type.');
}
