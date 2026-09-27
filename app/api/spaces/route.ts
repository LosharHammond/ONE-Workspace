import {hasAction} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,oneOf,idOf,auditStatement} from '../../server/core';
import {ensureSpaces,canSeeSpace,canManageSpace,loadSpace,isSpaceMember,canSeeTask,taskContext,canSeeProject,TASK_SELECT,type SpaceRow,type TaskRow,type ProjectRow} from '../../server/collab';
import {canSeeFile,canSeePage,type FileRow,type PageRow} from '../../server/entities';
import type {Member} from '../../server/policy';

// Spaces are collaboration hubs: company, department, project and custom spaces with announcements, files,
// pages, projects, tasks, messages, members, calendar and activity. Each tab reuses the module that owns the
// data (Files, Pages, Projects, Tasks, Messaging), filtered with the same access rules.
const inSpace=(s:SpaceRow,row:{space_id?:string|null,department?:string})=>row.space_id===s.id||(!row.space_id&&(s.kind==='company'?!row.department:s.kind==='department'&&(row.department||'').toLowerCase()===s.department.toLowerCase()));
async function hub(u:Member,s:SpaceRow){
 const [pagesRaw,filesRaw,tasksRaw,projectsRaw,members,channel]=await Promise.all([
  all<PageRow>('SELECT * FROM pages WHERE tenant_id=? AND deleted_at IS NULL ORDER BY pinned DESC,updated_at DESC LIMIT 1500',u.tenantId),
  all<FileRow&{space_id:string|null}>('SELECT * FROM files WHERE tenant_id=? AND deleted_at IS NULL AND entity_type IS NULL ORDER BY pinned DESC,updated_at DESC LIMIT 2000',u.tenantId),
  all<TaskRow>(`SELECT ${TASK_SELECT} FROM tasks t WHERE t.tenant_id=? AND t.deleted_at IS NULL AND (t.space_id=? OR t.project_id=?) ORDER BY t.due_date LIMIT 500`,u.tenantId,s.id,s.project_id||''),
  all<ProjectRow>('SELECT * FROM projects WHERE tenant_id=? AND archived_at IS NULL AND (space_id=? OR (?=\'department\' AND lower(department)=lower(?)))',u.tenantId,s.id,s.kind,s.department),
  s.kind==='company'?[]:all('SELECT m.id,m.name,m.title,m.department,sm.role FROM space_members sm JOIN members m ON m.id=sm.member_id AND m.tenant_id=sm.tenant_id WHERE sm.tenant_id=? AND sm.space_id=? ORDER BY sm.role DESC,m.name',u.tenantId,s.id),
  first<{id:string}>("SELECT id FROM channels WHERE tenant_id=? AND kind=? AND ref_id=? AND archived_at IS NULL",u.tenantId,s.kind==='department'?'department':s.kind==='company'?'company':s.kind==='project'?'project':'space',s.kind==='department'?s.department:s.kind==='company'?'':s.kind==='project'?s.project_id||'':s.id),
 ]);
 const pages=pagesRaw.filter(p=>canSeePage(u,p)&&inSpace(s,p));
 const files=filesRaw.filter(f=>canSeeFile(u,f)&&(f.space_id===s.id||(!f.space_id&&s.kind==='department'&&f.department.toLowerCase()===s.department.toLowerCase())));
 const ctx=await taskContext(u,tasksRaw);const tasks=tasksRaw.filter(t=>canSeeTask(u,t,ctx.projects,ctx.spaces));
 const projects=projectsRaw.filter(p=>canSeeProject(u,p));
 const deptMembers=s.kind==='department'?await all('SELECT id,name,title,department FROM members WHERE tenant_id=? AND active=1 AND lower(department)=lower(?) ORDER BY name',u.tenantId,s.department):[];
 const strip=({body,...p}:PageRow)=>({...p,excerpt:body.replace(/[#*_>`[\]()-]/g,'').slice(0,200)});
 const today=now().slice(0,10);
 const calendar=[
  ...tasks.filter(t=>t.due_date).map(t=>({date:t.due_date!,type:t.milestone?'Milestone':'Task',title:t.title,link:`#/tasks/all/${t.id}`,overdue:t.due_date!<today&&!['Done','Cancelled'].includes(t.status)})),
  ...pages.filter(p=>p.kind==='announcement'&&(p.publish_at||p.expires_at)).flatMap(p=>[...(p.publish_at?[{date:p.publish_at.slice(0,10),type:'Announcement',title:`Publishes: ${p.title}`,link:`#/spaces/page/${p.id}`,overdue:false}]:[]),...(p.expires_at?[{date:p.expires_at.slice(0,10),type:'Announcement',title:`Expires: ${p.title}`,link:`#/spaces/page/${p.id}`,overdue:false}]:[])]),
  ...projects.filter(p=>p.target_date).map(p=>({date:p.target_date!,type:'Project',title:`${p.code} target date`,link:`#/projects/${p.id}`,overdue:p.target_date!<today&&!p.actual_end})),
 ].sort((a,b)=>a.date.localeCompare(b.date));
 // Activity: the latest changes to things in this space that the viewer can see.
 const activity=[
  ...pages.map(p=>({at:p.updated_at,type:p.kind==='announcement'?'Announcement':'Page',title:p.title,link:`#/spaces/page/${p.id}`})),
  ...files.map(f=>({at:f.updated_at,type:'File',title:f.name,link:`#/files/root/${f.id}`})),
  ...tasks.map(t=>({at:t.updated_at,type:'Task',title:`${t.title} · ${t.status}`,link:`#/tasks/all/${t.id}`})),
  ...projects.map(p=>({at:p.updated_at,type:'Project',title:`${p.code} · ${p.name}`,link:`#/projects/${p.id}`})),
 ].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,60);
 return {space:s,canManage:canManageSpace(u,s),isMember:isSpaceMember(u,s),
  announcements:pages.filter(p=>p.kind==='announcement').map(strip),pages:pages.filter(p=>p.kind!=='announcement').map(strip),
  files:files.map(({file_key,...f})=>{void file_key;return f}),tasks:tasks.map(t=>({...t,assignees:(t.assignees||'').split(',').filter(Boolean)})),projects:projects.map(p=>({id:p.id,code:p.code,name:p.name,stage:p.stage,health:p.health,progress:p.progress,target:p.target_date})),
  members:s.kind==='department'?[...deptMembers,...(members as {id:string}[]).filter(m=>!(deptMembers as {id:string}[]).some(d=>d.id===m.id))]:members,channelId:channel?.id||null,calendar,activity};
}
export const GET=route(async(req,u)=>{
 if(!hasAction(u,'knowledge'))throw new HttpError(403,'Spaces are not available to your account.');
 await ensureSpaces(u);
 const id=new URL(req.url).searchParams.get('id');
 if(id)return hub(u,await loadSpace(u,idOf(id,'Space')));
 const rows=await all<SpaceRow&{members:number}>("SELECT s.*,(SELECT count(*) FROM space_members sm WHERE sm.space_id=s.id AND sm.tenant_id=s.tenant_id) AS members FROM spaces s WHERE s.tenant_id=? ORDER BY s.kind='company' DESC,s.kind,s.name",u.tenantId);
 return {spaces:rows.filter(s=>canSeeSpace(u,s)||(u.role==='admin'&&s.status==='archived')).map(s=>({...s,isMember:isSpaceMember(u,s)})),canCreate:hasAction(u,'knowledge','create')};
},{module:'spaces'});
export const POST=route(async(req,u)=>{
 const b=await readBody(req);const action=String(b.action||'');
 if(action==='create'){
  if(!hasAction(u,'knowledge','create'))throw new HttpError(403,'Creating spaces is not part of your role.');
  const id=uid(),ts=now();const name=str(b.name,'Space name',80);const members=(Array.isArray(b.members)?b.members:[]).map((x:unknown)=>idOf(x,'Person')).slice(0,500);
  await batch([stmt("INSERT INTO spaces(id,tenant_id,key,kind,name,description,icon,color,visibility,created_by,created_at,updated_at) VALUES(?,?,?,'custom',?,?,?,?,?,?,?,?)",id,u.tenantId,`custom:${id}`,name,str(b.description,'Description',400,false),str(b.icon,'Icon',40,false)||'LibraryBig',str(b.color,'Colour',20,false),oneOf(b.visibility||'members',['company','members'] as const,'visibility'),u.id,ts,ts),stmt("INSERT INTO space_members(id,tenant_id,space_id,member_id,role,added_at) VALUES(?,?,?,?,'owner',?)",uid(),u.tenantId,id,u.id,ts),...members.filter((m:string)=>m!==u.id).map((m:string)=>stmt("INSERT OR IGNORE INTO space_members(id,tenant_id,space_id,member_id,role,added_at) SELECT ?,?,?,id,'member',? FROM members WHERE id=? AND tenant_id=? AND active=1",uid(),u.tenantId,id,ts,m,u.tenantId)),auditStatement(u,'Space created',id,u.department,null,{name})]);
  return {id};
 }
 const s=await loadSpace(u,idOf(b.id,'Space'));
 if(action!=='channel'&&!canManageSpace(u,s))throw new HttpError(403,'Only the space’s owners and administrators change it.');
 if(action==='channel'&&!isSpaceMember(u,s))throw new HttpError(403,'Only members of this space open its channel.');
 switch(action){
  case 'update':await batch([stmt('UPDATE spaces SET name=?,description=?,icon=?,color=?,visibility=?,updated_at=? WHERE id=? AND tenant_id=?',s.kind==='department'||s.kind==='company'?s.name:str(b.name,'Space name',80),str(b.description,'Description',400,false),str(b.icon,'Icon',40,false),str(b.color,'Colour',20,false),s.kind==='custom'?oneOf(b.visibility||s.visibility,['company','members'] as const,'visibility'):s.visibility,now(),s.id,u.tenantId),auditStatement(u,'Space updated',s.id,s.department,{name:s.name,visibility:s.visibility},{name:b.name,visibility:b.visibility})]);return {ok:true};
  case 'members':{const add=(Array.isArray(b.add)?b.add:[]).map((x:unknown)=>idOf(x,'Person'));const remove=(Array.isArray(b.remove)?b.remove:[]).map((x:unknown)=>idOf(x,'Person'));const role=oneOf(b.role||'member',['member','owner'] as const,'role');await batch([...add.map((m:string)=>stmt('INSERT INTO space_members(id,tenant_id,space_id,member_id,role,added_at) SELECT ?,?,?,id,?,? FROM members WHERE id=? AND tenant_id=? AND active=1 ON CONFLICT(tenant_id,space_id,member_id) DO UPDATE SET role=excluded.role',uid(),u.tenantId,s.id,role,now(),m,u.tenantId)),...remove.map((m:string)=>stmt('DELETE FROM space_members WHERE tenant_id=? AND space_id=? AND member_id=?',u.tenantId,s.id,m)),auditStatement(u,'Space members changed',s.id,s.department,{removed:remove},{added:add,role})]);return {ok:true}}
  case 'archive':case 'restore':{if(s.kind!=='custom')throw new HttpError(409,'Company, department and project spaces follow their company, department or project.');await batch([stmt('UPDATE spaces SET status=?,updated_at=? WHERE id=? AND tenant_id=?',action==='archive'?'archived':'active',now(),s.id,u.tenantId),auditStatement(u,action==='archive'?'Space archived':'Space restored',s.id,s.department,null,null)]);return {ok:true}}
  case 'channel':{
   // Create the space's messaging channel on demand.
   const kind=s.kind==='department'?'department':s.kind==='company'?'company':s.kind==='project'?'project':'space';const ref=s.kind==='department'?s.department:s.kind==='company'?'':s.kind==='project'?s.project_id||'':s.id;
   const have=await first<{id:string}>('SELECT id FROM channels WHERE tenant_id=? AND kind=? AND ref_id=? AND archived_at IS NULL',u.tenantId,kind,ref);if(have)return {id:have.id};
   const id=uid();await batch([stmt('INSERT INTO channels(id,tenant_id,kind,name,description,ref_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',id,u.tenantId,kind,s.name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),`${s.name} space`,ref,u.id,now()),auditStatement(u,'Space channel created',s.id,s.department,null,{channel:id})]);return {id};
  }
 }
 throw new HttpError(400,'Unknown action.');
},{module:'spaces'});
