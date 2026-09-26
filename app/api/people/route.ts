import {hasAction,departmentKey,baseRoles} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,oneOf,idOf,auditStatement,tenantOf,tenantSettings,isPlatformOwner,type Tenant} from '../../server/core';
import {identityFor,prepareToken,deliverToken} from '../../server/auth';
import {planLimits} from '../../modules';
import type {Member} from '../../server/policy';

// Workspace memberships. People are invited with a one-time activation link; administrators never
// set, see or send a password.
type Row={id:string,name:string,email:string,role:string,role_id:string|null,department:string,title:string,phone:string,location:string,additional_locations:string,manager_id:string|null,employee_code:string,active:number,last_seen_at:string|null,created_at:string,updated_at:string|null,updated_by:string|null,invited_at:string|null,identity_id:string|null,activated:number,must_change:number|null};
const canManage=(u:Member)=>hasAction(u,'settings','manage_members');
// Department heads manage only standard users and viewers in their own department.
function assertCanManage(u:Member,target:{role:string,department:string,email?:string}){
 if(!canManage(u))throw new HttpError(403,'Account management is not assigned to your account.');
 if(target.email&&isPlatformOwner(target.email)&&u.platformRole!=='owner')throw new HttpError(403,'The Platform Owner account is managed only from the Platform Console.');
 if(u.role==='admin')return;
 if(!['employee','viewer'].includes(target.role)||departmentKey(target.department)!==departmentKey(u.department))throw new HttpError(403,'You can manage standard users and viewers in your own department only.');
}
function checkDomain(t:Tenant,email:string){const domains=t.domains.split(',').map(d=>d.trim().toLowerCase()).filter(Boolean);if(domains.length&&!domains.some(d=>email.endsWith('@'+d)))throw new HttpError(400,`Use a company email address (${domains.map(d=>'@'+d).join(', ')}).`)}
async function roleBase(u:Member,roleId:unknown){if(!roleId)return null;const r=await first<{id:string,base:string}>('SELECT id,base FROM roles WHERE id=? AND tenant_id=?',idOf(roleId,'Role'),u.tenantId);if(!r)throw new HttpError(400,'Choose a valid role.');return r}
async function managerOf(u:Member,v:unknown){if(!v)return null;const id=idOf(v,'Reporting manager');if(!await first('SELECT id FROM members WHERE id=? AND tenant_id=?',id,u.tenantId))throw new HttpError(400,'Choose a reporting manager from this workspace.');return id}
async function ensureAdminRemains(u:Member,changingId:string,nextRole:string,nextActive:number){if(nextRole==='admin'&&nextActive)return;const others=await first<{n:number}>("SELECT count(*) AS n FROM members WHERE tenant_id=? AND role='admin' AND active=1 AND id!=?",u.tenantId,changingId);if(!others?.n)throw new HttpError(409,'Keep at least one active administrator in this workspace.')}
async function checkSeats(u:Member,t:Tenant,adding:number){const limits={...(planLimits[t.plan]||planLimits.business),...(tenantSettings(t).limits as object||{})} as {maxUsers:number};const n=await first<{n:number}>('SELECT count(*) AS n FROM members WHERE tenant_id=? AND active=1',u.tenantId);if((n?.n||0)+adding>limits.maxUsers)throw new HttpError(409,`This workspace is limited to ${limits.maxUsers} active people on its plan. Ask the Platform Owner to raise the limit.`)}
const locationsOf=(v:unknown)=>Array.isArray(v)?v.map(x=>str(x,'Location',200)).filter(Boolean).slice(0,50):[];
const statusOf=(m:{active:number,activated:number})=>!m.active?'Disabled':m.activated?'Active':'Invited';

export const GET=route(async(req,u)=>{
 if(!hasAction(u,'people'))throw new HttpError(403,'The people directory is not available to your account.');
 const manage=canManage(u);
 const rows=await all<Row>('SELECT m.id,m.name,m.email,m.role,m.role_id,m.department,m.title,m.phone,m.location,m.additional_locations,m.manager_id,m.employee_code,m.active,m.last_seen_at,m.created_at,m.updated_at,m.updated_by,m.invited_at,m.identity_id,c.must_change,(c.identity_id IS NOT NULL) AS activated FROM members m LEFT JOIN credentials c ON c.identity_id=m.identity_id WHERE m.tenant_id=? ORDER BY m.name',u.tenantId);
 const id=new URL(req.url).searchParams.get('activity');
 if(id){
  const m=rows.find(r=>r.id===id);if(!m||!manage)throw new HttpError(404,'Person not found.');
  return {activity:await all('SELECT id,action,record_id AS recordId,created_at AS createdAt FROM audit WHERE tenant_id=? AND actor=? ORDER BY created_at DESC LIMIT 200',u.tenantId,m.id)};
 }
 return {manage,members:rows.map(m=>{const mine=manage&&(u.role==='admin'||(['employee','viewer'].includes(m.role)&&departmentKey(m.department)===departmentKey(u.department)));return {id:m.id,name:m.name,email:m.email,role:m.role,role_id:m.role_id,department:m.department,title:m.title,location:m.location,additional_locations:JSON.parse(m.additional_locations||'[]'),manager_id:m.manager_id,employee_code:m.employee_code,active:m.active,last_seen_at:m.last_seen_at,created_at:m.created_at,updated_at:m.updated_at,updated_by:m.updated_by,status:statusOf(m),invited_at:mine?m.invited_at:undefined,must_change:mine?m.must_change:undefined,phone:manage||m.id===u.id?m.phone:(m.phone?'••••':''),manageable:mine}})};
});

export const POST=route(async(req,u)=>{
 const b=await readBody(req,1500000);
 const action=String(b.action||'');
 const t=await tenantOf(u);
 if(action==='create'){
  const name=str(b.name,'Full name',100),email=str(b.email,'Email',160).toLowerCase(),department=str(b.department,'Department',160);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,'Enter a valid email address.');
  const custom=await roleBase(u,b.roleId);const role=custom?.base||oneOf(b.role,baseRoles,'access level');
  assertCanManage(u,{role,department,email});checkDomain(t,email);await checkSeats(u,t,1);
  const idn=await identityFor(email,name);
  if(await first('SELECT id FROM members WHERE tenant_id=? AND (identity_id=? OR lower(email)=?)',u.tenantId,idn.id,email))throw new HttpError(409,'This person is already a member of this workspace.');
  const id=uid();
  const tok=idn.activated?null:await prepareToken({identityId:idn.id,memberId:id,tenantId:u.tenantId,purpose:'invite',createdBy:u.id});
  await batch([
   ...idn.statements,
   stmt('INSERT INTO members(id,name,email,role,department,active,created_at,tenant_id,phone,title,manager_id,location,additional_locations,role_id,employee_code,identity_id,invited_at,updated_at,updated_by) VALUES(?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,name,email,role,department,now(),u.tenantId,str(b.phone,'Phone',40,false),str(b.title,'Job title',120,false),await managerOf(u,b.managerId),str(b.location,'Location',200,false),JSON.stringify(locationsOf(b.additionalLocations)),custom?.id||null,str(b.employeeCode,'Employee code',40,false),idn.id,idn.activated?null:now(),now(),u.id),
   stmt('INSERT OR IGNORE INTO departments(id,tenant_id,name,created_at) VALUES(?,?,?,?)',uid(),u.tenantId,department,now()),
   ...(tok?tok.statements:[]),
   auditStatement(u,idn.activated?'Existing account added to workspace':'Person invited',id,department,null,{name,email,role,roleId:custom?.id}),
  ]);
  const delivery=tok?await deliverToken(tok,{purpose:'invite',req,workspaceName:t.name,recipient:{email,name},inviterName:u.name}):{emailed:false};
  return {id,...delivery,note:idn.activated?'This person already has a One Workspace account; they can switch into this workspace now.':undefined};
 }
 if(action==='update'){
  const id=idOf(b.id,'Person');
  const before=await first<Row>('SELECT * FROM members WHERE id=? AND tenant_id=?',id,u.tenantId);if(!before)throw new HttpError(404,'Person not found.');
  assertCanManage(u,before);
  const custom=b.roleId===undefined?(before.role_id?{id:before.role_id,base:before.role}:null):await roleBase(u,b.roleId);
  const role=custom?.base||(b.role===undefined?before.role:oneOf(b.role,baseRoles,'access level'));
  const department=b.department===undefined?before.department:str(b.department,'Department',160);
  const active=b.active===undefined?before.active:b.active?1:0;
  assertCanManage(u,{role,department});
  if(id===u.id&&(!active||role!==u.role))throw new HttpError(403,'You cannot change your own access level or disable yourself.');
  if(before.role==='admin')await ensureAdminRemains(u,id,role,active);
  if(active&&!before.active)await checkSeats(u,t,1);
  // Only these fields can change; anything else in the request is ignored (no mass assignment).
  const after={name:b.name===undefined?before.name:str(b.name,'Full name',100),role,role_id:custom?.id||null,department,active,title:b.title===undefined?before.title:str(b.title,'Job title',120,false),phone:b.phone===undefined?before.phone:str(b.phone,'Phone',40,false),location:b.location===undefined?before.location:str(b.location,'Location',200,false),additional_locations:b.additionalLocations===undefined?before.additional_locations:JSON.stringify(locationsOf(b.additionalLocations)),manager_id:b.managerId===undefined?before.manager_id:await managerOf(u,b.managerId),employee_code:b.employeeCode===undefined?before.employee_code:str(b.employeeCode,'Employee code',40,false)};
  if(after.manager_id===id)throw new HttpError(400,'A person cannot report to themselves.');
  const accessChanged=after.role!==before.role||after.role_id!==before.role_id||after.department!==before.department||after.active!==before.active;
  await batch([
   stmt('UPDATE members SET name=?,role=?,role_id=?,department=?,active=?,title=?,phone=?,location=?,additional_locations=?,manager_id=?,employee_code=?,updated_at=?,updated_by=? WHERE id=? AND tenant_id=?',after.name,after.role,after.role_id,after.department,after.active,after.title,after.phone,after.location,after.additional_locations,after.manager_id,after.employee_code,now(),u.id,id,u.tenantId),
   // Access changes end the person's sessions in this workspace only.
   ...(accessChanged?[stmt('DELETE FROM sessions WHERE member_id=?',id)]:[]),
   stmt('INSERT OR IGNORE INTO departments(id,tenant_id,name,created_at) VALUES(?,?,?,?)',uid(),u.tenantId,after.department,now()),
   auditStatement(u,accessChanged?'Access changed':'Profile updated',id,after.department,{role:before.role,role_id:before.role_id,department:before.department,active:before.active},after),
  ]);
  return {ok:true};
 }
 if(action==='bulk-active'){
  if(!Array.isArray(b.ids)||!b.ids.length||b.ids.length>500)throw new HttpError(400,'Select up to 500 people.');
  const active=b.active?1:0;const ids=b.ids.map(x=>idOf(x,'Person'));
  if(ids.includes(u.id)&&!active)throw new HttpError(403,'You cannot disable your own account.');
  const rows=await all<Row>(`SELECT * FROM members WHERE tenant_id=? AND id IN (${ids.map(()=>'?').join(',')})`,u.tenantId,...ids);
  for(const r of rows)assertCanManage(u,r);
  if(active)await checkSeats(u,t,rows.filter(r=>!r.active).length);
  if(!active&&rows.some(r=>r.role==='admin')){const left=await first<{n:number}>(`SELECT count(*) AS n FROM members WHERE tenant_id=? AND role='admin' AND active=1 AND id NOT IN (${ids.map(()=>'?').join(',')})`,u.tenantId,...ids);if(!left?.n)throw new HttpError(409,'Keep at least one active administrator in this workspace.')}
  await batch(rows.flatMap(r=>[stmt('UPDATE members SET active=?,updated_at=?,updated_by=? WHERE id=? AND tenant_id=?',active,now(),u.id,r.id,u.tenantId),...(active?[]:[stmt('DELETE FROM sessions WHERE member_id=?',r.id)]),auditStatement(u,active?'Account reactivated':'Account disabled',r.id,r.department,{active:r.active},{active})]));
  return {updated:rows.length};
 }
 // Invitation (not yet activated) or password-reset links, one per selected person.
 if(action==='send-links'){
  const ids=(Array.isArray(b.ids)?b.ids:[b.id]).map(x=>idOf(x,'Person'));if(!ids.length||ids.length>200)throw new HttpError(400,'Select up to 200 people.');
  const rows=await all<Row>(`SELECT m.*,(c.identity_id IS NOT NULL) AS activated FROM members m LEFT JOIN credentials c ON c.identity_id=m.identity_id WHERE m.tenant_id=? AND m.active=1 AND m.id IN (${ids.map(()=>'?').join(',')})`,u.tenantId,...ids);
  const results:{id:string,name:string,email:string,purpose:string,emailed:boolean,link?:string,error?:string}[]=[];
  for(const r of rows){
   try{
    assertCanManage(u,r);
    if(!r.identity_id)throw new HttpError(409,'Account is not linked to an identity.');
    const purpose=r.activated?'reset':'invite';
    const tok=await prepareToken({identityId:r.identity_id,memberId:r.id,tenantId:u.tenantId,purpose,createdBy:u.id});
    await batch([...tok.statements,...(purpose==='invite'?[stmt('UPDATE members SET invited_at=? WHERE id=?',now(),r.id)]:[]),auditStatement(u,purpose==='invite'?'Invitation re-sent':'Password reset link sent',r.id,r.department,null,{email:r.email})]);
    const d=await deliverToken(tok,{purpose,req,workspaceName:t.name,recipient:{email:r.email,name:r.name},inviterName:u.name});
    results.push({id:r.id,name:r.name,email:r.email,purpose,emailed:d.emailed,link:d.link,error:d.emailError||undefined});
   }catch(e){results.push({id:r.id,name:r.name,email:r.email,purpose:'',emailed:false,error:e instanceof Error?e.message:'Failed'})}
  }
  return {results};
 }
 if(action==='import')return importPeople(u,t,b);
 throw new HttpError(400,'Unknown action.');
});

// Bulk create/update from a spreadsheet export (e.g. an AssetInfinity "List of users").
// Existing members are matched by email and updated. New people get invitations (no passwords).
// {preview:true} validates and returns what would happen without writing anything.
async function importPeople(u:Member,t:Tenant,b:Record<string,unknown>){
 if(u.role!=='admin')throw new HttpError(403,'Only administrators can import people.');
 if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>1000)throw new HttpError(400,'Import between 1 and 1000 rows at a time.');
 const preview=!!b.preview;
 const domains=t.domains.split(',').map(d=>d.trim().toLowerCase()).filter(Boolean);
 const existing=await all<Row>('SELECT * FROM members WHERE tenant_id=?',u.tenantId);
 const byEmail=new Map(existing.filter(m=>m.email).map(m=>[m.email.toLowerCase(),m]));
 const roles=await all<{id:string,name:string,base:string}>('SELECT id,name,base FROM roles WHERE tenant_id=?',u.tenantId);
 // Imports never grant full Admin: "Owner"/"Admin" rows become a custom role at Department Head level
 // for an administrator to promote deliberately.
 const baseByLabel:Record<string,string>={manager:'manager','department head':'manager',employee:'employee','standard user':'employee',user:'employee',viewer:'viewer'};
 const created:{email:string,name:string,memberId:string,identityId:string,needsInvite:boolean}[]=[],updated:string[]=[],skipped:{row:number,reason:string}[]=[];
 const stmts:D1PreparedStatement[]=[];const newRoles=new Map<string,{id:string,base:string,name:string}>();const pending:{id:string,managerEmail:string}[]=[];const depts=new Set<string>();
 const rows=b.rows as Record<string,unknown>[];const seen=new Set<string>();
 for(let i=0;i<rows.length;i++){
  const r=rows[i];const s=(k:string,max=200)=>String(r[k]??'').trim().slice(0,max);
  const email=s('email',160).toLowerCase(),name=s('name',100);
  if(!name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){skipped.push({row:i+1,reason:'Missing name or valid email'});continue}
  if(seen.has(email)){skipped.push({row:i+1,reason:'Duplicate email in file'});continue}seen.add(email);
  if(domains.length&&!domains.some(d=>email.endsWith('@'+d))){skipped.push({row:i+1,reason:'Email outside company domains'});continue}
  if(isPlatformOwner(email)){skipped.push({row:i+1,reason:'The Platform Owner cannot be imported'});continue}
  const roleName=s('role',80);let base='employee',roleId:string|null=null;
  if(roleName){const known=roles.find(x=>x.name.toLowerCase()===roleName.toLowerCase())||newRoles.get(roleName.toLowerCase());if(known){roleId=known.id;base=known.base==='admin'?'manager':known.base}else if(baseByLabel[roleName.toLowerCase()])base=baseByLabel[roleName.toLowerCase()];else{const id=uid();const guess=/admin|owner|head|manager/i.test(roleName)?'manager':'employee';newRoles.set(roleName.toLowerCase(),{id,base:guess,name:roleName});stmts.push(stmt('INSERT INTO roles(id,tenant_id,name,description,base,permissions_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,roleName,'Created by people import. Review its permissions.',guess,'{}',u.id,now(),u.id,now()));roleId=id;base=guess}}
  const department=s('department',160)||'Unassigned';if(department!=='Unassigned')depts.add(department);
  const fields={name,department,phone:s('phone',40),title:s('title',120),location:s('location',200).replaceAll('&gt;','>').split('>').map(x=>x.trim()).filter(Boolean).join(' > '),employee_code:s('employeeCode',40)};
  const managerEmail=(s('manager',200).match(/[^\s(<]+@[^\s)>]+/)?.[0]||'').toLowerCase();
  const found=byEmail.get(email);
  if(found){
   if(found.id===u.id){skipped.push({row:i+1,reason:'Your own account is not changed by imports'});continue}
   stmts.push(stmt("UPDATE members SET name=?,department=?,phone=CASE WHEN ?='' THEN phone ELSE ? END,title=CASE WHEN ?='' THEN title ELSE ? END,location=CASE WHEN ?='' THEN location ELSE ? END,role=?,role_id=?,updated_at=?,updated_by=? WHERE id=? AND tenant_id=?",fields.name,fields.department,fields.phone,fields.phone,fields.title,fields.title,fields.location,fields.location,found.role==='admin'?'admin':base,found.role==='admin'?found.role_id:roleId,now(),u.id,found.id,u.tenantId));
   updated.push(email);if(managerEmail)pending.push({id:found.id,managerEmail});
  }else{
   const idn=await identityFor(email,name);const id=uid();
   stmts.push(...idn.statements,stmt('INSERT INTO members(id,name,email,role,department,active,created_at,tenant_id,phone,title,location,role_id,employee_code,identity_id,invited_at,updated_at,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,name,email,base,department,r.active===false?0:1,now(),u.tenantId,fields.phone,fields.title,fields.location,roleId,fields.employee_code,idn.id,idn.activated?null:now(),now(),u.id));
   byEmail.set(email,{id,email} as Row);created.push({email,name,memberId:id,identityId:idn.id,needsInvite:!idn.activated});if(managerEmail)pending.push({id,managerEmail});
  }
 }
 if(!preview)await checkSeats(u,t,created.length);
 if(preview)return {preview:true,create:created.length,update:updated.length,skipped,rolesToCreate:[...newRoles.values()].map(r=>r.name)};
 for(const d of depts)stmts.push(stmt('INSERT OR IGNORE INTO departments(id,tenant_id,name,created_at) VALUES(?,?,?,?)',uid(),u.tenantId,d,now()));
 for(const p of pending){const m=byEmail.get(p.managerEmail);if(m&&m.id!==p.id)stmts.push(stmt('UPDATE members SET manager_id=? WHERE id=? AND tenant_id=?',m.id,p.id,u.tenantId))}
 stmts.push(auditStatement(u,'People imported',u.id,'Administration',null,{created:created.length,updated:updated.length,skipped:skipped.length,rolesCreated:newRoles.size}));
 for(let i=0;i<stmts.length;i+=90)await batch(stmts.slice(i,i+90));
 // Invitations go out by email when configured; otherwise use "Send invitation links" on the people list.
 let emailed=0;
 if(b.sendInvites!==false)for(const c of created.filter(c=>c.needsInvite)){const tok=await prepareToken({identityId:c.identityId,memberId:c.memberId,tenantId:u.tenantId,purpose:'invite',createdBy:u.id});await batch(tok.statements);const d=await deliverToken(tok,{purpose:'invite',workspaceName:t.name,recipient:{email:c.email,name:c.name},inviterName:u.name});if(d.emailed)emailed++}
 return {created:created.length,updated:updated.length,skipped,rolesCreated:[...newRoles.values()].map(r=>r.name),invitesEmailed:emailed};
}
