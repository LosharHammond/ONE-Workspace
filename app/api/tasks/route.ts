import {hasAction,canActOn} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,num,oneOf,idOf,date,auditStatement,parseJson,nextNumber} from '../../server/core';
import {canSeeTask,canEditTask,loadTask,taskContext,loadProject,canManageProject,loadSpace,TASK_SELECT,assigneesOf,type TaskRow} from '../../server/collab';
import {validateAcl,defaultAcl} from '../../server/acl';
import {enqueueStatement,kick} from '../../server/jobs';
import {notify} from '../../server/notify';
import type {Member} from '../../server/policy';

// Unified tasks: personal, department, project, space, ticket and purchasing tasks, with subtasks, checklists,
// dependencies, assignees and watchers, time tracking, approvals, recurrence and reminders. Visibility is
// decided by canSeeTask (owner/assignee/watcher, project team, space members, department scope or audience).
const STATUSES=['To do','In progress','Blocked','In review','Done','Cancelled'] as const;
const TYPES=['task','milestone','deliverable','requirement','epic','feature','story','bug','test','checklist','approval','inspection','meeting'] as const;
const PRIORITIES=['Low','Medium','High','Critical'] as const;
async function visibleTasks(u:Member,where:string,binds:unknown[],limit=2000){
 const rows=await all<TaskRow>(`SELECT ${TASK_SELECT} FROM tasks t WHERE t.tenant_id=? AND t.deleted_at IS NULL ${where} ORDER BY t.due_date IS NULL,t.due_date,t.sort LIMIT ${limit}`,u.tenantId,...binds);
 const ctx=await taskContext(u,rows);return rows.filter(t=>canSeeTask(u,t,ctx.projects,ctx.spaces));
}
const nextDue=(d:string,rule:string)=>{const x=new Date(d+'T00:00:00Z');if(rule==='daily')x.setUTCDate(x.getUTCDate()+1);else if(rule==='weekdays'){do{x.setUTCDate(x.getUTCDate()+1)}while([0,6].includes(x.getUTCDay()))}else if(rule==='weekly')x.setUTCDate(x.getUTCDate()+7);else if(rule==='monthly')x.setUTCMonth(x.getUTCMonth()+1);else return null;return x.toISOString().slice(0,10)};

export const GET=route(async(req,u)=>{
 const url=new URL(req.url);const q=(k:string)=>url.searchParams.get(k);
 if(q('id')){
  const {task:t,project}=await loadTask(u,idOf(q('id'),'Task'));
  const [checklist,deps,blocking,subtasks,comments,files,time,activity]=await Promise.all([
   all('SELECT id,title,done,sort FROM task_checklist WHERE tenant_id=? AND task_id=? ORDER BY sort,rowid',u.tenantId,t.id),
   all("SELECT d.depends_on AS id,d.kind,x.title,x.status FROM task_deps d JOIN tasks x ON x.id=d.depends_on AND x.tenant_id=d.tenant_id WHERE d.tenant_id=? AND d.task_id=?",u.tenantId,t.id),
   all("SELECT d.task_id AS id,x.title,x.status FROM task_deps d JOIN tasks x ON x.id=d.task_id AND x.tenant_id=d.tenant_id WHERE d.tenant_id=? AND d.depends_on=?",u.tenantId,t.id),
   visibleTasks(u,'AND t.parent_id=?',[t.id],200),
   all("SELECT id,author_id AS authorId,body,created_at AS createdAt FROM comments WHERE tenant_id=? AND entity_type='task' AND entity_id=? ORDER BY created_at",u.tenantId,t.id),
   all("SELECT f.id,f.name,f.mime,f.bytes FROM file_links l JOIN files f ON f.id=l.file_id AND f.tenant_id=l.tenant_id WHERE l.tenant_id=? AND l.entity_type='task' AND l.entity_id=? AND f.deleted_at IS NULL",u.tenantId,t.id),
   all('SELECT e.id,e.minutes,e.date,e.note,m.name AS who FROM time_entries e LEFT JOIN members m ON m.id=e.member_id WHERE e.tenant_id=? AND e.task_id=? ORDER BY e.date DESC',u.tenantId,t.id),
   all('SELECT a.action,a.created_at AS createdAt,m.name AS who FROM audit a LEFT JOIN members m ON m.id=a.actor WHERE a.tenant_id=? AND a.record_id=? ORDER BY a.created_at DESC LIMIT 60',u.tenantId,t.id),
  ]);
  return {task:{...t,assignees:assigneesOf(t),watchers:(t.watchers||'').split(',').filter(Boolean),custom:parseJson(t.custom_json,{})},project:project?{id:project.id,code:project.code,name:project.name}:null,checklist,deps,blocking,subtasks,comments,files,time,activity,canEdit:canEditTask(u,t,project)};
 }
 const view=q('view')||'mine';const today=now().slice(0,10);
 if(view==='templates')return {templates:(await all<{id:string,name:string,owner_id:string,shared:number,payload_json:string,updated_at:string}>('SELECT * FROM task_templates WHERE tenant_id=? AND (owner_id=? OR shared=1) ORDER BY name',u.tenantId,u.id)).map(t=>({id:t.id,name:t.name,ownerId:t.owner_id,shared:!!t.shared,payload:parseJson(t.payload_json,{}),updatedAt:t.updated_at}))};
 if(view==='workload'){
  const rows=await visibleTasks(u,"AND t.status NOT IN ('Done','Cancelled')",[],5000);
  const load=new Map<string,{open:number,estimateMin:number,overdue:number}>();
  for(const t of rows)for(const m of (assigneesOf(t).length?assigneesOf(t):[t.owner_id])){const x=load.get(m)||{open:0,estimateMin:0,overdue:0};x.open++;x.estimateMin+=t.estimate_min;if(t.due_date&&t.due_date<today)x.overdue++;load.set(m,x)}
  return {workload:[...load.entries()].map(([id,x])=>({memberId:id,...x})).sort((a,b)=>b.open-a.open)};
 }
 const filters:string[]=[];const binds:unknown[]=[];
 if(q('project')){await loadProject(u,idOf(q('project'),'Project'));filters.push('AND t.project_id=?');binds.push(q('project'))}
 if(q('space')){const s=await loadSpace(u,idOf(q('space'),'Space'));filters.push('AND t.space_id=?');binds.push(s.id)}
 let rows=await visibleTasks(u,filters.join(' '),binds);
 const mine=(t:TaskRow)=>t.owner_id===u.id||assigneesOf(t).includes(u.id);
 if(view==='mine')rows=rows.filter(mine);
 if(view==='assigned-by-me')rows=rows.filter(t=>t.created_by===u.id&&assigneesOf(t).some(a=>a!==u.id));
 if(view==='department')rows=rows.filter(t=>t.department.toLowerCase()===u.department.toLowerCase());
 if(view==='overdue')rows=rows.filter(t=>t.due_date&&t.due_date<today&&!['Done','Cancelled'].includes(t.status));
 if(q('status'))rows=rows.filter(t=>t.status===q('status'));
 if(q('q')){const s=q('q')!.toLowerCase();rows=rows.filter(t=>t.title.toLowerCase().includes(s)||t.tags.toLowerCase().includes(s))}
 const checks=rows.length?await all<{task_id:string,n:number,d:number}>(`SELECT task_id,count(*) AS n,sum(done) AS d FROM task_checklist WHERE tenant_id=? AND task_id IN (${rows.slice(0,900).map(()=>'?').join(',')}) GROUP BY task_id`,u.tenantId,...rows.slice(0,900).map(t=>t.id)):[];
 const byTask=new Map(checks.map(c=>[c.task_id,c]));
 return {tasks:rows.map(t=>({...t,assignees:assigneesOf(t),watchers:(t.watchers||'').split(',').filter(Boolean),checklist:byTask.get(t.id)?{total:byTask.get(t.id)!.n,done:byTask.get(t.id)!.d}:null})),statuses:STATUSES,canCreate:hasAction(u,'tasks','create')};
},{module:'tasks'});

export const POST=route(async(req,u)=>{
 const b=await readBody(req,300000);const action=String(b.action||'');
 const people=async(v:unknown)=>{const ids=Array.isArray(v)?[...new Set(v.map(x=>idOf(x,'Person')))].slice(0,50):[];if(ids.length){const ok=new Set((await all<{id:string}>(`SELECT id FROM members WHERE tenant_id=? AND active=1 AND id IN (${ids.map(()=>'?').join(',')})`,u.tenantId,...ids)).map(r=>r.id));if(ids.some(i=>!ok.has(i)))throw new HttpError(400,'Assignees must be active people in this company.')}return ids};
 // Assigning work to other people needs assign rights (department scope), or project management rights.
 const mayAssign=(dept:string,project:Parameters<typeof canManageProject>[1]|null,ids:string[])=>ids.every(i=>i===u.id)||u.role==='admin'||(project&&canManageProject(u,project))||canActOn(u,'tasks','assign',dept,u.id)||(!!project&&u.projectIds?.includes(project.id));
 if(action==='save'){
  const cur=b.id?await loadTask(u,idOf(b.id,'Task')):null;
  if(cur&&!canEditTask(u,cur.task,cur.project))throw new HttpError(403,'You cannot edit this task.');
  if(!cur&&!hasAction(u,'tasks','create'))throw new HttpError(403,'Creating tasks is not available to you.');
  const project=b.projectId!==undefined?(b.projectId?await loadProject(u,idOf(b.projectId,'Project')):null):cur?.project||null;
  if(project&&!cur&&!canManageProject(u,project)&&!u.projectIds?.includes(project.id))throw new HttpError(403,'Only the project team adds tasks to this project.');
  const space=b.spaceId?await loadSpace(u,idOf(b.spaceId,'Space')):null;
  const parent=b.parentId?(await loadTask(u,idOf(b.parentId,'Parent task'))).task:null;
  const t=cur?.task;
  const v={title:str(b.title??t?.title,'Title',200),description:str(b.description??t?.description,'Description',20000,false),type:oneOf(b.type??t?.type??'task',TYPES,'task type'),status:oneOf(b.status??t?.status??'To do',STATUSES,'status'),priority:oneOf(b.priority??t?.priority??'Medium',PRIORITIES,'priority'),department:str(b.department??t?.department??project?.department??u.department,'Department',160,false),startDate:b.startDate!==undefined?date(b.startDate,'Start date'):t?.start_date??null,dueDate:b.dueDate!==undefined?date(b.dueDate,'Due date'):t?.due_date??null,estimateMin:b.estimateMin!==undefined?Math.round(num(b.estimateMin||0,'Estimate',0,1e6)):t?.estimate_min??0,progress:b.progress!==undefined?Math.round(num(b.progress,'Progress',0,100)):t?.progress??0,milestone:b.milestone!==undefined?(b.milestone?1:0):t?.milestone??0,tags:str(b.tags??t?.tags,'Tags',300,false),recurrence:oneOf(b.recurrence??t?.recurrence??'',['','daily','weekdays','weekly','monthly'] as const,'recurrence'),reminderAt:b.reminderAt!==undefined?(b.reminderAt?new Date(String(b.reminderAt)).toISOString():null):t?.reminder_at??null,phaseId:b.phaseId!==undefined?(b.phaseId?idOf(b.phaseId,'Phase'):null):t?.phase_id??null,sprintId:b.sprintId!==undefined?(b.sprintId?idOf(b.sprintId,'Sprint'):null):t?.sprint_id??null,custom:b.custom&&typeof b.custom==='object'?Object.fromEntries(Object.entries(b.custom as Record<string,unknown>).slice(0,30).map(([k,x])=>[k.slice(0,40),str(x,'Custom field',300,false)])):parseJson(t?.custom_json,{})};
  if(v.startDate&&v.dueDate&&v.dueDate<v.startDate)throw new HttpError(400,'The due date must be on or after the start date.');
  const assignees=b.assignees!==undefined?await people(b.assignees):cur?assigneesOf(cur.task):[u.id];
  const watchers=b.watchers!==undefined?await people(b.watchers):(cur?.task.watchers||'').split(',').filter(Boolean);
  if(!mayAssign(v.department,project,assignees.filter(a=>!cur||!assigneesOf(cur.task).includes(a))))throw new HttpError(403,'Assigning tasks to other people is not part of your role.');
  const {acl}=b.acl?await validateAcl(u,b.acl):{acl:t?.acl_json?JSON.parse(t.acl_json):project||space?null:defaultAcl(u)};
  const id=cur?.task.id||uid();const ts=now();const done=v.status==='Done';
  const people_=[...assignees.map(m=>['assignee',m]),...watchers.map(m=>['watcher',m])];
  const s=[
   cur?stmt('UPDATE tasks SET title=?,description=?,type=?,status=?,priority=?,department=?,project_id=?,space_id=coalesce(?,space_id),parent_id=coalesce(?,parent_id),start_date=?,due_date=?,estimate_min=?,progress=?,milestone=?,tags=?,recurrence=?,reminder_at=?,phase_id=?,sprint_id=?,custom_json=?,acl_json=?,completed_at=CASE WHEN ? THEN coalesce(completed_at,?) ELSE NULL END,updated_at=?,updated_by=? WHERE id=? AND tenant_id=?',v.title,v.description,v.type,v.status,v.priority,v.department,project?.id||null,space?.id||null,parent?.id||null,v.startDate,v.dueDate,v.estimateMin,done?100:v.progress,v.milestone,v.tags,v.recurrence,v.reminderAt,v.phaseId,v.sprintId,JSON.stringify(v.custom),acl?JSON.stringify(acl):null,done?1:0,ts,ts,u.name,id,u.tenantId)
   :stmt('INSERT INTO tasks(id,tenant_id,number,title,description,type,status,priority,owner_id,department,project_id,space_id,parent_id,milestone,start_date,due_date,estimate_min,progress,tags,custom_json,acl_json,recurrence,reminder_at,phase_id,sprint_id,source_type,source_id,completed_at,created_by,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,await nextNumber(u.tenantId,'TSK',true,['tasks','number']),v.title,v.description,v.type,v.status,v.priority,u.id,v.department,project?.id||null,space?.id||project?.space_id||null,parent?.id||null,v.milestone,v.startDate,v.dueDate,v.estimateMin,done?100:v.progress,v.tags,JSON.stringify(v.custom),acl?JSON.stringify(acl):null,v.recurrence,v.reminderAt,v.phaseId,v.sprintId,b.sourceType?oneOf(b.sourceType,['ticket','PR','PO','message','file','email','ai'] as const,'source'):'',b.sourceId?String(b.sourceId).slice(0,120):'',done?ts:null,u.id,ts,ts,u.name),
   stmt('DELETE FROM task_assignees WHERE tenant_id=? AND task_id=?',u.tenantId,id),
   ...people_.map(([kind,m])=>stmt('INSERT OR IGNORE INTO task_assignees(id,tenant_id,task_id,member_id,kind) VALUES(?,?,?,?,?)',uid(),u.tenantId,id,m,kind)),
   auditStatement(u,cur?'Task updated':'Task created',id,v.department,cur?{title:t!.title,status:t!.status,due:t!.due_date,assignees:assigneesOf(t!)}:null,{title:v.title,status:v.status,due:v.dueDate,assignees}),
   ...(v.reminderAt&&v.reminderAt!==t?.reminder_at?[enqueueStatement(u.tenantId,'task.remind',id,{},{key:`remind:${id}:${v.reminderAt}`,delaySec:Math.max(0,Math.ceil((Date.parse(v.reminderAt)-Date.now())/1000))})]:[]),
  ];
  // Checklist items can be sent with a new task.
  if(!cur&&Array.isArray(b.checklist))b.checklist.slice(0,100).forEach((c:unknown,i:number)=>s.push(stmt('INSERT INTO task_checklist(id,tenant_id,task_id,title,sort) VALUES(?,?,?,?,?)',uid(),u.tenantId,id,str(c,'Checklist item',300),i)));
  await batch(s);
  const newly=assignees.filter(a=>a!==u.id&&(!cur||!assigneesOf(cur.task).includes(a)));
  if(newly.length)await notify(u,newly,{kind:'task',title:`${u.name} assigned you “${v.title}”`,body:v.dueDate?`Due ${v.dueDate}`:'',link:`#/tasks/all/${id}`},req);
  if(cur&&done&&cur.task.status!=='Done')await afterComplete(u,cur.task,req);
  if(v.reminderAt)kick();
  return {id};
 }
 if(action==='bulk'){
  const ids=(Array.isArray(b.ids)?b.ids:[]).map(x=>idOf(x,'Task')).slice(0,200);const op=oneOf(b.op,['status','priority','due','assign','delete'] as const,'bulk operation');
  const results:{id:string,ok:boolean,error?:string}[]=[];
  for(const id of ids){try{const {task:t,project}=await loadTask(u,id);if(!canEditTask(u,t,project))throw new HttpError(403,'You cannot edit this task.');
   if(op==='status'){const st=oneOf(b.value,STATUSES,'status');await batch([stmt('UPDATE tasks SET status=?,completed_at=CASE WHEN ?=\'Done\' THEN coalesce(completed_at,?) ELSE NULL END,progress=CASE WHEN ?=\'Done\' THEN 100 ELSE progress END,updated_at=? WHERE id=? AND tenant_id=?',st,st,now(),st,now(),id,u.tenantId),auditStatement(u,'Task status changed',id,t.department,{status:t.status},{status:st})]);if(st==='Done'&&t.status!=='Done')await afterComplete(u,t,req)}
   if(op==='priority')await batch([stmt('UPDATE tasks SET priority=?,updated_at=? WHERE id=? AND tenant_id=?',oneOf(b.value,PRIORITIES,'priority'),now(),id,u.tenantId),auditStatement(u,'Task priority changed',id,t.department,{priority:t.priority},{priority:b.value})]);
   if(op==='due')await batch([stmt('UPDATE tasks SET due_date=?,updated_at=? WHERE id=? AND tenant_id=?',date(b.value,'Due date'),now(),id,u.tenantId),auditStatement(u,'Task due date changed',id,t.department,{due:t.due_date},{due:b.value})]);
   if(op==='assign'){const [m]=await people([b.value]);if(!mayAssign(t.department,project,[m]))throw new HttpError(403,'Assigning tasks to other people is not part of your role.');await batch([stmt("DELETE FROM task_assignees WHERE tenant_id=? AND task_id=? AND kind='assignee'",u.tenantId,id),stmt("INSERT INTO task_assignees(id,tenant_id,task_id,member_id,kind) VALUES(?,?,?,?,'assignee')",uid(),u.tenantId,id,m),auditStatement(u,'Task reassigned',id,t.department,{assignees:assigneesOf(t)},{assignees:[m]})]);if(m!==u.id)await notify(u,[m],{kind:'task',title:`${u.name} assigned you “${t.title}”`,link:`#/tasks/all/${id}`},req)}
   if(op==='delete')await batch([stmt('UPDATE tasks SET deleted_at=? WHERE id=? AND tenant_id=?',now(),id,u.tenantId),auditStatement(u,'Task deleted',id,t.department,{title:t.title},null)]);
   results.push({id,ok:true})}catch(e){results.push({id,ok:false,error:e instanceof HttpError?e.message:'Failed'})}}
  return {results};
 }
 // Templates: a task's reusable parts (never its assignees or dates). Shared templates need task-management rights.
 if(action==='template-save'){
  if(!hasAction(u,'tasks','create'))throw new HttpError(403,'Creating tasks is not available to you.');
  const p=(b.payload&&typeof b.payload==='object'?b.payload:{}) as Record<string,unknown>;
  const payload={title:str(p.title,'Title',200),description:str(p.description,'Description',8000,false),type:oneOf(p.type||'task',TYPES,'task type'),priority:oneOf(p.priority||'Medium',PRIORITIES,'priority'),estimateMin:Math.round(num(p.estimateMin||0,'Estimate',0,1e6)),recurrence:oneOf(p.recurrence||'',['','daily','weekdays','weekly','monthly'] as const,'recurrence'),tags:str(p.tags,'Tags',300,false),checklist:(Array.isArray(p.checklist)?p.checklist:[]).slice(0,100).map(x=>str(x,'Checklist item',300))};
  const shared=!!b.shared;if(shared&&u.role!=='admin'&&!hasAction(u,'tasks','assign'))throw new HttpError(403,'Only people who manage tasks can share templates.');
  const id=uid();await batch([stmt('INSERT INTO task_templates(id,tenant_id,name,owner_id,shared,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',id,u.tenantId,str(b.name,'Template name',120),u.id,shared?1:0,JSON.stringify(payload),now(),now()),auditStatement(u,'Task template saved',id,u.department,null,{name:b.name,shared})]);return {id};
 }
 if(action==='template-delete'){const id=idOf(b.id,'Template');const t=await first<{owner_id:string}>('SELECT owner_id FROM task_templates WHERE id=? AND tenant_id=?',id,u.tenantId);if(!t)throw new HttpError(404,'Template not found.');if(t.owner_id!==u.id&&u.role!=='admin')throw new HttpError(403,'Only the owner deletes this template.');await batch([stmt('DELETE FROM task_templates WHERE id=? AND tenant_id=?',id,u.tenantId),auditStatement(u,'Task template deleted',id,u.department,null,null)]);return {ok:true}}
 if(action==='import'){
  if(!hasAction(u,'tasks','create'))throw new HttpError(403,'Creating tasks is not available to you.');
  const project=b.projectId?await loadProject(u,idOf(b.projectId,'Project')):null;if(project&&!canManageProject(u,project))throw new HttpError(403,'Only project managers import into a project.');
  const rows=Array.isArray(b.rows)?b.rows.slice(0,1000):[];const errors:{row:number,reason:string}[]=[];const ok:{title:string,due:string|null,start:string|null,priority:string,status:string,description:string}[]=[];
  rows.forEach((r:any,i:number)=>{const title=String(r.title||r.Title||'').trim();if(!title){errors.push({row:i+1,reason:'Title is required'});return}const d=(x:unknown)=>{const s=String(x||'').trim();return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:null};const pr=PRIORITIES.find(p=>p.toLowerCase()===String(r.priority||'Medium').toLowerCase())||'Medium';const st=STATUSES.find(p=>p.toLowerCase()===String(r.status||'To do').toLowerCase())||'To do';ok.push({title:title.slice(0,200),due:d(r.due||r.dueDate),start:d(r.start||r.startDate),priority:pr,status:st,description:String(r.description||'').slice(0,4000)})});
  if(b.preview)return {preview:true,create:ok.length,errors};
  const ts=now();const s=[];for(const r of ok)s.push(stmt('INSERT INTO tasks(id,tenant_id,title,description,status,priority,owner_id,department,project_id,space_id,start_date,due_date,created_by,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,r.title,r.description,r.status,r.priority,u.id,project?.department||u.department,project?.id||null,project?.space_id||null,r.start,r.due,u.id,ts,ts,u.name));
  s.push(auditStatement(u,'Tasks imported',project?.id||u.tenantId,u.department,null,{created:ok.length,errors:errors.length}));
  for(let i=0;i<s.length;i+=80)await batch(s.slice(i,i+80));return {created:ok.length,errors};
 }
 const {task:t,project}=await loadTask(u,idOf(b.id,'Task'));
 const edit=canEditTask(u,t,project);const need=()=>{if(!edit)throw new HttpError(403,'You cannot change this task.')};
 switch(action){
  case 'status':{need();const st=oneOf(b.status,STATUSES,'status');
   // Blocked by unfinished dependencies: moving to Done is refused.
   if(st==='Done'){const open=await first<{n:number}>("SELECT count(*) AS n FROM task_deps d JOIN tasks x ON x.id=d.depends_on AND x.tenant_id=d.tenant_id WHERE d.tenant_id=? AND d.task_id=? AND x.status NOT IN ('Done','Cancelled') AND x.deleted_at IS NULL",u.tenantId,t.id);if(open?.n)throw new HttpError(409,`${open.n} task(s) this depends on are not finished yet.`)}
   await batch([stmt("UPDATE tasks SET status=?,completed_at=CASE WHEN ?='Done' THEN coalesce(completed_at,?) ELSE NULL END,progress=CASE WHEN ?='Done' THEN 100 ELSE progress END,sort=coalesce(?,sort),updated_at=?,updated_by=? WHERE id=? AND tenant_id=?",st,st,now(),st,b.sort===undefined?null:Number(b.sort),now(),u.name,t.id,u.tenantId),auditStatement(u,'Task status changed',t.id,t.department,{status:t.status},{status:st})]);
   if(st==='Done'&&t.status!=='Done')await afterComplete(u,t,req);return {ok:true};
  }
  case 'checklist':{need();const op=oneOf(b.op,['add','toggle','delete','rename'] as const,'checklist action');
   if(op==='add'){const id=uid();await stmt('INSERT INTO task_checklist(id,tenant_id,task_id,title,sort) VALUES(?,?,?,?,?)',id,u.tenantId,t.id,str(b.title,'Checklist item',300),Number(b.sort)||Date.now()%100000).run();return {id}}
   const cid=idOf(b.itemId,'Checklist item');
   if(op==='toggle')await stmt('UPDATE task_checklist SET done=1-done WHERE id=? AND tenant_id=? AND task_id=?',cid,u.tenantId,t.id).run();
   if(op==='rename')await stmt('UPDATE task_checklist SET title=? WHERE id=? AND tenant_id=? AND task_id=?',str(b.title,'Checklist item',300),cid,u.tenantId,t.id).run();
   if(op==='delete')await stmt('DELETE FROM task_checklist WHERE id=? AND tenant_id=? AND task_id=?',cid,u.tenantId,t.id).run();
   return {ok:true};
  }
  case 'dependency':{need();const other=idOf(b.dependsOn,'Task');if(other===t.id)throw new HttpError(400,'A task cannot depend on itself.');await loadTask(u,other);
   if(b.remove){await batch([stmt('DELETE FROM task_deps WHERE tenant_id=? AND task_id=? AND depends_on=?',u.tenantId,t.id,other),auditStatement(u,'Dependency removed',t.id,t.department,{dependsOn:other},null)]);return {ok:true}}
   // Refuse cycles: walk what `other` depends on.
   const seen=new Set<string>();const stack=[other];while(stack.length){const x=stack.pop()!;if(x===t.id)throw new HttpError(400,'That would create a dependency loop.');if(seen.has(x))continue;seen.add(x);stack.push(...(await all<{depends_on:string}>('SELECT depends_on FROM task_deps WHERE tenant_id=? AND task_id=?',u.tenantId,x)).map(r=>r.depends_on))}
   await batch([stmt('INSERT OR IGNORE INTO task_deps(id,tenant_id,task_id,depends_on,kind) VALUES(?,?,?,?,?)',uid(),u.tenantId,t.id,other,oneOf(b.kind||'finish-start',['finish-start','start-start','finish-finish'] as const,'dependency type')),auditStatement(u,'Dependency added',t.id,t.department,null,{dependsOn:other})]);return {ok:true};
  }
  case 'watch':{await stmt(b.on===false?"DELETE FROM task_assignees WHERE tenant_id=? AND task_id=? AND member_id=? AND kind='watcher'":"INSERT OR IGNORE INTO task_assignees(tenant_id,task_id,member_id,kind,id) VALUES(?,?,?,'watcher',?)",...(b.on===false?[u.tenantId,t.id,u.id]:[u.tenantId,t.id,u.id,uid()])).run();return {ok:true}}
  case 'time':{
   if(!edit&&!assigneesOf(t).includes(u.id))throw new HttpError(403,'Only people working on the task log time.');
   const minutes=Math.round(num(b.minutes,'Minutes',1,24*60));const rate=b.rate!==undefined?num(b.rate,'Hourly rate',0,1e6):0;
   await batch([stmt('INSERT INTO time_entries(id,tenant_id,task_id,project_id,member_id,minutes,date,note,rate,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,t.id,t.project_id,u.id,minutes,date(b.date,'Date')||now().slice(0,10),str(b.note,'Note',300,false),rate,now()),stmt('UPDATE tasks SET actual_min=actual_min+?,updated_at=? WHERE id=? AND tenant_id=?',minutes,now(),t.id,u.tenantId),auditStatement(u,'Time logged',t.id,t.department,null,{minutes})]);return {ok:true};
  }
  case 'request-approval':{need();const approver=idOf(b.approverId,'Approver');if(!await first('SELECT id FROM members WHERE id=? AND tenant_id=? AND active=1',approver,u.tenantId))throw new HttpError(400,'Choose an active approver.');await batch([stmt("UPDATE tasks SET approval_status='pending',approver_id=?,updated_at=? WHERE id=? AND tenant_id=?",approver,now(),t.id,u.tenantId),auditStatement(u,'Task approval requested',t.id,t.department,null,{approver})]);await notify(u,[approver],{kind:'approval',title:`${u.name} asks you to approve “${t.title}”`,link:`#/tasks/all/${t.id}`},req);return {ok:true}}
  case 'decide':{if(t.approver_id!==u.id&&u.role!=='admin')throw new HttpError(403,'You are not the approver of this task.');const approve=b.approve===true;await batch([stmt('UPDATE tasks SET approval_status=?,updated_at=? WHERE id=? AND tenant_id=?',approve?'approved':'rejected',now(),t.id,u.tenantId),auditStatement(u,approve?'Task approved':'Task rejected',t.id,t.department,null,{note:str(b.note,'Note',300,false)})]);await notify(u,[t.owner_id,...assigneesOf(t)],{kind:'approval',title:`“${t.title}” was ${approve?'approved':'rejected'}`,link:`#/tasks/all/${t.id}`},req);return {ok:true}}
  case 'delete':case 'restore':{need();await batch([stmt('UPDATE tasks SET deleted_at=? WHERE id=? AND tenant_id=?',action==='delete'?now():null,t.id,u.tenantId),auditStatement(u,action==='delete'?'Task deleted':'Task restored',t.id,t.department,{title:t.title},null)]);return {ok:true}}
 }
 throw new HttpError(400,'Unknown action.');
},{module:'tasks'});

// Completing a recurring task schedules the next one; watchers and the owner are told.
async function afterComplete(u:Member,t:TaskRow,req:Request){
 if(t.recurrence&&t.due_date){const due=nextDue(t.due_date,t.recurrence);if(due){const id=uid();const shift=t.start_date?Math.round((Date.parse(due)-Date.parse(t.due_date))/86400000):0;const start=t.start_date?new Date(Date.parse(t.start_date)+shift*86400000).toISOString().slice(0,10):null;
  await batch([stmt('INSERT INTO tasks(id,tenant_id,title,description,type,status,priority,owner_id,department,project_id,space_id,parent_id,start_date,due_date,estimate_min,tags,custom_json,acl_json,recurrence,created_by,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,t.title,t.description,t.type,'To do',t.priority,t.owner_id,t.department,t.project_id,t.space_id,t.parent_id,start,due,t.estimate_min,t.tags,t.custom_json,t.acl_json,t.recurrence,u.id,now(),now(),u.name),stmt("INSERT INTO task_assignees(id,tenant_id,task_id,member_id,kind) SELECT lower(hex(randomblob(16))),tenant_id,?,member_id,kind FROM task_assignees WHERE tenant_id=? AND task_id=?",id,u.tenantId,t.id),auditStatement(u,'Recurring task scheduled',id,t.department,null,{from:t.id,due})])}}
 const watchers=(t.watchers||'').split(',').filter(Boolean);
 if(watchers.length||t.owner_id!==u.id)await notify(u,[...watchers,t.owner_id].filter(x=>x!==u.id),{kind:'task',title:`“${t.title}” was completed`,link:`#/tasks/all/${t.id}`},req);
}
