import {pageActions,baseRoles,permissionMap,roleRules,alwaysPages,pageLabels,type AccessRule,type Scope} from '../../access-policy';
import {roleTemplates} from '../../role-templates';
import {corePages} from '../../page-catalog';
import {entitledPages,blockedPages} from '../../modules';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,oneOf,idOf,auditStatement,tenantOf,tenantSettings,parseJson} from '../../server/core';
import type {Member} from '../../server/policy';

// Custom roles (e.g. "IT", "PR User", "Purchase Head") layer a page list, a permission matrix and record
// scopes on top of a base access level. Everything is validated here: a role can only receive pages the
// company is entitled to, never more than the person creating it has, and View comes before other actions.
const rank:Record<string,number>={none:0,own:1,department:2,all:3};
const label=(p:string)=>pageLabels[p]||p;
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
async function entitlement(u:Member){const t=await tenantOf(u);const s=tenantSettings(t);return {entitled:entitledPages(s),blocked:blockedPages(s)}}
// Effective access of a representative member of a role, including company entitlements and the page list.
function roleMap(r:{id?:string,base:string,permissions_json:string,pages_json?:string|null},rules:AccessRule[],blocked:string[]){
 return permissionMap({id:'preview',role:r.base,department:'',active:1,roleId:r.id||'preview-role',disabledPages:blocked,rolePages:r.pages_json?parseJson<string[]>(r.pages_json,[]):null,rules:[...rules.filter(x=>x.subject_type!=='user'),...roleRules(r.id||'preview-role',r.permissions_json)]});
}
export const GET=route(async(_req,u)=>{
 if(u.role!=='admin')throw new HttpError(403,'Only administrators manage roles.');
 const [{entitled,blocked},roles,rules]=await Promise.all([entitlement(u),all<{id:string,name:string,description:string,base:string,permissions_json:string,locations_json:string,scope_json:string,pages_json:string|null,default_screen:string,created_at:string,updated_at:string,updated_by:string}>('SELECT r.*,(SELECT count(*) FROM members m WHERE m.role_id=r.id AND m.tenant_id=r.tenant_id AND m.active=1) AS members FROM roles r WHERE r.tenant_id=? ORDER BY r.name',u.tenantId),all<AccessRule>('SELECT * FROM access_rules WHERE tenant_id=?',u.tenantId)]);
 return {pageActions,templates:roleTemplates,entitledPages:[...corePages,...entitled],
  roles:roles.map(r=>({...r,permissions:parseJson(r.permissions_json,{}),locations:parseJson(r.locations_json,[]),scope:parseJson(r.scope_json,{}),pages:r.pages_json?parseJson<string[]>(r.pages_json,[]):null,effective:roleMap(r,rules,blocked)})),
  defaults:Object.fromEntries(baseRoles.map(b=>[b,permissionMap({id:'preview',role:b,department:'',active:1,disabledPages:blocked,rules:[]})]))};
});
export const POST=route(async(req,u)=>{
 if(u.role!=='admin')throw new HttpError(403,'Only administrators manage roles.');
 const b=await readBody(req);
 if(b.action==='delete'){
  const id=idOf(b.id,'Role');const r=await first<{name:string}>('SELECT name FROM roles WHERE id=? AND tenant_id=?',id,u.tenantId);if(!r)throw new HttpError(404,'Role not found.');
  const used=await first<{n:number}>('SELECT count(*) AS n FROM members WHERE role_id=? AND tenant_id=?',id,u.tenantId);if(used?.n)throw new HttpError(409,`Move the ${used.n} people using “${r.name}” to another role first.`);
  await batch([stmt('DELETE FROM roles WHERE id=? AND tenant_id=?',id,u.tenantId),auditStatement(u,'Role deleted',id,'Administration',r,null)]);return {ok:true};
 }
 const {entitled,blocked}=await entitlement(u);
 const available=new Set([...corePages,...entitled]);
 // Preview: effective access for an unsaved role, computed exactly as the server will enforce it.
 const name=b.action==='preview'?'Preview':str(b.name,'Role name',80);
 const base=oneOf(b.base,baseRoles,'role type');
 const permissions=validPermissions(b.permissions);
 // Page list: null keeps the role type's baseline; a list denies every other page.
 let pages:string[]|null=null;
 if(Array.isArray(b.pages)){
  pages=[...new Set(b.pages.map(String))].filter(p=>!alwaysPages.includes(p));
  for(const p of pages){if(!pageActions[p])throw new HttpError(400,'Choose valid pages.');if(!available.has(p))throw new HttpError(400,`${label(p)} is not available to your company. Ask the Platform Owner to add it.`)}
 }
 for(const [p,acts] of Object.entries(permissions)){
  const granted=Object.entries(acts).filter(([,v])=>v!=='none');
  if(!granted.length)continue;
  if(!available.has(p))throw new HttpError(400,`${label(p)} is not available to your company. Ask the Platform Owner to add it.`);
  if(pages&&!pages.includes(p)&&!alwaysPages.includes(p))throw new HttpError(400,`Add ${label(p)} to the role's pages before granting permissions on it.`);
  if(acts.view==='none'&&granted.length)throw new HttpError(400,`Grant View on ${label(p)} before other actions.`);
 }
 // A role can never exceed the access of the person creating it.
 const mine=permissionMap(u);
 for(const [p,acts] of Object.entries(permissions))for(const [a,v] of Object.entries(acts))if(rank[v]>rank[(mine[p]?.[a]||'none') as Scope])throw new HttpError(403,`You cannot grant ${a} on ${label(p)} beyond your own access.`);
 if(base==='admin'&&u.role!=='admin')throw new HttpError(403,'Only Company Admins can create Company Admin roles.');
 if(b.action==='preview'){const rules=await all<AccessRule>('SELECT * FROM access_rules WHERE tenant_id=?',u.tenantId);return {effective:roleMap({base,permissions_json:JSON.stringify(permissions),pages_json:pages?JSON.stringify(pages):null},rules,blocked)}}
 const list=(v:unknown,l:string)=>Array.isArray(v)?v.map(x=>str(x,l,200)).filter(Boolean).slice(0,300):[];
 const locations=list(b.locations,'Location');
 const sc=(b.scope&&typeof b.scope==='object'?b.scope:{}) as Record<string,unknown>;
 // Record filters layered on the permission matrix: selected departments count as the person's own department.
 const scope={departments:list(sc.departments,'Department'),assetCategories:list(sc.assetCategories,'Asset category'),assetStatuses:list(sc.assetStatuses,'Asset status')};
 const template=roleTemplates.some(t=>t.id===b.template)?String(b.template):'custom';
 const values=[name,str(b.description,'Description',400,false),base,JSON.stringify(permissions),JSON.stringify(locations),str(b.defaultScreen,'Default screen',60,false),JSON.stringify(scope),b.vendorAccess?1:0,b.assignedOnly?1:0,template,pages?JSON.stringify(pages):null];
 const summary={name,base,pages,permissions,locations,scope};
 if(b.id){
  const id=idOf(b.id,'Role');const before=await first<Record<string,unknown>>('SELECT * FROM roles WHERE id=? AND tenant_id=?',id,u.tenantId);if(!before)throw new HttpError(404,'Role not found.');
  if(await first('SELECT id FROM roles WHERE tenant_id=? AND lower(name)=lower(?) AND id!=?',u.tenantId,name,id))throw new HttpError(409,'Another role already uses this name.');
  await batch([
   stmt('UPDATE roles SET name=?,description=?,base=?,permissions_json=?,locations_json=?,default_screen=?,scope_json=?,vendor_access=?,assigned_only=?,template=?,pages_json=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',...values,u.name,now(),id,u.tenantId),
   // The base access level travels with the role.
   stmt("UPDATE members SET role=? WHERE role_id=? AND tenant_id=? AND role!='admin'",base,id,u.tenantId),
   auditStatement(u,'Role permissions changed',id,'Administration',{name:before.name,base:before.base,pages:parseJson(before.pages_json as string,null),permissions:parseJson(before.permissions_json as string,{})},summary),
  ]);
  return {id};
 }
 if(await first('SELECT id FROM roles WHERE tenant_id=? AND lower(name)=lower(?)',u.tenantId,name))throw new HttpError(409,'A role with this name already exists.');
 const id=uid();
 await batch([stmt('INSERT INTO roles(id,tenant_id,name,description,base,permissions_json,locations_json,default_screen,scope_json,vendor_access,assigned_only,template,pages_json,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,...values,u.name,now(),u.name,now()),auditStatement(u,'Role created',id,'Administration',null,summary)]);
 return {id};
});
