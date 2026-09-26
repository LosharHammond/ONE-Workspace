import {hasAction} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,idOf,oneOf,auditStatement} from '../../server/core';
// Departments (with heads, which drive approvals and department spaces) and the location tree.
export const GET=route(async(_req,u)=>{
 const [departments,locations]=await Promise.all([
  all("SELECT d.id,d.name,d.code,d.head_id AS headId,d.description,d.color,(SELECT count(*) FROM members m WHERE m.tenant_id=d.tenant_id AND m.active=1 AND lower(m.department)=lower(d.name)) AS members FROM departments d WHERE d.tenant_id=? ORDER BY d.name",u.tenantId),
  all('SELECT l.id,l.name,l.path,l.parent_id AS parentId,l.kind,(SELECT count(*) FROM assets a WHERE a.tenant_id=l.tenant_id AND a.location=l.path) AS assets FROM locations l WHERE l.tenant_id=? ORDER BY l.path',u.tenantId),
 ]);
 return {departments,locations};
});
export const POST=route(async(req,u)=>{
 const b=await readBody(req);const action=String(b.action||'');
 if(action==='department'){
  if(u.role!=='admin')throw new HttpError(403,'Only administrators manage departments.');
  const name=str(b.name,'Department name',120);const headId=b.headId?idOf(b.headId,'Department head'):null;
  if(headId&&!await first('SELECT id FROM members WHERE id=? AND tenant_id=? AND active=1',headId,u.tenantId))throw new HttpError(400,'Choose an active department head.');
  const values=[name,str(b.code,'Code',20,false),headId,str(b.description,'Description',600,false),str(b.color,'Colour',20,false)];
  if(b.id){const id=idOf(b.id,'Department');const before=await first<{name:string}>('SELECT * FROM departments WHERE id=? AND tenant_id=?',id,u.tenantId);if(!before)throw new HttpError(404,'Department not found.');
   await batch([stmt('UPDATE departments SET name=?,code=?,head_id=?,description=?,color=? WHERE id=? AND tenant_id=?',...values,id,u.tenantId),
    // Renaming a department carries its people and records with it.
    ...(before.name!==name?[stmt('UPDATE members SET department=? WHERE tenant_id=? AND department=?',name,u.tenantId,before.name),stmt('UPDATE pages SET department=? WHERE tenant_id=? AND department=?',name,u.tenantId,before.name)]:[]),
    auditStatement(u,'Department updated',id,name,before,{name,headId})]);return {id}}
  if(await first('SELECT id FROM departments WHERE tenant_id=? AND lower(name)=lower(?)',u.tenantId,name))throw new HttpError(409,'This department already exists.');
  const id=uid();await batch([stmt('INSERT INTO departments(id,tenant_id,name,code,head_id,description,color,created_at) VALUES(?,?,?,?,?,?,?,?)',id,u.tenantId,...values,now()),auditStatement(u,'Department created',id,name,null,{name})]);return {id};
 }
 if(action==='delete-department'){
  if(u.role!=='admin')throw new HttpError(403,'Only administrators manage departments.');
  const id=idOf(b.id,'Department');const d=await first<{name:string}>('SELECT name FROM departments WHERE id=? AND tenant_id=?',id,u.tenantId);if(!d)throw new HttpError(404,'Department not found.');
  const used=await first<{n:number}>('SELECT count(*) AS n FROM members WHERE tenant_id=? AND lower(department)=lower(?)',u.tenantId,d.name);if(used?.n)throw new HttpError(409,`Move the ${used.n} people in ${d.name} first.`);
  await batch([stmt('DELETE FROM departments WHERE id=? AND tenant_id=?',id,u.tenantId),auditStatement(u,'Department deleted',id,d.name,d,null)]);return {ok:true};
 }
 if(action==='location'){
  if(!hasAction(u,'locations','create'))throw new HttpError(403,'Location management is not assigned to your account.');
  const name=str(b.name,'Location name',120).replaceAll('>','-');const parentId=b.parentId?idOf(b.parentId,'Parent location'):null;
  const parent=parentId?await first<{path:string}>('SELECT path FROM locations WHERE id=? AND tenant_id=?',parentId,u.tenantId):null;if(parentId&&!parent)throw new HttpError(400,'Parent location not found.');
  const path=parent?`${parent.path} > ${name}`:name;
  if(await first('SELECT id FROM locations WHERE tenant_id=? AND lower(path)=lower(?)',u.tenantId,path))throw new HttpError(409,'This location already exists.');
  const id=uid();await batch([stmt('INSERT INTO locations(id,tenant_id,name,parent_id,path,kind,created_at) VALUES(?,?,?,?,?,?,?)',id,u.tenantId,name,parentId,path,oneOf(b.kind||'Site',['Site','Building','Unit','Store','Area','Office'],'location type'),now()),auditStatement(u,'Location created',id,'',null,{path})]);return {id,path};
 }
 if(action==='delete-location'){
  if(!hasAction(u,'locations','update'))throw new HttpError(403,'Location management is not assigned to your account.');
  const id=idOf(b.id,'Location');const l=await first<{path:string}>('SELECT path FROM locations WHERE id=? AND tenant_id=?',id,u.tenantId);if(!l)throw new HttpError(404,'Location not found.');
  if(await first('SELECT id FROM locations WHERE parent_id=? AND tenant_id=?',id,u.tenantId))throw new HttpError(409,'Remove the locations inside this one first.');
  await batch([stmt('DELETE FROM locations WHERE id=? AND tenant_id=?',id,u.tenantId),auditStatement(u,'Location deleted',id,'',l,null)]);return {ok:true};
 }
 throw new HttpError(400,'Unknown action.');
});
