import {hasAction} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,oneOf,idOf,auditStatement,parseJson} from '../../server/core';
import {matchesRules,type GroupRules} from '../../server/acl';
import type {Member} from '../../server/policy';

// Custom company groups (Company settings › Groups): reusable audiences for files, announcements, messaging,
// projects, tasks, pages and approvals. Static members, owners, and dynamic rules (department/location/role/title).
type G={id:string,code:string,name:string,description:string,type:string,status:string,visibility:string,membership_mode:string,rules_json:string,created_by:string,created_at:string,updated_at:string,updated_by:string};
const canAdmin=(u:Member)=>u.role==='admin'||hasAction(u,'settings','configure');
async function members(u:Member,g:G){
 if(g.membership_mode==='dynamic'){const rules=parseJson<GroupRules>(g.rules_json,{});const people=await all<{id:string,name:string,email:string,department:string,location:string,role:string,role_id:string|null,title:string}>('SELECT id,name,email,department,location,role,role_id,title FROM members WHERE tenant_id=? AND active=1 ORDER BY name',u.tenantId);return people.filter(p=>matchesRules({...p,roleId:p.role_id},rules)).map(p=>({id:p.id,name:p.name,email:p.email,department:p.department,role:'member',dynamic:true}))}
 return all('SELECT m.id,m.name,m.email,m.department,gm.role FROM group_members gm JOIN members m ON m.id=gm.member_id AND m.tenant_id=gm.tenant_id WHERE gm.tenant_id=? AND gm.group_id=? ORDER BY gm.role DESC,m.name',u.tenantId,g.id);
}
// Where a group is still used (content audiences and channels).
async function references(u:Member,id:string){
 const like=`"${id}"`;
 const r=await first<Record<string,number>>("SELECT (SELECT count(*) FROM files WHERE tenant_id=?1 AND instr(coalesce(acl_json,''),?2)>0 AND deleted_at IS NULL) AS files,(SELECT count(*) FROM pages WHERE tenant_id=?1 AND instr(coalesce(acl_json,''),?2)>0 AND deleted_at IS NULL) AS pages,(SELECT count(*) FROM tasks WHERE tenant_id=?1 AND instr(coalesce(acl_json,''),?2)>0 AND deleted_at IS NULL) AS tasks,(SELECT count(*) FROM projects WHERE tenant_id=?1 AND instr(coalesce(acl_json,''),?2)>0) AS projects,(SELECT count(*) FROM folders WHERE tenant_id=?1 AND instr(coalesce(acl_json,''),?2)>0 AND deleted_at IS NULL) AS folders,(SELECT count(*) FROM channels WHERE tenant_id=?1 AND kind='group' AND ref_id=?3 AND archived_at IS NULL) AS channels",u.tenantId,like,id);
 return r||{};
}
export const GET=route(async(req,u)=>{
 const id=new URL(req.url).searchParams.get('id');
 if(id){
  const g=await first<G>('SELECT * FROM groups WHERE id=? AND tenant_id=?',idOf(id,'Group'),u.tenantId);if(!g)throw new HttpError(404,'Group not found.');
  const list=await members(u,g);const mine=list.some((m:any)=>m.id===u.id);
  if(!canAdmin(u)&&g.visibility!=='company'&&!mine)throw new HttpError(404,'Group not found.');
  return {group:{...g,rules:parseJson(g.rules_json,{})},members:list,references:canAdmin(u)?await references(u,g.id):null,activity:canAdmin(u)?await all('SELECT a.action,a.created_at AS createdAt,m.name AS who FROM audit a LEFT JOIN members m ON m.id=a.actor WHERE a.tenant_id=? AND a.record_id=? ORDER BY a.created_at DESC LIMIT 60',u.tenantId,g.id):[],canManage:canAdmin(u)||list.some((m:any)=>m.id===u.id&&m.role==='owner')};
 }
 const rows=await all<G&{members:number}>("SELECT g.*,(SELECT count(*) FROM group_members gm WHERE gm.group_id=g.id AND gm.tenant_id=g.tenant_id) AS members FROM groups g WHERE g.tenant_id=? ORDER BY g.status,g.name",u.tenantId);
 // Staff see active company-visible groups and groups they belong to (for audience pickers).
 const visible=canAdmin(u)?rows:rows.filter(g=>g.status==='active'&&(g.visibility==='company'||u.groupIds?.includes(g.id)));
 return {groups:visible.map(g=>({...g,rules:parseJson(g.rules_json,{}),dynamicCount:undefined})),canManage:canAdmin(u)};
});
export const POST=route(async(req,u)=>{
 const b=await readBody(req);const action=String(b.action||'');
 const list=(v:unknown)=>Array.isArray(v)?[...new Set(v.map(x=>String(x).slice(0,160)).filter(Boolean))].slice(0,200):[];
 if(action==='save'||action==='preview-rules'){
  const rules:GroupRules={departments:list((b.rules as any)?.departments),locations:list((b.rules as any)?.locations),roles:list((b.rules as any)?.roles),titles:list((b.rules as any)?.titles)};
  if(action==='preview-rules'){if(!canAdmin(u))throw new HttpError(403,'Only administrators manage groups.');const people=await all<{id:string,name:string,department:string,location:string,role:string,role_id:string|null,title:string}>('SELECT id,name,department,location,role,role_id,title FROM members WHERE tenant_id=? AND active=1 ORDER BY name',u.tenantId);return {members:people.filter(p=>matchesRules({...p,roleId:p.role_id},rules)).map(p=>({id:p.id,name:p.name,department:p.department}))}}
  if(!canAdmin(u))throw new HttpError(403,'Only administrators manage groups.');
  const name=str(b.name,'Group name',80),code=str(b.code||name.toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,''),'Code',30).toUpperCase();
  if(!/^[A-Z0-9_-]{2,30}$/.test(code))throw new HttpError(400,'Codes use 2–30 letters, numbers, dashes and underscores.');
  const v={name,code,description:str(b.description,'Description',400,false),type:str(b.type||'team','Type',40),visibility:oneOf(b.visibility||'company',['company','members'] as const,'visibility'),mode:oneOf(b.membershipMode||'static',['static','dynamic'] as const,'membership mode')};
  if(v.mode==='dynamic'&&!Object.values(rules).some(x=>x&&x.length))throw new HttpError(400,'Add at least one membership rule.');
  const clash=await first<{id:string}>('SELECT id FROM groups WHERE tenant_id=? AND code=?',u.tenantId,code);
  if(b.id){const id=idOf(b.id,'Group');const before=await first<G>('SELECT * FROM groups WHERE id=? AND tenant_id=?',id,u.tenantId);if(!before)throw new HttpError(404,'Group not found.');if(clash&&clash.id!==id)throw new HttpError(409,'Another group uses this code.');
   await batch([stmt('UPDATE groups SET name=?,code=?,description=?,type=?,visibility=?,membership_mode=?,rules_json=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',v.name,v.code,v.description,v.type,v.visibility,v.mode,JSON.stringify(rules),u.name,now(),id,u.tenantId),auditStatement(u,'Group updated',id,'Administration',{name:before.name,code:before.code,mode:before.membership_mode,rules:parseJson(before.rules_json,{})},{...v,rules})]);return {id}}
  if(clash)throw new HttpError(409,'Another group uses this code.');
  const id=uid();const owners=list(b.owners);
  await batch([stmt('INSERT INTO groups(id,tenant_id,code,name,description,type,status,visibility,membership_mode,rules_json,created_by,created_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,v.code,v.name,v.description,v.type,'active',v.visibility,v.mode,JSON.stringify(rules),u.name,now(),now(),u.name),...owners.map(m=>stmt("INSERT OR IGNORE INTO group_members(id,tenant_id,group_id,member_id,role,added_by,added_at) SELECT ?,?,?,id,'owner',?,? FROM members WHERE id=? AND tenant_id=?",uid(),u.tenantId,id,u.id,now(),m,u.tenantId)),auditStatement(u,'Group created',id,'Administration',null,{...v,rules})]);
  return {id};
 }
 const id=idOf(b.id,'Group');const g=await first<G>('SELECT * FROM groups WHERE id=? AND tenant_id=?',id,u.tenantId);if(!g)throw new HttpError(404,'Group not found.');
 const owner=!!await first("SELECT id FROM group_members WHERE tenant_id=? AND group_id=? AND member_id=? AND role='owner'",u.tenantId,id,u.id);
 if(action==='members'){
  if(!canAdmin(u)&&!owner)throw new HttpError(403,'Only administrators and group owners change members.');
  if(g.membership_mode==='dynamic')throw new HttpError(409,'Members of a dynamic group come from its rules.');
  const add=list(b.add),remove=list(b.remove),role=oneOf(b.role||'member',['member','owner'] as const,'role');
  if(add.length){const found=new Set((await all<{id:string}>(`SELECT id FROM members WHERE tenant_id=? AND id IN (${add.map(()=>'?').join(',')})`,u.tenantId,...add)).map(r=>r.id));if(add.some(a=>!found.has(a)))throw new HttpError(400,'Someone is not a member of this company.')}
  await batch([...add.map(m=>stmt('INSERT INTO group_members(id,tenant_id,group_id,member_id,role,added_by,added_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(tenant_id,group_id,member_id) DO UPDATE SET role=excluded.role',uid(),u.tenantId,id,m,role,u.id,now())),...remove.map(m=>stmt('DELETE FROM group_members WHERE tenant_id=? AND group_id=? AND member_id=?',u.tenantId,id,m)),auditStatement(u,'Group members changed',id,'Administration',{removed:remove},{added:add,role})]);
  return {ok:true};
 }
 if(!canAdmin(u))throw new HttpError(403,'Only administrators manage groups.');
 switch(action){
  case 'archive':case 'restore':await batch([stmt('UPDATE groups SET status=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',action==='archive'?'archived':'active',u.name,now(),id,u.tenantId),auditStatement(u,action==='archive'?'Group archived':'Group restored',id,'Administration',{status:g.status},{status:action==='archive'?'archived':'active'})]);return {ok:true};
  case 'delete':{
   const refs=await references(u,id);const used=Object.entries(refs).filter(([,n])=>n>0);
   if(used.length)throw new HttpError(409,`This group is still used by ${used.map(([k,n])=>`${n} ${k}`).join(', ')}. Archive it, or replace it with another group first.`);
   await batch([stmt('DELETE FROM group_members WHERE tenant_id=? AND group_id=?',u.tenantId,id),stmt('DELETE FROM groups WHERE id=? AND tenant_id=?',id,u.tenantId),auditStatement(u,'Group deleted',id,'Administration',{name:g.name,code:g.code},null)]);return {ok:true};
  }
  case 'replace':{
   // Point every audience that uses this group at another group, then the group can be deleted.
   const to=idOf(b.replacementId,'Replacement group');if(to===id||!await first("SELECT id FROM groups WHERE id=? AND tenant_id=? AND status='active'",to,u.tenantId))throw new HttpError(400,'Choose another active group.');
   const s=['files','pages','tasks','projects','folders'].map(t=>stmt(`UPDATE ${t} SET acl_json=replace(acl_json,?,?) WHERE tenant_id=? AND instr(coalesce(acl_json,''),?)>0`,`"${id}"`,`"${to}"`,u.tenantId,`"${id}"`));
   await batch([...s,stmt("UPDATE channels SET ref_id=? WHERE tenant_id=? AND kind='group' AND ref_id=?",to,u.tenantId,id),auditStatement(u,'Group replaced in audiences',id,'Administration',{group:id},{replacement:to})]);return {ok:true};
  }
 }
 throw new HttpError(400,'Unknown action.');
});
