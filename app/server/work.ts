import {hasAction,departmentKey} from '../access-policy';
import {workKindById,type WorkKind} from '../work-records';
import {all,first,HttpError} from './core';
import type {EdgeSpec,NodeSpec} from './graph';
import type {Member} from './policy';

// Connected work records (goals, objectives, initiatives, customers, contracts, services, meetings,
// decisions). Visibility: company (anyone with the page), department, or private (owner and admins).
export type WorkRow={id:string,tenant_id:string,kind:string,number:string,title:string,description:string,status:string,owner_id:string|null,department:string,location:string,parent_id:string|null,start_date:string|null,end_date:string|null,amount:number|null,currency:string,progress:number,data_json:string,visibility:string,created_by:string,created_at:string,updated_by:string,updated_at:string,deleted_at:string|null,acl_json?:string|null,version?:number};
// Restricted visibility: named people, groups, roles or departments (plus the owner and administrators).
//  leadership   — administrators and managers (unless roles are listed)
//  groups       — members of the listed groups
//  confidential — only the listed people (e.g. confidential financial initiatives)
//  partners     — the listed people, which may include external partner accounts (viewer role)
export type WorkAcl={people?:string[],groups?:string[],roles?:string[],departments?:string[]};
export function canSeeWork(u:Member,r:WorkRow){
 if(r.deleted_at||!hasAction(u,'business'))return false;
 if(u.role==='admin'||r.owner_id===u.id||r.created_by===u.id)return true;
 if(r.kind==='meeting'&&(JSON.parse(r.data_json||'{}').attendees||[]).includes(u.id))return true;
 if(r.visibility==='company')return true;
 if(r.visibility==='department')return [u.department,...(u.extraDepartments||[])].map(departmentKey).includes(departmentKey(r.department));
 if(['leadership','groups','confidential','partners'].includes(r.visibility)){
  let acl:WorkAcl={};try{acl=JSON.parse(r.acl_json||'{}')}catch{acl={}}
  if(acl.people?.includes(u.id))return true;
  if(r.visibility==='confidential'||r.visibility==='partners')return false;
  if(acl.groups?.some(g=>u.groupIds?.includes(g)))return true;
  if(acl.departments?.some(d=>departmentKey(d)===departmentKey(u.department)))return true;
  const roles=acl.roles?.length?acl.roles:r.visibility==='leadership'?['manager']:[];
  return roles.includes(u.role)||(!!u.roleId&&roles.includes(u.roleId));
 }
 return false;
}
export const canEditWork=(u:Member,r:WorkRow)=>u.role==='admin'||r.owner_id===u.id||r.created_by===u.id||(hasAction(u,'business','update')&&u.role==='manager'&&departmentKey(u.department)===departmentKey(r.department));
export async function loadWork(u:Member,id:string){const r=await first<WorkRow>('SELECT * FROM work_records WHERE id=? AND tenant_id=?',id,u.tenantId);if(!r||!canSeeWork(u,r))throw new HttpError(404,'Record not found.');return r}
export async function visibleWork(u:Member,ids:string[]){const out=new Set<string>();for(let i=0;i<ids.length;i+=90){const part=ids.slice(i,i+90);for(const r of await all<WorkRow>(`SELECT * FROM work_records WHERE tenant_id=? AND id IN (${part.map(()=>'?').join(',')})`,u.tenantId,...part))if(canSeeWork(u,r))out.add(r.id)}return out}
// Work Graph projection: the record, its owner, department, parent and every reference field.
export async function projectWork(tenantId:string,id:string):Promise<{node:NodeSpec,edges:EdgeSpec[]}|null>{
 const r=await first<WorkRow>('SELECT * FROM work_records WHERE id=? AND tenant_id=?',id,tenantId);if(!r||r.deleted_at)return null;
 const k=workKindById.get(r.kind) as WorkKind;if(!k)return null;const d=JSON.parse(r.data_json||'{}') as Record<string,unknown>;const edges:EdgeSpec[]=[];
 if(r.owner_id)edges.push({type:'owns',to:{type:'person',sourceId:r.owner_id},reverse:true});
 if(r.department){const dep=await first<{id:string}>('SELECT id FROM departments WHERE tenant_id=? AND lower(name)=lower(?)',tenantId,r.department);if(dep)edges.push({type:'belongs_to',to:{type:'department',sourceId:dep.id}})}
 if(r.parent_id&&(k.parent||k.parents)){const pk=k.parents?(await first<{kind:string}>('SELECT kind FROM work_records WHERE id=? AND tenant_id=?',r.parent_id,tenantId))?.kind:k.parent!.kind;const rel=k.parents?.find(p=>p.kind===pk)?.relationship||k.parent?.relationship||'part_of';if(pk)edges.push({type:rel,to:{type:pk,sourceId:r.parent_id}})}
 for(const f of k.fields){const v=d[f.key];
  if(f.type==='refs'&&Array.isArray(v))for(const x of v)if(typeof x==='string'&&x)edges.push({type:f.relationship!,to:{type:f.refType!,sourceId:x},reverse:!!f.reverse});
  if(f.type==='people'&&Array.isArray(v))for(const x of v)if(typeof x==='string')edges.push({type:'attended',to:{type:'person',sourceId:x},reverse:true});
  if(f.type==='person'&&typeof v==='string'&&v)edges.push({type:f.key==='decidedBy'?'decided_by':'related_to',to:{type:'person',sourceId:v}});
 }
 const summary=[r.description,...k.fields.filter(f=>['text','textarea'].includes(f.type)).map(f=>d[f.key])].filter(Boolean).join(' · ').slice(0,600);
 return {node:{type:r.kind,sourceId:r.id,title:`${r.number} · ${r.title}`,summary,status:r.status,ownerId:r.owner_id,department:r.department,location:r.location,module:'business',url:['strategy','theme','goal','objective','key_result','initiative','programme'].includes(r.kind)?`#/strategy/item/${r.id}`:['decision','meeting'].includes(r.kind)?`#/knowledge/${r.kind}s/${r.id}`:`#/business/${r.kind}/${r.id}`,meta:{amount:r.amount,currency:r.currency,start:r.start_date,end:r.end_date,progress:r.progress,kind:r.kind}},edges};
}
