import {hasAction,canActOn} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,num,oneOf,idOf,date,auditStatement,parseJson,nextNumber,tenantOf} from '../../server/core';
import {canSeeProject,canManageProject,loadProject,projectFinance,workflowFor,defaultWorkflows,canSeeTask,taskContext,TASK_SELECT,type ProjectRow,type TaskRow,type Stage} from '../../server/collab';
import {canSeeDoc,type PurchaseRow} from '../../server/entities';
import {validateAcl,aclOf} from '../../server/acl';
import {notify} from '../../server/notify';
import type {Member} from '../../server/policy';

// Enterprise project planner: configurable lifecycles with approvals and required information, members and
// roles, plans (records + tasks), procurement and finance from real linked records, templates, baselines and
// critical path. Every change is audited; visibility follows the project's team, department or audience.
const PROJECT_TYPES=['capital','construction','service','client','procurement','internal','department','it','software','maintenance','custom'] as const;
const RECORD_KINDS=['phase','milestone','deliverable','risk','issue','decision','change','lesson','meeting','requirement','epic','feature','story','bug','sprint','release','environment','test','deployment','inspection','site-report','service-report','defect','contractor','material','equipment','certificate','handover','obligation','sla','rfq'] as const;
const canCreate=(u:Member,department:string)=>u.role==='admin'||canActOn(u,'projects','create',department,u.id);
const fieldValue=(p:ProjectRow,f:string)=>({description:p.description,businessCase:p.business_case,approvedBudget:p.approved_budget,startDate:p.start_date,targetDate:p.target_date,managerId:p.manager_id,ownerId:p.owner_id,sponsorId:p.sponsor_id} as Record<string,unknown>)[f];
function criticalPath(tasks:TaskRow[],deps:{task_id:string,depends_on:string}[]){
 // Longest path through finish-to-start dependencies, using task durations in days.
 const dur=new Map(tasks.map(t=>[t.id,Math.max(1,t.start_date&&t.due_date?Math.round((Date.parse(t.due_date)-Date.parse(t.start_date))/86400000)+1:Math.ceil((t.estimate_min||480)/480))]));
 const preds=new Map<string,string[]>();for(const d of deps)if(dur.has(d.task_id)&&dur.has(d.depends_on))preds.set(d.task_id,[...(preds.get(d.task_id)||[]),d.depends_on]);
 const finish=new Map<string,number>(),via=new Map<string,string|null>();const visiting=new Set<string>();
 const ef=(id:string):number=>{if(finish.has(id))return finish.get(id)!;if(visiting.has(id))return 0;visiting.add(id);let best=0,from:string|null=null;for(const p of preds.get(id)||[]){const f=ef(p);if(f>best){best=f;from=p}}visiting.delete(id);const v=best+dur.get(id)!;finish.set(id,v);via.set(id,from);return v};
 let end:string|null=null,max=0;for(const t of tasks){const f=ef(t.id);if(f>max){max=f;end=t.id}}
 const path:string[]=[];for(let c=end;c;c=via.get(c)||null)path.unshift(c);
 return {taskIds:path,days:max};
}
async function detail(u:Member,p:ProjectRow){
 const manage=canManageProject(u,p);
 const [members,history,records,tasksRaw,deps,files,wf,channel,space]=await Promise.all([
  all('SELECT pm.member_id AS id,pm.role,pm.allocation,m.name,m.department,m.title FROM project_members pm JOIN members m ON m.id=pm.member_id AND m.tenant_id=pm.tenant_id WHERE pm.tenant_id=? AND pm.project_id=? ORDER BY pm.role,m.name',u.tenantId,p.id),
  all('SELECT h.from_stage AS "from",h.to_stage AS "to",h.note,h.created_at AS createdAt,m.name AS who FROM project_stage_history h LEFT JOIN members m ON m.id=h.actor WHERE h.tenant_id=? AND h.project_id=? ORDER BY h.created_at DESC',u.tenantId,p.id),
  all<{id:string,kind:string,title:string,body:string,status:string,priority:string,owner_id:string|null,due_date:string|null,parent_id:string|null,data_json:string,sort:number,created_at:string,updated_at:string}>('SELECT * FROM project_records WHERE tenant_id=? AND project_id=? AND deleted_at IS NULL ORDER BY kind,sort,created_at',u.tenantId,p.id),
  all<TaskRow>(`SELECT ${TASK_SELECT} FROM tasks t WHERE t.tenant_id=? AND t.project_id=? AND t.deleted_at IS NULL ORDER BY t.sort,t.due_date`,u.tenantId,p.id),
  all<{task_id:string,depends_on:string,kind:string}>('SELECT d.task_id,d.depends_on,d.kind FROM task_deps d JOIN tasks t ON t.id=d.task_id AND t.tenant_id=d.tenant_id WHERE d.tenant_id=? AND t.project_id=?',u.tenantId,p.id),
  all("SELECT f.id,f.name,f.mime,f.bytes,f.updated_at AS updatedAt,f.processing_status AS processingStatus FROM files f WHERE f.tenant_id=?1 AND f.deleted_at IS NULL AND (f.id IN (SELECT file_id FROM file_links WHERE tenant_id=?1 AND entity_type='project' AND entity_id=?2) OR instr(coalesce(f.acl_json,''),?3)>0) ORDER BY f.updated_at DESC LIMIT 200",u.tenantId,p.id,`"projectId":"${p.id}"`),
  workflowFor(p),
  first<{id:string}>("SELECT id FROM channels WHERE tenant_id=? AND kind='project' AND ref_id=?",u.tenantId,p.id),
  p.space_id?first<{id:string,name:string}>('SELECT id,name FROM spaces WHERE id=? AND tenant_id=?',p.space_id,u.tenantId):null,
 ]);
 const ctx=await taskContext(u,tasksRaw);const tasks=tasksRaw.filter(t=>canSeeTask(u,t,ctx.projects,ctx.spaces));
 const finance=hasAction(u,'requests')||hasAction(u,'procurement')||hasAction(u,'budgets')||manage?await projectFinance(u.tenantId,p):null;
 // Procurement documents are listed only if the person can open them.
 const docs=finance?(await all<PurchaseRow>("SELECT d.*,(SELECT group_concat(j.value) FROM approvals a, json_each(a.approver_ids) j WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id) AS approver_ids FROM purchase_docs d WHERE d.tenant_id=? AND d.project_id=? ORDER BY d.created_at DESC",u.tenantId,p.id)).filter(d=>canSeeDoc(u,d)).map(d=>({id:d.id,kind:d.kind,number:d.number,title:d.title,status:d.status,total:d.total,currency:d.currency,createdAt:d.created_at})):[];
 const stage=wf.stages.find(s=>s.id===p.stage);
 const cp=criticalPath(tasks,deps);
 const costs=manage?await all('SELECT id,kind,description,amount,currency,status,source_type AS sourceType,source_id AS sourceId,date FROM project_costs WHERE tenant_id=? AND project_id=? ORDER BY date DESC',u.tenantId,p.id):[];
 const assets=await all('SELECT id,code,name,status FROM assets WHERE tenant_id=? AND project_id=? ORDER BY code',u.tenantId,p.id);
 return {project:{...p,custom:parseJson(p.custom_json,{}),acl:p.acl_json?aclOf(p.acl_json):null},members,history,records:records.map(r=>({...r,data:parseJson(r.data_json,{})})),tasks,deps,criticalPath:cp,files,finance:finance?{...finance,documents:docs}:null,costs,assets,workflow:{...wf,current:stage||null,next:(stage?.next||[]).map(id=>wf.stages.find(s=>s.id===id)).filter(Boolean)},channelId:channel?.id||null,space,canManage:manage,canApprove:u.role==='admin'||(hasAction(u,'projects','approve')&&canActOn(u,'projects','approve',p.department,p.created_by))};
}
export const GET=route(async(req,u)=>{
 const url=new URL(req.url);const id=url.searchParams.get('id');const view=url.searchParams.get('view');
 if(id)return detail(u,await loadProject(u,idOf(id,'Project')));
 if(view==='templates')return {templates:await all('SELECT id,name,project_type AS projectType,methodology,payload_json AS payload,created_at AS createdAt,created_by AS createdBy FROM project_templates WHERE tenant_id=? ORDER BY name',u.tenantId)};
 if(view==='workflows'){const rows=await all<{id:string,name:string,project_type:string,stages_json:string,is_default:number}>('SELECT * FROM project_workflows WHERE tenant_id=? ORDER BY name',u.tenantId);return {workflows:rows.map(w=>({id:w.id,name:w.name,projectType:w.project_type,isDefault:!!w.is_default,stages:parseJson(w.stages_json,[])})),defaults:defaultWorkflows,types:PROJECT_TYPES}}
 const rows=await all<ProjectRow&{open_tasks:number,overdue:number,team:number}>("SELECT p.*,(SELECT count(*) FROM tasks t WHERE t.tenant_id=p.tenant_id AND t.project_id=p.id AND t.deleted_at IS NULL AND t.status NOT IN ('Done','Cancelled')) AS open_tasks,(SELECT count(*) FROM tasks t WHERE t.tenant_id=p.tenant_id AND t.project_id=p.id AND t.deleted_at IS NULL AND t.status NOT IN ('Done','Cancelled') AND t.due_date<date('now')) AS overdue,(SELECT count(*) FROM project_members m WHERE m.tenant_id=p.tenant_id AND m.project_id=p.id) AS team FROM projects p WHERE p.tenant_id=? ORDER BY p.archived_at IS NOT NULL,p.updated_at DESC LIMIT 2000",u.tenantId);
 return {projects:rows.filter(p=>canSeeProject(u,p)&&(url.searchParams.get('archived')?true:!p.archived_at)).map(({custom_json,acl_json,...p})=>({...p,custom:parseJson(custom_json,{}),audience:acl_json?aclOf(acl_json).mode:'department'})),canCreate:u.role==='admin'||hasAction(u,'projects','create'),types:PROJECT_TYPES};
},{module:'projects'});

export const POST=route(async(req,u)=>{
 const b=await readBody(req,300000);const action=String(b.action||'');
 const person=async(v:unknown,label:string)=>{if(!v)return null;const id=idOf(v,label);if(!await first('SELECT id FROM members WHERE id=? AND tenant_id=? AND active=1',id,u.tenantId))throw new HttpError(400,`${label} must be an active person in this company.`);return id};
 const fields=async(d:Record<string,unknown>,cur?:ProjectRow)=>({name:str(d.name??cur?.name,'Project name',160),type:oneOf(d.type??cur?.type??'internal',PROJECT_TYPES,'project type'),methodology:oneOf(d.methodology??cur?.methodology??'waterfall',['waterfall','kanban','scrum','hybrid','custom'] as const,'methodology'),description:str(d.description??cur?.description,'Description',8000,false),businessCase:str(d.businessCase??cur?.business_case,'Business case',8000,false),department:str(d.department??cur?.department??u.department,'Department',160,false),location:str(d.location??cur?.location,'Location',200,false),ownerId:d.ownerId!==undefined?await person(d.ownerId,'Owner'):cur?.owner_id??u.id,managerId:d.managerId!==undefined?await person(d.managerId,'Project manager'):cur?.manager_id??null,sponsorId:d.sponsorId!==undefined?await person(d.sponsorId,'Sponsor'):cur?.sponsor_id??null,startDate:d.startDate!==undefined?date(d.startDate,'Start date'):cur?.start_date??null,targetDate:d.targetDate!==undefined?date(d.targetDate,'Target date'):cur?.target_date??null,priority:oneOf(d.priority??cur?.priority??'Medium',['Low','Medium','High','Critical'] as const,'priority'),health:oneOf(d.health??cur?.health??'green',['green','amber','red'] as const,'health'),currency:str(d.currency??cur?.currency,'Currency',8,false)||(await tenantOf(u)).currency,approvedBudget:d.approvedBudget!==undefined&&d.approvedBudget!==''?num(d.approvedBudget,'Approved budget',0,1e12):cur?.approved_budget??0,progress:d.progress!==undefined?Math.round(num(d.progress,'Progress',0,100)):cur?.progress??0,tags:str(d.tags??cur?.tags,'Tags',300,false),custom:d.custom&&typeof d.custom==='object'?Object.fromEntries(Object.entries(d.custom as Record<string,unknown>).slice(0,40).map(([k,v])=>[k.slice(0,40),str(v,'Custom field',400,false)])):parseJson(cur?.custom_json,{})});
 if(action==='create'){
  const v=await fields(b);if(!canCreate(u,v.department))throw new HttpError(403,'You cannot create projects for this department.');
  if(v.targetDate&&v.startDate&&v.targetDate<v.startDate)throw new HttpError(400,'The target date must be after the start date.');
  const {acl}=b.acl?await validateAcl(u,b.acl):{acl:null};
  const tpl=b.templateId?await first<{payload_json:string,project_type:string,methodology:string}>('SELECT payload_json,project_type,methodology FROM project_templates WHERE id=? AND tenant_id=?',idOf(b.templateId,'Template'),u.tenantId):null;
  if(b.templateId&&!tpl)throw new HttpError(404,'Template not found.');
  const payload=parseJson<{records?:{kind:string,title:string,body?:string}[],tasks?:{title:string,offsetDays?:number,durationDays?:number,milestone?:boolean,type?:string}[]}>(tpl?.payload_json,{});
  const id=uid(),spaceId=uid(),ts=now();const code=b.code?str(b.code,'Project code',30).toUpperCase():await nextNumber(u.tenantId,'PRJ',true,['projects','code']);
  if(await first('SELECT id FROM projects WHERE tenant_id=? AND code=?',u.tenantId,code))throw new HttpError(409,'Another project uses this code.');
  const wf=await workflowFor({tenant_id:u.tenantId,workflow_id:null,type:v.type});
  const start=v.startDate||ts.slice(0,10);const addDays=(d:string,n:number)=>new Date(Date.parse(d)+n*86400000).toISOString().slice(0,10);
  await batch([
   stmt('INSERT INTO projects(id,tenant_id,code,name,type,methodology,description,business_case,department,location,owner_id,manager_id,sponsor_id,start_date,target_date,priority,stage,workflow_id,health,currency,approved_budget,progress,tags,custom_json,acl_json,space_id,created_by,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,code,v.name,tpl?.project_type||v.type,tpl?.methodology||v.methodology,v.description,v.businessCase,v.department,v.location,v.ownerId,v.managerId,v.sponsorId,v.startDate,v.targetDate,v.priority,wf.stages[0]?.id||'request',wf.id,v.health,v.currency,v.approvedBudget,0,v.tags,JSON.stringify(v.custom),acl?JSON.stringify(acl):null,spaceId,u.id,ts,ts,u.name),
   // Every project gets its own space (files, pages, tasks, messages) and a team.
   stmt("INSERT INTO spaces(id,tenant_id,key,kind,name,department,project_id,description,icon,visibility,created_by,created_at,updated_at) VALUES(?,?,?,'project',?,?,?,?,'FolderKanban','members',?,?,?)",spaceId,u.tenantId,`project:${id}`,v.name,v.department,id,`Workspace for project ${code}`,u.id,ts,ts),
   ...[...new Set([u.id,v.ownerId,v.managerId,v.sponsorId].filter(Boolean) as string[])].map(m=>stmt('INSERT OR IGNORE INTO project_members(id,tenant_id,project_id,member_id,role,added_at) VALUES(?,?,?,?,?,?)',uid(),u.tenantId,id,m,m===v.managerId?'manager':m===v.ownerId?'owner':m===v.sponsorId?'sponsor':'member',ts)),
   ...[...new Set([u.id,v.ownerId,v.managerId].filter(Boolean) as string[])].map(m=>stmt("INSERT OR IGNORE INTO space_members(id,tenant_id,space_id,member_id,role,added_at) VALUES(?,?,?,?,'owner',?)",uid(),u.tenantId,spaceId,m,ts)),
   stmt('INSERT INTO project_stage_history(id,tenant_id,project_id,from_stage,to_stage,actor,note,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),u.tenantId,id,'',wf.stages[0]?.id||'request',u.id,tpl?'Created from template':'Created',ts),
   ...(payload.records||[]).slice(0,200).filter(r=>(RECORD_KINDS as readonly string[]).includes(r.kind)).map((r,i)=>stmt('INSERT INTO project_records(id,tenant_id,project_id,kind,title,body,sort,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,id,r.kind,String(r.title).slice(0,200),String(r.body||'').slice(0,4000),i,u.id,ts,ts)),
   ...(payload.tasks||[]).slice(0,300).map((t,i)=>stmt('INSERT INTO tasks(id,tenant_id,title,type,status,priority,owner_id,department,project_id,space_id,milestone,start_date,due_date,sort,created_by,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,String(t.title).slice(0,200),String(t.type||'task').slice(0,20),'To do','Medium',v.managerId||u.id,v.department,id,spaceId,t.milestone?1:0,addDays(start,t.offsetDays||0),addDays(start,(t.offsetDays||0)+Math.max(0,(t.durationDays||1)-1)),i,u.id,ts,ts,u.name)),
   auditStatement(u,'Project created',id,v.department,null,{code,name:v.name,type:v.type,template:b.templateId||null}),
  ]);
  return {id,code};
 }
 if(action==='workflow-save'||action==='workflow-delete'){
  if(u.role!=='admin'&&!hasAction(u,'projects','configure'))throw new HttpError(403,'Only administrators configure project workflows.');
  if(action==='workflow-delete'){const id=idOf(b.id,'Workflow');if(await first('SELECT id FROM projects WHERE tenant_id=? AND workflow_id=? AND archived_at IS NULL',u.tenantId,id))throw new HttpError(409,'Projects still use this workflow.');await batch([stmt('DELETE FROM project_workflows WHERE id=? AND tenant_id=?',id,u.tenantId),auditStatement(u,'Project workflow deleted',id,'Administration',null,null)]);return {ok:true}}
  const stages=(Array.isArray(b.stages)?b.stages:[]).slice(0,30).map((s:any)=>({id:str(s.id,'Stage ID',40).toLowerCase().replace(/[^a-z0-9-]/g,'-'),name:str(s.name,'Stage name',60),requires:(Array.isArray(s.requires)?s.requires:[]).filter((f:string)=>['description','businessCase','approvedBudget','startDate','targetDate','managerId','ownerId','sponsorId'].includes(f)),approval:!!s.approval,approverRole:s.approval?oneOf(s.approverRole||'admin',['admin','manager','sponsor'] as const,'approver'):undefined,next:(Array.isArray(s.next)?s.next:[]).map(String)})) as Stage[];
  if(stages.length<2)throw new HttpError(400,'A workflow needs at least two stages.');
  const ids=new Set(stages.map(s=>s.id));if(ids.size!==stages.length)throw new HttpError(400,'Stage IDs must be unique.');
  for(const s of stages)if(s.next.some(n=>!ids.has(n)||n===s.id))throw new HttpError(400,`Stage “${s.name}” has an invalid transition.`);
  const id=b.id?idOf(b.id,'Workflow'):uid();const projectType=b.projectType?oneOf(b.projectType,PROJECT_TYPES,'project type'):'';
  await batch([b.id?stmt('UPDATE project_workflows SET name=?,project_type=?,stages_json=?,is_default=?,updated_at=? WHERE id=? AND tenant_id=?',str(b.name,'Workflow name',80),projectType,JSON.stringify(stages),b.isDefault?1:0,now(),id,u.tenantId):stmt('INSERT INTO project_workflows(id,tenant_id,name,project_type,stages_json,is_default,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',id,u.tenantId,str(b.name,'Workflow name',80),projectType,JSON.stringify(stages),b.isDefault?1:0,u.id,now(),now()),auditStatement(u,b.id?'Project workflow changed':'Project workflow created',id,'Administration',null,{name:b.name,projectType,stages:stages.map(s=>s.id)})]);
  return {id};
 }
 if(action==='template-delete'){if(u.role!=='admin'&&!hasAction(u,'projects','configure'))throw new HttpError(403,'Only administrators manage templates.');const id=idOf(b.id,'Template');await batch([stmt('DELETE FROM project_templates WHERE id=? AND tenant_id=?',id,u.tenantId),auditStatement(u,'Project template deleted',id,'Administration',null,null)]);return {ok:true}}
 const p=await loadProject(u,idOf(b.id,'Project'));
 const manage=canManageProject(u,p);
 const need=()=>{if(!manage)throw new HttpError(403,'Only the project’s managers and administrators change it.')};
 switch(action){
  case 'update':{
   need();const v=await fields(b,p);const {acl}=b.acl!==undefined?(b.acl?await validateAcl(u,b.acl):{acl:null}):{acl:p.acl_json?aclOf(p.acl_json):null};
   await batch([stmt('UPDATE projects SET name=?,type=?,methodology=?,description=?,business_case=?,department=?,location=?,owner_id=?,manager_id=?,sponsor_id=?,start_date=?,target_date=?,priority=?,health=?,currency=?,approved_budget=?,progress=?,tags=?,custom_json=?,acl_json=?,updated_at=?,updated_by=? WHERE id=? AND tenant_id=?',v.name,v.type,v.methodology,v.description,v.businessCase,v.department,v.location,v.ownerId,v.managerId,v.sponsorId,v.startDate,v.targetDate,v.priority,v.health,v.currency,v.approvedBudget,v.progress,v.tags,JSON.stringify(v.custom),acl?JSON.stringify(acl):null,now(),u.name,p.id,u.tenantId),...[v.managerId,v.ownerId,v.sponsorId].filter(Boolean).map(m=>stmt("INSERT OR IGNORE INTO project_members(id,tenant_id,project_id,member_id,role,added_at) VALUES(?,?,?,?,'member',?)",uid(),u.tenantId,p.id,m,now())),auditStatement(u,'Project updated',p.id,v.department,{name:p.name,budget:p.approved_budget,manager:p.manager_id,target:p.target_date,health:p.health},{name:v.name,budget:v.approvedBudget,manager:v.managerId,target:v.targetDate,health:v.health})]);return {ok:true};
  }
  case 'transition':{
   need();const wf=await workflowFor(p);const cur=wf.stages.find(s=>s.id===p.stage);const to=wf.stages.find(s=>s.id===String(b.to));
   if(!to)throw new HttpError(400,'Choose a valid stage.');if(cur&&!cur.next.includes(to.id))throw new HttpError(409,`${cur.name} cannot move to ${to.name}.`);
   const missing=(to.requires||[]).filter(f=>{const x=fieldValue(p,f);return x===null||x===undefined||x===''||x===0});
   if(missing.length)throw new HttpError(400,`Complete these before moving to ${to.name}: ${missing.join(', ')}.`);
   // Approval gates: an approver (per the stage) must approve; the move waits until then.
   const approver=to.approval&&(u.role==='admin'||(to.approverRole==='manager'&&hasAction(u,'projects','approve')&&canActOn(u,'projects','approve',p.department,p.created_by))||(to.approverRole==='sponsor'&&p.sponsor_id===u.id));
   if(to.approval&&!approver){
    await batch([stmt("UPDATE projects SET approval_status=?,updated_at=? WHERE id=? AND tenant_id=?",`pending:${to.id}`,now(),p.id,u.tenantId),auditStatement(u,`Approval requested to move to ${to.name}`,p.id,p.department,{stage:p.stage},{requested:to.id,note:str(b.note,'Note',500,false)})]);
    const approvers=(await all<{id:string}>(to.approverRole==='sponsor'?'SELECT id FROM members WHERE id=? AND tenant_id=?':to.approverRole==='manager'?"SELECT id FROM members WHERE tenant_id=?2 AND active=1 AND (role='admin' OR (role='manager' AND lower(department)=lower(?1)))":"SELECT id FROM members WHERE tenant_id=?2 AND active=1 AND role='admin' AND ?1 IS NOT NULL",to.approverRole==='sponsor'?p.sponsor_id:p.department,u.tenantId)).map(r=>r.id);
    await notify(u,approvers,{kind:'approval',title:`${p.code} needs approval to move to ${to.name}`,link:`#/projects/${p.id}`},req);
    return {pending:true};
   }
   await batch([stmt("UPDATE projects SET stage=?,approval_status='none',actual_end=CASE WHEN ? IN ('closure','closed','archived') THEN coalesce(actual_end,?) ELSE actual_end END,archived_at=CASE WHEN ?='archived' THEN ? ELSE archived_at END,updated_at=? WHERE id=? AND tenant_id=?",to.id,to.id,now().slice(0,10),to.id,now(),now(),p.id,u.tenantId),stmt('INSERT INTO project_stage_history(id,tenant_id,project_id,from_stage,to_stage,actor,note,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),u.tenantId,p.id,p.stage,to.id,u.id,str(b.note,'Note',500,false),now()),auditStatement(u,`Project moved to ${to.name}`,p.id,p.department,{stage:p.stage},{stage:to.id})]);
   return {stage:to.id};
  }
  case 'approve-stage':case 'reject-stage':{
   const pending=/^pending:(.+)$/.exec(p.approval_status)?.[1];if(!pending)throw new HttpError(409,'Nothing is waiting for approval.');
   const wf=await workflowFor(p);const to=wf.stages.find(s=>s.id===pending)!;
   const ok=u.role==='admin'||(to.approverRole==='manager'&&hasAction(u,'projects','approve')&&canActOn(u,'projects','approve',p.department,p.created_by))||(to.approverRole==='sponsor'&&p.sponsor_id===u.id);
   if(!ok)throw new HttpError(403,'You are not an approver for this stage.');
   if(action==='reject-stage'){await batch([stmt("UPDATE projects SET approval_status='rejected' WHERE id=? AND tenant_id=?",p.id,u.tenantId),auditStatement(u,`Approval to move to ${to.name} declined`,p.id,p.department,null,{note:str(b.note,'Note',500,false)})]);await notify(u,[p.manager_id,p.owner_id],{kind:'approval',title:`${p.code}: move to ${to.name} was declined`,link:`#/projects/${p.id}`},req);return {ok:true}}
   await batch([stmt("UPDATE projects SET stage=?,approval_status='approved',updated_at=? WHERE id=? AND tenant_id=?",to.id,now(),p.id,u.tenantId),stmt('INSERT INTO project_stage_history(id,tenant_id,project_id,from_stage,to_stage,actor,note,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),u.tenantId,p.id,p.stage,to.id,u.id,`Approved. ${str(b.note,'Note',400,false)}`.trim(),now()),auditStatement(u,`Project approved to move to ${to.name}`,p.id,p.department,{stage:p.stage},{stage:to.id})]);
   await notify(u,[p.manager_id,p.owner_id],{kind:'approval',title:`${p.code} was approved: now in ${to.name}`,link:`#/projects/${p.id}`},req);return {stage:to.id};
  }
  case 'members':{
   need();const add=(Array.isArray(b.add)?b.add:[]).map((x:unknown)=>idOf(x,'Person')).slice(0,100);const remove=(Array.isArray(b.remove)?b.remove:[]).map((x:unknown)=>idOf(x,'Person')).slice(0,100);
   for(const m of add)await person(m,'Team member');const role=str(b.role||'member','Role',40);const allocation=Math.round(num(b.allocation??100,'Allocation',0,100));
   await batch([...add.map((m:string)=>stmt('INSERT INTO project_members(id,tenant_id,project_id,member_id,role,allocation,added_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id,project_id,member_id) DO UPDATE SET role=excluded.role,allocation=excluded.allocation',uid(),u.tenantId,p.id,m,role,allocation,now())),...(p.space_id?add.map((m:string)=>stmt("INSERT OR IGNORE INTO space_members(id,tenant_id,space_id,member_id,role,added_at) VALUES(?,?,?,?,'member',?)",uid(),u.tenantId,p.space_id,m,now())):[]),...remove.map((m:string)=>stmt('DELETE FROM project_members WHERE tenant_id=? AND project_id=? AND member_id=?',u.tenantId,p.id,m)),...(p.space_id?remove.map((m:string)=>stmt('DELETE FROM space_members WHERE tenant_id=? AND space_id=? AND member_id=?',u.tenantId,p.space_id,m)):[]),auditStatement(u,'Project team changed',p.id,p.department,{removed:remove},{added:add,role})]);
   if(add.length)await notify(u,add,{kind:'project',title:`You were added to ${p.code} · ${p.name}`,link:`#/projects/${p.id}`},req);
   return {ok:true};
  }
  case 'record':{
   // Canonical plan records: phases, milestones, risks, issues, decisions, change requests, requirements,
   // stories, bugs, sprints, releases, inspections, site reports, defects, contractors, materials and more.
   need();const kind=oneOf(b.kind,RECORD_KINDS,'record type');const data=b.data&&typeof b.data==='object'?JSON.stringify(b.data).slice(0,20000):'{}';
   const v=[kind,str(b.title,'Title',200),str(b.body,'Details',20000,false),str(b.status||'Open','Status',40),oneOf(b.priority||'Medium',['Low','Medium','High','Critical'] as const,'priority'),b.ownerId?await person(b.ownerId,'Owner'):null,date(b.dueDate,'Due date'),b.parentId?idOf(b.parentId,'Parent'):null,data];
   if(b.recordId){const rid=idOf(b.recordId,'Record');const before=await first('SELECT * FROM project_records WHERE id=? AND tenant_id=? AND project_id=?',rid,u.tenantId,p.id);if(!before)throw new HttpError(404,'Record not found.');await batch([stmt('UPDATE project_records SET kind=?,title=?,body=?,status=?,priority=?,owner_id=?,due_date=?,parent_id=?,data_json=?,updated_at=? WHERE id=? AND tenant_id=?',...v,now(),rid,u.tenantId),auditStatement(u,`Project ${kind} updated`,p.id,p.department,before,{title:v[1],status:v[3]})]);return {id:rid}}
   const rid=uid();await batch([stmt('INSERT INTO project_records(kind,title,body,status,priority,owner_id,due_date,parent_id,data_json,id,tenant_id,project_id,sort,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',...v,rid,u.tenantId,p.id,Number(b.sort)||0,u.id,now(),now()),auditStatement(u,`Project ${kind} added`,p.id,p.department,null,{title:v[1]})]);return {id:rid};
  }
  case 'record-delete':{need();const rid=idOf(b.recordId,'Record');await batch([stmt('UPDATE project_records SET deleted_at=? WHERE id=? AND tenant_id=? AND project_id=?',now(),rid,u.tenantId,p.id),auditStatement(u,'Project record deleted',p.id,p.department,{record:rid},null)]);return {ok:true}}
  case 'cost':{
   need();const kind=oneOf(b.kind,['invoice','payment','expense','forecast'] as const,'cost type');
   const id=uid();await batch([stmt('INSERT INTO project_costs(id,tenant_id,project_id,kind,description,amount,currency,status,source_type,source_id,date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,p.id,kind,str(b.description,'Description',300),num(b.amount,'Amount',0,1e12),p.currency,str(b.status||'recorded','Status',30),b.sourceType?oneOf(b.sourceType,['PO','PR','vendor','file'] as const,'source'):'',b.sourceId?idOf(b.sourceId,'Source'):'',date(b.date,'Date',true),u.id,now()),auditStatement(u,`Project ${kind} recorded`,p.id,p.department,null,{amount:b.amount,description:b.description})]);await (await import('../../server/finance')).reconcileProjectCost(u.tenantId,id,u.id,`Project ${kind} recorded`);return {id};
  }
  case 'cost-delete':{need();const cid=idOf(b.costId,'Cost');await batch([stmt('DELETE FROM project_costs WHERE id=? AND tenant_id=? AND project_id=?',cid,u.tenantId,p.id),auditStatement(u,'Project cost removed',p.id,p.department,{cost:cid},null)]);await (await import('../../server/finance')).reconcileProjectCost(u.tenantId,cid,u.id,'Project cost removed');return {ok:true}}
  case 'link':case 'unlink':{
   need();const type=oneOf(b.type,['PR','PO','budget','asset'] as const,'record type');const rid=idOf(b.recordId,'Record');
   if(type==='PR'||type==='PO'){const d=await first<PurchaseRow>("SELECT d.*,(SELECT group_concat(j.value) FROM approvals a, json_each(a.approver_ids) j WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id) AS approver_ids FROM purchase_docs d WHERE d.id=? AND d.tenant_id=? AND d.kind=?",rid,u.tenantId,type);if(!d||!canSeeDoc(u,d))throw new HttpError(404,'Document not found.');await batch([stmt('UPDATE purchase_docs SET project_id=? WHERE id=? AND tenant_id=?',action==='link'?p.id:null,rid,u.tenantId),auditStatement(u,`${type} ${action==='link'?'linked to':'unlinked from'} project`,p.id,p.department,null,{number:d.number})]);await (await import('../../server/finance')).reconcileDoc(u.tenantId,rid,u.id,`${type} ${action}ed`);return {ok:true}}
   const table=type==='budget'?'budgets':'assets';if(!await first(`SELECT id FROM ${table} WHERE id=? AND tenant_id=?`,rid,u.tenantId))throw new HttpError(404,'Record not found.');
   if(type==='budget'&&!hasAction(u,'budgets')&&u.role!=='admin')throw new HttpError(403,'Budgets are not available to you.');
   await batch([stmt(`UPDATE ${table} SET project_id=? WHERE id=? AND tenant_id=?`,action==='link'?p.id:null,rid,u.tenantId),auditStatement(u,`${type} ${action==='link'?'linked to':'unlinked from'} project`,p.id,p.department,null,{id:rid})]);const fin=await import('../../server/finance');if(type==='budget')await fin.reconcileBudget(u.tenantId,rid,u.id,`Budget ${action}ed`);return {ok:true};
  }
  case 'baseline':{need();await batch([stmt('UPDATE tasks SET baseline_start=start_date,baseline_due=due_date WHERE tenant_id=? AND project_id=? AND deleted_at IS NULL',u.tenantId,p.id),auditStatement(u,'Project baseline set',p.id,p.department,null,{at:now()})]);return {ok:true}}
  case 'save-template':{
   need();const records=await all<{kind:string,title:string,body:string}>('SELECT kind,title,body FROM project_records WHERE tenant_id=? AND project_id=? AND deleted_at IS NULL',u.tenantId,p.id);
   const tasks=await all<{title:string,start_date:string|null,due_date:string|null,milestone:number,type:string}>('SELECT title,start_date,due_date,milestone,type FROM tasks WHERE tenant_id=? AND project_id=? AND deleted_at IS NULL AND parent_id IS NULL',u.tenantId,p.id);
   const base=p.start_date?Date.parse(p.start_date):Date.now();const days=(d:string|null)=>d?Math.max(0,Math.round((Date.parse(d)-base)/86400000)):0;
   const payload={records:records.map(r=>({kind:r.kind,title:r.title,body:r.body})),tasks:tasks.map(t=>({title:t.title,type:t.type,milestone:!!t.milestone,offsetDays:days(t.start_date),durationDays:t.start_date&&t.due_date?days(t.due_date)-days(t.start_date)+1:1}))};
   const id=uid();await batch([stmt('INSERT INTO project_templates(id,tenant_id,name,project_type,methodology,payload_json,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',id,u.tenantId,str(b.name||p.name,'Template name',120),p.type,p.methodology,JSON.stringify(payload),u.id,now(),now()),auditStatement(u,'Project template saved',id,p.department,null,{from:p.code})]);return {id};
  }
  case 'archive':case 'restore':{need();await batch([stmt('UPDATE projects SET archived_at=? WHERE id=? AND tenant_id=?',action==='archive'?now():null,p.id,u.tenantId),auditStatement(u,action==='archive'?'Project archived':'Project restored',p.id,p.department,null,null)]);return {ok:true}}
 }
 throw new HttpError(400,'Unknown action.');
},{module:'projects'});
