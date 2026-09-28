import {all,first,stmt,batch,uid,now,HttpError,auditStatement,parseJson} from './core';
import {hasAction} from '../access-policy';
import type {Member} from './policy';

// Delegation and absence cover. A person (delegator) lets another person (delegate) act on their approvals and
// work for a bounded period, optionally limited to modules or item types. Delegates act under their OWN
// identity ("on behalf of" is recorded in the audit trail). Rules:
//  • dates are enforced at the time of the action; ended or revoked delegations stop immediately
//  • a delegate must hold the same approval permission on the module (an equally authorised role)
//  • chains and cycles are refused (A→B while B→A, or A→B→C)
//  • company policy can forbid delegation for sensitive approvals (over an amount or for listed item types)
export type Delegation={id:string,tenant_id:string,delegator_id:string,delegate_id:string,modules_json:string,item_types_json:string,source_type:string|null,source_id:string|null,starts_at:string,ends_at:string,reason:string,out_of_office:number,status:string,created_by:string,created_at:string};
export type Policy={allowDelegation:boolean,maxDays:number,nonDelegableTypes:string[],nonDelegableAbove:number|null,requireSameRole:boolean};
export async function delegationPolicy(tenantId:string):Promise<Policy>{
 const r=await first<{config_json:string}>("SELECT config_json FROM inbox_rules WHERE tenant_id=? AND kind='delegation' AND enabled=1 ORDER BY updated_at DESC LIMIT 1",tenantId);
 const c=parseJson<Partial<Policy>>(r?.config_json,{});
 return {allowDelegation:c.allowDelegation!==false,maxDays:Number(c.maxDays)||90,nonDelegableTypes:Array.isArray(c.nonDelegableTypes)?c.nonDelegableTypes:[],nonDelegableAbove:c.nonDelegableAbove==null?null:Number(c.nonDelegableAbove),requireSameRole:c.requireSameRole!==false};
}
const MODULE_PAGE:Record<string,[string,string]>={purchasing:['requests','approve'],procurement:['procurement','approve'],studio:['studio','view'],lifecycle:['lifecycle','approve'],projects:['projects','approve'],tasks:['tasks','update'],tickets:['maintenance','update'],strategy:['strategy','update'],knowledge:['knowledge','update']};
function covers(d:Delegation,module:string,itemType:string,at:string,source?:{type:string,id:string}){
 if(d.status!=='active'||d.starts_at>at||d.ends_at<at)return false;
 if(d.source_type&&(!source||d.source_type!==source.type||d.source_id!==source.id))return false;
 const mods=parseJson<string[]>(d.modules_json,[]),types=parseJson<string[]>(d.item_types_json,[]);
 return (!mods.length||mods.includes(module))&&(!types.length||types.includes(itemType));
}
// Active delegations TO this person, for a module/item type (optionally a single source record).
export async function activeFor(tenantId:string,delegateId:string,module:string,itemType:string,source?:{type:string,id:string}){
 const at=now();return (await all<Delegation>("SELECT * FROM inbox_delegations WHERE tenant_id=? AND delegate_id=? AND status='active'",tenantId,delegateId)).filter(d=>covers(d,module,itemType,at,source));
}
// The delegators among `approverIds` whose approvals this person may currently act on, or [] if none.
export async function actingFor(u:Member,approverIds:string[],module:string,o:{itemType?:string,amount?:number|null,source?:{type:string,id:string}}={}):Promise<string[]>{
 const p=await delegationPolicy(u.tenantId);if(!p.allowDelegation)return [];
 const itemType=o.itemType||'approval';if(p.nonDelegableTypes.includes(itemType)||p.nonDelegableTypes.includes(`${module}:${itemType}`))return [];
 if(p.nonDelegableAbove!=null&&o.amount!=null&&o.amount>p.nonDelegableAbove)return [];
 const ds=(await activeFor(u.tenantId,u.id,module,itemType,o.source)).filter(d=>approverIds.includes(d.delegator_id));
 if(!ds.length)return [];
 const perm=MODULE_PAGE[module];if(perm&&p.requireSameRole&&u.role!=='admin'&&!hasAction(u,perm[0],perm[1]))return [];
 return ds.map(d=>d.delegator_id);
}
// Everyone currently covering for `delegatorId` (used by the inbox projection to route items to delegates).
export async function delegatesOf(tenantId:string,delegatorId:string,module:string,itemType:string,source?:{type:string,id:string}){
 const at=now();return (await all<Delegation>("SELECT * FROM inbox_delegations WHERE tenant_id=? AND delegator_id=? AND status='active'",tenantId,delegatorId)).filter(d=>covers(d,module,itemType,at,source)).map(d=>d.delegate_id);
}
export async function createDelegation(u:Member,b:{delegatorId?:string,delegateId:string,modules?:string[],itemTypes?:string[],startsAt:string,endsAt:string,reason?:string,outOfOffice?:boolean,source?:{type:string,id:string}}){
 const p=await delegationPolicy(u.tenantId);if(!p.allowDelegation)throw new HttpError(403,'Delegation is switched off by your company.');
 const delegator=b.delegatorId||u.id;
 if(delegator!==u.id&&u.role!=='admin')throw new HttpError(403,'Only administrators can set up cover for someone else.');
 if(b.delegateId===delegator)throw new HttpError(400,'Choose someone other than the person being covered.');
 const people=await all<{id:string,active:number}>('SELECT id,active FROM members WHERE tenant_id=? AND id IN (?,?)',u.tenantId,delegator,b.delegateId);
 if(people.length<2||people.some(x=>!x.active))throw new HttpError(400,'Both people must be active members of this company.');
 const s=Date.parse(b.startsAt),e=Date.parse(b.endsAt);if(!Number.isFinite(s)||!Number.isFinite(e)||e<=s)throw new HttpError(400,'Choose a start and an end after it.');if(e<=Date.now())throw new HttpError(400,'The delegation would already have ended; choose an end in the future.');
 if((e-s)/86400000>p.maxDays)throw new HttpError(400,`Delegations can last at most ${p.maxDays} days.`);
 // No cycles or chains: the delegate may not have delegated their own work, and nobody may delegate to the delegator.
 const at=now();const act=await all<Delegation>("SELECT * FROM inbox_delegations WHERE tenant_id=? AND status='active' AND ends_at>=?",u.tenantId,at);
 if(act.some(d=>d.delegator_id===b.delegateId&&d.delegate_id===delegator))throw new HttpError(409,'Circular delegation: this person is already covering for you.');
 if(act.some(d=>d.delegator_id===b.delegateId))throw new HttpError(409,'This person has delegated their own work; choose someone who is available.');
 if(act.some(d=>d.delegate_id===delegator))throw new HttpError(409,'You are covering for someone else; delegations cannot be chained.');
 const id=uid();
 await batch([stmt('INSERT INTO inbox_delegations(id,tenant_id,delegator_id,delegate_id,modules_json,item_types_json,source_type,source_id,starts_at,ends_at,reason,out_of_office,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,delegator,b.delegateId,JSON.stringify((b.modules||[]).slice(0,20)),JSON.stringify((b.itemTypes||[]).slice(0,20)),b.source?.type||null,b.source?.id||null,new Date(s).toISOString(),new Date(e).toISOString(),String(b.reason||'').slice(0,300),b.outOfOffice?1:0,'active',u.id,now()),
  auditStatement(u,b.source?'Item delegated':b.outOfOffice?'Out-of-office cover set':'Delegation created',id,'Inbox',null,{delegator,delegate:b.delegateId,modules:b.modules||[],itemTypes:b.itemTypes||[],startsAt:b.startsAt,endsAt:b.endsAt,source:b.source||null})]);
 return id;
}
export async function endDelegation(u:Member,id:string){
 const d=await first<Delegation>('SELECT * FROM inbox_delegations WHERE id=? AND tenant_id=?',id,u.tenantId);if(!d)throw new HttpError(404,'Delegation not found.');
 if(d.delegator_id!==u.id&&d.created_by!==u.id&&u.role!=='admin')throw new HttpError(403,'You cannot end this delegation.');
 await batch([stmt("UPDATE inbox_delegations SET status='ended',ended_at=? WHERE id=? AND tenant_id=?",now(),id,u.tenantId),auditStatement(u,'Delegation ended',id,'Inbox',{status:d.status},{status:'ended'})]);
}
