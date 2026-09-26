import {pageActions,baseRoles,permissionMap,roleRules,type AccessRule} from '../../access-policy';
import {roleTemplates} from '../../role-templates';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,oneOf,idOf,auditStatement} from '../../server/core';

// Custom roles (e.g. "PR User", "Purchase Head") layer a permission matrix and an
// optional location scope on top of a base access level.
function validPermissions(v:unknown){
 if(!v||typeof v!=='object')return {};
 const out:Record<string,Record<string,string>>={};
 for(const [page,acts] of Object.entries(v as Record<string,unknown>)){
  if(!pageActions[page]||!acts||typeof acts!=='object')continue;
  for(const [action,scope] of Object.entries(acts as Record<string,unknown>)){
   if(!pageActions[page].includes(action)||!['none','own','department','all'].includes(String(scope)))continue;
   if(['it','research','company-data'].includes(page)&&!['none','all'].includes(String(scope)))throw new HttpError(400,'IT, Research and the Data hub are shared libraries: choose All or None.');
   (out[page]||=(out[page]={}))[action]=String(scope);
  }
 }
 return out;
}
export const GET=route(async(_req,u)=>{
 if(u.role!=='admin')throw new HttpError(403,'Only administrators manage roles.');
 const roles=await all<{id:string,name:string,description:string,base:string,permissions_json:string,locations_json:string,default_screen:string,created_at:string,updated_at:string,updated_by:string}>('SELECT r.*,(SELECT count(*) FROM members m WHERE m.role_id=r.id AND m.tenant_id=r.tenant_id AND m.active=1) AS members FROM roles r WHERE r.tenant_id=? ORDER BY r.name',u.tenantId);
 const rules=await all<AccessRule>('SELECT * FROM access_rules WHERE tenant_id=?',u.tenantId);
 // Effective matrix for a representative member of each role, so the editor can show inherited defaults.
 return {pageActions,templates:roleTemplates,roles:roles.map(r=>({...r,permissions:JSON.parse(r.permissions_json||'{}'),locations:JSON.parse(r.locations_json||'[]'),scope:JSON.parse((r as unknown as {scope_json:string}).scope_json||'{}'),effective:permissionMap({id:'preview',role:r.base,department:'',active:1,roleId:r.id,rules:[...rules.filter(x=>x.subject_type!=='user'),...roleRules(r.id,r.permissions_json)]})})),defaults:Object.fromEntries(baseRoles.map(b=>[b,permissionMap({id:'preview',role:b,department:'',active:1,rules:[]})]))};
});
export const POST=route(async(req,u)=>{
 if(u.role!=='admin')throw new HttpError(403,'Only administrators manage roles.');
 const b=await readBody(req);
 if(b.action==='delete'){
  const id=idOf(b.id,'Role');const r=await first<{name:string}>('SELECT name FROM roles WHERE id=? AND tenant_id=?',id,u.tenantId);if(!r)throw new HttpError(404,'Role not found.');
  const used=await first<{n:number}>('SELECT count(*) AS n FROM members WHERE role_id=? AND tenant_id=?',id,u.tenantId);if(used?.n)throw new HttpError(409,`Move the ${used.n} people using “${r.name}” to another role first.`);
  await batch([stmt('DELETE FROM roles WHERE id=? AND tenant_id=?',id,u.tenantId),auditStatement(u,'Role deleted',id,'Administration',r,null)]);return {ok:true};
 }
 const name=str(b.name,'Role name',80),base=oneOf(b.base,baseRoles,'role type');
 const permissions=validPermissions(b.permissions);
 const list=(v:unknown,label:string)=>Array.isArray(v)?v.map(x=>str(x,label,200)).filter(Boolean).slice(0,300):[];
 const locations=list(b.locations,'Location');
 const sc=(b.scope&&typeof b.scope==='object'?b.scope:{}) as Record<string,unknown>;
 // Record filters layered on the permission matrix: selected departments count as the person's own department.
 const scope={departments:list(sc.departments,'Department'),assetCategories:list(sc.assetCategories,'Asset category'),assetStatuses:list(sc.assetStatuses,'Asset status')};
 const template=roleTemplates.some(t=>t.id===b.template)?String(b.template):'custom';
 const values=[name,str(b.description,'Description',400,false),base,JSON.stringify(permissions),JSON.stringify(locations),str(b.defaultScreen,'Default screen',60,false),JSON.stringify(scope),b.vendorAccess?1:0,b.assignedOnly?1:0,template];
 if(b.id){
  const id=idOf(b.id,'Role');const before=await first('SELECT * FROM roles WHERE id=? AND tenant_id=?',id,u.tenantId);if(!before)throw new HttpError(404,'Role not found.');
  if(await first('SELECT id FROM roles WHERE tenant_id=? AND lower(name)=lower(?) AND id!=?',u.tenantId,name,id))throw new HttpError(409,'Another role already uses this name.');
  await batch([
   stmt('UPDATE roles SET name=?,description=?,base=?,permissions_json=?,locations_json=?,default_screen=?,scope_json=?,vendor_access=?,assigned_only=?,template=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',...values,u.name,now(),id,u.tenantId),
   // The base access level travels with the role.
   stmt("UPDATE members SET role=? WHERE role_id=? AND tenant_id=? AND role!='admin'",base,id,u.tenantId),
   auditStatement(u,'Role updated',id,'Administration',before,{name,base,permissions,locations}),
  ]);
  return {id};
 }
 if(await first('SELECT id FROM roles WHERE tenant_id=? AND lower(name)=lower(?)',u.tenantId,name))throw new HttpError(409,'A role with this name already exists.');
 const id=uid();
 await batch([stmt('INSERT INTO roles(id,tenant_id,name,description,base,permissions_json,locations_json,default_screen,scope_json,vendor_access,assigned_only,template,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,...values,u.name,now(),u.name,now()),auditStatement(u,'Role created',id,'Administration',null,{name,base,permissions})]);
 return {id};
});
