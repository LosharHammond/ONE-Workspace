import {hasAction} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,idOf,oneOf,auditStatement} from '../../server/core';
import type {Member} from '../../server/policy';
// Departments (heads drive approvals and department spaces; codes and cost centres drive reporting)
// and the location tree.
type Dept={id:string,name:string,code:string,head_id:string|null,description:string,color:string,parent_id:string|null,cost_centre:string,status:string};
export const GET=route(async(req,u)=>{
 const id=new URL(req.url).searchParams.get('history');
 if(id)return {history:await all('SELECT a.id,a.action,a.actor,a.created_at AS createdAt FROM audit a WHERE a.tenant_id=? AND a.record_id=? ORDER BY a.created_at DESC LIMIT 100',u.tenantId,idOf(id,'Department'))};
 const [departments,locations]=await Promise.all([
  all("SELECT d.id,d.name,d.code,d.head_id AS headId,d.description,d.color,d.parent_id AS parentId,d.cost_centre AS costCentre,d.status,d.created_at AS createdAt,d.created_by AS createdBy,d.updated_at AS updatedAt,d.updated_by AS updatedBy,(SELECT count(*) FROM members m WHERE m.tenant_id=d.tenant_id AND m.active=1 AND lower(m.department)=lower(d.name)) AS members FROM departments d WHERE d.tenant_id=? ORDER BY d.name",u.tenantId),
  all('SELECT l.id,l.name,l.path,l.parent_id AS parentId,l.kind,(SELECT count(*) FROM assets a WHERE a.tenant_id=l.tenant_id AND a.location=l.path) AS assets FROM locations l WHERE l.tenant_id=? ORDER BY l.path',u.tenantId),
 ]);
 return {departments,locations,canManage:u.role==='admin'||hasAction(u,'settings','configure')};
});
function assertAdmin(u:Member){if(u.role!=='admin'&&!hasAction(u,'settings','configure'))throw new HttpError(403,'Only administrators manage departments.')}
async function validDept(u:Member,b:Record<string,unknown>,selfId?:string){
 const name=str(b.name,'Department name',120),code=str(b.code,'Code',20,false).toUpperCase();
 if(code&&!/^[A-Z0-9_-]{1,20}$/.test(code))throw new HttpError(400,'Codes use letters, numbers, dashes and underscores.');
 if(await first('SELECT id FROM departments WHERE tenant_id=? AND lower(name)=lower(?) AND id!=?',u.tenantId,name,selfId||''))throw new HttpError(409,'Another department already uses this name.');
 if(code&&await first('SELECT id FROM departments WHERE tenant_id=? AND code=? AND id!=?',u.tenantId,code,selfId||''))throw new HttpError(409,`The code ${code} is already used by another department.`);
 const headId=b.headId?idOf(b.headId,'Department head'):null;
 if(headId&&!await first('SELECT id FROM members WHERE id=? AND tenant_id=? AND active=1',headId,u.tenantId))throw new HttpError(400,'Choose an active department head from this workspace.');
 const parentId=b.parentId?idOf(b.parentId,'Parent department'):null;
 if(parentId){if(parentId===selfId)throw new HttpError(400,'A department cannot be its own parent.');
  // Walk up the tree to refuse cycles.
  let cur:string|null=parentId;for(let i=0;cur&&i<20;i++){if(cur===selfId)throw new HttpError(400,'That would create a loop in the department hierarchy.');const p:{parent_id:string|null}|null=await first<{parent_id:string|null}>('SELECT parent_id FROM departments WHERE id=? AND tenant_id=?',cur,u.tenantId);if(!p&&i===0)throw new HttpError(400,'Parent department not found.');cur=p?.parent_id||null}
 }
 return {name,code,head_id:headId,parent_id:parentId,description:str(b.description,'Description',600,false),color:str(b.color,'Colour',20,false),cost_centre:str(b.costCentre,'Cost centre',40,false),status:oneOf(b.status||'Active',['Active','Inactive'] as const,'status')};
}
export const POST=route(async(req,u)=>{
 const b=await readBody(req,400000);const action=String(b.action||'');
 if(action==='department'){
  assertAdmin(u);
  if(b.id){const id=idOf(b.id,'Department');const before=await first<Dept>('SELECT * FROM departments WHERE id=? AND tenant_id=?',id,u.tenantId);if(!before)throw new HttpError(404,'Department not found.');
   const v=await validDept(u,b,id);
   await batch([stmt('UPDATE departments SET name=?,code=?,head_id=?,parent_id=?,description=?,color=?,cost_centre=?,status=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',v.name,v.code,v.head_id,v.parent_id,v.description,v.color,v.cost_centre,v.status,u.id,now(),id,u.tenantId),
    // Renaming a department carries its people and pages with it.
    ...(before.name!==v.name?[stmt('UPDATE members SET department=? WHERE tenant_id=? AND department=?',v.name,u.tenantId,before.name),stmt('UPDATE pages SET department=? WHERE tenant_id=? AND department=?',v.name,u.tenantId,before.name)]:[]),
    auditStatement(u,before.status!==v.status?`Department ${v.status==='Active'?'enabled':'disabled'}`:'Department updated',id,v.name,before,v)]);return {id}}
  const v=await validDept(u,b);const id=uid();
  await batch([stmt('INSERT INTO departments(id,tenant_id,name,code,head_id,parent_id,description,color,cost_centre,status,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,v.name,v.code,v.head_id,v.parent_id,v.description,v.color,v.cost_centre,v.status,u.id,now(),u.id,now()),auditStatement(u,'Department created',id,v.name,null,v)]);return {id};
 }
 if(action==='import-departments'){
  assertAdmin(u);
  if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>500)throw new HttpError(400,'Import between 1 and 500 rows.');
  const existing=await all<Dept>('SELECT * FROM departments WHERE tenant_id=?',u.tenantId);
  const errors:{row:number,reason:string}[]=[];const ok:{name:string,code:string,cost_centre:string,description:string,status:string,parent:string,existing?:Dept}[]=[];const codes=new Set<string>();
  (b.rows as Record<string,unknown>[]).forEach((r,i)=>{const g=(k:string)=>String(r[k]??'').trim();const name=g('name'),code=g('code').toUpperCase(),status=g('status')||'Active';
   if(!name){errors.push({row:i+1,reason:'Name is required'});return}
   if(code&&!/^[A-Z0-9_-]{1,20}$/.test(code)){errors.push({row:i+1,reason:`Invalid code "${code}"`});return}
   if(!['Active','Inactive'].includes(status)){errors.push({row:i+1,reason:'Status must be Active or Inactive'});return}
   const ex=existing.find(d=>d.name.toLowerCase()===name.toLowerCase());
   if(code&&(codes.has(code)||existing.some(d=>d.code===code&&d.id!==ex?.id))){errors.push({row:i+1,reason:`Code ${code} is already used`});return}
   if(code)codes.add(code);ok.push({name,code,cost_centre:g('costCentre'),description:g('description'),status,parent:g('parent'),existing:ex})});
  if(b.preview)return {preview:true,create:ok.filter(o=>!o.existing).length,update:ok.filter(o=>o.existing).length,errors};
  const s:D1PreparedStatement[]=[];
  for(const o of ok){if(o.existing)s.push(stmt('UPDATE departments SET code=CASE WHEN ?=\'\' THEN code ELSE ? END,cost_centre=CASE WHEN ?=\'\' THEN cost_centre ELSE ? END,description=CASE WHEN ?=\'\' THEN description ELSE ? END,status=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',o.code,o.code,o.cost_centre,o.cost_centre,o.description,o.description,o.status,u.id,now(),o.existing.id,u.tenantId));else s.push(stmt('INSERT INTO departments(id,tenant_id,name,code,cost_centre,description,status,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,o.name,o.code,o.cost_centre,o.description,o.status,u.id,now(),u.id,now()))}
  for(const o of ok.filter(o=>o.parent))s.push(stmt('UPDATE departments SET parent_id=(SELECT id FROM departments WHERE tenant_id=? AND lower(name)=lower(?)) WHERE tenant_id=? AND lower(name)=lower(?) AND lower(?)<>lower(name)',u.tenantId,o.parent,u.tenantId,o.name,o.parent));
  s.push(auditStatement(u,'Departments imported',u.tenantId,'Administration',null,{rows:ok.length,errors:errors.length}));
  for(let i=0;i<s.length;i+=90)await batch(s.slice(i,i+90));
  return {created:ok.filter(o=>!o.existing).length,updated:ok.filter(o=>o.existing).length,errors};
 }
 if(action==='delete-department'){
  assertAdmin(u);
  const id=idOf(b.id,'Department');const d=await first<{name:string}>('SELECT name FROM departments WHERE id=? AND tenant_id=?',id,u.tenantId);if(!d)throw new HttpError(404,'Department not found.');
  const used=await first<{n:number}>('SELECT count(*) AS n FROM members WHERE tenant_id=? AND lower(department)=lower(?)',u.tenantId,d.name);if(used?.n)throw new HttpError(409,`Move the ${used.n} people in ${d.name} first, or disable the department instead.`);
  if(await first('SELECT id FROM departments WHERE parent_id=? AND tenant_id=?',id,u.tenantId))throw new HttpError(409,'Move its sub-departments first.');
  await batch([stmt('DELETE FROM departments WHERE id=? AND tenant_id=?',id,u.tenantId),auditStatement(u,'Department deleted',id,d.name,d,null)]);return {ok:true};
 }
 if(action==='location'){
  if(!hasAction(u,'locations','create'))throw new HttpError(403,'Location management is not assigned to your account.');
  const name=str(b.name,'Location name',120).replaceAll('>','-');const parentId=b.parentId?idOf(b.parentId,'Parent location'):null;
  const parent=parentId?await first<{path:string}>('SELECT path FROM locations WHERE id=? AND tenant_id=?',parentId,u.tenantId):null;if(parentId&&!parent)throw new HttpError(400,'Parent location not found.');
  const path=parent?`${parent.path} > ${name}`:name;
  if(await first('SELECT id FROM locations WHERE tenant_id=? AND lower(path)=lower(?)',u.tenantId,path))throw new HttpError(409,'This location already exists.');
  const id=uid();await batch([stmt('INSERT INTO locations(id,tenant_id,name,parent_id,path,kind,created_at) VALUES(?,?,?,?,?,?,?)',id,u.tenantId,name,parentId,path,oneOf(b.kind||'Site',['Site','Building','Unit','Store','Area','Office','Warehouse'] as const,'location type'),now()),auditStatement(u,'Location created',id,'',null,{path})]);return {id,path};
 }
 if(action==='delete-location'){
  if(!hasAction(u,'locations','delete')&&!hasAction(u,'locations','update'))throw new HttpError(403,'Location management is not assigned to your account.');
  const id=idOf(b.id,'Location');const l=await first<{path:string}>('SELECT path FROM locations WHERE id=? AND tenant_id=?',id,u.tenantId);if(!l)throw new HttpError(404,'Location not found.');
  if(await first('SELECT id FROM locations WHERE parent_id=? AND tenant_id=?',id,u.tenantId))throw new HttpError(409,'Remove the locations inside this one first.');
  if(await first('SELECT id FROM assets WHERE tenant_id=? AND location=?',u.tenantId,l.path))throw new HttpError(409,'Move the assets at this location first.');
  await batch([stmt('DELETE FROM locations WHERE id=? AND tenant_id=?',id,u.tenantId),auditStatement(u,'Location deleted',id,'',l,null)]);return {ok:true};
 }
 throw new HttpError(400,'Unknown action.');
});
