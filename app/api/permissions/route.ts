import {route,readBody,HttpError,all,first,stmt,batch,uid,auditStatement} from '../../server/core';
import {pageActions,departmentPages,permissionMap,departmentKey,roleRules,type AccessRule} from '../../access-policy';
// Fine-grained overrides for a person, a base role or a department. Custom roles are managed in /api/roles.
export const GET=route(async(_req,u)=>{
 if(u.role!=='admin')throw new HttpError(403,'Only administrators manage permissions.');
 const members=await all<{id:string,name:string,email:string,role:string,department:string,active:number,role_id:string|null}>('SELECT id,name,email,role,department,active,role_id FROM members WHERE tenant_id=? ORDER BY name',u.tenantId);
 const rules=await all<AccessRule>('SELECT * FROM access_rules WHERE tenant_id=? ORDER BY subject_type,subject_id,page,action',u.tenantId);
 const roles=await all<{id:string,permissions_json:string}>('SELECT id,permissions_json FROM roles WHERE tenant_id=?',u.tenantId);
 const legacy=await all<{member_id:string}>('SELECT a.member_id FROM research_access a JOIN members m ON m.id=a.member_id WHERE m.tenant_id=?',u.tenantId);
 const effective=[...rules,...roles.flatMap(r=>roleRules(r.id,r.permissions_json))];
 for(const l of legacy)for(const action of ['view','upload','process','download'])if(!effective.some(r=>r.subject_type==='user'&&r.subject_id===l.member_id&&r.page==='research'&&r.action===action))effective.push({subject_type:'user',subject_id:l.member_id,department:'*',page:'research',action,effect:'allow',scope:'all'});
 return {members:members.map(m=>({...m,permissions:permissionMap({...m,roleId:m.role_id,rules:effective})})),rules,pageActions,departmentPages};
});
export const POST=route(async(req,u)=>{
 if(u.role!=='admin')throw new HttpError(403,'Only administrators manage permissions.');
 const b=await readBody(req);
 if(b.remove===true){if(typeof b.id!=='string')throw new HttpError(400,'Select a rule.');const old=await first('SELECT * FROM access_rules WHERE id=? AND tenant_id=?',b.id,u.tenantId);if(!old)throw new HttpError(404,'Rule not found.');await batch([stmt('DELETE FROM access_rules WHERE id=? AND tenant_id=?',b.id,u.tenantId),auditStatement(u,'Permission override removed',b.id,'Administration',old,null)]);return {ok:true}}
 if(!['user','role','department'].includes(String(b.subject_type))||typeof b.subject_id!=='string'||!b.subject_id.trim()||b.subject_id.length>160||typeof b.department!=='string'||!b.department.trim()||b.department.length>160||typeof b.page!=='string'||!pageActions[b.page]||typeof b.action!=='string'||!pageActions[b.page].includes(b.action)||!['allow','deny'].includes(String(b.effect))||!['own','department','all'].includes(String(b.scope)))throw new HttpError(400,'Choose a valid subject, page, action and scope.');
 if(b.subject_type==='role'&&!['manager','employee','viewer'].includes(b.subject_id))throw new HttpError(400,'Administrators always retain full access.');
 if(b.subject_type==='user'){const m=await first<{role:string}>('SELECT role FROM members WHERE id=? AND tenant_id=?',b.subject_id,u.tenantId);if(!m||m.role==='admin')throw new HttpError(400,'Choose a non-administrator account.')}
 if(['it','research','company-data'].includes(b.page)&&b.effect==='allow'&&b.scope!=='all')throw new HttpError(400,'This shared library requires page-wide scope.');
 if(b.page==='settings'&&b.action==='manage_members'&&b.scope!=='department')throw new HttpError(400,'Delegated account management is limited to the assigned department.');
 if(['overview','settings'].includes(b.page)&&b.action==='view'&&b.effect==='deny')throw new HttpError(400,'Home and account access remain available.');
 const subject=b.subject_type==='department'?departmentKey(b.subject_id):b.subject_id,department=b.department==='*'?'*':departmentKey(b.department);
 const old=await first('SELECT * FROM access_rules WHERE tenant_id=? AND subject_type=? AND subject_id=? AND department=? AND page=? AND action=?',u.tenantId,b.subject_type,subject,department,b.page,b.action);
 await batch([stmt('INSERT INTO access_rules(id,subject_type,subject_id,department,page,action,effect,scope,tenant_id) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,subject_type,subject_id,department,page,action) DO UPDATE SET effect=excluded.effect,scope=excluded.scope',uid(),b.subject_type,subject,department,b.page,b.action,b.effect,b.scope,u.tenantId),auditStatement(u,'Permission override saved',String(b.subject_id),'Administration',old,{...b,subject_id:subject,department})]);
 return {ok:true};
});
