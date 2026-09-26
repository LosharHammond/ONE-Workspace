import {hasAction,departmentKey,baseRoles} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,oneOf,idOf,auditStatement,tenantOf} from '../../server/core';
import {derive,randomHex,ITERATIONS} from '../../server/passwords';
import type {Member} from '../../server/policy';

type Row={id:string,name:string,email:string,role:string,role_id:string|null,department:string,title:string,phone:string,location:string,manager_id:string|null,employee_code:string,active:number,last_seen_at:string|null,created_at:string,username?:string,must_change?:number};
const canManage=(u:Member)=>hasAction(u,'settings','manage_members');
// Department heads manage only employee and viewer accounts in their own department.
function assertCanManage(u:Member,target:{role:string,department:string}){
 if(!canManage(u))throw new HttpError(403,'Account management is not assigned to your account.');
 if(u.role==='admin')return;
 if(!['employee','viewer'].includes(target.role)||departmentKey(target.department)!==departmentKey(u.department))throw new HttpError(403,'You can manage standard users and viewers in your own department only.');
}
async function checkDomain(u:Member,email:string){const t=await tenantOf(u);const domains=t.domains.split(',').map(d=>d.trim().toLowerCase()).filter(Boolean);if(domains.length&&!domains.some(d=>email.endsWith('@'+d)))throw new HttpError(400,`Use a company email address (${domains.map(d=>'@'+d).join(', ')}).`)}
async function roleBase(u:Member,roleId:unknown){if(!roleId)return null;const r=await first<{id:string,base:string}>('SELECT id,base FROM roles WHERE id=? AND tenant_id=?',idOf(roleId,'Role'),u.tenantId);if(!r)throw new HttpError(400,'Choose a valid role.');return r}
async function managerOf(u:Member,v:unknown){if(!v)return null;const id=idOf(v,'Reporting manager');if(!await first('SELECT id FROM members WHERE id=? AND tenant_id=?',id,u.tenantId))throw new HttpError(400,'Choose a reporting manager from this workspace.');return id}
async function ensureAdminRemains(u:Member,changingId:string,nextRole:string,nextActive:number){if(nextRole==='admin'&&nextActive)return;const others=await first<{n:number}>("SELECT count(*) AS n FROM members WHERE tenant_id=? AND role='admin' AND active=1 AND id!=?",u.tenantId,changingId);if(!others?.n)throw new HttpError(409,'Keep at least one active administrator in this workspace.')}

export const GET=route(async(_req,u)=>{
 if(!hasAction(u,'people'))throw new HttpError(403,'The people directory is not available to your account.');
 const manage=canManage(u);
 const rows=await all<Row>(`SELECT m.id,m.name,m.email,m.role,m.role_id,m.department,m.title,m.phone,m.location,m.manager_id,m.employee_code,m.active,m.last_seen_at,m.created_at${manage?',p.username,p.must_change':''} FROM members m LEFT JOIN passwords p ON p.member_id=m.id WHERE m.tenant_id=? ORDER BY m.name`,u.tenantId);
 return {manage,members:rows.map(m=>{const mine=manage&&(u.role==='admin'||(['employee','viewer'].includes(m.role)&&departmentKey(m.department)===departmentKey(u.department)));return {...m,username:mine?m.username:undefined,must_change:mine?m.must_change:undefined,phone:manage||m.id===u.id?m.phone:(m.phone?'••••':'' ),manageable:mine}})};
});

export const POST=route(async(req,u)=>{
 const b=await readBody(req,1500000);
 const action=String(b.action||'');
 if(action==='create'){
  const name=str(b.name,'Full name',100),email=str(b.email,'Email',160).toLowerCase(),department=str(b.department,'Department',160);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,'Enter a valid email address.');
  const custom=await roleBase(u,b.roleId);const role=custom?.base||oneOf(b.role,baseRoles,'access level');
  assertCanManage(u,{role,department});await checkDomain(u,email);
  const password=str(b.password,'Temporary password',128);if(password.length<12)throw new HttpError(400,'Temporary passwords need at least 12 characters.');
  if(await first('SELECT id FROM members WHERE lower(email)=?',email)||await first('SELECT member_id FROM passwords WHERE username=?',email))throw new HttpError(409,'This email already has an account.');
  const id=uid(),salt=randomHex();
  await batch([
   stmt('INSERT INTO members(id,name,email,role,department,active,created_at,tenant_id,phone,title,manager_id,location,role_id,employee_code) VALUES(?,?,?,?,?,1,?,?,?,?,?,?,?,?)',id,name,email,role,department,now(),u.tenantId,str(b.phone,'Phone',40,false),str(b.title,'Job title',120,false),await managerOf(u,b.managerId),str(b.location,'Location',200,false),custom?.id||null,str(b.employeeCode,'Employee code',40,false)),
   stmt('INSERT INTO passwords(member_id,username,salt,password_hash,iterations,must_change) VALUES(?,?,?,?,?,1)',id,email,salt,await derive(password,salt),ITERATIONS),
   stmt('INSERT OR IGNORE INTO departments(id,tenant_id,name,created_at) VALUES(?,?,?,?)',uid(),u.tenantId,department,now()),
   auditStatement(u,'Account created',id,department,null,{name,email,role,roleId:custom?.id}),
  ]);
  return {id};
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
  const after={name:b.name===undefined?before.name:str(b.name,'Full name',100),role,role_id:custom?.id||null,department,active,title:b.title===undefined?before.title:str(b.title,'Job title',120,false),phone:b.phone===undefined?before.phone:str(b.phone,'Phone',40,false),location:b.location===undefined?before.location:str(b.location,'Location',200,false),manager_id:b.managerId===undefined?before.manager_id:await managerOf(u,b.managerId),employee_code:b.employeeCode===undefined?before.employee_code:str(b.employeeCode,'Employee code',40,false)};
  if(after.manager_id===id)throw new HttpError(400,'A person cannot report to themselves.');
  const accessChanged=after.role!==before.role||after.role_id!==before.role_id||after.department!==before.department||after.active!==before.active;
  await batch([
   stmt('UPDATE members SET name=?,role=?,role_id=?,department=?,active=?,title=?,phone=?,location=?,manager_id=?,employee_code=? WHERE id=? AND tenant_id=?',after.name,after.role,after.role_id,after.department,after.active,after.title,after.phone,after.location,after.manager_id,after.employee_code,id,u.tenantId),
   ...(accessChanged?[stmt('DELETE FROM sessions WHERE member_id=?',id)]:[]),
   stmt('INSERT OR IGNORE INTO departments(id,tenant_id,name,created_at) VALUES(?,?,?,?)',uid(),u.tenantId,after.department,now()),
   auditStatement(u,accessChanged?'Access changed':'Profile updated',id,after.department,before,after),
  ]);
  return {ok:true};
 }
 if(action==='bulk-active'){
  if(!Array.isArray(b.ids)||!b.ids.length||b.ids.length>500)throw new HttpError(400,'Select up to 500 people.');
  const active=b.active?1:0;const ids=b.ids.map(x=>idOf(x,'Person'));
  if(ids.includes(u.id)&&!active)throw new HttpError(403,'You cannot disable your own account.');
  const rows=await all<Row>(`SELECT * FROM members WHERE tenant_id=? AND id IN (${ids.map(()=>'?').join(',')})`,u.tenantId,...ids);
  for(const r of rows)assertCanManage(u,r);
  if(!active&&rows.some(r=>r.role==='admin')){const left=await first<{n:number}>(`SELECT count(*) AS n FROM members WHERE tenant_id=? AND role='admin' AND active=1 AND id NOT IN (${ids.map(()=>'?').join(',')})`,u.tenantId,...ids);if(!left?.n)throw new HttpError(409,'Keep at least one active administrator in this workspace.')}
  await batch(rows.flatMap(r=>[stmt('UPDATE members SET active=? WHERE id=? AND tenant_id=?',active,r.id,u.tenantId),...(active?[]:[stmt('DELETE FROM sessions WHERE member_id=?',r.id)]),auditStatement(u,active?'Account enabled':'Account disabled',r.id,r.department,{active:r.active},{active})]));
  return {updated:rows.length};
 }
 if(action==='reset-password'){
  const ids=(Array.isArray(b.ids)?b.ids:[b.id]).map(x=>idOf(x,'Person'));if(ids.length>200)throw new HttpError(400,'Reset up to 200 passwords at a time.');
  const password=str(b.password,'Temporary password',128);if(password.length<12)throw new HttpError(400,'Temporary passwords need at least 12 characters.');
  const rows=await all<Row>(`SELECT * FROM members WHERE tenant_id=? AND id IN (${ids.map(()=>'?').join(',')})`,u.tenantId,...ids);
  for(const r of rows)assertCanManage(u,r);
  const stmts=[];for(const r of rows){const salt=randomHex();stmts.push(stmt('UPDATE passwords SET salt=?,password_hash=?,iterations=?,must_change=1 WHERE member_id=?',salt,await derive(password,salt),ITERATIONS,r.id),stmt('DELETE FROM sessions WHERE member_id=?',r.id),auditStatement(u,'Password reset',r.id,r.department,null,{mustChange:true}))}
  if(stmts.length)await batch(stmts);
  return {updated:rows.length};
 }
 if(action==='import')return importPeople(u,b);
 throw new HttpError(400,'Unknown action.');
});

// Bulk create/update from a spreadsheet export (e.g. an AssetInfinity "List of users").
// Existing accounts are matched by email and updated; new accounts get the temporary password.
async function importPeople(u:Member,b:Record<string,unknown>){
 if(u.role!=='admin')throw new HttpError(403,'Only administrators can import people.');
 if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>1000)throw new HttpError(400,'Import between 1 and 1000 rows at a time.');
 const password=str(b.password,'Temporary password',128);if(password.length<12)throw new HttpError(400,'Temporary passwords need at least 12 characters.');
 const t=await tenantOf(u);const domains=t.domains.split(',').map(d=>d.trim().toLowerCase()).filter(Boolean);
 const existing=await all<Row>('SELECT * FROM members WHERE tenant_id=?',u.tenantId);
 const byEmail=new Map(existing.filter(m=>m.email).map(m=>[m.email.toLowerCase(),m]));
 const roles=await all<{id:string,name:string,base:string}>('SELECT id,name,base FROM roles WHERE tenant_id=?',u.tenantId);
 // Imports never grant full Admin: "Owner"/"Admin" rows become a custom role at Department Head level
 // for an administrator to promote deliberately.
 const baseByLabel:Record<string,string>={manager:'manager','department head':'manager',employee:'employee','standard user':'employee',user:'employee',viewer:'viewer'};
 const created:string[]=[],updated:string[]=[],skipped:{row:number,reason:string}[]=[];
 const stmts:D1PreparedStatement[]=[];const newRoles=new Map<string,{id:string,base:string,name:string}>();const pending:{id:string,managerEmail:string}[]=[];const depts=new Set<string>();
 // One derivation for the shared temporary password keeps large imports within the
 // Worker CPU budget; every imported account must replace it at first sign-in.
 const salt=randomHex(),hashValue=await derive(password,salt);
 const rows=b.rows as Record<string,unknown>[];
 for(let i=0;i<rows.length;i++){
  const r=rows[i];const s=(k:string,max=200)=>String(r[k]??'').trim().slice(0,max);
  const email=s('email',160).toLowerCase(),name=s('name',100);
  if(!name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){skipped.push({row:i+1,reason:'Missing name or valid email'});continue}
  if(domains.length&&!domains.some(d=>email.endsWith('@'+d))){skipped.push({row:i+1,reason:'Email outside company domains'});continue}
  const roleName=s('role',80);let base='employee',roleId:string|null=null;
  if(roleName){const known=roles.find(x=>x.name.toLowerCase()===roleName.toLowerCase())||newRoles.get(roleName.toLowerCase());if(known){roleId=known.id;base=known.base}else if(baseByLabel[roleName.toLowerCase()])base=baseByLabel[roleName.toLowerCase()];else{const id=uid();const guess=/admin|owner|head|manager/i.test(roleName)?'manager':'employee';newRoles.set(roleName.toLowerCase(),{id,base:guess,name:roleName});stmts.push(stmt('INSERT INTO roles(id,tenant_id,name,description,base,permissions_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,roleName,'Created by people import. Review its permissions.',guess,'{}',u.id,now(),u.id,now()));roleId=id;base=guess}}
  const department=s('department',160)||'Unassigned';if(department!=='Unassigned')depts.add(department);
  const fields={name,department,phone:s('phone',40),title:s('title',120),location:s('location',200).replaceAll('&gt;','>').split('>').map(x=>x.trim()).filter(Boolean).join(' > '),employee_code:s('employeeCode',40)};
  const managerEmail=(s('manager',200).match(/[^\s(<]+@[^\s)>]+/)?.[0]||'').toLowerCase();
  const found=byEmail.get(email);
  if(found){
   if(found.id===u.id){skipped.push({row:i+1,reason:'Your own account is not changed by imports'});continue}
   stmts.push(stmt('UPDATE members SET name=?,department=?,phone=CASE WHEN ?=\'\' THEN phone ELSE ? END,title=CASE WHEN ?=\'\' THEN title ELSE ? END,location=CASE WHEN ?=\'\' THEN location ELSE ? END,role=?,role_id=? WHERE id=? AND tenant_id=?',fields.name,fields.department,fields.phone,fields.phone,fields.title,fields.title,fields.location,fields.location,found.role==='admin'?'admin':base,found.role==='admin'?found.role_id:roleId,found.id,u.tenantId));
   updated.push(email);if(managerEmail)pending.push({id:found.id,managerEmail});
  }else{
   if(await first('SELECT member_id FROM passwords WHERE username=?',email)){skipped.push({row:i+1,reason:'Email belongs to another workspace'});continue}
   const id=uid();byEmail.set(email,{id,email} as Row);
   stmts.push(stmt('INSERT INTO members(id,name,email,role,department,active,created_at,tenant_id,phone,title,location,role_id,employee_code) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,name,email,base,department,r.active===false?0:1,now(),u.tenantId,fields.phone,fields.title,fields.location,roleId,fields.employee_code));
   stmts.push(stmt('INSERT INTO passwords(member_id,username,salt,password_hash,iterations,must_change) VALUES(?,?,?,?,?,1)',id,email,salt,hashValue,ITERATIONS));
   created.push(email);if(managerEmail)pending.push({id,managerEmail});
  }
 }
 for(const d of depts)stmts.push(stmt('INSERT OR IGNORE INTO departments(id,tenant_id,name,created_at) VALUES(?,?,?,?)',uid(),u.tenantId,d,now()));
 for(const p of pending){const m=byEmail.get(p.managerEmail);if(m&&m.id!==p.id)stmts.push(stmt('UPDATE members SET manager_id=? WHERE id=? AND tenant_id=?',m.id,p.id,u.tenantId))}
 stmts.push(auditStatement(u,'People imported',u.id,'Administration',null,{created:created.length,updated:updated.length,skipped:skipped.length,rolesCreated:newRoles.size}));
 for(let i=0;i<stmts.length;i+=90)await batch(stmts.slice(i,i+90));
 return {created:created.length,updated:updated.length,skipped,rolesCreated:[...newRoles.values()].map(r=>r.name)};
}
