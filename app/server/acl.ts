import {departmentKey} from '../access-policy';
import {all,first,HttpError,parseJson,tenantOf,tenantSettings} from './core';
import type {Acl,Audience} from '../acl';
import type {Member} from './policy';

// Content access control. Every query that returns files, announcements, pages, projects, tasks or channels
// filters rows through canView; search, AI retrieval, previews, downloads, exports and notifications all use the
// same function. Company Admins can see and manage everything inside their own company (and the Platform
// Owner only through an audited support session, where they act as a Company Admin).
const AUDIENCES:Audience[]=['private','department','departments','people','roles','groups','locations','project','space','company'];
// Legacy rows (before content ACLs) are mapped from their old visibility.
export function aclOf(json:string|null|undefined,legacy?:{visibility?:string,department?:string}):Acl{
 const a=parseJson<Acl|null>(json,null);if(a&&AUDIENCES.includes(a.mode))return a;
 const v=legacy?.visibility||'company';
 if(v==='private')return {mode:'private'};
 if(v==='department')return {mode:'department',departments:legacy?.department?[legacy.department]:[]};
 return {mode:'company'};
}
export function canView(u:Member,acl:Acl,owner?:string|null):boolean{
 if(u.role==='admin'||(owner&&owner===u.id)||acl.editors?.includes(u.id))return true;
 const inDept=(ds?:string[])=>!!ds?.some(d=>departmentKey(d)===departmentKey(u.department)||u.extraDepartments?.some(x=>departmentKey(x)===departmentKey(d)));
 switch(acl.mode){
  case 'company':return true;
  case 'private':return false;
  case 'department':case 'departments':return inDept(acl.departments);
  case 'people':return !!acl.people?.includes(u.id);
  case 'roles':return !!acl.roles?.some(r=>r===u.roleId||r===u.role);
  case 'groups':return !!acl.groups?.some(g=>u.groupIds?.includes(g));
  case 'locations':return !!acl.locations?.some(l=>(u.location||'').toLowerCase().startsWith(l.toLowerCase()));
  case 'project':return !!acl.projectId&&!!u.projectIds?.includes(acl.projectId);
  case 'space':return !!acl.spaceId&&!!u.spaceIds?.includes(acl.spaceId);
 }
 return false;
}
// Editing, sharing, changing access, deleting and restoring: owner, named editors and Company Admins.
export const canManage=(u:Member,acl:Acl,owner?:string|null)=>u.role==='admin'||(!!owner&&owner===u.id)||!!acl.editors?.includes(u.id);
// The default audience for new staff content: the uploader's department, or private when they have none.
export function defaultAcl(u:Member):Acl{return u.department&&departmentKey(u.department)!=='unassigned'&&u.department!=='Platform support'?{mode:'department',departments:[u.department]}:{mode:'private'}}
const list=(v:unknown,max=200)=>Array.isArray(v)?[...new Set(v.map(x=>String(x).slice(0,160)).filter(Boolean))].slice(0,max):[];
// Validates an audience against the current company: every department, person, role, group, project and space
// must exist in this workspace. Returns {acl, needsApproval} when company-wide publishing is restricted.
export async function validateAcl(u:Member,input:unknown,fallback?:Acl):Promise<{acl:Acl,needsApproval:boolean}>{
 if(input===undefined||input===null)return {acl:fallback||defaultAcl(u),needsApproval:false};
 const o=(typeof input==='object'?input:{}) as Record<string,unknown>;
 const mode=String(o.mode) as Audience;if(!AUDIENCES.includes(mode))throw new HttpError(400,'Choose who can see this.');
 const acl:Acl={mode};const t=u.tenantId;
 const check=async(sql:string,ids:string[],label:string)=>{if(!ids.length)return;const found=new Set((await all<{v:string}>(sql.replace('%IN%',ids.map(()=>'?').join(',')),t,...ids)).map(r=>r.v));const bad=ids.filter(i=>!found.has(i));if(bad.length)throw new HttpError(400,`${label} not found in this company.`)};
 if(mode==='department')acl.departments=list(o.departments).slice(0,1).length?list(o.departments).slice(0,1):[u.department];
 if(mode==='departments'){acl.departments=list(o.departments);if(!acl.departments.length)throw new HttpError(400,'Choose at least one department.')}
 if(acl.departments?.length)await check('SELECT name AS v FROM departments WHERE tenant_id=? AND name IN (%IN%)',acl.departments,'A department');
 if(mode==='people'){acl.people=list(o.people);if(!acl.people.length)throw new HttpError(400,'Choose at least one person.');await check('SELECT id AS v FROM members WHERE tenant_id=? AND id IN (%IN%)',acl.people,'A person')}
 if(mode==='roles'){acl.roles=list(o.roles);if(!acl.roles.length)throw new HttpError(400,'Choose at least one role.');const base=['admin','manager','employee','viewer'];await check('SELECT id AS v FROM roles WHERE tenant_id=? AND id IN (%IN%)',acl.roles.filter(r=>!base.includes(r)),'A role')}
 if(mode==='groups'){acl.groups=list(o.groups);if(!acl.groups.length)throw new HttpError(400,'Choose at least one group.');await check("SELECT id AS v FROM groups WHERE tenant_id=? AND status='active' AND id IN (%IN%)",acl.groups,'A group')}
 if(mode==='locations'){acl.locations=list(o.locations);if(!acl.locations.length)throw new HttpError(400,'Choose at least one location.')}
 if(mode==='project'){acl.projectId=String(o.projectId||'');await check('SELECT id AS v FROM projects WHERE tenant_id=? AND id IN (%IN%)',[acl.projectId],'The project')}
 if(mode==='space'){acl.spaceId=String(o.spaceId||'');await check('SELECT id AS v FROM spaces WHERE tenant_id=? AND id IN (%IN%)',[acl.spaceId],'The space')}
 const editors=list(o.editors,50);if(editors.length){await check('SELECT id AS v FROM members WHERE tenant_id=? AND id IN (%IN%)',editors,'An editor');acl.editors=editors}
 let needsApproval=false;
 if(mode==='company'&&u.role!=='admin'){const s=tenantSettings(await tenantOf(u));if(s.companyWidePublishing==='admins')needsApproval=true}
 return {acl,needsApproval};
}
// Group, project and space memberships for access checks (loaded once per request).
export async function loadMemberships(u:Member){
 const [groups,dynamic,projects,spaces]=await Promise.all([
  all<{group_id:string}>("SELECT gm.group_id FROM group_members gm JOIN groups g ON g.id=gm.group_id AND g.tenant_id=gm.tenant_id WHERE gm.tenant_id=? AND gm.member_id=? AND g.status='active'",u.tenantId,u.id).catch(()=>[]),
  all<{id:string,rules_json:string}>("SELECT id,rules_json FROM groups WHERE tenant_id=? AND status='active' AND membership_mode='dynamic'",u.tenantId).catch(()=>[]),
  all<{project_id:string}>('SELECT project_id FROM project_members WHERE tenant_id=? AND member_id=?',u.tenantId,u.id).catch(()=>[]),
  // Explicit space members, plus the company space and the member's own department space.
  all<{space_id:string}>("SELECT space_id FROM space_members WHERE tenant_id=?1 AND member_id=?2 UNION SELECT id FROM spaces WHERE tenant_id=?1 AND (kind='company' OR (kind='department' AND lower(department)=lower(?3)))",u.tenantId,u.id,u.department).catch(()=>[]),
 ]);
 u.groupIds=[...new Set([...groups.map(g=>g.group_id),...dynamic.filter(g=>matchesRules(u,parseJson(g.rules_json,{}))).map(g=>g.id)])];
 u.projectIds=projects.map(p=>p.project_id);
 u.spaceIds=spaces.map(s=>s.space_id);
}
// Dynamic group rules: every listed dimension must match (departments, locations, roles, job titles).
export type GroupRules={departments?:string[],locations?:string[],roles?:string[],titles?:string[]};
export function matchesRules(m:{department:string,location?:string,role:string,roleId?:string|null,title?:string},r:GroupRules){
 const has=(xs?:string[])=>!!xs&&xs.length>0;if(!has(r.departments)&&!has(r.locations)&&!has(r.roles)&&!has(r.titles))return false;
 if(has(r.departments)&&!r.departments!.some(d=>departmentKey(d)===departmentKey(m.department)))return false;
 if(has(r.locations)&&!r.locations!.some(l=>(m.location||'').toLowerCase().startsWith(l.toLowerCase())))return false;
 if(has(r.roles)&&!r.roles!.some(x=>x===m.role||x===m.roleId))return false;
 if(has(r.titles)&&!r.titles!.some(t=>(m.title||'').toLowerCase()===t.toLowerCase()))return false;
 return true;
}
export async function memberNames(tenantId:string){return new Map((await all<{id:string,name:string}>('SELECT id,name FROM members WHERE tenant_id=?',tenantId)).map(m=>[m.id,m.name]))}
export async function spaceOf(tenantId:string,id:string){return first<{id:string,kind:string,department:string,project_id:string|null,visibility:string,name:string}>('SELECT id,kind,department,project_id,visibility,name FROM spaces WHERE id=? AND tenant_id=?',id,tenantId)}
// Everyone an audience reaches (active members), for notifications and read-receipt reports.
export async function audienceMembers(tenantId:string,acl:Acl):Promise<string[]>{
 const people=await all<{id:string,department:string,location:string,role:string,role_id:string|null,title:string}>('SELECT id,department,location,role,role_id,title FROM members WHERE tenant_id=? AND active=1',tenantId);
 const lower=(xs?:string[])=>new Set((xs||[]).map(x=>departmentKey(x)));
 switch(acl.mode){
  case 'company':return people.map(p=>p.id);
  case 'private':return [];
  case 'department':case 'departments':{const d=lower(acl.departments);return people.filter(p=>d.has(departmentKey(p.department))).map(p=>p.id)}
  case 'people':{const set=new Set(acl.people||[]);return people.filter(p=>set.has(p.id)).map(p=>p.id)}
  case 'roles':{const set=new Set(acl.roles||[]);return people.filter(p=>set.has(p.role)||(p.role_id&&set.has(p.role_id))).map(p=>p.id)}
  case 'locations':return people.filter(p=>acl.locations?.some(l=>(p.location||'').toLowerCase().startsWith(l.toLowerCase()))).map(p=>p.id);
  case 'groups':{
   const ids=acl.groups||[];if(!ids.length)return [];
   const groups=await all<{id:string,membership_mode:string,rules_json:string}>(`SELECT id,membership_mode,rules_json FROM groups WHERE tenant_id=? AND status='active' AND id IN (${ids.map(()=>'?').join(',')})`,tenantId,...ids);
   const stat=new Set((await all<{member_id:string}>(`SELECT member_id FROM group_members WHERE tenant_id=? AND group_id IN (${ids.map(()=>'?').join(',')})`,tenantId,...ids)).map(r=>r.member_id));
   const dyn=groups.filter(g=>g.membership_mode==='dynamic').map(g=>parseJson<GroupRules>(g.rules_json,{}));
   return people.filter(p=>stat.has(p.id)||dyn.some(r=>matchesRules({...p,roleId:p.role_id},r))).map(p=>p.id);
  }
  case 'project':{if(!acl.projectId)return [];const rows=await all<{m:string}>('SELECT member_id AS m FROM project_members WHERE tenant_id=?1 AND project_id=?2 UNION SELECT owner_id FROM projects WHERE tenant_id=?1 AND id=?2 AND owner_id IS NOT NULL UNION SELECT manager_id FROM projects WHERE tenant_id=?1 AND id=?2 AND manager_id IS NOT NULL',tenantId,acl.projectId);const set=new Set(rows.map(r=>r.m));return people.filter(p=>set.has(p.id)).map(p=>p.id)}
  case 'space':{if(!acl.spaceId)return [];const s=await spaceOf(tenantId,acl.spaceId);if(!s)return [];if(s.kind==='company')return people.map(p=>p.id);const explicit=new Set((await all<{member_id:string}>('SELECT member_id FROM space_members WHERE tenant_id=? AND space_id=?',tenantId,s.id)).map(r=>r.member_id));return people.filter(p=>explicit.has(p.id)||(s.kind==='department'&&departmentKey(p.department)===departmentKey(s.department))).map(p=>p.id)}
 }
 return [];
}
