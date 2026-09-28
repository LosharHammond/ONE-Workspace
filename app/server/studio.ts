import {hasAction,canActOn,departmentKey} from '../access-policy';
import {evalFormula,test,type AppDef,type StudioField,type StudioTable,type StudioWorkflow,type WfTransition,type WfAction,type Approver,type ApprovalStage,type Automation,type StudioReport,type Cond} from '../studio-def';
import {all,first,stmt,batch,run,uid,now,HttpError,parseJson,nextNumber,tenantOf,tenantSettings} from './core';
import {enqueueStatement,registerJob,kick} from './jobs';
import {notify} from './notify';
import type {ConsumerResult,DomainEvent} from './events';
import type {EdgeSpec,NodeSpec} from './graph';
import type {Member} from './policy';

// ── Workspace Studio runtime ────────────────────────────────────────────────
// Applications are versioned metadata (studio-def.ts). This module is the only place that turns metadata into
// behaviour: record validation, workflows and approvals, automations and reports. Nothing here evaluates code;
// every query is bound to the tenant; every change is audited (which also feeds the Work Graph).
export type AppRow={id:string,tenant_id:string,slug:string,name:string,description:string,icon:string,status:string,draft_json:string,draft_version:number,published_version:number|null,approval_status:string,paused_json:string,platform_disabled_reason:string|null,created_by:string,created_at:string,updated_by:string,updated_at:string};
export type RecordRow={id:string,tenant_id:string,app_id:string,table_key:string,number:string,status:string,data_json:string,search_text:string,department:string,owner_id:string,is_draft:number,version:number,app_version:number,created_by:string,created_at:string,updated_by:string,updated_at:string,deleted_at:string|null};
type Actor={id:string,tenantId:string,name:string,role:string,department:string,supportSessionId?:string|null};
const audit=(a:Actor,action:string,id:string,dept:string,before:unknown,after:unknown)=>stmt('INSERT INTO audit (id,action,actor,record_id,department,before_json,after_json,created_at,tenant_id,support_session_id) VALUES (?,?,?,?,?,?,?,?,?,?)',uid(),action,a.id,id,dept||'',before?JSON.stringify(before):null,after?JSON.stringify(after):null,now(),a.tenantId,a.supportSessionId||null);
const event=(tenantId:string,type:string,entityId:string,payload:Record<string,unknown>,actor:string,action:string)=>stmt("INSERT INTO domain_events(id,tenant_id,type,entity_id,action,actor,payload_json,status,attempts,error,created_at) VALUES(?,?,?,?,?,?,?,'pending',0,'',?)",uid(),tenantId,type,entityId,action,actor,JSON.stringify(payload),now());
export const roleMatch=(u:{role:string,roleId?:string|null},roles:string[]|undefined)=>u.role==='admin'||!roles?.length||roles.some(r=>r==='*'||r==='all'||r===u.role||r===u.roleId);
export const canBuild=(u:Member)=>u.role==='admin'||hasAction(u,'studio','configure');
const REDACT=/secret|token|password|api[_-]?key|authorization|cookie/i;
export function redact(v:unknown,depth=0):unknown{if(depth>6)return '…';if(Array.isArray(v))return v.slice(0,50).map(x=>redact(x,depth+1));if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,REDACT.test(k)?'[redacted]':redact(x,depth+1)]));if(typeof v==='string')return v.length>2000?v.slice(0,2000)+'…':v;return v}

// ── Loading apps and definitions ────────────────────────────────────────────
export async function loadApp(u:Member,idOrSlug:string){const a=await first<AppRow>('SELECT * FROM studio_apps WHERE (id=? OR slug=?) AND tenant_id=?',idOrSlug,idOrSlug,u.tenantId);if(!a)throw new HttpError(404,'Application not found.');return a}
export async function definitionAt(tenantId:string,appId:string,version:number){const v=await first<{definition_json:string}>('SELECT definition_json FROM studio_app_versions WHERE tenant_id=? AND app_id=? AND version=?',tenantId,appId,version);return v?parseJson<AppDef>(v.definition_json,null as unknown as AppDef):null}
// The definition a person runs: builders may preview the draft; everyone else only the published version.
export async function runtime(u:Member,idOrSlug:string,preview=false){
 const a=await loadApp(u,idOrSlug);
 if(preview){if(!canBuild(u))throw new HttpError(403,'Only Studio builders can preview drafts.');return {app:a,def:parseJson<AppDef>(a.draft_json,null as unknown as AppDef),version:0,preview:true}}
 if(a.status!=='published'||!a.published_version||a.platform_disabled_reason)throw new HttpError(404,a.platform_disabled_reason?'This application was disabled by the platform.':'This application is not published.');
 const def=await definitionAt(u.tenantId,a.id,a.published_version);if(!def)throw new HttpError(404,'Application version not found.');
 if(!roleMatch(u,def.permissions?.use))throw new HttpError(404,'Application not found.');
 return {app:a,def,version:a.published_version,preview:false};
}
export function tableOf(def:AppDef,key:string){const t=def.tables.find(x=>x.key===key);if(!t)throw new HttpError(404,'Table not found.');return t}
const perm=(u:Member,t:StudioTable,action:'view'|'create'|'edit'|'delete')=>roleMatch(u,t.permissions?.[action]);
export function recordVisible(u:Member,t:StudioTable,r:RecordRow){
 if(r.deleted_at)return false;if(u.role==='admin')return true;if(!perm(u,t,'view'))return false;
 if(r.is_draft&&r.owner_id!==u.id&&r.created_by!==u.id)return false;
 const scope=t.permissions?.scope||'all';if(scope==='all')return true;if(r.owner_id===u.id||r.created_by===u.id)return true;
 if(scope==='department')return [u.department,...(u.extraDepartments||[])].map(departmentKey).includes(departmentKey(r.department));
 return false;
}
const fieldReadable=(u:Member,f:StudioField)=>roleMatch(u,f.readRoles);
const fieldWritable=(u:Member,f:StudioField)=>roleMatch(u,f.writeRoles);
export function shapeRecord(u:Member,t:StudioTable,wf:StudioWorkflow|undefined,r:RecordRow){
 const data=parseJson<Record<string,unknown>>(r.data_json,{});const out:Record<string,unknown>={};for(const f of t.fields)if(fieldReadable(u,f))out[f.key]=data[f.key];
 const state=wf?.states.find(s=>s.id===r.status);
 return {id:r.id,number:r.number,status:r.status,statusName:state?.name||r.status,statusKind:state?.kind||'',title:String(data[t.titleField]??r.number??''),data:out,department:r.department,ownerId:r.owner_id,isDraft:!!r.is_draft,version:r.version,createdBy:r.created_by,createdAt:r.created_at,updatedAt:r.updated_at};
}

// ── Field validation (every field type) ─────────────────────────────────────
async function validateFields(u:Member,app:AppRow,t:StudioTable,fields:StudioField[],input:Record<string,unknown>,old:Record<string,unknown>,o:{draft:boolean,create:boolean,recordId?:string,prefix?:string}){
 const out:Record<string,unknown>={...old};const errors:string[]=[];
 for(const f of fields){
  const label=o.prefix?`${o.prefix} › ${f.label}`:f.label;
  if(['formula','autonumber'].includes(f.type))continue;
  const supplied=Object.prototype.hasOwnProperty.call(input,f.key);
  if(supplied&&!fieldWritable(u,f)){if(JSON.stringify(input[f.key])!==JSON.stringify(old[f.key]))errors.push(`You cannot change “${label}”.`);continue}
  let v=supplied?input[f.key]:(o.create&&f.default!==undefined?f.default:old[f.key]);
  // Conditional fields: hidden fields are cleared and never required.
  if(f.showIf&&!test(f.showIf,{...out,...input})){delete out[f.key];continue}
  const empty=v===undefined||v===null||v===''||(Array.isArray(v)&&!v.length);
  if(empty){if(f.required&&!o.draft)errors.push(`“${label}” is required.`);out[f.key]=Array.isArray(v)?[]:null;continue}
  try{
   switch(f.type){
    case 'text':case 'richtext':case 'address':case 'phone':case 'email':{const s=String(v).trim();const max=f.type==='richtext'?20000:f.type==='address'?1000:1000;if(s.length>max)throw `“${label}” is too long.`;if(f.type==='email'&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))throw `“${label}” must be a valid email address.`;if(f.type==='phone'&&!/^[+()0-9\s.-]{5,30}$/.test(s))throw `“${label}” must be a valid phone number.`;if(f.pattern&&!new RegExp(f.pattern).test(s))throw `“${label}” is not in the expected format.`;if(f.min!==undefined&&s.length<f.min)throw `“${label}” must have at least ${f.min} characters.`;v=s;break}
    case 'number':case 'currency':case 'percent':case 'rating':{const n=typeof v==='number'?v:Number(v);if(!Number.isFinite(n))throw `“${label}” must be a number.`;const min=f.type==='rating'?1:f.type==='percent'?(f.min??0):f.min,max=f.type==='rating'?(f.max??5):f.type==='percent'?(f.max??100):f.max;if(min!==undefined&&n<min)throw `“${label}” must be at least ${min}.`;if(max!==undefined&&n>max)throw `“${label}” must be at most ${max}.`;v=f.type==='rating'?Math.round(n):n;break}
    case 'date':if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v))||!Number.isFinite(Date.parse(String(v))))throw `“${label}” must be a date.`;break;
    case 'datetime':if(!Number.isFinite(Date.parse(String(v))))throw `“${label}” must be a date and time.`;v=String(v).slice(0,40);break;
    case 'select':case 'radio':if(!f.options?.includes(String(v)))throw `Choose a valid option for “${label}”.`;v=String(v);break;
    case 'multiselect':{const l=(Array.isArray(v)?v:[v]).map(String);if(l.some(x=>!f.options?.includes(x)))throw `Choose valid options for “${label}”.`;v=[...new Set(l)];break}
    case 'checkbox':v=v===true||v==='true'||v===1;break;
    case 'person':{const m=await first('SELECT id FROM members WHERE id=? AND tenant_id=? AND active=1',String(v),u.tenantId);if(!m)throw `“${label}” must be an active person in this company.`;v=String(v);break}
    case 'department':{if(!await first('SELECT id FROM departments WHERE tenant_id=? AND name=?',u.tenantId,String(v)))throw `“${label}” must be one of the company’s departments.`;v=String(v);break}
    case 'location':{if(!await first('SELECT id FROM locations WHERE tenant_id=? AND (path=? OR name=?)',u.tenantId,String(v),String(v)))throw `“${label}” must be one of the company’s locations.`;v=String(v);break}
    case 'group':{if(!await first("SELECT id FROM groups WHERE tenant_id=? AND id=? AND status='active'",u.tenantId,String(v)))throw `“${label}” must be an active company group.`;v=String(v);break}
    case 'role':{const r=String(v);if(!['admin','manager','employee','viewer'].includes(r)&&!await first('SELECT id FROM roles WHERE tenant_id=? AND id=?',u.tenantId,r))throw `“${label}” must be a company role.`;break}
    case 'file':{const ids=(Array.isArray(v)?v:[v]).map(String).slice(0,20);const {canSeeFile}=await import('./entities');for(const id of ids){const fr=await first<Parameters<typeof canSeeFile>[1]>('SELECT * FROM files WHERE id=? AND tenant_id=?',id,u.tenantId);if(!fr||!canSeeFile(u,fr))throw `A file in “${label}” was not found.`}v=ids;break}
    case 'signature':{const s=String(v);if(!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(s)||s.length>200000)throw `“${label}” must be a drawn signature.`;break}
    case 'lookup':{const r=await first<RecordRow>('SELECT * FROM studio_records WHERE id=? AND tenant_id=? AND app_id=? AND table_key=? AND deleted_at IS NULL',String(v),u.tenantId,app.id,String(f.lookupTable));if(!r)throw `“${label}” refers to a record that was not found.`;v=String(v);break}
    case 'relationship':{const {findNode}=await import('./graph');const ids=(Array.isArray(v)?v:[v]).map(String).slice(0,20);for(const id of ids)await findNode(u,String(f.relation),id).catch(()=>{throw `“${label}”: a linked record was not found.`});v=ids;break}
    case 'repeating':{if(!Array.isArray(v))throw `“${label}” must be a list of rows.`;if(v.length>100)throw `“${label}” can have at most 100 rows.`;const rows=[];for(let i=0;i<v.length;i++){const r=await validateFields(u,app,t,(f.subfields||[]).filter(x=>x.type!=='repeating'),(v[i]||{}) as Record<string,unknown>,{},{...o,prefix:`${label} row ${i+1}`});errors.push(...r.errors);rows.push(r.data)}v=rows;break}
   }
   if(f.unique&&!o.draft){const clash=await first<{id:string}>("SELECT id FROM studio_records WHERE tenant_id=? AND app_id=? AND table_key=? AND deleted_at IS NULL AND is_draft=0 AND json_extract(data_json,'$.'||?)=? AND id<>?",u.tenantId,app.id,t.key,f.key,typeof v==='object'?JSON.stringify(v):v as string,o.recordId||'');if(clash)throw `Another record already has this “${label}”.`}
   out[f.key]=v;
  }catch(e){if(typeof e==='string')errors.push(e);else throw e}
 }
 // Calculated values after inputs.
 for(const f of fields.filter(x=>x.type==='formula')){try{out[f.key]=evalFormula(f.formula||'',out)}catch{out[f.key]=null}}
 return {data:out,errors};
}
function searchText(t:StudioTable,data:Record<string,unknown>,number:string){const keys=t.searchFields?.length?t.searchFields:t.fields.filter(f=>['text','email','select','radio','phone'].includes(f.type)).map(f=>f.key);return [number,...keys.map(k=>data[k])].filter(x=>x!==undefined&&x!==null).map(x=>Array.isArray(x)?x.join(' '):String(x)).join(' ').toLowerCase().slice(0,2000)}

// ── Records ────────────────────────────────────────────────────────────────
export async function listRecords(u:Member,a:AppRow,def:AppDef,t:StudioTable,o:{q?:string,status?:string,sort?:string,dir?:string,page?:number,size?:number,filters?:Cond[],mine?:boolean}={}){
 if(!perm(u,t,'view'))throw new HttpError(403,'You cannot see this table.');
 const rows=await all<RecordRow>('SELECT * FROM studio_records WHERE tenant_id=? AND app_id=? AND table_key=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 5000',u.tenantId,a.id,t.key);
 const wf=def.workflows.find(w=>w.key===t.workflow);
 let vis=rows.filter(r=>recordVisible(u,t,r)).map(r=>shapeRecord(u,t,wf,r));
 const q=(o.q||'').toLowerCase();
 vis=vis.filter(r=>(!q||rows.find(x=>x.id===r.id)!.search_text.includes(q))&&(!o.status||r.status===o.status)&&(!o.mine||r.ownerId===u.id||r.createdBy===u.id)&&(o.filters||[]).every(c=>test(c,{...r.data,status:r.status})));
 if(o.sort){const k=o.sort,d=o.dir==='asc'?1:-1;vis.sort((x,y)=>{const a1=k==='updated'?x.updatedAt:k==='number'?x.number:x.data[k],b1=k==='updated'?y.updatedAt:k==='number'?y.number:y.data[k];return (typeof a1==='number'&&typeof b1==='number'?a1-b1:String(a1??'').localeCompare(String(b1??'')))*d})}
 const size=Math.min(200,Math.max(5,o.size||50)),page=Math.max(1,o.page||1);
 return {total:vis.length,page,size,records:vis.slice((page-1)*size,page*size)};
}
export async function loadRecord(u:Member,a:AppRow,def:AppDef,id:string){
 const r=await first<RecordRow>('SELECT * FROM studio_records WHERE id=? AND tenant_id=? AND app_id=?',id,u.tenantId,a.id);
 if(!r)throw new HttpError(404,'Record not found.');const t=tableOf(def,r.table_key);if(!recordVisible(u,t,r))throw new HttpError(404,'Record not found.');return {r,t};
}
export async function saveRecord(u:Member,a:AppRow,def:AppDef,version:number,t:StudioTable,input:Record<string,unknown>,o:{id?:string,draft?:boolean,formKey?:string,baseVersion?:number}){
 const form=o.formKey?def.forms.find(f=>f.key===o.formKey&&f.table===t.key):undefined;
 if(o.formKey&&!form)throw new HttpError(400,'Form not found.');if(form&&!roleMatch(u,form.roles))throw new HttpError(403,'This form is not available to you.');
 if(form&&!o.draft&&form.allowDraft===false&&o.draft)throw new HttpError(400,'This form does not allow drafts.');
 // Fields hidden from this person (read roles) or locked for them (write roles) can never be submitted by them.
 const locked=t.fields.filter(f=>Object.prototype.hasOwnProperty.call(input,f.key)&&input[f.key]!==undefined&&(!fieldReadable(u,f)||!fieldWritable(u,f)));
 if(locked.length&&!o.id)throw new HttpError(403,`You cannot set: ${locked.map(f=>f.label).join(', ')}.`);
 const onForm=form?new Set(form.sections.flatMap(s=>s.fields)):null;
 for(const k of Object.keys(input))if(!t.fields.some(f=>f.key===k)||(onForm&&!onForm.has(k)))throw new HttpError(400,`“${k}” is not a field on this form.`);
 const wf=def.workflows.find(w=>w.key===t.workflow);const ts=now();
 if(o.id){
  const {r}=await loadRecord(u,a,def,o.id);
  const mayEdit=perm(u,t,'edit')&&(u.role==='admin'||t.permissions?.scope==='all'||r.owner_id===u.id||r.created_by===u.id||(t.permissions?.scope==='department'&&departmentKey(r.department)===departmentKey(u.department)));
  if(!mayEdit&&!(r.is_draft&&r.created_by===u.id))throw new HttpError(403,'You cannot edit this record.');
  if(wf&&wf.states.find(s=>s.id===r.status)?.kind==='end'&&u.role!=='admin')throw new HttpError(409,'This record is finished and can no longer be edited.');
  if(o.baseVersion!==undefined&&o.baseVersion!==r.version)throw new HttpError(409,'Someone else changed this record. Reload it before saving.');
  const old=parseJson<Record<string,unknown>>(r.data_json,{});
  const {data,errors}=await validateFields(u,a,t,t.fields,input,old,{draft:!!o.draft,create:false,recordId:r.id});
  if(errors.length)throw new HttpError(400,errors.join(' '));
  const draft=o.draft&&r.is_draft?1:0;
  await batch([stmt('UPDATE studio_records SET data_json=?,search_text=?,is_draft=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND tenant_id=? AND version=?',JSON.stringify(data),searchText(t,data,r.number),draft,u.id,ts,r.id,u.tenantId,r.version),
   stmt('INSERT INTO studio_record_versions(id,tenant_id,record_id,version,data_json,status,edited_by,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),u.tenantId,r.id,r.version+1,JSON.stringify(data),r.status,u.id,ts),
   ...(t.audit!==false?[audit(u,`${t.name} record updated`,r.id,r.department,redact(old),redact(data))]:[]),
   event(u.tenantId,'studio.record',r.id,{type:'studio_record',appId:a.id,table:t.key,change:r.is_draft&&!draft?'created':'updated',status:r.status},u.id,r.is_draft&&!draft?'record created':'record updated')]);
  return {id:r.id,version:r.version+1};
 }
 if(!perm(u,t,'create'))throw new HttpError(403,'You cannot create records in this table.');
 const {data,errors}=await validateFields(u,a,t,t.fields,input,{},{draft:!!o.draft,create:true});
 if(errors.length)throw new HttpError(400,errors.join(' '));
 const auto=t.fields.find(f=>f.type==='autonumber');const prefix=(auto?.prefix||t.numbering?.prefix||t.key.slice(0,3)).toUpperCase().replace(/[^A-Z0-9]/g,'')||'REC';
 const number=await nextNumber(u.tenantId,`S-${prefix}`,true,['studio_records','number']);if(auto)data[auto.key]=number;
 for(const f of t.fields.filter(x=>x.type==='formula')){try{data[f.key]=evalFormula(f.formula||'',data)}catch{data[f.key]=null}}
 const start=wf?.states.find(s=>s.kind==='start');const status=start?.id||t.statuses?.[0]||'Open';
 const id=uid();const draft=o.draft?1:0;
 const deptField=t.fields.find(f=>f.type==='department');const dept=(deptField&&typeof data[deptField.key]==='string'?String(data[deptField.key]):u.department)||'';
 await batch([stmt('INSERT INTO studio_records(id,tenant_id,app_id,table_key,number,status,data_json,search_text,department,owner_id,is_draft,version,app_version,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)',id,u.tenantId,a.id,t.key,number,status,JSON.stringify(data),searchText(t,data,number),dept,u.id,draft,version,u.id,ts,u.id,ts),
  stmt('INSERT INTO studio_record_versions(id,tenant_id,record_id,version,data_json,status,edited_by,created_at) VALUES(?,?,?,1,?,?,?,?)',uid(),u.tenantId,id,JSON.stringify(data),status,u.id,ts),
  ...(t.audit!==false?[audit(u,`${t.name} record ${draft?'draft saved':'created'}`,id,dept,null,{number})]:[]),
  ...(draft?[]:[event(u.tenantId,'studio.record',id,{type:'studio_record',appId:a.id,table:t.key,change:'created',status},u.id,'record created')])]);
 // A form can submit straight into the first workflow step (e.g. "Submit for approval").
 if(!draft&&form?.startTransition&&wf){const rec=await first<RecordRow>('SELECT * FROM studio_records WHERE id=? AND tenant_id=?',id,u.tenantId);await transition(u,a,def,t,rec!,form.startTransition)}
 return {id,number};
}
export async function deleteRecord(u:Member,a:AppRow,def:AppDef,id:string){
 const {r,t}=await loadRecord(u,a,def,id);
 if(!perm(u,t,'delete')||(u.role!=='admin'&&r.owner_id!==u.id&&r.created_by!==u.id&&t.permissions?.scope!=='all'))throw new HttpError(403,'You cannot delete this record.');
 await batch([stmt('UPDATE studio_records SET deleted_at=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',now(),u.id,now(),r.id,u.tenantId),audit(u,`${t.name} record deleted`,r.id,r.department,{number:r.number},null)]);
}

// ── Workflow engine and approvals ───────────────────────────────────────────
export function available(u:Member,t:StudioTable,wf:StudioWorkflow|undefined,r:RecordRow){
 if(!wf||r.is_draft)return [];const data=parseJson<Record<string,unknown>>(r.data_json,{});
 return wf.transitions.filter(x=>x.from===r.status&&!x.timerHours&&roleMatch(u,x.roles)).map(x=>({id:x.id,label:x.label,to:wf.states.find(s=>s.id===x.to)?.name||x.to,approval:!!x.approval?.stages?.length,blocked:x.condition&&!test(x.condition,data)?'Conditions not met':(x.requiredFields||[]).filter(k=>data[k]===undefined||data[k]===null||data[k]==='').map(k=>t.fields.find(f=>f.key===k)?.label||k).join(', ')?`Complete: ${(x.requiredFields||[]).filter(k=>data[k]===undefined||data[k]===null||data[k]==='').map(k=>t.fields.find(f=>f.key===k)?.label||k).join(', ')}`:''}));
}
export async function resolveApprovers(tenantId:string,list:Approver[],ctx:{department?:string,requesterId?:string}){
 const ids=new Set<string>();
 for(const a of list){
  if(a.kind==='person'&&a.value)ids.add(a.value);
  if(a.kind==='role'&&a.value)for(const m of await all<{id:string}>('SELECT id FROM members WHERE tenant_id=? AND active=1 AND (role=? OR role_id=?)',tenantId,a.value,a.value))ids.add(m.id);
  if(a.kind==='group'&&a.value)for(const m of await all<{member_id:string}>('SELECT member_id FROM group_members WHERE tenant_id=? AND group_id=?',tenantId,a.value))ids.add(m.member_id);
  if(a.kind==='manager'&&ctx.requesterId){const m=await first<{manager_id:string|null}>('SELECT manager_id FROM members WHERE id=? AND tenant_id=?',ctx.requesterId,tenantId);if(m?.manager_id)ids.add(m.manager_id)}
  const head=async(name:string|undefined)=>{if(!name)return;const d=await first<{head_id:string|null}>('SELECT head_id FROM departments WHERE tenant_id=? AND lower(name)=lower(?)',tenantId,name);if(d?.head_id)ids.add(d.head_id);else for(const m of await all<{id:string}>("SELECT id FROM members WHERE tenant_id=? AND active=1 AND role='manager' AND lower(department)=lower(?)",tenantId,name))ids.add(m.id)};
  if(a.kind==='department_head')await head(ctx.department);
  if(a.kind==='department')await head(a.value);
 }
 // Nobody approves their own request.
 if(ctx.requesterId)ids.delete(ctx.requesterId);
 if(!ids.size)for(const m of await all<{id:string}>("SELECT id FROM members WHERE tenant_id=? AND active=1 AND role='admin' LIMIT 5",tenantId))if(m.id!==ctx.requesterId)ids.add(m.id);
 return [...ids];
}
type StageMeta={decisions:{by:string,approve:boolean,comment:string,at:string,override?:boolean}[],escalateAfterHours?:number,escalateTo?:Approver,requesterId?:string,title:string,appVersion:number,link:string};
// Creates the approval stages (sequential; each stage may be parallel with any/all/quorum).
export async function startApproval(tenantId:string,appId:string,recordId:string,transitionId:string,stages:ApprovalStage[],ctx:{data:Record<string,unknown>,department:string,requesterId:string,title:string,appVersion:number,link:string},actor:Actor){
 const active=stages.filter(s=>test(s.when,ctx.data));if(!active.length)return false;
 const s:D1PreparedStatement[]=[];let first_=true;
 for(let i=0;i<active.length;i++){const st=active[i];const approvers=await resolveApprovers(tenantId,st.approvers,{department:ctx.department,requesterId:ctx.requesterId});
  const meta:StageMeta={decisions:[],escalateAfterHours:st.escalateAfterHours,escalateTo:st.escalateTo,requesterId:ctx.requesterId,title:ctx.title,appVersion:ctx.appVersion,link:ctx.link};
  const id=uid();s.push(stmt('INSERT INTO studio_approvals(id,tenant_id,app_id,record_id,transition_id,stage,stage_name,approver_ids,mode,quorum,status,decisions_json,due_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,tenantId,appId,recordId,transitionId,i,st.name,JSON.stringify(approvers),st.mode||'any',st.mode==='quorum'?Math.max(1,st.quorum||1):st.mode==='all'?approvers.length:1,first_?'pending':'waiting',JSON.stringify(meta),st.escalateAfterHours?new Date(Date.now()+st.escalateAfterHours*3600000).toISOString():null,now()));
  if(first_){await notify({id:actor.id,tenantId},approvers,{kind:'approval',title:`Approval needed: ${ctx.title}`,body:st.name,link:'#/inbox'});first_=false}
 }
 s.push(audit(actor,`Approval requested · ${active.map(x=>x.name).join(' → ')}`,recordId,ctx.department,null,{transition:transitionId,stages:active.length}));
 await batch(s);return true;
}
export async function transition(u:Member|Actor,a:AppRow,def:AppDef,t:StudioTable,r:RecordRow,transitionId:string,o:{system?:boolean,comment?:string}={}){
 const wf=def.workflows.find(w=>w.key===t.workflow);if(!wf)throw new HttpError(400,'This table has no workflow.');
 const tr=wf.transitions.find(x=>x.id===transitionId);if(!tr||tr.from!==r.status)throw new HttpError(409,'That step is not available from the current status.');
 if(!o.system&&!roleMatch(u,tr.roles))throw new HttpError(403,'You are not allowed to take this step.');
 const data=parseJson<Record<string,unknown>>(r.data_json,{});
 if(tr.condition&&!test(tr.condition,data))throw new HttpError(409,'The conditions for this step are not met.');
 const missing=(tr.requiredFields||[]).filter(k=>data[k]===undefined||data[k]===null||data[k]==='');if(missing.length)throw new HttpError(400,`Complete these first: ${missing.map(k=>t.fields.find(f=>f.key===k)?.label||k).join(', ')}.`);
 if(await first("SELECT id FROM studio_approvals WHERE tenant_id=? AND record_id=? AND status IN ('pending','waiting')",r.tenant_id,r.id))throw new HttpError(409,'This record is already waiting for approval.');
 const actor:Actor={id:u.id,tenantId:r.tenant_id,name:u.name,role:u.role,department:u.department,supportSessionId:(u as Member).supportSessionId};
 if(tr.approval?.stages?.length){const started=await startApproval(r.tenant_id,a.id,r.id,tr.id,tr.approval.stages,{data,department:r.department,requesterId:r.owner_id,title:`${t.name} ${r.number}: ${tr.label}`,appVersion:r.app_version,link:`#/apps/${a.slug}/${t.key}/${r.id}`},actor);if(started)return {pending:true}}
 await applyTransition(actor,a,def,t,r,tr);return {pending:false,status:tr.to};
}
async function applyTransition(actor:Actor,a:AppRow,def:AppDef,t:StudioTable,r:RecordRow,tr:WfTransition){
 const ts=now();const data=parseJson<Record<string,unknown>>(r.data_json,{});
 await batch([stmt('UPDATE studio_records SET status=?,version=version+1,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',tr.to,actor.id,ts,r.id,r.tenant_id),
  stmt('INSERT INTO studio_record_versions(id,tenant_id,record_id,version,data_json,status,edited_by,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),r.tenant_id,r.id,r.version+1,r.data_json,tr.to,actor.id,ts),
  audit(actor,`${t.name}: ${tr.label}`,r.id,r.department,{status:r.status},{status:tr.to}),
  event(r.tenant_id,'studio.record',r.id,{type:'studio_record',appId:a.id,table:t.key,change:'status_changed',status:tr.to,prevStatus:r.status},actor.id,'status changed')]);
 if(tr.actions?.length)await runActions({tenantId:r.tenant_id,app:a,def,version:r.app_version,actor,record:{id:r.id,type:'studio_record',table:t.key,title:String(data[t.titleField]??r.number),department:r.department,requesterId:r.owner_id,data:{...data,number:r.number,status:tr.to}},dryRun:false},tr.actions);
}
export async function decide(u:Member,approvalId:string,approve:boolean,comment:string){
 const ap=await first<{id:string,tenant_id:string,app_id:string,record_id:string,transition_id:string,stage:number,stage_name:string,approver_ids:string,mode:string,quorum:number,status:string,decisions_json:string}>('SELECT * FROM studio_approvals WHERE id=? AND tenant_id=?',approvalId,u.tenantId);
 if(!ap||ap.status!=='pending')throw new HttpError(404,'Approval not found or already decided.');
 const approvers=JSON.parse(ap.approver_ids) as string[];const meta=parseJson<StageMeta>(ap.decisions_json,{decisions:[],title:'',appVersion:0,link:''});
 let override=!approvers.includes(u.id);if(override){const {actingFor}=await import('./delegation');if((await actingFor(u,approvers,'studio',{itemType:'approval',source:{type:'studio_record',id:ap.record_id}})).length)override=false}if(override&&u.role!=='admin')throw new HttpError(403,'You are not an approver for this step.');
 if(meta.requesterId===u.id)throw new HttpError(403,'You cannot approve your own request.');
 if(meta.decisions.some(d=>d.by===u.id))throw new HttpError(409,'You have already decided.');
 if(!approve&&!comment.trim())throw new HttpError(400,'Add a reason when rejecting.');
 meta.decisions.push({by:u.id,approve,comment,at:now(),override:override||undefined});
 const yes=meta.decisions.filter(d=>d.approve).length;const actor:Actor={id:u.id,tenantId:u.tenantId,name:u.name,role:u.role,department:u.department,supportSessionId:u.supportSessionId};
 const need=ap.mode==='all'?Math.max(1,approvers.length):ap.mode==='quorum'?Math.max(1,ap.quorum):1;
 const done=!approve||override||yes>=need;const status=!approve?'rejected':done?'approved':'pending';
 await batch([stmt('UPDATE studio_approvals SET decisions_json=?,status=?,decided_at=? WHERE id=? AND tenant_id=?',JSON.stringify(meta),status,done?now():null,ap.id,u.tenantId),audit(actor,`Approval ${approve?'approved':'rejected'} · ${ap.stage_name}${override?' (administrator override)':''}`,ap.record_id,'',null,{comment})]);
 if(!done)return {status:'pending'};
 if(!approve){await run("UPDATE studio_approvals SET status='cancelled' WHERE tenant_id=? AND record_id=? AND transition_id=? AND status='waiting'",u.tenantId,ap.record_id,ap.transition_id);await finishApproval(actor,ap,'rejected',meta);return {status:'rejected'}}
 const next=await first<{id:string,approver_ids:string,stage_name:string}>("SELECT id,approver_ids,stage_name FROM studio_approvals WHERE tenant_id=? AND record_id=? AND transition_id=? AND status='waiting' ORDER BY stage LIMIT 1",u.tenantId,ap.record_id,ap.transition_id);
 if(next){await run("UPDATE studio_approvals SET status='pending' WHERE id=?",next.id);await notify(actor,JSON.parse(next.approver_ids),{kind:'approval',title:`Approval needed: ${meta.title}`,body:next.stage_name,link:'#/inbox'});return {status:'next-stage'}}
 await finishApproval(actor,ap,'approved',meta);return {status:'approved'};
}
async function finishApproval(actor:Actor,ap:{tenant_id:string,app_id:string,record_id:string,transition_id:string},outcome:'approved'|'rejected',meta:StageMeta){
 await event(ap.tenant_id,'studio.approval',ap.record_id,{appId:ap.app_id,transitionId:ap.transition_id,automationId:ap.transition_id.startsWith('auto:')?ap.transition_id.slice(5):undefined,outcome},actor.id,`approval ${outcome}`).run();
 if(meta.requesterId)await notify(actor,[meta.requesterId],{kind:'approval',title:`${meta.title} was ${outcome}`,link:meta.link||'#/inbox'});
 if(outcome!=='approved'||ap.transition_id.startsWith('auto:'))return;
 const a=await first<AppRow>('SELECT * FROM studio_apps WHERE id=? AND tenant_id=?',ap.app_id,ap.tenant_id);const r=await first<RecordRow>('SELECT * FROM studio_records WHERE id=? AND tenant_id=?',ap.record_id,ap.tenant_id);if(!a||!r)return;
 const def=await definitionAt(ap.tenant_id,a.id,r.app_version)||parseJson<AppDef>(a.draft_json,null as unknown as AppDef);const t=def.tables.find(x=>x.key===r.table_key);const wf=t&&def.workflows.find(w=>w.key===t.workflow);const tr=wf?.transitions.find(x=>x.id===ap.transition_id);
 if(t&&tr&&r.status===tr.from)await applyTransition(actor,a,def,t,r,tr);
}
// Items waiting for this person (Studio approvals); shown in the Universal Work Inbox.
export async function myApprovals(u:Member){
 const rows=await all<{id:string,app_id:string,record_id:string,stage_name:string,approver_ids:string,decisions_json:string,created_at:string,due_at:string|null}>("SELECT * FROM studio_approvals WHERE tenant_id=? AND status='pending' ORDER BY created_at LIMIT 300",u.tenantId);
 return rows.filter(r=>(JSON.parse(r.approver_ids) as string[]).includes(u.id)&&!parseJson<StageMeta>(r.decisions_json,{decisions:[],title:'',appVersion:0,link:''}).decisions.some(d=>d.by===u.id)).map(r=>{const m=parseJson<StageMeta>(r.decisions_json,{decisions:[],title:'',appVersion:0,link:''});return {id:r.id,title:m.title,stage:r.stage_name,link:m.link,since:r.created_at,dueAt:r.due_at}});
}

// ── Automations ─────────────────────────────────────────────────────────────
type Ctx={tenantId:string,app:AppRow,def:AppDef,version:number,actor:Actor,record:{id:string,type:string,table?:string,title:string,department:string,requesterId?:string|null,data:Record<string,unknown>},dryRun:boolean};
const tmpl=(s:unknown,data:Record<string,unknown>)=>String(s??'').replace(/\{\{\s*([\w.]+)\s*\}\}/g,(_,k)=>{const v=k.split('.').reduce((o:unknown,p:string)=>o&&typeof o==='object'?(o as Record<string,unknown>)[p]:undefined,data);return v===undefined||v===null?'':Array.isArray(v)?v.join(', '):String(v)});
export async function runActions(ctx:Ctx,actions:WfAction[]){
 const log:{action:string,result:string,ok:boolean,detail?:unknown}[]=[];const d={...ctx.record.data,title:ctx.record.title,department:ctx.record.department};
 for(const act of actions.slice(0,20)){
  const push=(result:string,ok=true,detail?:unknown)=>log.push({action:act.type,result,ok,detail:redact(detail)});
  if(ctx.dryRun){push(`Would ${describe(act,d)}`);continue}
  switch(act.type){
   case 'notify':{const to=await resolveApprovers(ctx.tenantId,(act.to as Approver[])||[],{department:ctx.record.department});await notify(ctx.actor,to,{kind:'automation',title:tmpl(act.title||'Update: {{title}}',d),body:tmpl(act.body||'',d),link:String(act.link||'')||(ctx.record.type==='studio_record'?`#/apps/${ctx.app.slug}/${ctx.record.table}/${ctx.record.id}`:'#/inbox')});push(`Notified ${to.length} people`);break}
   case 'create_record':{const t=ctx.def.tables.find(x=>x.key===act.table);if(!t){push('Table not found',false);break}const values=Object.fromEntries(Object.entries((act.values as Record<string,unknown>)||{}).map(([k,v])=>[k,typeof v==='string'?tmpl(v,d):v]));
    // Records created by automations meet the same required-field rules as records created by people.
    const missing=t.fields.filter(x=>x.required&&!['formula','autonumber'].includes(x.type)&&!x.showIf&&(values[x.key]===undefined||values[x.key]===null||values[x.key]===''));if(missing.length)throw new Error(`Cannot create a ${t.name} record: missing ${missing.map(x=>x.label).join(', ')}.`);
    const id=uid(),ts=now();const number=await nextNumber(ctx.tenantId,`S-${(t.numbering?.prefix||t.key.slice(0,3)).toUpperCase()}`,true,['studio_records','number']);const wf=ctx.def.workflows.find(w=>w.key===t.workflow);const status=wf?.states.find(s=>s.kind==='start')?.id||'Open';
    await batch([stmt('INSERT INTO studio_records(id,tenant_id,app_id,table_key,number,status,data_json,search_text,department,owner_id,is_draft,version,app_version,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,0,1,?,?,?,?,?)',id,ctx.tenantId,ctx.app.id,t.key,number,status,JSON.stringify(values),searchText(t,values,number),ctx.record.department,ctx.record.requesterId||ctx.actor.id,ctx.version,ctx.actor.id,ts,ctx.actor.id,ts),audit(ctx.actor,`${t.name} record created by automation`,id,ctx.record.department,null,{number,from:ctx.record.id}),event(ctx.tenantId,'studio.record',id,{type:'studio_record',appId:ctx.app.id,table:t.key,change:'created',status,depth:Number(ctx.record.data.__depth||0)+1},ctx.actor.id,'record created')]);push(`Created ${number}`,true,{id});break}
   case 'update_record':{if(ctx.record.type!=='studio_record'){push('Only app records can be updated',false);break}const r=await first<RecordRow>('SELECT * FROM studio_records WHERE id=? AND tenant_id=?',ctx.record.id,ctx.tenantId);if(!r){push('Record not found',false);break}const data={...parseJson<Record<string,unknown>>(r.data_json,{}),...Object.fromEntries(Object.entries((act.values as Record<string,unknown>)||{}).map(([k,v])=>[k,typeof v==='string'?tmpl(v,d):v]))};await batch([stmt('UPDATE studio_records SET data_json=?,version=version+1,updated_at=?,updated_by=? WHERE id=? AND tenant_id=?',JSON.stringify(data),now(),ctx.actor.id,r.id,ctx.tenantId),audit(ctx.actor,'Record updated by automation',r.id,r.department,null,act.values)]);push('Updated the record');break}
   case 'set_status':{const r=await first<RecordRow>('SELECT * FROM studio_records WHERE id=? AND tenant_id=?',ctx.record.id,ctx.tenantId);const t=r&&ctx.def.tables.find(x=>x.key===r.table_key);if(!r||!t){push('Record not found',false);break}try{const res=await transition(ctx.actor,ctx.app,ctx.def,t,r,String(act.transition),{system:true});push(res.pending?'Sent for approval':`Moved to ${res.status}`)}catch(e){push((e as Error).message,false)}break}
   case 'create_task':{const assignees=await resolveApprovers(ctx.tenantId,act.assignTo?[act.assignTo as Approver]:[],{department:ctx.record.department,requesterId:undefined});const id=uid(),ts=now();const due=act.dueInDays!==undefined?new Date(Date.now()+Number(act.dueInDays)*86400000).toISOString().slice(0,10):null;const owner=assignees[0]||ctx.record.requesterId||ctx.app.created_by;
    await batch([stmt("INSERT INTO tasks(id,tenant_id,title,description,status,priority,owner_id,department,project_id,due_date,source_type,source_id,created_by,created_at,updated_at,updated_by) VALUES(?,?,?,?,'To do',?,?,?,?,?,?,?,?,?,?,?)",id,ctx.tenantId,tmpl(act.title||'Follow up: {{title}}',d).slice(0,200),tmpl(act.description||'',d).slice(0,4000),String(act.priority||'Medium'),owner,ctx.record.department,typeof act.projectId==='string'?act.projectId:null,due,'automation',ctx.record.id,owner,ts,ts,'Automation'),...assignees.map(m=>stmt("INSERT OR IGNORE INTO task_assignees(id,tenant_id,task_id,member_id,kind) VALUES(?,?,?,?,'assignee')",uid(),ctx.tenantId,id,m)),audit(ctx.actor,'Task created by automation',id,ctx.record.department,null,{from:ctx.record.id})]);
    await notify(ctx.actor,assignees,{kind:'task',title:`New task: ${tmpl(act.title||'Follow up: {{title}}',d)}`,link:`#/tasks/mine/${id}`});push(`Created a task for ${assignees.length||1} people`,true,{id});break}
   case 'post_message':{const kind=String(act.channel||'company');const ch=await first<{id:string}>(kind==='department'?"SELECT id FROM channels WHERE tenant_id=? AND kind='department' AND lower(ref_id)=lower(?)":"SELECT id FROM channels WHERE tenant_id=? AND kind='company' AND ?=?",ctx.tenantId,kind==='department'?ctx.record.department:'x','x');if(!ch){push('Channel not found',false);break}await batch([stmt("INSERT INTO messages(id,tenant_id,channel_id,thread_id,author_id,body,kind,created_at) VALUES(?,?,?,NULL,?,?,'text',?)",uid(),ctx.tenantId,ch.id,ctx.actor.id,tmpl(act.text||'{{title}}',d).slice(0,4000),now()),stmt('UPDATE channels SET last_message_at=? WHERE id=? AND tenant_id=?',now(),ch.id,ctx.tenantId)]);push('Posted a message');break}
   case 'request_approval':{const started=await startApproval(ctx.tenantId,ctx.app.id,ctx.record.id,`auto:${String(act.automationId||'')}`,(act.stages as ApprovalStage[])||[],{data:ctx.record.data,department:ctx.record.department,requesterId:ctx.record.requesterId||'',title:tmpl(act.title||'{{title}}',d),appVersion:ctx.version,link:recordLink(ctx.record)},ctx.actor);push(started?'Approval requested':'No approval stage applied');break}
   // Request-to-outcome: raise a business request (as the automation's identity) from this record.
   case 'create_request':{const {memberById}=await import('./core');const actor=await memberById(ctx.tenantId,ctx.actor.id);if(!actor){push('Automation identity unavailable',false);break}const lc=await import('./lifecycle');const r=await lc.createRequest(actor,{title:tmpl(act.title||'{{title}}',d).slice(0,200),description:tmpl(act.description||'',d),requestType:String(act.requestType||'general'),department:ctx.record.department||actor.department,businessNeed:tmpl(act.businessNeed||'',d),estimatedCost:act.estimatedCost!==undefined?Number(tmpl(act.estimatedCost,d))||0:0,submit:act.submit===true});push(`Business request ${r.number} created`,true,{id:r.id});break}
   // Goals: record a key-result value from this record (lineage: the app record).
   case 'record_progress':{const {applyKrValue}=await import('./strategy');const v=Number(tmpl(act.value,d));if(!Number.isFinite(v)){push('No numeric value',false);break}const changed=await applyKrValue(ctx.tenantId,String(act.keyResultId),v,ctx.actor.id,{kind:'studio',ref:ctx.record.id,lineage:{app:ctx.app.slug,record:ctx.record.id,version:ctx.version}});push(changed?`Key result updated to ${v}`:'Key result already at that value');break}
   case 'add_relationship':{const {addRelationship,findNode:fn}=await import('./graph');const toId=tmpl(act.toId||'',d);if(!toId){push('No record to link',false);break}const sys=systemMember(ctx);try{const from=await fn(sys,ctx.record.type,ctx.record.id);const to=await fn(sys,String(act.toType),toId);await addRelationship(sys,from,to,String(act.relationship||'related_to'),'user',{meta:{automation:true}});push('Linked records')}catch(e){push((e as Error).message,false)}break}
   case 'connector_action':{const {executeAction}=await import('./fabric');const r=await executeAction(ctx.tenantId,{connectorId:String(act.connectorId),action:String(act.action),input:Object.fromEntries(Object.entries((act.input as Record<string,unknown>)||{}).map(([k,v])=>[k,typeof v==='string'?tmpl(v,d):v])),origin:'automation',requestedBy:ctx.actor.id,idempotencyKey:`auto:${ctx.record.id}:${act.connectorId}:${act.action}`});push(r.status==='pending_confirmation'?'Waiting for a person to confirm the external action':r.status==='succeeded'?`External action done${r.externalId?` (${r.externalId})`:''}`:r.error||r.status,r.status!=='failed',{run:r.id});break}
   case 'run_agent':{const {startRun}=await import('./agents');try{const r=await startRun(ctx.tenantId,String(act.agentId),{prompt:tmpl(act.prompt||'{{title}}',d),trigger:'automation',record:{type:ctx.record.type,id:ctx.record.id},requestedBy:ctx.actor.id});push(`Agent run ${r.status}`,r.status!=='failed',{run:r.id})}catch(e){push((e as Error).message,false)}break}
  }
 }
 return log;
}
function systemMember(ctx:Ctx):Member{return {id:ctx.actor.id,name:'Automation',email:'',role:'admin',department:ctx.record.department,active:1,tenantId:ctx.tenantId,identityId:''} as Member}
const recordLink=(r:Ctx['record'])=>r.type==='PR'||r.type==='PO'?`#/purchasing/${r.type.toLowerCase()}/${r.id}`:r.type==='studio_record'?'#/inbox':`#/graph?id=${r.id}`;
function describe(a:WfAction,d:Record<string,unknown>){switch(a.type){case 'notify':return `notify ${((a.to as Approver[])||[]).map(x=>x.kind+(x.value?`:${x.value}`:'')).join(', ')} — “${tmpl(a.title||'',d)}”`;case 'create_record':return `create a ${a.table} record`;case 'update_record':return 'update the record';case 'set_status':return `take the “${a.transition}” step`;case 'create_task':return `create task “${tmpl(a.title||'',d)}”`;case 'post_message':return `post to the ${a.channel||'company'} channel`;case 'request_approval':return `request approval (${((a.stages as ApprovalStage[])||[]).map(s=>s.name).join(' → ')})`;case 'connector_action':return `run ${a.action} on connector ${a.connectorId}`;case 'run_agent':return `run agent ${a.agentId}`;case 'add_relationship':return `link to ${a.toType}`}return a.type}
// Entity summaries used by module triggers and conditions (amounts, departments, statuses).
async function entityRecord(tenantId:string,type:string|null,id:string):Promise<Ctx['record']|null>{
 if(type==='PR'||type==='PO'){const d=await first<{id:string,number:string,title:string,total:number,department:string,status:string,requester_id:string,location:string,currency:string,vendor_id:string|null,project_id:string|null}>('SELECT id,number,title,total,department,status,requester_id,location,currency,vendor_id,project_id FROM purchase_docs WHERE id=? AND tenant_id=?',id,tenantId);return d&&{id,type,title:`${d.number} · ${d.title}`,department:d.department,requesterId:d.requester_id,data:{...d,amount:d.total}}}
 if(type==='file'){const f=await first<{id:string,name:string,department:string,mime:string,owner_id:string|null,uploaded_by:string,processing_status:string}>('SELECT id,name,department,mime,owner_id,uploaded_by,processing_status FROM files WHERE id=? AND tenant_id=?',id,tenantId);return f&&{id,type,title:f.name,department:f.department,requesterId:f.owner_id||f.uploaded_by,data:{...f}}}
 if(type==='studio_record'){const r=await first<RecordRow>('SELECT * FROM studio_records WHERE id=? AND tenant_id=?',id,tenantId);return r&&{id,type,table:r.table_key,title:r.number,department:r.department,requesterId:r.owner_id,data:{...parseJson<Record<string,unknown>>(r.data_json,{}),number:r.number,status:r.status}}}
 if(type){const n=await first<{title:string,status:string,department:string,owner_id:string|null,meta_json:string}>('SELECT title,status,department,owner_id,meta_json FROM graph_nodes WHERE tenant_id=? AND source_id=? AND deleted_at IS NULL',tenantId,id);if(n)return {id,type,title:n.title,department:n.department,requesterId:n.owner_id,data:{title:n.title,status:n.status,department:n.department,...parseJson<Record<string,unknown>>(n.meta_json,{})}}}
 return null;
}
async function publishedApps(tenantId:string){
 const rows=await all<AppRow&{definition_json:string}>("SELECT a.*,v.definition_json FROM studio_apps a JOIN studio_app_versions v ON v.tenant_id=a.tenant_id AND v.app_id=a.id AND v.version=a.published_version WHERE a.tenant_id=? AND a.status='published' AND a.platform_disabled_reason IS NULL",tenantId);
 return rows.map(r=>({app:r as AppRow,def:parseJson<AppDef>(r.definition_json,null as unknown as AppDef),paused:new Set(parseJson<string[]>(r.paused_json,[]))})).filter(x=>x.def);
}
export async function automationLimit(tenantId:string){const t=await tenantOf({tenantId});const s=tenantSettings(t);const limit=Number((s.limits as Record<string,unknown>|undefined)?.automationRunsPerMonth??5000);const start=new Date();start.setUTCDate(1);start.setUTCHours(0,0,0,0);const used=(await first<{n:number}>('SELECT count(*) AS n FROM studio_automation_runs WHERE tenant_id=? AND started_at>=? AND dry_run=0',tenantId,start.toISOString()))?.n||0;return {limit,used}}
// Queues one automation run. The idempotency key makes duplicate deliveries of the same event harmless.
export async function queueRun(tenantId:string,app:AppRow,version:number,a:Automation,trigger:string,record:Ctx['record'],key:string,eventId?:string){
 const lim=await automationLimit(tenantId);const id=uid();
 if(lim.used>=lim.limit){await run("INSERT INTO studio_automation_runs(id,tenant_id,app_id,automation_id,app_version,trigger,event_id,idempotency_key,status,dry_run,input_json,output_json,error,attempts,started_at) VALUES(?,?,?,?,?,?,?,?,'blocked',0,?,'{}',?,0,?) ON CONFLICT(tenant_id,idempotency_key) DO NOTHING",id,tenantId,app.id,a.id,version,trigger,eventId||null,key,JSON.stringify(redact(record)),`Monthly automation limit (${lim.limit}) reached.`,now());return}
 await batch([stmt("INSERT INTO studio_automation_runs(id,tenant_id,app_id,automation_id,app_version,trigger,event_id,idempotency_key,status,dry_run,input_json,output_json,error,attempts,started_at) VALUES(?,?,?,?,?,?,?,?,'queued',0,?,'{}','',0,?) ON CONFLICT(tenant_id,idempotency_key) DO NOTHING",id,tenantId,app.id,a.id,version,trigger,eventId||null,key,JSON.stringify(record),now()),
  enqueueStatement(tenantId,'studio.automation',id,{},{key:`job:${key}`,maxAttempts:4})]);
}
// Domain events → matching automations (Studio records, purchasing, files, approvals, webhooks, connectors, graph).
export async function onDomainEvent(e:DomainEvent,entityType:string|null,payload:Record<string,unknown>):Promise<ConsumerResult>{
 const triggers:{type:string,match:(t:Automation['trigger'])=>boolean,appId?:string}[]=[];const action=e.action.toLowerCase();
 if(e.type==='studio.record'){const change=String(payload.change||'');const tmap:Record<string,string>={created:'record_created',updated:'record_updated',status_changed:'status_changed'};if(tmap[change])triggers.push({type:tmap[change],appId:String(payload.appId),match:t=>(!t.table||t.table===payload.table)&&(!t.toStatus||t.toStatus===payload.status)});if(Number(payload.depth||0)>3)return {status:'complete'}}
 if(e.type==='studio.approval')triggers.push({type:'approval_completed',match:t=>(!t.automationId||t.automationId===payload.automationId)&&(!t.toStatus||t.toStatus===payload.outcome)});
 if(e.type==='audit'){
  if(entityType==='PR'&&/submitted for approval/.test(action))triggers.push({type:'purchase_submitted',match:()=>true});
  if((entityType==='PR'||entityType==='PO')&&/ approved · /.test(action)){const d=await first<{status:string}>('SELECT status FROM purchase_docs WHERE id=? AND tenant_id=?',e.entity_id,e.tenant_id);if(d?.status==='Approved')triggers.push({type:'approval_completed',match:t=>!t.automationId&&(!t.module||t.module===entityType)})}
  if(entityType==='file'&&action==='file uploaded')triggers.push({type:'file_uploaded',match:()=>true});
  if(entityType==='request'&&/ submitted$/.test(action))triggers.push({type:'request_submitted',match:()=>true});
  if(entityType==='request'&&/^stage (started|completed)/.test(action))triggers.push({type:'lifecycle_stage_changed',match:t=>!t.action||action.includes(t.action.toLowerCase())});
  if(/^key result updated/.test(action))triggers.push({type:'key_result_updated',match:()=>true});
  if(/^decision approved/.test(action))triggers.push({type:'decision_approved',match:()=>true});
  if(/^knowledge review requested/.test(action))triggers.push({type:'knowledge_review_due',match:()=>true});
  if(/^inbox item escalated|^inbox: escalate/.test(action))triggers.push({type:'inbox_escalated',match:()=>true});
  if(entityType)triggers.push({type:'module_event',match:t=>(!t.module||t.module===entityType)&&(!t.action||action.includes(t.action.toLowerCase()))});
 }
 if(e.type==='connector.webhook')triggers.push({type:'webhook_received',match:t=>!t.connectorId||t.connectorId===payload.connectorId});
 if(e.type==='connector.record')triggers.push({type:'connector_event',match:t=>!t.connectorId||t.connectorId===payload.connectorId});
 if(e.type==='file.processed')triggers.push({type:'ai_classification_completed',match:()=>true});
 if(e.type==='graph.relationship')triggers.push({type:'relationship_created',match:t=>(!t.module||t.module===payload.type)&&(!t.action||t.action===payload.relationship)});
 if(!triggers.length)return {status:'complete'};
 const apps=await publishedApps(e.tenant_id);if(!apps.length)return {status:'complete'};
 let record:Ctx['record']|null=null;
 if(e.type==='connector.webhook'||e.type==='connector.record')record={id:e.entity_id,type:'external',title:String(payload.title||payload.event||'External event'),department:'',data:{...payload}};
 else record=await entityRecord(e.tenant_id,e.type==='studio.record'?'studio_record':e.type==='studio.approval'?String(payload.recordType||(await first('SELECT id FROM studio_records WHERE id=? AND tenant_id=?',e.entity_id,e.tenant_id)?'studio_record':'PR')):entityType,e.entity_id);
 if(!record)return {status:'complete'};
 if(e.type==='studio.approval')record.data={...record.data,outcome:payload.outcome};
 for(const {app,def,paused} of apps)for(const a of def.automations||[]){
  if(!a.enabled||paused.has(a.id))continue;
  const tr=triggers.find(t=>t.type===a.trigger?.type&&(!t.appId||t.appId===app.id)&&t.match(a.trigger));if(!tr)continue;
  if(!a.conditions.every(c=>test(c,record!.data)))continue;
  await queueRun(e.tenant_id,app,app.published_version!,a,a.trigger.type,record,`auto:${app.id}:${a.id}:${e.id}`,e.id);
 }
 kick(3);
 return {status:'complete'};
}
registerJob('studio.automation',async job=>{
 const r=await first<{id:string,tenant_id:string,app_id:string,automation_id:string,app_version:number,input_json:string,status:string,dry_run:number}>('SELECT * FROM studio_automation_runs WHERE id=? AND tenant_id=?',job.ref_id,job.tenant_id);
 if(!r||['succeeded','cancelled'].includes(r.status))return;
 const app=await first<AppRow>('SELECT * FROM studio_apps WHERE id=? AND tenant_id=?',r.app_id,r.tenant_id);if(!app)return;
 if(app.platform_disabled_reason||parseJson<string[]>(app.paused_json,[]).includes(r.automation_id)){await run("UPDATE studio_automation_runs SET status='cancelled',error=?,finished_at=? WHERE id=?",app.platform_disabled_reason?'Application disabled':'Automation paused',now(),r.id);return}
 const def=await definitionAt(r.tenant_id,app.id,r.app_version);const a=def?.automations.find(x=>x.id===r.automation_id);if(!def||!a){await run("UPDATE studio_automation_runs SET status='failed',error='Automation no longer exists in that version',finished_at=? WHERE id=?",now(),r.id);return}
 await run("UPDATE studio_automation_runs SET status='running',attempts=attempts+1 WHERE id=?",r.id);
 const record=parseJson<Ctx['record']>(r.input_json,null as unknown as Ctx['record']);
 const actor:Actor={id:`automation:${a.id}`,tenantId:r.tenant_id,name:`Automation: ${a.name}`,role:'workflow',department:record.department};
 const acts=a.actions.map(x=>x.type==='request_approval'?{...x,automationId:a.id}:x);
 const started=Date.now();
 const log=await Promise.race([runActions({tenantId:r.tenant_id,app,def,version:r.app_version,actor,record,dryRun:false},acts),new Promise<never>((_,rej)=>setTimeout(()=>rej(new Error('Automation timed out after 60 seconds.')),60000))]);
 const failed=log.filter(x=>!x.ok);
 if(failed.length)await stmt("INSERT INTO domain_events(id,tenant_id,type,entity_id,action,actor,payload_json,status,attempts,error,created_at) VALUES(?,?,'inbox',?,'inbox sync','system',?,'pending',0,'',?)",uid(),r.tenant_id,r.id,JSON.stringify({type:'automation_run'}),now()).run();
 await run('UPDATE studio_automation_runs SET status=?,output_json=?,error=?,finished_at=? WHERE id=?',failed.length?'failed':'succeeded',JSON.stringify({log,ms:Date.now()-started}),failed.map(x=>x.result).join('; ').slice(0,500),now(),r.id);
 if(failed.length&&failed.some(x=>/timed out|unavailable|could not reach|rate/i.test(x.result)))throw new Error(failed[0].result);
});
registerJob('studio.automation:failed',async job=>{await stmt("INSERT INTO domain_events(id,tenant_id,type,entity_id,action,actor,payload_json,status,attempts,error,created_at) VALUES(?,?,'inbox',?,'inbox sync','system',?,'pending',0,'',?)",uid(),job.tenant_id,job.ref_id,JSON.stringify({type:'automation_run'}),now()).run();await run("UPDATE studio_automation_runs SET status=?,error=?,finished_at=? WHERE id=? AND tenant_id=?",job.status==='dead'?'failed':'retrying',job.last_error,now(),job.ref_id,job.tenant_id)});
export async function dryRun(u:Member,a:AppRow,def:AppDef,automationId:string,sample:Record<string,unknown>){
 const au=def.automations.find(x=>x.id===automationId);if(!au)throw new HttpError(404,'Automation not found.');
 const record={id:'sample',type:'sample',title:String(sample.title||'Sample record'),department:String(sample.department||u.department),data:sample};
 const passes=au.conditions.map(c=>({condition:`${c.field} ${c.op} ${c.value??''}`,passed:test(c,sample)}));
 const log=passes.every(p=>p.passed)?await runActions({tenantId:u.tenantId,app:a,def,version:0,actor:{id:u.id,tenantId:u.tenantId,name:u.name,role:u.role,department:u.department},record,dryRun:true},au.actions):[];
 await run("INSERT INTO studio_automation_runs(id,tenant_id,app_id,automation_id,app_version,trigger,idempotency_key,status,dry_run,input_json,output_json,error,attempts,started_at,finished_at) VALUES(?,?,?,?,0,'dry_run',?,'succeeded',1,?,?,'',0,?,?)",uid(),u.tenantId,a.id,au.id,`dry:${uid()}`,JSON.stringify(redact(sample)),JSON.stringify({conditions:passes,log}),now(),now());
 return {conditions:passes,wouldRun:passes.every(p=>p.passed),log};
}

// ── Scheduler: time-based triggers, approval escalation, workflow timers, scheduled reports, retention ──
export function scheduleStatement(tenantId:string,delaySec=0){const at=new Date(Date.now()+delaySec*1000);return enqueueStatement(tenantId,'studio.schedule',tenantId,{},{key:`studio-schedule:${at.toISOString().slice(0,13)}`,delaySec,maxAttempts:3})}
registerJob('studio.schedule',async job=>{
 const tenantId=job.tenant_id;const nowD=new Date();const hour=nowD.getUTCHours(),day=nowD.getUTCDay();const today=nowD.toISOString().slice(0,10);const hourKey=nowD.toISOString().slice(0,13);
 const apps=await publishedApps(tenantId);
 for(const {app,def,paused} of apps){for(const a of def.automations||[]){
  if(!a.enabled||paused.has(a.id))continue;const t=a.trigger;const base={id:app.id,type:'schedule',title:app.name,department:'',data:{} as Record<string,unknown>};
  if(t.type==='schedule'&&(t.schedule==='hourly'||(t.schedule==='daily'&&hour===7)||(t.schedule==='weekly'&&day===1&&hour===7)))await queueRun(tenantId,app,app.published_version!,a,'schedule',base,`sched:${a.id}:${hourKey}`);
  if(t.type==='date_reached'&&t.table&&t.field){const rows=await all<RecordRow>("SELECT * FROM studio_records WHERE tenant_id=? AND app_id=? AND table_key=? AND deleted_at IS NULL AND substr(json_extract(data_json,'$.'||?),1,10)=?",tenantId,app.id,t.table,t.field,today);for(const r of rows)await queueRun(tenantId,app,app.published_version!,a,'date_reached',{id:r.id,type:'studio_record',table:r.table_key,title:r.number,department:r.department,requesterId:r.owner_id,data:parseJson(r.data_json,{})},`date:${a.id}:${r.id}:${today}`)}
  if(t.type==='task_overdue'){for(const x of await all<{id:string,title:string,department:string,owner_id:string,due_date:string,project_id:string|null}>("SELECT id,title,department,owner_id,due_date,project_id FROM tasks WHERE tenant_id=? AND deleted_at IS NULL AND status NOT IN ('Done','Cancelled') AND due_date<? LIMIT 200",tenantId,today))await queueRun(tenantId,app,app.published_version!,a,'task_overdue',{id:x.id,type:'task',title:x.title,department:x.department,requesterId:x.owner_id,data:{...x}},`overdue:${a.id}:${x.id}:${today}`)}
  if(t.type==='inventory_below_min'){for(const i of await all<{id:string,sku:string,name:string,min_stock:number,qty:number}>('SELECT i.id,i.sku,i.name,i.min_stock,(SELECT coalesce(sum(s.qty),0) FROM stock_levels s WHERE s.item_id=i.id AND s.tenant_id=i.tenant_id) AS qty FROM inventory_items i WHERE i.tenant_id=? AND i.min_stock>0',tenantId))if(i.qty<=i.min_stock)await queueRun(tenantId,app,app.published_version!,a,'inventory_below_min',{id:i.id,type:'inventory_item',title:`${i.sku} · ${i.name}`,department:'',data:{...i}},`stock:${a.id}:${i.id}:${today}`)}
  if(t.type==='maintenance_due'){for(const p of await all<{id:string,title:string,department:string,next_due:string,asset_id:string}>('SELECT id,title,department,next_due,asset_id FROM maintenance_plans WHERE tenant_id=? AND active=1 AND next_due<=?',tenantId,today))await queueRun(tenantId,app,app.published_version!,a,'maintenance_due',{id:p.id,type:'maintenance_plan',title:p.title,department:p.department,data:{...p}},`maint:${a.id}:${p.id}:${p.next_due}`)}
  if(t.type==='budget_threshold'){const pct=Number(t.percent||80);for(const b of await all<{id:string,name:string,department:string,amount:number,spent:number}>("SELECT b.id,b.name,b.department,b.amount,(SELECT coalesce(sum(d.total),0) FROM purchase_docs d WHERE d.tenant_id=b.tenant_id AND d.budget_id=b.id AND d.status NOT IN ('Draft','Rejected','Cancelled')) AS spent FROM budgets b WHERE b.tenant_id=? AND b.amount>0",tenantId))if(b.spent/b.amount*100>=pct)await queueRun(tenantId,app,app.published_version!,a,'budget_threshold',{id:b.id,type:'budget',title:b.name,department:b.department,data:{...b,percent:Math.round(b.spent/b.amount*100)}},`budget:${a.id}:${b.id}:${pct}`)}
 }
  // Workflow timers: records waiting in a state longer than the transition's timer take it automatically.
  for(const wf of def.workflows)for(const tr of wf.transitions.filter(x=>x.timerHours)){const t=def.tables.find(x=>x.workflow===wf.key);if(!t)continue;const cutoff=new Date(Date.now()-Number(tr.timerHours)*3600000).toISOString();
   for(const r of await all<RecordRow>('SELECT * FROM studio_records WHERE tenant_id=? AND app_id=? AND table_key=? AND status=? AND deleted_at IS NULL AND is_draft=0 AND updated_at<=? LIMIT 100',tenantId,app.id,t.key,tr.from,cutoff))await transition({id:'workflow-timer',tenantId,name:'Workflow timer',role:'workflow',department:r.department},app,def,t,r,tr.id,{system:true}).catch(()=>null)}
  // Scheduled reports: a summary notification to recipients.
  for(const rep of def.reports.filter(r=>r.schedule)){const due=rep.schedule!.frequency==='daily'?hour===7:day===1&&hour===7;if(!due)continue;const key=`report:${rep.key}:${hourKey}`;if(await first('SELECT id FROM studio_automation_runs WHERE tenant_id=? AND idempotency_key=?',tenantId,key))continue;
   const to=await resolveApprovers(tenantId,rep.schedule!.recipients,{});await notify({id:`studio:${app.id}`,tenantId},to,{kind:'report',title:`${rep.name} (${rep.schedule!.frequency} report)`,body:`${app.name}: open the report for current figures.`,link:`#/apps/${app.slug}/report/${rep.key}`});
   await run("INSERT INTO studio_automation_runs(id,tenant_id,app_id,automation_id,app_version,trigger,idempotency_key,status,dry_run,input_json,output_json,error,attempts,started_at,finished_at) VALUES(?,?,?,?,?,'scheduled_report',?,'succeeded',0,'{}',?,'',1,?,?)",uid(),tenantId,app.id,`report:${rep.key}`,app.published_version,key,JSON.stringify({recipients:to.length}),now(),now())}
  // Retention: finished records older than the table's retention period are removed (soft delete, audited).
  for(const t of def.tables.filter(x=>x.retentionDays&&x.retentionDays>0)){const wf=def.workflows.find(w=>w.key===t.workflow);const ends=wf?wf.states.filter(s=>s.kind==='end').map(s=>s.id):[];const cutoff=new Date(Date.now()-t.retentionDays!*86400000).toISOString();
   const old=await all<{id:string}>(`SELECT id FROM studio_records WHERE tenant_id=? AND app_id=? AND table_key=? AND deleted_at IS NULL AND updated_at<?${ends.length?` AND status IN (${ends.map(()=>'?').join(',')})`:''} LIMIT 200`,tenantId,app.id,t.key,cutoff,...ends);
   if(old.length)await batch([...old.map(r=>stmt('UPDATE studio_records SET deleted_at=? WHERE id=? AND tenant_id=?',now(),r.id,tenantId)),stmt('INSERT INTO audit (id,action,actor,record_id,department,before_json,after_json,created_at,tenant_id) VALUES (?,?,?,?,?,NULL,?,?,?)',uid(),`Retention removed ${old.length} ${t.name} records`,'retention',app.id,'Workspace Studio',JSON.stringify({days:t.retentionDays}),now(),tenantId)])}
 }
 // Approval escalation.
 for(const ap of await all<{id:string,decisions_json:string,approver_ids:string,stage_name:string}>("SELECT id,decisions_json,approver_ids,stage_name FROM studio_approvals WHERE tenant_id=? AND status='pending' AND due_at IS NOT NULL AND due_at<=? AND escalated_at IS NULL LIMIT 100",tenantId,now())){
  const meta=parseJson<StageMeta>(ap.decisions_json,{decisions:[],title:'',appVersion:0,link:''});const extra=meta.escalateTo?await resolveApprovers(tenantId,[meta.escalateTo],{requesterId:meta.requesterId}):[];
  const ids=[...new Set([...(JSON.parse(ap.approver_ids) as string[]),...extra])];await run('UPDATE studio_approvals SET approver_ids=?,escalated_at=? WHERE id=?',JSON.stringify(ids),now(),ap.id);
  await notify({id:'studio:escalation',tenantId},extra.length?extra:ids,{kind:'approval',title:`Overdue approval escalated: ${meta.title}`,body:ap.stage_name,link:'#/inbox'});
 }
 if(apps.length)await scheduleStatement(tenantId,3600).run();
});

// ── Reports ────────────────────────────────────────────────────────────────
export async function runReport(u:Member,a:AppRow,def:AppDef,rep:StudioReport,extra:Cond[]=[]){
 if(!roleMatch(u,rep.roles))throw new HttpError(403,'This report is not available to you.');
 let rows:Record<string,unknown>[]=[];
 if(rep.source.kind==='table'){const t=tableOf(def,rep.source.id);rows=(await listRecords(u,a,def,t,{size:200,page:1})).records.map(r=>({...r.data,status:r.statusName,number:r.number,link:`#/apps/${a.slug}/${t.key}/${r.id}`,updated:r.updatedAt}));const more=await listRecords(u,a,def,t,{size:5000});rows=more.records.map(r=>({...r.data,status:r.statusName,number:r.number,title:r.title,link:`#/apps/${a.slug}/${t.key}/${r.id}`,updated:r.updatedAt}))}
 else if(rep.source.kind==='module'){const {loadSource}=await import('./widgets');rows=(await loadSource(u,rep.source.id,{})) as Record<string,unknown>[]}
 else if(rep.source.kind==='graph'){const {browseNodes}=await import('./graph');rows=(await browseNodes(u,[rep.source.id],400)).map(n=>({title:n.title,status:n.status,department:n.department,location:n.location,module:n.module,link:n.url,updated:n.updatedAt,type:n.label}))}
 else if(rep.source.kind==='connector'){const {connectorRecordsFor}=await import('./fabric');rows=await connectorRecordsFor(u,rep.source.id,500)}
 rows=rows.filter(r=>[...(rep.filters||[]),...extra].every(c=>test(c,r)));
 const val=(r:Record<string,unknown>)=>rep.measure.op==='count'?1:Number(r[rep.measure.field||'']||0);
 const agg=(list:Record<string,unknown>[])=>{const s=list.reduce((n,r)=>n+val(r),0);return rep.measure.op==='avg'?(list.length?Math.round(s/list.length*100)/100:0):Math.round(s*100)/100};
 const key=(r:Record<string,unknown>,k?:string)=>{const v=k?r[k]:'';return v===undefined||v===null||v===''?'—':Array.isArray(v)?v.join(', '):String(v).slice(0,rep.chart==='timeline'||rep.chart==='calendar'||rep.chart==='line'||rep.chart==='area'?10:120)};
 const groupField=rep.chart==='timeline'||rep.chart==='calendar'||rep.chart==='line'||rep.chart==='area'?(rep.dateField||rep.groupBy):rep.groupBy;
 const groups=new Map<string,Record<string,unknown>[]>();for(const r of rows){const g=key(r,groupField);groups.set(g,[...(groups.get(g)||[]),r])}
 let series=[...groups.entries()].map(([name,list])=>({name,value:agg(list),count:list.length}));
 series=['line','area','timeline','calendar'].includes(rep.chart)?series.sort((x,y)=>x.name.localeCompare(y.name)):series.sort((x,y)=>y.value-x.value);
 const pivot=rep.chart==='pivot'&&rep.column?(()=>{const cols=[...new Set(rows.map(r=>key(r,rep.column)))].slice(0,20);return {columns:cols,rows:[...groups.entries()].map(([name,list])=>({name,cells:cols.map(c=>agg(list.filter(r=>key(r,rep.column)===c))),total:agg(list)}))}})():null;
 return {total:agg(rows),count:rows.length,series:series.slice(0,100),pivot,rows:rows.slice(0,200),canExport:roleMatch(u,rep.exportRoles?.length?rep.exportRoles:['admin','manager'])};
}

// ── Work Graph integration ──────────────────────────────────────────────────
type Ctx2={app_name:string,app_slug:string,app_status:string,draft_json:string,definition_json:string|null};
export async function projectStudioRecord(tenantId:string,id:string):Promise<{node:NodeSpec,edges:EdgeSpec[]}|null>{
 const row=await first<RecordRow&Ctx2>(`SELECT r.*,a.name AS app_name,a.slug AS app_slug,a.status AS app_status,a.draft_json,v.definition_json FROM studio_records r JOIN studio_apps a ON a.id=r.app_id AND a.tenant_id=r.tenant_id LEFT JOIN studio_app_versions v ON v.app_id=r.app_id AND v.tenant_id=r.tenant_id AND v.version=r.app_version WHERE r.id=? AND r.tenant_id=?`,id,tenantId);
 if(!row||row.deleted_at||row.is_draft)return null;
 const def=parseJson<AppDef>(row.definition_json||row.draft_json,null as unknown as AppDef);const t=def?.tables?.find(x=>x.key===row.table_key);const data=parseJson<Record<string,unknown>>(row.data_json,{});const edges:EdgeSpec[]=[];
 edges.push({type:'created_by',to:{type:'person',sourceId:row.owner_id}});
 for(const f of t?.fields||[]){const v=data[f.key];const list=Array.isArray(v)?v:v?[v]:[];
  if(f.type==='relationship'&&f.relation)for(const x of list)if(typeof x==='string')edges.push({type:'related_to',to:{type:f.relation,sourceId:x}});
  if(f.type==='lookup')for(const x of list)if(typeof x==='string')edges.push({type:'related_to',to:{type:'studio_record',sourceId:x}});
  if(f.type==='person')for(const x of list)if(typeof x==='string')edges.push({type:'assigned_to',to:{type:'person',sourceId:x}});
  if(f.type==='file')for(const x of list)if(typeof x==='string')edges.push({type:'attached_to',to:{type:'file',sourceId:x},reverse:true});
 }
 const wf=def?.workflows?.find(w=>w.key===t?.workflow);
 return {node:{type:'studio_record',sourceId:row.id,title:`${row.number} · ${String(data[t?.titleField||'']??t?.name??'')}`,summary:row.search_text.slice(0,300),status:wf?.states.find(s=>s.id===row.status)?.name||row.status,ownerId:row.owner_id,department:row.department,module:'studio',url:`#/apps/${row.app_slug}/${row.table_key}/${row.id}`,classification:'internal',meta:{app:row.app_name,table:t?.name||row.table_key}},edges};
}
export async function visibleStudioRecords(u:Member,ids:string[]){
 const out=new Set<string>();if(!ids.length)return out;
 const rows=await all<RecordRow&Ctx2&{published_version:number|null,platform_disabled_reason:string|null}>(`SELECT r.*,a.name AS app_name,a.slug AS app_slug,a.status AS app_status,a.draft_json,a.published_version,a.platform_disabled_reason,v.definition_json FROM studio_records r JOIN studio_apps a ON a.id=r.app_id AND a.tenant_id=r.tenant_id LEFT JOIN studio_app_versions v ON v.app_id=r.app_id AND v.tenant_id=r.tenant_id AND v.version=a.published_version WHERE r.tenant_id=? AND r.id IN (${ids.map(()=>'?').join(',')})`,u.tenantId,...ids);
 for(const r of rows){if(u.role==='admin'||canBuild(u)){if(!r.deleted_at)out.add(r.id);continue}if(r.app_status!=='published'||r.platform_disabled_reason||!r.definition_json)continue;const def=parseJson<AppDef>(r.definition_json,null as unknown as AppDef);const t=def?.tables.find(x=>x.key===r.table_key);if(!def||!t||!roleMatch(u,def.permissions?.use))continue;if(recordVisible(u,t,r))out.add(r.id)}
 return out;
}
export {canActOn};
