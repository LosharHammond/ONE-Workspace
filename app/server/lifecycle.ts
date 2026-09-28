import {hasAction,canActOn,departmentKey} from '../access-policy';
import {all,first,stmt,batch,run,uid,now,parseJson,HttpError,auditStatement,nextNumber,str,num,date,idOf,oneOf} from './core';
import {notify} from './notify';
import type {ApprovalStage} from '../studio-def';
import type {Member} from './policy';

// Request-to-outcome lifecycle. A business request follows a lifecycle TEMPLATE (a versioned list of stages);
// the template is copied onto the request when it is created, so later template edits never change requests in
// flight. Stages are completed manually by their owner, by an approval gate, or automatically when the linked
// record reaches the required state (project created, requisition approved, order issued, goods received,
// asset created, service accepted, outcome reviewed). Every step is audited and projected into the Work Graph
// and the Universal Work Inbox through domain events.
export const REQUEST_TYPES=['general','capex','opex','procurement','project','it','asset','service','maintenance','staffing','contract','improvement','custom'] as const;
export const REQUEST_LABELS:Record<string,string>={general:'General business request',capex:'Capital expenditure',opex:'Operational expenditure',procurement:'Procurement request',project:'Project request',it:'IT request',asset:'Asset request',service:'Service request',maintenance:'Maintenance request',staffing:'Hiring or staffing request',contract:'Contract request',improvement:'Improvement idea',custom:'Custom request'};
export const STAGE_KINDS=['intake','business_case','review','approval','goal','project','budget','requisition','rfq','quotations','evaluation','order','receipt','asset','deployment','service','measurement','outcome','closure','custom'] as const;
export type StageKind=typeof STAGE_KINDS[number];
export type Owner={kind:'requester'|'manager'|'department_head'|'procurement'|'finance'|'role'|'person',value?:string};
export type StageDef={key:string,name:string,kind:StageKind,required:boolean,owner:Owner,slaDays?:number,approval?:{stages:ApprovalStage[],delegable?:boolean},requiredFields?:string[],requiredDocs?:number,budgetRule?:{financeAbove?:number},notify?:string[],auto?:boolean,minQuotes?:number};
export type Template={id:string,tenant_id:string,name:string,kind:string,description:string,request_types_json:string,stages_json:string,status:string,version:number};
export type RequestRow={id:string,tenant_id:string,number:string,title:string,description:string,request_type:string,requester_id:string,department:string,location:string,business_need:string,expected_outcome:string,estimated_cost:number,currency:string,priority:string,risk:string,required_date:string|null,goal_id:string|null,project_id:string|null,budget_id:string|null,template_id:string,template_version:number,stages_json:string,status:string,current_stage:string,files_json:string,visibility:string,version:number,created_at:string,updated_at:string,closed_at:string|null};
type StageRow={id:string,request_id:string,stage_key:string,name:string,position:number,required:number,status:string,owner_id:string|null,due_at:string|null,started_at:string|null,completed_at:string|null,completed_by:string|null,outcome:string,notes:string,linked_type:string|null,linked_id:string|null};

const S=(key:string,name:string,kind:StageKind,o:Partial<StageDef>={}):StageDef=>({key,name,kind,required:true,owner:{kind:'requester'},...o});
const headApproval=(name='Department head approval'):StageDef['approval']=>({stages:[{name,mode:'any',approvers:[{kind:'department_head'}]}]});
const financeApproval:StageDef['approval']={stages:[{name:'Department head',mode:'any',approvers:[{kind:'department_head'}]},{name:'Finance',mode:'any',approvers:[{kind:'department',value:'Finance'}],when:{field:'estimated_cost',op:'gte',value:10000}}]};
// Built-in templates (companies copy and adapt them; they are created on first use).
export const DEFAULT_TEMPLATES:{kind:string,name:string,description:string,types:string[],stages:StageDef[]}[]=[
 {kind:'physical_project',name:'Physical project',description:'Capital works from business case to asset handover and benefits review.',types:['capex','project'],stages:[S('request','Request','intake'),S('case','Business case','business_case'),S('approval','Approval','approval',{owner:{kind:'department_head'},approval:financeApproval,slaDays:5}),S('goal','Link to goal','goal',{required:false}),S('project','Project set up','project',{owner:{kind:'department_head'},auto:true}),S('budget','Budget','budget',{owner:{kind:'finance'},auto:true}),S('pr','Purchase requisition','requisition'),S('quotes','Vendor quotations','quotations',{owner:{kind:'procurement'},minQuotes:2,required:false}),S('po','Purchase order','order',{owner:{kind:'procurement'}}),S('receipt','Goods receipt','receipt',{owner:{kind:'procurement'}}),S('assets','Asset creation','asset',{required:false}),S('deploy','Assignment & deployment','deployment',{required:false}),S('measure','Performance measurement','measurement',{required:false}),S('outcome','Outcome review','outcome'),S('close','Closure','closure')]},
 {kind:'service_delivery',name:'Service delivery',description:'Purchased or internal services from request to acceptance, SLA and renewal.',types:['service','contract'],stages:[S('request','Request','intake'),S('approval','Approval','approval',{owner:{kind:'department_head'},approval:headApproval()}),S('pr','Requisition','requisition',{required:false}),S('po','Purchase order','order',{owner:{kind:'procurement'},required:false}),S('service','Service delivery & acceptance','service'),S('outcome','Outcome review','outcome'),S('close','Renewal or closure','closure')]},
 {kind:'it_project',name:'IT project',description:'IT change from request to delivery and benefits.',types:['it'],stages:[S('request','Request','intake'),S('case','Business case','business_case',{required:false}),S('approval','Approval','approval',{owner:{kind:'department_head'},approval:headApproval('IT approval')}),S('project','Project set up','project',{auto:true}),S('pr','Requisition','requisition',{required:false}),S('po','Purchase order','order',{required:false,owner:{kind:'procurement'}}),S('receipt','Receipt','receipt',{required:false,owner:{kind:'procurement'}}),S('outcome','Outcome review','outcome'),S('close','Closure','closure')]},
 {kind:'procurement',name:'Procurement',description:'Need to purchase order, receipt and payment.',types:['procurement','opex'],stages:[S('request','Request','intake'),S('approval','Approval','approval',{owner:{kind:'department_head'},approval:financeApproval}),S('budget','Budget check','budget',{required:false,owner:{kind:'finance'}}),S('pr','Purchase requisition','requisition'),S('rfq','Request for quotation','rfq',{required:false,owner:{kind:'procurement'}}),S('quotes','Vendor quotations','quotations',{required:false,owner:{kind:'procurement'},minQuotes:2}),S('eval','Bid evaluation','evaluation',{required:false,owner:{kind:'procurement'}}),S('po','Purchase order','order',{owner:{kind:'procurement'}}),S('receipt','Goods receipt','receipt',{owner:{kind:'procurement'}}),S('close','Closure','closure')]},
 {kind:'asset_acquisition',name:'Asset acquisition',description:'Equipment from request to deployment, maintenance and disposal.',types:['asset'],stages:[S('request','Request','intake'),S('approval','Approval','approval',{owner:{kind:'department_head'},approval:financeApproval}),S('pr','Purchase requisition','requisition'),S('po','Purchase order','order',{owner:{kind:'procurement'}}),S('receipt','Goods receipt','receipt',{owner:{kind:'procurement'}}),S('assets','Asset creation','asset'),S('deploy','Assignment & deployment','deployment'),S('outcome','Outcome review','outcome',{required:false}),S('close','Disposal, renewal or closure','closure')]},
 {kind:'maintenance',name:'Maintenance',description:'Maintenance need to completed work and review.',types:['maintenance'],stages:[S('request','Request','intake'),S('approval','Approval','approval',{owner:{kind:'department_head'},approval:headApproval(),required:false}),S('pr','Parts requisition','requisition',{required:false}),S('deliver','Maintenance delivery','service'),S('close','Closure','closure')]},
 {kind:'improvement',name:'Internal improvement',description:'Ideas from proposal to measured benefit.',types:['improvement','general','staffing'],stages:[S('request','Idea','intake'),S('review','Review','review',{owner:{kind:'department_head'}}),S('approval','Approval','approval',{owner:{kind:'department_head'},approval:headApproval()}),S('goal','Link to goal','goal',{required:false}),S('project','Project set up','project',{required:false,auto:true}),S('measure','Benefit measurement','measurement'),S('outcome','Outcome review','outcome'),S('close','Closure','closure')]},
 {kind:'custom',name:'Custom process',description:'A minimal request → approval → closure process to adapt.',types:['custom'],stages:[S('request','Request','intake'),S('approval','Approval','approval',{owner:{kind:'department_head'},approval:headApproval()}),S('close','Closure','closure')]},
];
export async function ensureTemplates(tenantId:string,actor:string){
 if(await first('SELECT id FROM lifecycle_templates WHERE tenant_id=? LIMIT 1',tenantId))return;
 const ts=now();await batch(DEFAULT_TEMPLATES.map(t=>stmt('INSERT INTO lifecycle_templates(id,tenant_id,name,kind,description,request_types_json,stages_json,status,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,1,?,?,?)',uid(),tenantId,t.name,t.kind,t.description,JSON.stringify(t.types),JSON.stringify(t.stages),'active',actor,ts,ts)));
}
export function validateStages(v:unknown):StageDef[]{
 if(!Array.isArray(v)||v.length<2||v.length>30)throw new HttpError(400,'A lifecycle needs between 2 and 30 stages.');
 const keys=new Set<string>();
 return v.map((x,i)=>{const s=(x||{}) as Record<string,unknown>;const key=String(s.key||'').trim();if(!/^[a-z][a-z0-9_]{0,30}$/.test(key))throw new HttpError(400,`Stage ${i+1}: use a short lowercase key.`);if(keys.has(key))throw new HttpError(400,`Stage key “${key}” is used twice.`);keys.add(key);
  const kind=oneOf(s.kind,STAGE_KINDS,`stage ${i+1} type`);const owner=(s.owner||{kind:'requester'}) as Owner;if(!['requester','manager','department_head','procurement','finance','role','person'].includes(owner.kind))throw new HttpError(400,`Stage ${i+1}: choose an owner.`);
  if(kind==='approval'){const st=((s.approval as {stages?:ApprovalStage[]})?.stages)||[];if(!st.length)throw new HttpError(400,`Stage “${s.name}”: an approval gate needs at least one approval step.`);for(const a of st)if(!a.approvers?.length)throw new HttpError(400,`Stage “${s.name}”: step “${a.name}” has no approvers.`)}
  if(i===0&&kind!=='intake')throw new HttpError(400,'The first stage must be the request (intake).');
  return {key,name:str(s.name,`Stage ${i+1} name`,80),kind,required:s.required!==false,owner:{kind:owner.kind,value:owner.value?String(owner.value).slice(0,120):undefined},slaDays:s.slaDays?Math.round(num(s.slaDays,'SLA days',1,365)):undefined,approval:kind==='approval'?{stages:(s.approval as {stages:ApprovalStage[]}).stages.slice(0,6),delegable:(s.approval as {delegable?:boolean}).delegable!==false}:undefined,requiredFields:Array.isArray(s.requiredFields)?s.requiredFields.map(String).slice(0,20):undefined,requiredDocs:s.requiredDocs?Math.round(num(s.requiredDocs,'Required documents',0,20)):undefined,budgetRule:s.budgetRule as StageDef['budgetRule'],notify:Array.isArray(s.notify)?s.notify.map(String).slice(0,10):undefined,auto:s.auto===true,minQuotes:s.minQuotes?Math.round(num(s.minQuotes,'Minimum quotations',1,10)):undefined};
 });
}

// ── Visibility ──
export async function canSeeRequest(u:Member,r:RequestRow){
 if(u.role==='admin'||r.requester_id===u.id)return true;
 if(hasAction(u,'lifecycle')&&canActOn(u,'lifecycle','view',r.department,r.requester_id)&&r.visibility!=='private')return true;
 if(r.visibility==='company'&&hasAction(u,'lifecycle'))return true;
 // Approvers, stage owners and active delegates of either can open it while they are involved.
 const ap=await all<{approver_ids_json:string}>('SELECT approver_ids_json FROM lifecycle_approvals WHERE tenant_id=? AND request_id=?',u.tenantId,r.id);
 const involved=new Set(ap.flatMap(a=>parseJson<string[]>(a.approver_ids_json,[])));for(const s of await all<{owner_id:string|null}>('SELECT owner_id FROM lifecycle_stages WHERE tenant_id=? AND request_id=?',u.tenantId,r.id))if(s.owner_id)involved.add(s.owner_id);
 if(involved.has(u.id))return true;
 const {activeFor}=await import('./delegation');return (await activeFor(u.tenantId,u.id,'lifecycle','approval',{type:'request',id:r.id})).some(d=>involved.has(d.delegator_id));
}
export async function loadRequest(u:Member,id:string){const r=await first<RequestRow>('SELECT * FROM business_requests WHERE id=? AND tenant_id=?',id,u.tenantId);if(!r||!await canSeeRequest(u,r))throw new HttpError(404,'Request not found.');return r}
const canManage=(u:Member,r:RequestRow)=>u.role==='admin'||r.requester_id===u.id||canActOn(u,'lifecycle','update',r.department,r.requester_id);

// ── Owners and approvers ──
async function ownerFor(tenantId:string,o:Owner,r:RequestRow):Promise<string|null>{
 const {deptHeads}=await import('./inbox');
 switch(o.kind){
  case 'requester':return r.requester_id;
  case 'manager':return (await first<{manager_id:string|null}>('SELECT manager_id FROM members WHERE id=? AND tenant_id=?',r.requester_id,tenantId))?.manager_id||(await deptHeads(tenantId,r.department))[0]||r.requester_id;
  case 'department_head':return (await deptHeads(tenantId,r.department)).find(x=>x!==r.requester_id)||(await first<{id:string}>("SELECT id FROM members WHERE tenant_id=? AND active=1 AND role='admin' AND id<>? LIMIT 1",tenantId,r.requester_id))?.id||r.requester_id;
  case 'procurement':return (await deptHeads(tenantId,'Procurement'))[0]||(await first<{id:string}>("SELECT id FROM members WHERE tenant_id=? AND active=1 AND role='admin' LIMIT 1",tenantId))?.id||null;
  case 'finance':return (await deptHeads(tenantId,'Finance'))[0]||(await first<{id:string}>("SELECT id FROM members WHERE tenant_id=? AND active=1 AND role='admin' LIMIT 1",tenantId))?.id||null;
  case 'person':return o.value&&await first('SELECT id FROM members WHERE id=? AND tenant_id=? AND active=1',o.value,tenantId)?o.value:null;
  case 'role':return (await first<{id:string}>('SELECT id FROM members WHERE tenant_id=? AND active=1 AND (role=? OR role_id=?) LIMIT 1',tenantId,o.value,o.value))?.id||null;
 }
 return null;
}
const stageDefs=(r:RequestRow)=>parseJson<StageDef[]>(r.stages_json,[]);
const ev=(tenantId:string,id:string)=>stmt("INSERT INTO domain_events(id,tenant_id,type,entity_id,action,actor,payload_json,status,attempts,error,created_at) VALUES(?,?,'inbox',?,'inbox sync','system',?,'pending',0,'',?)",uid(),tenantId,id,JSON.stringify({type:'request'}),now());

// ── Creating and editing requests ──
export type RequestInput={title:string,description?:string,requestType:string,department?:string,location?:string,businessNeed?:string,expectedOutcome?:string,estimatedCost?:number,currency?:string,priority?:string,risk?:string,requiredDate?:string|null,goalId?:string|null,templateId?:string,files?:string[],visibility?:string};
function readInput(b:Record<string,unknown>,u:Member){
 return {title:str(b.title,'Title',200),description:str(b.description,'Description',8000,false),requestType:oneOf(b.requestType||'general',REQUEST_TYPES,'request type'),department:str(b.department||u.department,'Department',160),location:str(b.location,'Location',200,false),businessNeed:str(b.businessNeed,'Business need',4000,false),expectedOutcome:str(b.expectedOutcome,'Expected outcome',4000,false),estimatedCost:b.estimatedCost===undefined||b.estimatedCost===''?0:num(b.estimatedCost,'Estimated cost',0,1e13),currency:str(b.currency||'GHS','Currency',8).toUpperCase(),priority:oneOf(b.priority||'Medium',['Low','Medium','High','Critical'] as const,'priority'),risk:oneOf(b.risk||'Medium',['Low','Medium','High'] as const,'risk'),requiredDate:date(b.requiredDate,'Required date'),goalId:b.goalId?idOf(b.goalId,'Goal'):null,files:Array.isArray(b.files)?(b.files as unknown[]).map(x=>idOf(x,'File')).slice(0,30):[],visibility:oneOf(b.visibility||'department',['department','company','private'] as const,'visibility')};
}
async function checkRefs(u:Member,v:ReturnType<typeof readInput>){
 if(v.goalId){const {loadWork}=await import('./work');const g=await loadWork(u,v.goalId).catch(()=>null);if(!g||!['goal','objective','key_result','initiative','programme','strategy'].includes(g.kind))throw new HttpError(400,'Choose a goal, objective or initiative you can see.')}
 const {canSeeFile}=await import('./entities');for(const f of v.files){const fr=await first<Parameters<typeof canSeeFile>[1]>('SELECT * FROM files WHERE id=? AND tenant_id=?',f,u.tenantId);if(!fr||!canSeeFile(u,fr))throw new HttpError(400,'A supporting file was not found.')}
}
export async function createRequest(u:Member,b:Record<string,unknown>){
 if(!hasAction(u,'lifecycle','create'))throw new HttpError(403,'Raising business requests is not available to you.');
 await ensureTemplates(u.tenantId,u.id);const v=readInput(b,u);await checkRefs(u,v);
 const tpl=b.templateId?await first<Template>("SELECT * FROM lifecycle_templates WHERE id=? AND tenant_id=? AND status='active'",idOf(b.templateId,'Template'),u.tenantId):(await all<Template>("SELECT * FROM lifecycle_templates WHERE tenant_id=? AND status='active' ORDER BY created_at",u.tenantId)).find(t=>parseJson<string[]>(t.request_types_json,[]).includes(v.requestType))||await first<Template>("SELECT * FROM lifecycle_templates WHERE tenant_id=? AND status='active' AND kind='custom'",u.tenantId);
 if(!tpl)throw new HttpError(400,'No lifecycle template applies to this request type.');
 const id=uid(),ts=now();const number=await nextNumber(u.tenantId,'REQ',true,['business_requests','number']);
 await batch([stmt('INSERT INTO business_requests(id,tenant_id,number,title,description,request_type,requester_id,department,location,business_need,expected_outcome,estimated_cost,currency,priority,risk,required_date,goal_id,template_id,template_version,stages_json,status,current_stage,files_json,visibility,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)',id,u.tenantId,number,v.title,v.description,v.requestType,u.id,v.department,v.location,v.businessNeed,v.expectedOutcome,v.estimatedCost,v.currency,v.priority,v.risk,v.requiredDate,v.goalId,tpl.id,tpl.version,tpl.stages_json,'Draft','',JSON.stringify(v.files),v.visibility,ts,ts),
  ...stageDefsOf(tpl).map((s,i)=>stmt('INSERT INTO lifecycle_stages(id,tenant_id,request_id,stage_key,name,position,required,status) VALUES(?,?,?,?,?,?,?,?)',uid(),u.tenantId,id,s.key,s.name,i,s.required?1:0,'pending')),
  auditStatement(u,`Business request ${number} created`,id,v.department,null,{title:v.title,type:v.requestType,template:tpl.name,estimatedCost:v.estimatedCost})]);
 for(const f of v.files)await stmt('INSERT OR IGNORE INTO file_links(id,tenant_id,file_id,entity_type,entity_id,created_by,created_at) VALUES(?,?,?,?,?,?,?)',uid(),u.tenantId,f,'request',id,u.id,now()).run().catch(()=>{});
 if(b.submit===true)await submit(u,await loadRequest(u,id));
 return {id,number};
}
const stageDefsOf=(t:Template)=>parseJson<StageDef[]>(t.stages_json,[]);
export async function updateRequest(u:Member,r:RequestRow,b:Record<string,unknown>){
 if(!canManage(u,r))throw new HttpError(403,'You cannot edit this request.');
 if(!['Draft','Changes requested'].includes(r.status)&&u.role!=='admin')throw new HttpError(409,'Only draft requests (or requests returned for changes) can be edited.');
 if(b.version!==undefined&&Number(b.version)!==r.version)throw new HttpError(409,'This request changed. Refresh and review the latest version.');
 const v=readInput({...b,requestType:b.requestType||r.request_type,department:b.department||r.department},u);await checkRefs(u,v);
 await batch([stmt('UPDATE business_requests SET title=?,description=?,department=?,location=?,business_need=?,expected_outcome=?,estimated_cost=?,currency=?,priority=?,risk=?,required_date=?,goal_id=?,files_json=?,visibility=?,version=version+1,updated_at=? WHERE id=? AND tenant_id=? AND version=?',v.title,v.description,v.department,v.location,v.businessNeed,v.expectedOutcome,v.estimatedCost,v.currency,v.priority,v.risk,v.requiredDate,v.goalId,JSON.stringify(v.files),v.visibility,now(),r.id,u.tenantId,r.version),auditStatement(u,`Request ${r.number} updated`,r.id,v.department,{title:r.title,estimatedCost:r.estimated_cost},{title:v.title,estimatedCost:v.estimatedCost})]);
 for(const f of v.files)await stmt('INSERT OR IGNORE INTO file_links(id,tenant_id,file_id,entity_type,entity_id,created_by,created_at) VALUES(?,?,?,?,?,?,?)',uid(),u.tenantId,f,'request',r.id,u.id,now()).run().catch(()=>{});
 await (await import('./finance')).reconcileRequest(u.tenantId,r.id,u.id,'Request updated');
 return {ok:true};
}

// ── Stage engine ──
async function stages(tenantId:string,requestId:string){return all<StageRow>('SELECT * FROM lifecycle_stages WHERE tenant_id=? AND request_id=? ORDER BY position',tenantId,requestId)}
export async function submit(u:Member,r:RequestRow){
 if(r.requester_id!==u.id&&u.role!=='admin')throw new HttpError(403,'Only the requester submits the request.');
 if(!['Draft','Changes requested'].includes(r.status))throw new HttpError(409,'This request has already been submitted.');
 const defs=stageDefs(r);const first0=defs[0];
 await requirements(u,r,first0);
 const st=await stages(u.tenantId,r.id);
 if(r.status==='Changes requested'){
  // Resubmission restarts the stage that asked for changes.
  const back=st.find(s=>s.status==='returned')||st.find(s=>s.status==='active');
  await batch([stmt("UPDATE business_requests SET status='In progress',version=version+1,updated_at=? WHERE id=? AND tenant_id=?",now(),r.id,u.tenantId),auditStatement(u,`Request ${r.number} resubmitted`,r.id,r.department,{status:r.status},{status:'In progress'})]);
  if(back)await activate(u,await loadRequest(u,r.id),back.stage_key);return {ok:true};
 }
 const intake=st.find(s=>s.position===0)!;
 await batch([stmt("UPDATE business_requests SET status='In progress',version=version+1,updated_at=? WHERE id=? AND tenant_id=?",now(),r.id,u.tenantId),stmt("UPDATE lifecycle_stages SET status='done',started_at=?,completed_at=?,completed_by=?,outcome='submitted' WHERE id=?",now(),now(),u.id,intake.id),auditStatement(u,`Request ${r.number} submitted`,r.id,r.department,{status:r.status},{status:'In progress'})]);
 await (await import('./finance')).reconcileRequest(u.tenantId,r.id,u.id,'Request submitted');
 await advance(u,await loadRequest(u,r.id));return {ok:true};
}
// Checks a stage's required fields, documents and budget rule before it can be completed.
async function requirements(u:Member,r:RequestRow,d:StageDef){
 const missing:string[]=[];const fieldMap:Record<string,unknown>={title:r.title,businessNeed:r.business_need,expectedOutcome:r.expected_outcome,estimatedCost:r.estimated_cost||'',requiredDate:r.required_date,goalId:r.goal_id,description:r.description,location:r.location};
 for(const f of d.requiredFields||[])if(fieldMap[f]===undefined||fieldMap[f]===null||fieldMap[f]==='')missing.push(f.replace(/([A-Z])/g,' $1').toLowerCase());
 if(d.requiredDocs){const n=parseJson<string[]>(r.files_json,[]).length;if(n<d.requiredDocs)missing.push(`${d.requiredDocs} supporting document${d.requiredDocs===1?'':'s'}`)}
 if(d.kind==='business_case'){const c=await first<{problem:string,solution:string,status:string}>('SELECT problem,solution,status FROM business_cases WHERE tenant_id=? AND request_id=?',u.tenantId,r.id);if(!c||!c.problem||!c.solution)missing.push('a business case with problem and solution')}
 if(missing.length)throw new HttpError(400,`Complete first: ${missing.join(', ')}.`);
}
// Activates the next pending stage (skipping optional stages already skipped) and runs its entry logic.
export async function advance(u:Member,r:RequestRow){
 const st=await stages(u.tenantId,r.id);const next=st.find(s=>s.status==='pending');
 if(!next){await batch([stmt("UPDATE business_requests SET status='Completed',current_stage='',closed_at=?,version=version+1,updated_at=? WHERE id=? AND tenant_id=?",now(),now(),r.id,u.tenantId),auditStatement(u,`Request ${r.number} completed`,r.id,r.department,{status:r.status},{status:'Completed'}),ev(u.tenantId,r.id)]);return}
 await activate(u,r,next.stage_key);
}
async function activate(u:Member,r:RequestRow,key:string){
 const d=stageDefs(r).find(s=>s.key===key)!;const owner=await ownerFor(u.tenantId,d.owner,r);const due=d.slaDays?new Date(Date.now()+d.slaDays*86400000).toISOString():r.required_date;
 await batch([stmt("UPDATE lifecycle_stages SET status='active',owner_id=?,due_at=?,started_at=coalesce(started_at,?) WHERE tenant_id=? AND request_id=? AND stage_key=?",owner,due,now(),u.tenantId,r.id,key),stmt('UPDATE business_requests SET current_stage=?,version=version+1,updated_at=? WHERE id=? AND tenant_id=?',key,now(),r.id,u.tenantId),auditStatement(u,`Stage started: ${d.name}`,r.id,r.department,null,{stage:key,owner}),ev(u.tenantId,r.id)]);
 if(d.kind==='approval')await startGate(u,r,d);
 else if(owner&&owner!==u.id)await notify(u,[owner],{kind:'lifecycle',title:`${r.number}: ${d.name}`,body:r.title,link:`#/lifecycle/${r.id}`});
 // Automatic stages create or check their linked record straight away.
 await evaluate(u.tenantId,r.id,u).catch(()=>{});
}
async function startGate(u:Member,r:RequestRow,d:StageDef){
 const {resolveApprovers}=await import('./studio');const {test}=await import('../studio-def');const ts=now();const s:D1PreparedStatement[]=[];let i=0;
 const data={estimated_cost:r.estimated_cost,estimatedCost:r.estimated_cost,priority:r.priority,risk:r.risk,request_type:r.request_type,department:r.department};
 await run("UPDATE lifecycle_approvals SET status='cancelled' WHERE tenant_id=? AND request_id=? AND stage_key=? AND status IN ('pending','waiting')",u.tenantId,r.id,d.key);
 const gates=(d.approval?.stages||[]).filter(g=>!g.when||test(g.when,data));
 // Finance rule: large amounts always include a finance step.
 if(d.budgetRule?.financeAbove!=null&&r.estimated_cost>=d.budgetRule.financeAbove&&!gates.some(g=>g.approvers.some(a=>a.kind==='department'&&a.value==='Finance')))gates.push({name:'Finance',mode:'any',approvers:[{kind:'department',value:'Finance'}]});
 for(const g of gates){const ids=await resolveApprovers(u.tenantId,g.approvers,{department:r.department,requesterId:r.requester_id});s.push(stmt('INSERT INTO lifecycle_approvals(id,tenant_id,request_id,stage_key,stage,name,mode,quorum,approver_ids_json,decisions_json,status,delegable,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,r.id,d.key,i,g.name,g.mode,g.quorum||1,JSON.stringify(ids),'[]',i===0?'pending':'waiting',d.approval?.delegable===false?0:1,ts));i++}
 if(!s.length){await completeStage(u,await loadRequest(u,r.id),d.key,'No approval step applied',true);return}
 await batch([...s,ev(u.tenantId,r.id)]);
 const firstIds=await first<{approver_ids_json:string}>("SELECT approver_ids_json FROM lifecycle_approvals WHERE tenant_id=? AND request_id=? AND stage_key=? AND status='pending'",u.tenantId,r.id,d.key);
 await notify(u,parseJson<string[]>(firstIds?.approver_ids_json,[]),{kind:'approval',title:`Approval needed: ${r.number}`,body:r.title,link:`#/lifecycle/${r.id}`});
}
export async function decide(u:Member,r:RequestRow,approvalId:string,decision:'approve'|'reject'|'changes',comment:string){
 const a=await first<{id:string,stage_key:string,stage:number,name:string,mode:string,quorum:number,approver_ids_json:string,decisions_json:string,status:string,delegable:number}>('SELECT * FROM lifecycle_approvals WHERE id=? AND tenant_id=? AND request_id=?',approvalId,u.tenantId,r.id);
 if(!a||a.status!=='pending')throw new HttpError(409,'This approval is not waiting for a decision.');
 if(r.requester_id===u.id)throw new HttpError(403,'You cannot approve your own request.');
 const approvers=parseJson<string[]>(a.approver_ids_json,[]);let actingFor:string|null=null;
 if(!approvers.includes(u.id)){
  if(a.delegable){const {actingFor:af}=await import('./delegation');const who=await af(u,approvers,'lifecycle',{itemType:'approval',amount:r.estimated_cost,source:{type:'request',id:r.id}});actingFor=who[0]||null}
  if(!actingFor&&u.role!=='admin')throw new HttpError(403,'You are not an approver for this step.');
 }
 if(decision!=='approve'&&!comment)throw new HttpError(400,'Add a reason.');
 const decisions=parseJson<{by:string,for?:string|null,decision:string,comment:string,at:string}[]>(a.decisions_json,[]);const who=actingFor||u.id;
 if(decisions.some(d=>(d.for||d.by)===who))throw new HttpError(409,'This approver has already decided.');
 decisions.push({by:u.id,for:actingFor,decision,comment,at:now()});
 const approvals=decisions.filter(d=>d.decision==='approve').map(d=>d.for||d.by);
 const done=decision!=='approve'?true:a.mode==='all'?approvers.every(x=>approvals.includes(x)):a.mode==='quorum'?approvals.length>=Math.max(1,a.quorum):true;
 const status=decision==='reject'?'rejected':decision==='changes'?'changes':done?'approved':'pending';
 const res=await batch([stmt("UPDATE lifecycle_approvals SET decisions_json=?,status=?,decided_at=CASE WHEN ?<>'pending' THEN ? ELSE decided_at END WHERE id=? AND status='pending'",JSON.stringify(decisions),status,status,now(),a.id),auditStatement(u,`${a.name}: ${decision==='approve'?'approved':decision==='reject'?'rejected':'changes requested'}${actingFor?' (delegation)':''}`,r.id,r.department,null,{step:a.name,comment,onBehalfOf:actingFor}),ev(u.tenantId,r.id)]);
 if(!res[0].meta.changes)throw new HttpError(409,'Someone else decided this step. Refresh to see the latest status.');
 const d=stageDefs(r).find(s=>s.key===a.stage_key)!;
 if(decision==='reject'){await batch([stmt("UPDATE lifecycle_approvals SET status='cancelled' WHERE tenant_id=? AND request_id=? AND status='waiting'",u.tenantId,r.id),stmt("UPDATE lifecycle_stages SET status='rejected',completed_at=?,completed_by=?,outcome=? WHERE tenant_id=? AND request_id=? AND stage_key=?",now(),u.id,comment,u.tenantId,r.id,a.stage_key),stmt("UPDATE business_requests SET status='Rejected',closed_at=?,version=version+1,updated_at=? WHERE id=? AND tenant_id=?",now(),now(),r.id,u.tenantId),auditStatement(u,`Request ${r.number} rejected`,r.id,r.department,{status:r.status},{status:'Rejected',reason:comment}),ev(u.tenantId,r.id)]);await notify(u,[r.requester_id],{kind:'rejected',title:`${r.number} was rejected`,body:comment,link:`#/lifecycle/${r.id}`});await (await import('./finance')).reconcileRequest(u.tenantId,r.id,u.id,'Request rejected');return {status:'Rejected'}}
 if(decision==='changes'){await batch([stmt("UPDATE lifecycle_approvals SET status='cancelled' WHERE tenant_id=? AND request_id=? AND stage_key=? AND status='waiting'",u.tenantId,r.id,a.stage_key),stmt("UPDATE lifecycle_stages SET status='returned' WHERE tenant_id=? AND request_id=? AND stage_key=?",u.tenantId,r.id,a.stage_key),stmt("UPDATE business_requests SET status='Changes requested',version=version+1,updated_at=? WHERE id=? AND tenant_id=?",now(),r.id,u.tenantId),ev(u.tenantId,r.id)]);await notify(u,[r.requester_id],{kind:'lifecycle',title:`${r.number}: changes requested`,body:comment,link:`#/lifecycle/${r.id}`});return {status:'Changes requested'}}
 if(!done)return {status:'Pending'};
 const next=await first<{id:string,approver_ids_json:string}>("SELECT id,approver_ids_json FROM lifecycle_approvals WHERE tenant_id=? AND request_id=? AND stage_key=? AND status='waiting' ORDER BY stage LIMIT 1",u.tenantId,r.id,a.stage_key);
 if(next){await batch([stmt("UPDATE lifecycle_approvals SET status='pending' WHERE id=?",next.id),ev(u.tenantId,r.id)]);await notify(u,parseJson<string[]>(next.approver_ids_json,[]),{kind:'approval',title:`Approval needed: ${r.number}`,body:r.title,link:`#/lifecycle/${r.id}`});return {status:'Pending'}}
 await completeStage(u,await loadRequest(u,r.id),d.key,'approved',true);
 await notify(u,[r.requester_id],{kind:'approved',title:`${r.number} approved: ${d.name}`,body:r.title,link:`#/lifecycle/${r.id}`});
 return {status:'Approved'};
}
export async function completeStage(u:Member,r:RequestRow,key:string,outcome:string,system=false,link?:{type:string,id:string}){
 const st=(await stages(u.tenantId,r.id)).find(s=>s.stage_key===key);if(!st||st.status!=='active')throw new HttpError(409,'That stage is not active.');
 const d=stageDefs(r).find(s=>s.key===key)!;
 if(!system){if(st.owner_id!==u.id&&!canManage(u,r)&&u.role!=='admin')throw new HttpError(403,'Only the stage owner can complete this stage.');if(d.kind==='approval')throw new HttpError(409,'Approval stages complete when approvers decide.');await requirements(u,r,d)}
 await batch([stmt("UPDATE lifecycle_stages SET status='done',completed_at=?,completed_by=?,outcome=?,linked_type=coalesce(?,linked_type),linked_id=coalesce(?,linked_id) WHERE id=?",now(),system?'system':u.id,outcome.slice(0,500),link?.type||null,link?.id||null,st.id),auditStatement(u,`Stage completed: ${d.name}`,r.id,r.department,null,{stage:key,outcome,link:link||null})]);
 if(d.kind==='closure'||(await stages(u.tenantId,r.id)).every(s=>['done','skipped'].includes(s.status)))await batch([stmt("UPDATE business_requests SET status=?,closed_at=?,version=version+1,updated_at=? WHERE id=? AND tenant_id=?",d.kind==='closure'&&/renew/i.test(outcome)?'Renewed':d.kind==='closure'&&/dispos/i.test(outcome)?'Disposed':'Closed',now(),now(),r.id,u.tenantId),ev(u.tenantId,r.id)]);
 await advance(u,await loadRequest(u,r.id));
}
export async function skipStage(u:Member,r:RequestRow,key:string,reason:string){
 const st=(await stages(u.tenantId,r.id)).find(s=>s.stage_key===key);if(!st||!['active','pending'].includes(st.status))throw new HttpError(409,'That stage cannot be skipped now.');
 if(st.required)throw new HttpError(409,'Required stages cannot be skipped.');if(!canManage(u,r)&&st.owner_id!==u.id)throw new HttpError(403,'You cannot skip stages on this request.');
 await batch([stmt("UPDATE lifecycle_stages SET status='skipped',completed_at=?,completed_by=?,outcome=? WHERE id=?",now(),u.id,reason.slice(0,300),st.id),auditStatement(u,`Stage skipped: ${st.name}`,r.id,r.department,null,{reason}),ev(u.tenantId,r.id)]);
 if(st.status==='active')await advance(u,await loadRequest(u,r.id));
}

// ── Automatic stage completion from linked records ──
// Looks at the records connected to the request and completes the active stage when its condition is met.
export async function evaluate(tenantId:string,requestId:string,actor?:Member){
 for(let guard=0;guard<25;guard++){
  const r=await first<RequestRow>('SELECT * FROM business_requests WHERE id=? AND tenant_id=?',requestId,tenantId);if(!r||r.status!=='In progress')return;
  const st=(await stages(tenantId,r.id)).find(s=>s.status==='active');if(!st)return;const d=stageDefs(r).find(s=>s.key===st.stage_key);if(!d)return;
  const met=await condition(tenantId,r,d);if(!met)return;
  const sys=actor||({id:'system',tenantId,name:'System',role:'admin',department:r.department} as unknown as Member);
  await completeStage({...sys,tenantId} as Member,r,st.stage_key,met.outcome,true,met.link);
 }
}
async function docsOf(tenantId:string,r:RequestRow){return all<{id:string,kind:string,status:string,number:string,pr_id:string|null}>('SELECT id,kind,status,number,pr_id FROM purchase_docs WHERE tenant_id=? AND (request_id=? OR (project_id IS NOT NULL AND project_id=?) OR pr_id IN (SELECT id FROM purchase_docs WHERE tenant_id=? AND request_id=?))',tenantId,r.id,r.project_id||'-',tenantId,r.id)}
async function condition(tenantId:string,r:RequestRow,d:StageDef):Promise<{outcome:string,link?:{type:string,id:string}}|null>{
 switch(d.kind){
  case 'goal':return r.goal_id?{outcome:'Linked to goal',link:{type:'work_record',id:r.goal_id}}:null;
  case 'project':return r.project_id?{outcome:'Project linked',link:{type:'project',id:r.project_id}}:null;
  case 'budget':{if(!r.budget_id)return null;const b=await first<{status:string}>('SELECT status FROM budgets WHERE id=? AND tenant_id=?',r.budget_id,tenantId);return b&&b.status==='Active'?{outcome:'Budget active',link:{type:'budget',id:r.budget_id}}:null}
  case 'requisition':{const pr=(await docsOf(tenantId,r)).find(x=>x.kind==='PR'&&['Approved','Converted','Partially converted'].includes(x.status));return pr?{outcome:`${pr.number} approved`,link:{type:'PR',id:pr.id}}:null}
  case 'rfq':{const prs=(await docsOf(tenantId,r)).filter(x=>x.kind==='PR');const q=prs.length?await first<{n:number}>(`SELECT count(*) AS n FROM quotations WHERE tenant_id=? AND doc_id IN (${prs.map(()=>'?').join(',')})`,tenantId,...prs.map(x=>x.id)):null;return (q?.n||0)>0?{outcome:'Quotations requested and received'}:null}
  case 'quotations':{const docs=await docsOf(tenantId,r);const q=docs.length?await first<{n:number}>(`SELECT count(DISTINCT vendor_id) AS n FROM quotations WHERE tenant_id=? AND doc_id IN (${docs.map(()=>'?').join(',')})`,tenantId,...docs.map(x=>x.id)):null;return (q?.n||0)>=(d.minQuotes||1)?{outcome:`${q?.n} vendor quotations`}:null}
  case 'evaluation':{const docs=await docsOf(tenantId,r);const q=docs.length?await first<{id:string,doc_id:string}>(`SELECT id,doc_id FROM quotations WHERE tenant_id=? AND selected=1 AND doc_id IN (${docs.map(()=>'?').join(',')}) LIMIT 1`,tenantId,...docs.map(x=>x.id)):null;return q?{outcome:'Winning quotation selected'}:null}
  case 'order':{const po=(await docsOf(tenantId,r)).find(x=>x.kind==='PO'&&['Issued','Partially received','Received','Closed'].includes(x.status));return po?{outcome:`${po.number} issued`,link:{type:'PO',id:po.id}}:null}
  case 'receipt':{const pos=(await docsOf(tenantId,r)).filter(x=>x.kind==='PO'&&!['Draft','Cancelled','Rejected'].includes(x.status));return pos.length&&pos.every(x=>['Received','Closed'].includes(x.status))?{outcome:'All ordered goods and services received',link:{type:'PO',id:pos[0].id}}:null}
  case 'asset':{const pos=(await docsOf(tenantId,r)).filter(x=>x.kind==='PO');if(!pos.length)return null;const a=await first<{id:string,n:number}>(`SELECT min(id) AS id,count(*) AS n FROM assets WHERE tenant_id=? AND purchase_doc_id IN (${pos.map(()=>'?').join(',')})`,tenantId,...pos.map(x=>x.id));return a?.n?{outcome:`${a.n} asset record${a.n===1?'':'s'} created`,link:{type:'asset',id:a.id}}:null}
  case 'deployment':{const pos=(await docsOf(tenantId,r)).filter(x=>x.kind==='PO');if(!pos.length)return null;const a=await all<{assigned_to:string|null,status:string}>(`SELECT assigned_to,status FROM assets WHERE tenant_id=? AND purchase_doc_id IN (${pos.map(()=>'?').join(',')})`,tenantId,...pos.map(x=>x.id));return a.length&&a.every(x=>x.assigned_to||x.status==='In use')?{outcome:'All assets assigned or in use'}:null}
  case 'service':{const s=await first<{id:string,status:string}>("SELECT id,status FROM service_deliveries WHERE tenant_id=? AND request_id=? AND status IN ('Accepted','Closed') ORDER BY updated_at DESC LIMIT 1",tenantId,r.id);return s?{outcome:`Service ${s.status.toLowerCase()}`,link:{type:'service_delivery',id:s.id}}:null}
  case 'measurement':{const b=await all<{id:string,n:number}>('SELECT b.id,(SELECT count(*) FROM benefit_measurements m WHERE m.benefit_id=b.id AND m.tenant_id=b.tenant_id) AS n FROM benefits b WHERE b.tenant_id=? AND b.request_id=?',tenantId,r.id);return b.length&&b.every(x=>x.n>0)?{outcome:'Every benefit has a measurement'}:null}
  case 'outcome':{const o=await first<{id:string}>("SELECT id FROM outcome_reviews WHERE tenant_id=? AND request_id=? AND status='Completed' LIMIT 1",tenantId,r.id);return o?{outcome:'Outcome review completed',link:{type:'outcome_review',id:o.id}}:null}
 }
 return null;
}
// Domain events for linked records re-evaluate the requests they belong to.
export async function onDomainEvent(tenantId:string,entityType:string|null,entityId:string){
 if(!entityType)return;const ids=new Set<string>();
 if(entityType==='PR'||entityType==='PO'){const d=await first<{request_id:string|null,project_id:string|null,pr_id:string|null}>('SELECT request_id,project_id,pr_id FROM purchase_docs WHERE id=? AND tenant_id=?',entityId,tenantId);if(d?.request_id)ids.add(d.request_id);if(d?.pr_id){const pr=await first<{request_id:string|null}>('SELECT request_id FROM purchase_docs WHERE id=? AND tenant_id=?',d.pr_id,tenantId);if(pr?.request_id)ids.add(pr.request_id)}if(d?.project_id)for(const r of await all<{id:string}>('SELECT id FROM business_requests WHERE tenant_id=? AND project_id=?',tenantId,d.project_id))ids.add(r.id)}
 if(entityType==='asset'){const a=await first<{purchase_doc_id:string|null}>('SELECT purchase_doc_id FROM assets WHERE id=? AND tenant_id=?',entityId,tenantId);if(a?.purchase_doc_id)return onDomainEvent(tenantId,'PO',a.purchase_doc_id)}
 if(entityType==='budget')for(const r of await all<{id:string}>('SELECT id FROM business_requests WHERE tenant_id=? AND budget_id=?',tenantId,entityId))ids.add(r.id);
 if(entityType==='project')for(const r of await all<{id:string}>('SELECT id FROM business_requests WHERE tenant_id=? AND project_id=?',tenantId,entityId))ids.add(r.id);
 if(entityType==='service_delivery'||entityType==='outcome_review'){const t=entityType==='service_delivery'?'service_deliveries':'outcome_reviews';const x=await first<{request_id:string|null}>(`SELECT request_id FROM ${t} WHERE id=? AND tenant_id=?`,entityId,tenantId);if(x?.request_id)ids.add(x.request_id)}
 for(const id of ids)await evaluate(tenantId,id);
}

// ── Linked records created from a request (through the owning modules' own services) ──
export async function linkRecord(u:Member,r:RequestRow,kind:'project'|'budget'|'goal',id:string){
 if(!canManage(u,r)&&!(await stages(u.tenantId,r.id)).some(s=>s.status==='active'&&s.owner_id===u.id))throw new HttpError(403,'You cannot link records to this request.');
 if(kind==='project'){const {loadProject}=await import('./collab');const p=await loadProject(u,id);await batch([stmt('UPDATE business_requests SET project_id=?,version=version+1,updated_at=? WHERE id=? AND tenant_id=?',p.id,now(),r.id,u.tenantId),stmt('UPDATE projects SET request_id=? WHERE id=? AND tenant_id=?',r.id,p.id,u.tenantId),auditStatement(u,`Request ${r.number} linked to project`,r.id,r.department,null,{project:p.id})])}
 if(kind==='budget'){const b=await first<{id:string,department:string,created_by:string}>('SELECT id,department,created_by FROM budgets WHERE id=? AND tenant_id=?',id,u.tenantId);if(!b||!canActOn(u,'budgets','view',b.department,b.created_by))throw new HttpError(404,'Budget not found.');await batch([stmt('UPDATE business_requests SET budget_id=?,version=version+1,updated_at=? WHERE id=? AND tenant_id=?',b.id,now(),r.id,u.tenantId),stmt('UPDATE budgets SET request_id=?,project_id=coalesce(project_id,?) WHERE id=? AND tenant_id=?',r.id,r.project_id,b.id,u.tenantId),auditStatement(u,`Request ${r.number} linked to budget`,r.id,r.department,null,{budget:b.id})]);await (await import('./finance')).reconcileBudget(u.tenantId,b.id,u.id,'Budget linked to request')}
 if(kind==='goal'){const {loadWork}=await import('./work');const g=await loadWork(u,id);if(!['goal','objective','key_result','initiative','programme','strategy'].includes(g.kind))throw new HttpError(400,'Choose a goal, objective or initiative.');await batch([stmt('UPDATE business_requests SET goal_id=?,version=version+1,updated_at=? WHERE id=? AND tenant_id=?',g.id,now(),r.id,u.tenantId),auditStatement(u,`Request ${r.number} linked to ${g.kind}`,r.id,r.department,null,{goal:g.id})])}
 await evaluate(u.tenantId,r.id,u);
}

// ── Business case (calculations use entered and linked data only) ──
export function caseFigures(c:{costs_json:string,annual_benefit:number|null},horizonYears=3){
 const costs=parseJson<{label:string,amount:number,kind?:string,year?:number}[]>(c.costs_json,[]);const total=Math.round(costs.reduce((n,x)=>n+(Number(x.amount)||0),0)*100)/100;
 const capex=costs.filter(x=>x.kind==='capex').reduce((n,x)=>n+(Number(x.amount)||0),0),opex=costs.filter(x=>x.kind!=='capex').reduce((n,x)=>n+(Number(x.amount)||0),0);
 const benefit=c.annual_benefit;
 return {totalCost:total,capex,opex,annualBenefit:benefit,horizonYears,netBenefit:benefit!=null?Math.round((benefit*horizonYears-total)*100)/100:null,roiPct:benefit!=null&&total>0?Math.round((benefit*horizonYears-total)/total*1000)/10:null,paybackMonths:benefit&&benefit>0?Math.round(total/(benefit/12)*10)/10:null,
  formulas:{totalCost:'sum of entered cost lines',netBenefit:`annual benefit × ${horizonYears} years − total cost`,roiPct:'net benefit ÷ total cost',paybackMonths:'total cost ÷ (annual benefit ÷ 12)'},missing:[...(costs.length?[]:['cost lines']),...(benefit==null?['annual benefit']:[])]};
}
export async function saveCase(u:Member,r:RequestRow,b:Record<string,unknown>){
 if(!canManage(u,r))throw new HttpError(403,'You cannot edit this business case.');
 const cur=await first<{id:string,version:number,status:string}>('SELECT id,version,status FROM business_cases WHERE tenant_id=? AND request_id=?',u.tenantId,r.id);
 if(cur&&b.version!==undefined&&Number(b.version)!==cur.version)throw new HttpError(409,'The business case changed. Refresh first.');
 const costs=(Array.isArray(b.costs)?b.costs:[]).slice(0,50).map((x:unknown,i:number)=>{const c=(x||{}) as Record<string,unknown>;return {label:str(c.label,`Cost ${i+1} label`,120),amount:num(c.amount,`Cost ${i+1} amount`,0,1e13),kind:c.kind==='capex'?'capex':'opex',year:c.year?Math.round(num(c.year,'Year',2000,2100)):null}});
 const alts=(Array.isArray(b.alternatives)?b.alternatives:[]).slice(0,10).map((x:unknown)=>{const a=(x||{}) as Record<string,unknown>;return {option:str(a.option,'Alternative',200),reason:str(a.reason,'Why not chosen',1000,false),cost:a.cost===undefined||a.cost===''?null:num(a.cost,'Alternative cost',0,1e13)}});
 const evidence=(Array.isArray(b.evidence)?b.evidence:[]).map(x=>idOf(x,'File')).slice(0,20);
 const v=[str(b.problem,'Problem statement',8000,false),str(b.solution,'Proposed solution',8000,false),JSON.stringify(alts),str(b.benefits,'Benefits',8000,false),JSON.stringify(costs),str(b.assumptions,'Financial assumptions',4000,false),str(b.risks,'Risks',4000,false),str(b.dependencies,'Dependencies',4000,false),JSON.stringify((Array.isArray(b.impactedDepartments)?b.impactedDepartments:[]).map(String).slice(0,20)),str(b.approach,'Implementation approach',4000,false),b.annualBenefit===undefined||b.annualBenefit===''||b.annualBenefit===null?null:num(b.annualBenefit,'Annual benefit',0,1e13),JSON.stringify(evidence)];
 if(cur)await batch([stmt('UPDATE business_cases SET problem=?,solution=?,alternatives_json=?,benefits=?,costs_json=?,assumptions=?,risks=?,dependencies=?,impacted_departments_json=?,approach=?,annual_benefit=?,evidence_json=?,version=version+1,updated_by=?,updated_at=? WHERE id=?',...v,u.id,now(),cur.id),auditStatement(u,`Business case updated (${r.number})`,r.id,r.department,{version:cur.version},{version:cur.version+1})]);
 else await batch([stmt('INSERT INTO business_cases(id,tenant_id,request_id,problem,solution,alternatives_json,benefits,costs_json,assumptions,risks,dependencies,impacted_departments_json,approach,annual_benefit,evidence_json,status,version,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)',uid(),u.tenantId,r.id,...v,'Draft',u.id,now()),auditStatement(u,`Business case started (${r.number})`,r.id,r.department,null,null)]);
 // The estimated cost follows the business case when the requester has not set it.
 const tot=costs.reduce((n,c)=>n+c.amount,0);if(tot>0&&!r.estimated_cost)await run('UPDATE business_requests SET estimated_cost=?,updated_at=? WHERE id=? AND tenant_id=?',Math.round(tot*100)/100,now(),r.id,u.tenantId);
 return {ok:true};
}

// ── Benefits and outcome reviews ──
export async function addBenefit(u:Member,r:RequestRow,b:Record<string,unknown>){
 if(!canManage(u,r))throw new HttpError(403,'You cannot change this request.');
 const krId=b.keyResultId?idOf(b.keyResultId,'Key result'):null;if(krId){const {loadWork}=await import('./work');const k=await loadWork(u,krId);if(k.kind!=='key_result')throw new HttpError(400,'Choose a key result.')}
 const id=uid();await batch([stmt('INSERT INTO benefits(id,tenant_id,request_id,project_id,key_result_id,name,kind,measure,unit,baseline,expected,owner_id,review_date,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,r.id,r.project_id,krId,str(b.name,'Benefit',200),oneOf(b.kind||'operational',['financial','operational','customer','compliance'] as const,'benefit type'),str(b.measure,'Success measure',300,false),str(b.unit,'Unit',30,false),b.baseline===undefined||b.baseline===''?0:num(b.baseline,'Baseline',-1e13,1e13),num(b.expected,'Expected value',-1e13,1e13),b.ownerId?idOf(b.ownerId,'Owner'):r.requester_id,date(b.reviewDate,'Review date'),u.id,now()),auditStatement(u,`Benefit defined (${r.number})`,r.id,r.department,null,{name:b.name,expected:b.expected})]);
 return {id};
}
export async function measureBenefit(u:Member,r:RequestRow,benefitId:string,value:number,note:string,source?:{type:string,ref:string}){
 const b=await first<{id:string,owner_id:string|null,key_result_id:string|null,name:string,expected:number,baseline:number}>('SELECT * FROM benefits WHERE id=? AND tenant_id=? AND request_id=?',benefitId,u.tenantId,r.id);if(!b)throw new HttpError(404,'Benefit not found.');
 if(b.owner_id!==u.id&&!canManage(u,r))throw new HttpError(403,'Only the benefit owner records measurements.');
 await batch([stmt('INSERT INTO benefit_measurements(id,tenant_id,benefit_id,value,measured_at,source_type,source_ref,note,actor) VALUES(?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,b.id,value,now(),source?.type||'manual',source?.ref||'',note.slice(0,1000),u.id),auditStatement(u,`Benefit measured: ${b.name}`,r.id,r.department,null,{value,note})]);
 await evaluate(u.tenantId,r.id,u);return {ok:true};
}
export async function benefitsOf(tenantId:string,requestId:string){
 const rows=await all<{id:string,name:string,kind:string,measure:string,unit:string,baseline:number,expected:number,owner_id:string|null,review_date:string|null,key_result_id:string|null}>('SELECT * FROM benefits WHERE tenant_id=? AND request_id=? ORDER BY created_at',tenantId,requestId);
 const out=[];for(const b of rows){const m=await all<{value:number,measured_at:string,source_type:string,note:string,actor:string}>('SELECT value,measured_at,source_type,note,actor FROM benefit_measurements WHERE tenant_id=? AND benefit_id=? ORDER BY measured_at DESC LIMIT 20',tenantId,b.id);const actual=m[0]?.value??null;
  out.push({id:b.id,name:b.name,kind:b.kind,measure:b.measure,unit:b.unit,baseline:b.baseline,expected:b.expected,actual,variance:actual==null?null:Math.round((actual-b.expected)*100)/100,realisedPct:actual==null||b.expected===b.baseline?null:Math.round((actual-b.baseline)/(b.expected-b.baseline)*1000)/10,ownerId:b.owner_id,reviewDate:b.review_date,keyResultId:b.key_result_id,measurements:m})}
 return out;
}
export async function scheduleReview(u:Member,r:RequestRow,b:Record<string,unknown>){
 if(!canManage(u,r))throw new HttpError(403,'You cannot change this request.');
 const id=uid();await batch([stmt("INSERT INTO outcome_reviews(id,tenant_id,request_id,project_id,title,status,review_date,owner_id,created_by,created_at) VALUES(?,?,?,?,?,'Scheduled',?,?,?,?)",id,u.tenantId,r.id,r.project_id,str(b.title||`Outcome review: ${r.title}`,'Title',200),date(b.reviewDate,'Review date',true),b.ownerId?idOf(b.ownerId,'Owner'):r.requester_id,u.id,now()),auditStatement(u,`Outcome review scheduled (${r.number})`,r.id,r.department,null,{reviewDate:b.reviewDate})]);
 await stmt("INSERT INTO domain_events(id,tenant_id,type,entity_id,action,actor,payload_json,status,attempts,error,created_at) VALUES(?,?,'inbox',?,'inbox sync','system',?,'pending',0,'',?)",uid(),u.tenantId,id,JSON.stringify({type:'outcome_review'}),now()).run();
 return {id};
}
// Completing a review compares expected and actual benefits and the financial result from the ledger; linked
// key results receive a progress update carrying the review as its lineage.
export async function completeReview(u:Member,r:RequestRow,reviewId:string,b:Record<string,unknown>){
 const o=await first<{id:string,owner_id:string|null,status:string,title:string}>('SELECT id,owner_id,status,title FROM outcome_reviews WHERE id=? AND tenant_id=? AND request_id=?',reviewId,u.tenantId,r.id);if(!o)throw new HttpError(404,'Review not found.');
 if(o.status==='Completed')throw new HttpError(409,'This review is already completed.');if(o.owner_id!==u.id&&!canManage(u,r))throw new HttpError(403,'Only the review owner completes it.');
 const benefits=await benefitsOf(u.tenantId,r.id);const fin=await (await import('./finance')).financeSummary(u.tenantId,{requestId:r.id,projectId:r.project_id});
 const c=await first<{costs_json:string,annual_benefit:number|null}>('SELECT costs_json,annual_benefit FROM business_cases WHERE tenant_id=? AND request_id=?',u.tenantId,r.id);const fig=c?caseFigures(c):null;
 const results={benefits:benefits.map(x=>({name:x.name,unit:x.unit,expected:x.expected,actual:x.actual,variance:x.variance,realisedPct:x.realisedPct})),finance:fin?{expectedCost:fig?.totalCost??r.estimated_cost,actualCost:fin.actual,committed:fin.committed,costVariance:Math.round(((fig?.totalCost??r.estimated_cost)-fin.actual-fin.committed)*100)/100}:null,unmeasured:benefits.filter(x=>x.actual==null).map(x=>x.name)};
 const outcome=oneOf(b.outcomeStatus||'Achieved',['Achieved','Partially achieved','Not achieved','Too early to tell'] as const,'outcome');
 const follow=(Array.isArray(b.followUps)?b.followUps:[]).slice(0,10).map(x=>str(x,'Follow-up action',300));const taskIds:string[]=[];
 const s:D1PreparedStatement[]=[stmt("UPDATE outcome_reviews SET status='Completed',outcome_status=?,lessons_learned=?,feedback=?,financial_result=?,operational_result=?,results_json=?,follow_up_json=?,reviewed_by=?,reviewed_at=? WHERE id=?",outcome,str(b.lessonsLearned,'Lessons learned',8000,false),str(b.feedback,'User feedback',4000,false),str(b.financialResult,'Financial result',2000,false),str(b.operationalResult,'Operational result',2000,false),JSON.stringify(results),JSON.stringify(follow),u.id,now(),o.id),auditStatement(u,`Outcome review completed (${r.number})`,r.id,r.department,null,{outcome,benefits:results.benefits.length})];
 for(const f of follow){const id=uid();taskIds.push(id);s.push(stmt("INSERT INTO tasks(id,tenant_id,title,description,status,priority,owner_id,department,project_id,source_type,source_id,created_by,created_at,updated_at,updated_by) VALUES(?,?,?,?,'To do','Medium',?,?,?,'request',?,?,?,?,?)",id,u.tenantId,f,`Follow-up from ${o.title}`,u.id,r.department,r.project_id,r.id,u.id,now(),now(),u.id))}
 await batch(s);
 for(const x of benefits.filter(x=>x.keyResultId&&x.actual!=null)){const {applyKrValue}=await import('./strategy');await applyKrValue(u.tenantId,x.keyResultId!,x.actual!,u.id,{kind:'outcome_review',ref:o.id,lineage:{request:r.id,review:o.id,benefit:x.id}},`Outcome review: ${x.name}`).catch(()=>{})}
 await evaluate(u.tenantId,r.id,u);return {ok:true,results,tasks:taskIds};
}

// ── Service delivery ──
export async function saveService(u:Member,b:Record<string,unknown>){
 if(!hasAction(u,'lifecycle','create'))throw new HttpError(403,'Managing services is not available to you.');
 const requestId=b.requestId?idOf(b.requestId,'Request'):null;const r=requestId?await loadRequest(u,requestId):null;
 const vendorId=b.vendorId?idOf(b.vendorId,'Vendor'):null;if(vendorId&&!await first('SELECT id FROM vendors WHERE id=? AND tenant_id=?',vendorId,u.tenantId))throw new HttpError(400,'Vendor not found.');
 const poId=b.poId?idOf(b.poId,'Purchase order'):null;if(poId&&!await first("SELECT id FROM purchase_docs WHERE id=? AND tenant_id=? AND kind='PO'",poId,u.tenantId))throw new HttpError(400,'Purchase order not found.');
 const contractId=b.contractId?idOf(b.contractId,'Contract'):null;
 const list=(v:unknown,label:string)=>(Array.isArray(v)?v:[]).slice(0,30).map((x:unknown)=>{const o=(x||{}) as Record<string,unknown>;return {title:str(o.title,label,200),due:date(o.due,`${label} due`),done:o.done===true}});
 const vals=[str(b.title,'Service',200),str(b.scope,'Scope',8000,false),b.providerKind==='internal'?'internal':'vendor',vendorId,str(b.providerDepartment,'Providing department',160,false),contractId,poId,requestId,r?.project_id||(b.projectId?idOf(b.projectId,'Project'):null),b.ownerId?idOf(b.ownerId,'Owner'):u.id,JSON.stringify(list(b.deliverables,'Deliverable')),JSON.stringify(list(b.milestones,'Milestone')),str(b.acceptanceCriteria,'Acceptance criteria',4000,false),b.slaTargetHours?num(b.slaTargetHours,'SLA target (hours)',0.1,100000):null,date(b.dueAt,'Due date'),str(b.department||r?.department||u.department,'Department',160)];
 if(b.id){const id=idOf(b.id,'Service');const cur=await first<{id:string,owner_id:string,created_by:string,status:string}>('SELECT id,owner_id,created_by,status FROM service_deliveries WHERE id=? AND tenant_id=?',id,u.tenantId);if(!cur)throw new HttpError(404,'Service not found.');if(cur.owner_id!==u.id&&cur.created_by!==u.id&&u.role!=='admin')throw new HttpError(403,'You cannot edit this service.');if(['Accepted','Closed'].includes(cur.status))throw new HttpError(409,'Accepted or closed services cannot be edited.');
  await batch([stmt('UPDATE service_deliveries SET title=?,scope=?,provider_kind=?,vendor_id=?,provider_department=?,contract_id=?,po_id=?,request_id=?,project_id=?,owner_id=?,deliverables_json=?,milestones_json=?,acceptance_criteria=?,sla_target_hours=?,due_at=?,department=?,updated_at=? WHERE id=? AND tenant_id=?',...vals,now(),id,u.tenantId),auditStatement(u,'Service updated',id,String(vals[15]),null,{title:vals[0]})]);return {id}}
 const id=uid();const number=await nextNumber(u.tenantId,'SRV',true,['service_deliveries','number']);
 await batch([stmt("INSERT INTO service_deliveries(id,tenant_id,number,title,scope,provider_kind,vendor_id,provider_department,contract_id,po_id,request_id,project_id,owner_id,deliverables_json,milestones_json,acceptance_criteria,sla_target_hours,due_at,department,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'Planned',?,?,?)",id,u.tenantId,number,...vals,u.id,now(),now()),auditStatement(u,`Service ${number} created`,id,String(vals[15]),null,{title:vals[0],request:requestId})]);
 return {id,number};
}
export async function serviceAction(u:Member,id:string,action:string,b:Record<string,unknown>){
 const s=await first<{id:string,number:string,status:string,owner_id:string,created_by:string,department:string,due_at:string|null,sla_target_hours:number|null,created_at:string,delivered_at:string|null,request_id:string|null,title:string,po_id:string|null}>('SELECT * FROM service_deliveries WHERE id=? AND tenant_id=?',id,u.tenantId);if(!s)throw new HttpError(404,'Service not found.');
 const owner=s.owner_id===u.id||u.role==='admin';const ts=now();
 const move=async(to:string,sets:string,args:unknown[],label:string,after:Record<string,unknown>={})=>{await batch([stmt(`UPDATE service_deliveries SET status=?,${sets}updated_at=? WHERE id=? AND tenant_id=?`,to,...args,ts,s.id,u.tenantId),auditStatement(u,`Service ${s.number}: ${label}`,s.id,s.department,{status:s.status},{status:to,...after}),stmt("INSERT INTO domain_events(id,tenant_id,type,entity_id,action,actor,payload_json,status,attempts,error,created_at) VALUES(?,?,'inbox',?,'inbox sync','system',?,'pending',0,'',?)",uid(),u.tenantId,s.id,JSON.stringify({type:'service_delivery'}),ts)]);if(s.request_id)await evaluate(u.tenantId,s.request_id,u);return {ok:true,status:to}};
 switch(action){
  case 'start':if(s.status!=='Planned')throw new HttpError(409,'Only planned services can start.');if(!owner&&s.created_by!==u.id)throw new HttpError(403,'Only the owner starts the service.');return move('In delivery','',[],'delivery started');
  case 'deliver':{if(!['Planned','In delivery'].includes(s.status))throw new HttpError(409,'This service is not in delivery.');const evidence=(Array.isArray(b.evidence)?b.evidence:[]).map(x=>idOf(x,'File')).slice(0,20);
   // SLA: measured from creation to delivery against the target, when a target is set.
   const hours=(Date.now()-Date.parse(s.created_at))/3600000;const met=s.sla_target_hours?hours<=s.sla_target_hours?1:0:null;
   return move('Delivered','delivered_at=?,sla_met=?,evidence_json=?,',[ts,met,JSON.stringify(evidence)],'delivered',{slaMet:met,hours:Math.round(hours*10)/10})}
  case 'accept':case 'reject':{if(s.status!=='Delivered')throw new HttpError(409,'Only delivered services can be accepted or rejected.');if(!owner)throw new HttpError(403,'Only the service owner accepts delivery.');
   if(action==='reject')return move('In delivery','review_notes=?,',[str(b.notes,'Reason',2000)],'delivery rejected');
   const rating=Math.round(num(b.rating,'Rating',1,5));const quality=b.qualityScore!==undefined?Math.round(num(b.qualityScore,'Quality score',0,100)):null;
   return move('Accepted','accepted_by=?,accepted_at=?,rating=?,quality_score=?,review_notes=?,payment_eligible=1,',[u.id,ts,rating,quality,str(b.notes,'Notes',2000,false)],'accepted',{rating,quality})}
  case 'close':case 'renew':case 'terminate':{if(!['Accepted','Delivered','In delivery'].includes(s.status))throw new HttpError(409,'Close or renew accepted services.');if(!owner)throw new HttpError(403,'Only the service owner can do this.');
   return move('Closed','renewal_decision=?,',[action==='renew'?'renew':action==='terminate'?'terminate':'close'],action==='renew'?'renewed':action==='terminate'?'terminated':'closed')}
  case 'milestone':{if(!owner&&s.created_by!==u.id)throw new HttpError(403,'Only the owner updates milestones.');const cur=parseJson<{title:string,due:string|null,done:boolean}[]>((await first<{milestones_json:string}>('SELECT milestones_json FROM service_deliveries WHERE id=?',s.id))?.milestones_json,[]);const i=Math.round(num(b.index,'Milestone',0,29));if(!cur[i])throw new HttpError(404,'Milestone not found.');cur[i].done=b.done!==false;await batch([stmt('UPDATE service_deliveries SET milestones_json=?,updated_at=? WHERE id=?',JSON.stringify(cur),ts,s.id),auditStatement(u,`Service ${s.number}: milestone ${cur[i].done?'done':'reopened'}`,s.id,s.department,null,{milestone:cur[i].title})]);return {ok:true}}
 }
 throw new HttpError(400,'Unknown service action.');
}

// ── Traceability: start from any record and walk backward and forward along the lifecycle ──
export async function rootOf(u:Member,type:string,id:string):Promise<string|null>{
 const t=u.tenantId;
 if(type==='request')return id;
 if(type==='asset'){const a=await first<{purchase_doc_id:string|null,project_id:string|null}>('SELECT purchase_doc_id,project_id FROM assets WHERE id=? AND tenant_id=?',id,t);if(a?.purchase_doc_id)return rootOf(u,'PO',a.purchase_doc_id);if(a?.project_id)return rootOf(u,'project',a.project_id);return null}
 if(type==='PO'||type==='PR'){const d=await first<{request_id:string|null,pr_id:string|null,project_id:string|null}>('SELECT request_id,pr_id,project_id FROM purchase_docs WHERE id=? AND tenant_id=?',id,t);if(d?.request_id)return d.request_id;if(d?.pr_id)return rootOf(u,'PR',d.pr_id);if(d?.project_id)return rootOf(u,'project',d.project_id);return null}
 if(type==='project'){const p=await first<{request_id:string|null}>('SELECT request_id FROM projects WHERE id=? AND tenant_id=?',id,t);return p?.request_id||(await first<{id:string}>('SELECT id FROM business_requests WHERE tenant_id=? AND project_id=? LIMIT 1',t,id))?.id||null}
 if(type==='budget'){const b=await first<{request_id:string|null}>('SELECT request_id FROM budgets WHERE id=? AND tenant_id=?',id,t);return b?.request_id||null}
 if(type==='service_delivery'){const s=await first<{request_id:string|null}>('SELECT request_id FROM service_deliveries WHERE id=? AND tenant_id=?',id,t);return s?.request_id||null}
 return null;
}
// Everything connected to a request, each item permission-checked through its Work Graph node.
export async function trace(u:Member,requestId:string){
 const r=await loadRequest(u,requestId);const t=u.tenantId;
 const [st,appr,bc,benefits,reviews,services]=await Promise.all([stages(t,r.id),all('SELECT id,stage_key AS stageKey,stage,name,mode,quorum,approver_ids_json AS approverIds,decisions_json AS decisions,status,created_at AS createdAt,decided_at AS decidedAt FROM lifecycle_approvals WHERE tenant_id=? AND request_id=? ORDER BY created_at,stage',t,r.id),first<Record<string,unknown>&{costs_json:string,annual_benefit:number|null}>('SELECT * FROM business_cases WHERE tenant_id=? AND request_id=?',t,r.id),benefitsOf(t,r.id),all('SELECT * FROM outcome_reviews WHERE tenant_id=? AND request_id=? ORDER BY created_at',t,r.id),all('SELECT * FROM service_deliveries WHERE tenant_id=? AND request_id=? ORDER BY created_at',t,r.id)]);
 const docs=await all<{id:string,kind:string,number:string,title:string,status:string,total:number,currency:string,vendor_id:string|null,pr_id:string|null,requester_id:string,department:string,created_at:string}>('SELECT id,kind,number,title,status,total,currency,vendor_id,pr_id,requester_id,department,created_at FROM purchase_docs WHERE tenant_id=? AND (request_id=? OR (project_id IS NOT NULL AND project_id=?) OR pr_id IN (SELECT id FROM purchase_docs WHERE tenant_id=? AND (request_id=? OR (project_id IS NOT NULL AND project_id=?)))) ORDER BY created_at',t,r.id,r.project_id||'-',t,r.id,r.project_id||'-');
 const poIds=docs.filter(d=>d.kind==='PO').map(d=>d.id);const docIds=docs.map(d=>d.id);const q=(l:string[])=>l.map(()=>'?').join(',')||"''";
 const [receipts,invoices,quotes,assets,docApprovals]=await Promise.all([poIds.length?all(`SELECT g.id,g.po_id AS poId,g.number,g.kind,g.lines_json AS linesJson,g.acceptance_json AS acceptance,g.received_by AS receivedBy,g.created_at AS createdAt FROM goods_receipts g WHERE g.tenant_id=? AND g.po_id IN (${q(poIds)})`,t,...poIds):[],poIds.length?all(`SELECT id,po_id AS poId,number,vendor_invoice_no AS vendorInvoiceNo,amount,tax,currency,status,match_json AS matchJson,paid_amount AS paid FROM purchase_invoices WHERE tenant_id=? AND po_id IN (${q(poIds)})`,t,...poIds):[],docIds.length?all(`SELECT q.id,q.doc_id AS docId,q.amount,q.currency,q.selected,v.name AS vendor FROM quotations q JOIN vendors v ON v.id=q.vendor_id AND v.tenant_id=q.tenant_id WHERE q.tenant_id=? AND q.doc_id IN (${q(docIds)})`,t,...docIds):[],poIds.length?all<{id:string,code:string,name:string,status:string,location:string,assigned_to:string|null,warranty_until:string|null,purchase_cost:number,purchase_doc_id:string}>(`SELECT id,code,name,status,location,assigned_to,warranty_until,purchase_cost,purchase_doc_id FROM assets WHERE tenant_id=? AND purchase_doc_id IN (${q(poIds)})`,t,...poIds):[],docIds.length?all(`SELECT doc_id AS docId,step_name AS step,status,decided_by AS decidedBy,decided_at AS decidedAt,comment FROM approvals WHERE tenant_id=? AND doc_id IN (${q(docIds)}) ORDER BY step_no`,t,...docIds):[]]);
 // Permission filter: records the viewer cannot open are removed and only counted.
 const refs:[string,string][]=[...docs.map(d=>[d.kind,d.id] as [string,string]),...assets.map(a=>['asset',a.id] as [string,string]),...(r.project_id?[['project',r.project_id] as [string,string]]:[]),...(r.budget_id?[['budget',r.budget_id] as [string,string]]:[]),...(r.goal_id?[['work_record',r.goal_id] as [string,string]]:[])];
 const nodes=refs.length?await all<import('./graph').GraphNode>(`SELECT * FROM graph_nodes WHERE tenant_id=? AND deleted_at IS NULL AND source_id IN (${q(refs.map(x=>x[1]))})`,t,...refs.map(x=>x[1])):[];
 const {visibleNodes}=await import('./graph');const vis=await visibleNodes(u,nodes);const ok=new Set(nodes.filter(n=>vis.has(n.id)).map(n=>n.source_id));
 // Records without a graph node yet fall back to the module check through the graph projection on read.
 const seen=(id:string)=>ok.has(id)||!nodes.some(n=>n.source_id===id)&&u.role==='admin';
 const vDocs=docs.filter(d=>seen(d.id));const vPo=new Set(vDocs.map(d=>d.id));
 const restricted=docs.length-vDocs.length+assets.filter(a=>!seen(a.id)).length;
 const project=r.project_id&&seen(r.project_id)?await first('SELECT id,code,name,stage,health,progress,target_date AS targetDate FROM projects WHERE id=? AND tenant_id=?',r.project_id,t):null;
 const budget=r.budget_id&&seen(r.budget_id)?await first('SELECT id,name,amount,currency,status,contingency,funding_source AS fundingSource FROM budgets WHERE id=? AND tenant_id=?',r.budget_id,t):null;
 const goal=r.goal_id&&seen(r.goal_id)?await first('SELECT id,kind,number,title,status,progress FROM work_records WHERE id=? AND tenant_id=?',r.goal_id,t):null;
 const fin=await (await import('./finance')).financeSummary(t,{requestId:r.id,projectId:r.project_id},{events:true});
 const allIds=[r.id,...vDocs.map(d=>d.id),...(project?[r.project_id!]:[]),...assets.filter(a=>seen(a.id)).map(a=>a.id)];
 const timeline=await all<{action:string,created_at:string,actor:string,record_id:string,who:string|null}>(`SELECT a.action,a.created_at,a.actor,a.record_id,m.name AS who FROM audit a LEFT JOIN members m ON m.id=a.actor AND m.tenant_id=a.tenant_id WHERE a.tenant_id=? AND a.record_id IN (${q(allIds)}) ORDER BY a.created_at DESC LIMIT 300`,t,...allIds);
 const files=await all<{id:string,name:string,entity_type:string}>(`SELECT f.id,f.name,l.entity_type FROM file_links l JOIN files f ON f.id=l.file_id AND f.tenant_id=l.tenant_id WHERE l.tenant_id=? AND f.deleted_at IS NULL AND l.entity_id IN (${q(allIds)})`,t,...allIds);
 const {canSeeFile}=await import('./entities');const fileRows=files.length?await all<Parameters<typeof canSeeFile>[1]&{id:string}>(`SELECT * FROM files WHERE tenant_id=? AND id IN (${q(files.map(f=>f.id))})`,t,...files.map(f=>f.id)):[];const fileOk=new Set(fileRows.filter(f=>canSeeFile(u,f)).map(f=>f.id));
 const today=new Date().toISOString();
 const exceptions=[...(invoices as {status:string,number:string,matchJson:string}[]).filter(i=>i.status==='Exception').map(i=>`Invoice ${i.number}: ${parseJson<{reasons?:string[]}>(i.matchJson,{}).reasons?.join('; ')||'does not match'}`),...st.filter(s=>s.status==='active'&&s.due_at&&s.due_at<today).map(s=>`Stage “${s.name}” is overdue (due ${s.due_at!.slice(0,10)})`),...st.filter(s=>s.status==='rejected').map(s=>`Stage “${s.name}” was rejected`),...(fin&&fin.budget>0&&fin.forecast>fin.budget?[`Forecast ${fin.forecast.toLocaleString()} exceeds the budget ${fin.budget.toLocaleString()}`]:[])];
 return {request:r,stages:st,approvals:appr,businessCase:bc?{...bc,figures:caseFigures(bc)}:null,goal,project,budget,documents:vDocs.map(d=>({...d,approvals:(docApprovals as {docId:string}[]).filter(a=>a.docId===d.id)})),quotations:(quotes as {docId:string}[]).filter(x=>vPo.has(x.docId)),receipts:(receipts as {poId:string}[]).filter(x=>vPo.has(x.poId)),invoices:(invoices as {poId:string}[]).filter(x=>vPo.has(x.poId)),assets:assets.filter(a=>seen(a.id)),services,benefits,reviews,finance:fin,files:files.filter(f=>fileOk.has(f.id)),timeline,exceptions,restricted};
}
// Asset lineage: why it was bought, who paid, who approved, vendor, receipt, custody, history, lifetime cost.
export async function assetLineage(u:Member,assetId:string){
 const {canSeeAsset}=await import('./entities');const a=await first<Parameters<typeof canSeeAsset>[1]&{id:string,code:string,name:string,purchase_doc_id:string|null,purchase_cost:number,purchase_date:string|null,warranty_until:string|null,assigned_to:string|null,location:string,useful_life_months:number|null,vendor:string,status:string,department:string}>('SELECT * FROM assets WHERE id=? AND tenant_id=?',assetId,u.tenantId);
 if(!a||!canSeeAsset(u,a))throw new HttpError(404,'Asset not found.');const t=u.tenantId;
 const po=a.purchase_doc_id?await first<{id:string,number:string,pr_id:string|null,vendor_id:string|null,budget_id:string|null,requester_id:string,total:number,currency:string,justification:string,title:string}>('SELECT * FROM purchase_docs WHERE id=? AND tenant_id=?',a.purchase_doc_id,t):null;
 const pr=po?.pr_id?await first<{id:string,number:string,justification:string,title:string,budget_id:string|null,request_id:string|null,requester_id:string}>('SELECT * FROM purchase_docs WHERE id=? AND tenant_id=?',po.pr_id,t):null;
 const reqId=await rootOf(u,'asset',a.id);const req=reqId?await first<RequestRow>('SELECT * FROM business_requests WHERE id=? AND tenant_id=?',reqId,t):null;const reqVisible=req?await canSeeRequest(u,req):false;
 const budgetId=po?.budget_id||pr?.budget_id||req?.budget_id||null;const budget=budgetId?await first<{id:string,name:string,department:string,created_by:string}>('SELECT id,name,department,created_by FROM budgets WHERE id=? AND tenant_id=?',budgetId,t):null;
 const names=async(ids:string[])=>ids.length?new Map((await all<{id:string,name:string}>(`SELECT id,name FROM members WHERE tenant_id=? AND id IN (${ids.map(()=>'?').join(',')})`,t,...ids)).map(m=>[m.id,m.name])):new Map<string,string>();
 const docApprovals=await all<{doc_id:string,step_name:string,decided_by:string|null,decided_at:string|null,status:string}>(`SELECT doc_id,step_name,decided_by,decided_at,status FROM approvals WHERE tenant_id=? AND status='Approved' AND doc_id IN (?,?)`,t,po?.id||'-',pr?.id||'-');
 const lifeApprovals=req?await all<{name:string,decisions_json:string}>("SELECT name,decisions_json FROM lifecycle_approvals WHERE tenant_id=? AND request_id=? AND status='approved'",t,req.id):[];
 const receipt=po?await first<{number:string,received_by:string,created_at:string,lines_json:string}>('SELECT number,received_by,created_at,lines_json FROM goods_receipts WHERE tenant_id=? AND po_id=? ORDER BY created_at LIMIT 1',t,po.id):null;
 const vendor=po?.vendor_id?await first<{id:string,name:string}>('SELECT id,name FROM vendors WHERE id=? AND tenant_id=?',po.vendor_id,t):null;
 const tickets=await all<{id:string,number:string,title:string,status:string,created_at:string}>('SELECT id,number,title,status,created_at FROM tickets WHERE tenant_id=? AND asset_id=? ORDER BY created_at DESC LIMIT 50',t,a.id);
 const orders=await all<{id:string,number:string,title:string,status:string,parts_cost:number,labor_cost:number,completed_at:string|null}>('SELECT id,number,title,status,parts_cost,labor_cost,completed_at FROM work_orders WHERE tenant_id=? AND asset_id=? ORDER BY created_at DESC LIMIT 50',t,a.id);
 const who=await names([...new Set([...docApprovals.map(x=>x.decided_by),...lifeApprovals.flatMap(x=>parseJson<{by:string}[]>(x.decisions_json,[]).map(d=>d.by)),receipt?.received_by,a.assigned_to,req?.requester_id,pr?.requester_id].filter((x):x is string=>!!x))]);
 const maintenanceCost=orders.reduce((n,o)=>n+(o.parts_cost||0)+(o.labor_cost||0),0);const lifetime=Math.round(((a.purchase_cost||0)+maintenanceCost)*100)/100;
 const today=Date.now();const warrantyDays=a.warranty_until?Math.ceil((Date.parse(a.warranty_until)-today)/86400000):null;
 const ageMonths=a.purchase_date?Math.max(0,Math.floor((today-Date.parse(a.purchase_date))/(30.44*86400000))):null;
 const recentTickets=tickets.filter(x=>Date.parse(x.created_at)>today-365*86400000).length;
 const reasons:string[]=[];let recommendation='Keep in service';
 if(ageMonths!=null&&a.useful_life_months&&ageMonths>=a.useful_life_months*0.9){reasons.push(`Age ${ageMonths} months is ${Math.round(ageMonths/a.useful_life_months*100)}% of its ${a.useful_life_months}-month useful life.`);recommendation='Plan replacement'}
 if(a.purchase_cost>0&&maintenanceCost>=a.purchase_cost*0.5){reasons.push(`Maintenance cost ${maintenanceCost.toLocaleString()} is ${Math.round(maintenanceCost/a.purchase_cost*100)}% of the purchase cost.`);recommendation='Plan replacement'}
 if(recentTickets>=3&&(warrantyDays==null||warrantyDays<0)){reasons.push(`${recentTickets} tickets in the last 12 months and no warranty cover.`);if(recommendation==='Keep in service')recommendation='Review reliability'}
 if(!reasons.length)reasons.push(ageMonths==null?'No purchase date recorded; age-based advice is not possible.':'Within its useful life with maintenance costs below half of the purchase cost.');
 return {asset:{id:a.id,code:a.code,name:a.name,status:a.status,location:a.location,department:a.department,custodian:a.assigned_to?{id:a.assigned_to,name:who.get(a.assigned_to)||''}:null,purchaseCost:a.purchase_cost,purchaseDate:a.purchase_date,warrantyUntil:a.warranty_until,warrantyDaysLeft:warrantyDays},
  why:reqVisible&&req?{request:{id:req.id,number:req.number,title:req.title,businessNeed:req.business_need,expectedOutcome:req.expected_outcome}}:pr?{justification:pr.justification||po?.justification||'',requisition:{id:pr.id,number:pr.number,title:pr.title}}:po?{justification:po.justification||''}:null,
  budget:budget&&canActOn(u,'budgets','view',budget.department,budget.created_by)?{id:budget.id,name:budget.name}:budget?{restricted:true}:null,
  approvals:[...lifeApprovals.flatMap(x=>parseJson<{by:string,decision:string,at:string}[]>(x.decisions_json,[]).filter(d=>d.decision==='approve').map(d=>({step:x.name,by:who.get(d.by)||'',at:d.at,record:'request'}))),...docApprovals.map(x=>({step:x.step_name,by:who.get(x.decided_by||'')||'',at:x.decided_at,record:x.doc_id===po?.id?po?.number:pr?.number}))],
  vendor,order:po?{id:po.id,number:po.number,total:po.total,currency:po.currency}:null,receipt:receipt?{number:receipt.number,receivedBy:who.get(receipt.received_by)||'',at:receipt.created_at}:null,
  tickets,maintenance:orders,lifetimeCost:lifetime,maintenanceCost,ageMonths,recommendation,reasons,requestId:reqVisible?reqId:null};
}
export {departmentKey};
