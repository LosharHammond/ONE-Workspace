import {hasAction,canActOn} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,idOf,num,parseJson,auditStatement} from '../../server/core';
import * as lc from '../../server/lifecycle';
import {financeSummary,measureSources,type Measure} from '../../server/finance';
import {dispatch} from '../../server/dispatch';
import type {Member} from '../../server/policy';

// Request-to-outcome lifecycle API: requests, business cases, the stage engine, linked records (created through
// their own modules), services, benefits, outcome reviews, templates and traceability from any record.
export const GET=route(async(req,u)=>{
 const q=new URL(req.url).searchParams;const view=q.get('view')||'list';
 if(!hasAction(u,'lifecycle')&&!['trace','asset'].includes(view))throw new HttpError(403,'Business requests are not available to you.');
 await lc.ensureTemplates(u.tenantId,u.id);
 if(view==='templates')return {templates:(await all<lc.Template>("SELECT * FROM lifecycle_templates WHERE tenant_id=? AND status<>'deleted' ORDER BY name",u.tenantId)).map(t=>({id:t.id,name:t.name,kind:t.kind,description:t.description,requestTypes:parseJson(t.request_types_json,[]),stages:parseJson(t.stages_json,[]),status:t.status,version:t.version})),stageKinds:lc.STAGE_KINDS,requestTypes:lc.REQUEST_TYPES.map(k=>({id:k,label:lc.REQUEST_LABELS[k]})),canConfigure:u.role==='admin'||hasAction(u,'lifecycle','configure')};
 if(q.get('id')){const t=await lc.trace(u,idOf(q.get('id'),'Request'));const r=t.request;
  const approvals=(t.approvals as {approverIds:string,decisions:string,status:string}[]).map(a=>({...a,approverIds:parseJson<string[]>(a.approverIds,[]),decisions:parseJson(a.decisions,[])}));
  const mine=approvals.some(a=>a.status==='pending'&&(a.approverIds.includes(u.id)));
  return {...t,approvals,canEdit:(r.requester_id===u.id||u.role==='admin'||canActOn(u,'lifecycle','update',r.department,r.requester_id))&&['Draft','Changes requested'].includes(r.status),canSubmit:r.requester_id===u.id&&['Draft','Changes requested'].includes(r.status),canManage:r.requester_id===u.id||u.role==='admin'||canActOn(u,'lifecycle','update',r.department,r.requester_id),awaitingMe:mine,requestTypeLabel:lc.REQUEST_LABELS[r.request_type]||r.request_type}}
 if(view==='trace'){const type=str(q.get('type'),'Record type',40),id=idOf(q.get('recordId'),'Record');const root=await lc.rootOf(u,type,id);return {requestId:root,asset:type==='asset'?await lc.assetLineage(u,id):null}}
 if(view==='asset')return lc.assetLineage(u,idOf(q.get('recordId'),'Asset'));
 if(view==='finance'){const scope={projectId:q.get('project')||null,budgetId:q.get('budget')||null,requestId:q.get('request')||null};
  if(scope.projectId){const {loadProject}=await import('../../server/collab');await loadProject(u,scope.projectId)}if(scope.requestId)await lc.loadRequest(u,scope.requestId);
  if(scope.budgetId){const b=await first<{department:string,created_by:string}>('SELECT department,created_by FROM budgets WHERE id=? AND tenant_id=?',scope.budgetId,u.tenantId);if(!b||!canActOn(u,'budgets','view',b.department,b.created_by))throw new HttpError(404,'Budget not found.')}
  const measure=q.get('measure');if(measure)return {sources:await measureSources(u.tenantId,scope,measure as Measure)};
  return financeSummary(u.tenantId,scope,{events:true})}
 if(view==='services'){const rows=await all<{id:string,number:string,title:string,status:string,owner_id:string,created_by:string,department:string,vendor_id:string|null,due_at:string|null,rating:number|null,sla_met:number|null,request_id:string|null,updated_at:string}>('SELECT id,number,title,status,owner_id,created_by,department,vendor_id,due_at,rating,sla_met,request_id,updated_at FROM service_deliveries WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 500',u.tenantId);
  return {services:rows.filter(s=>u.role==='admin'||s.owner_id===u.id||s.created_by===u.id||canActOn(u,'lifecycle','view',s.department,s.created_by))}}
 if(view==='service'){const id=idOf(q.get('sid'),'Service');const s=await first<Record<string,unknown>&{owner_id:string,created_by:string,department:string,deliverables_json:string,milestones_json:string,evidence_json:string}>('SELECT * FROM service_deliveries WHERE id=? AND tenant_id=?',id,u.tenantId);if(!s||!(u.role==='admin'||s.owner_id===u.id||s.created_by===u.id||canActOn(u,'lifecycle','view',s.department,s.created_by)))throw new HttpError(404,'Service not found.');
  return {service:{...s,deliverables:parseJson(s.deliverables_json,[]),milestones:parseJson(s.milestones_json,[]),evidence:parseJson(s.evidence_json,[])},history:await all('SELECT a.action,a.created_at AS createdAt,m.name AS who FROM audit a LEFT JOIN members m ON m.id=a.actor AND m.tenant_id=a.tenant_id WHERE a.tenant_id=? AND a.record_id=? ORDER BY a.created_at DESC',u.tenantId,id),canAccept:s.owner_id===u.id||u.role==='admin'}}
 // Requests the viewer can see (own, department for heads, involved as approver or stage owner).
 const rows=await all<lc.RequestRow>('SELECT * FROM business_requests WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 1000',u.tenantId);const out=[];
 for(const r of rows)if(await lc.canSeeRequest(u,r))out.push(r);
 const f=q.get('filter')||'all';const text=(q.get('q')||'').toLowerCase();
 const filtered=out.filter(r=>(f==='mine'?r.requester_id===u.id:f==='open'?!['Closed','Completed','Rejected','Withdrawn','Renewed','Disposed'].includes(r.status):f==='closed'?['Closed','Completed','Rejected','Withdrawn','Renewed','Disposed'].includes(r.status):true)&&(!text||`${r.number} ${r.title} ${r.business_need}`.toLowerCase().includes(text))&&(!q.get('type')||r.request_type===q.get('type')));
 const stageNames=new Map((await all<{request_id:string,stage_key:string,name:string}>("SELECT request_id,stage_key,name FROM lifecycle_stages WHERE tenant_id=? AND status='active'",u.tenantId)).map(s=>[s.request_id,s.name]));
 return {requests:filtered.map(r=>({id:r.id,number:r.number,title:r.title,type:r.request_type,typeLabel:lc.REQUEST_LABELS[r.request_type]||r.request_type,status:r.status,stage:stageNames.get(r.id)||'',requesterId:r.requester_id,department:r.department,estimatedCost:r.estimated_cost,currency:r.currency,priority:r.priority,requiredDate:r.required_date,updatedAt:r.updated_at})),canCreate:hasAction(u,'lifecycle','create')};
},{module:'lifecycle'});

export const POST=route(async(req,u)=>{
 const b=await readBody(req,200000);const action=str(b.action,'Action',40);
 if(action==='create')return lc.createRequest(u,b);
 if(action==='template-save'||action==='template-archive'){
  if(u.role!=='admin'&&!hasAction(u,'lifecycle','configure'))throw new HttpError(403,'Only administrators manage lifecycle templates.');
  if(action==='template-archive'){const id=idOf(b.id,'Template');await batch([stmt("UPDATE lifecycle_templates SET status='archived',updated_at=? WHERE id=? AND tenant_id=?",now(),id,u.tenantId),auditStatement(u,'Lifecycle template archived',id,'Lifecycle',null,null)]);return {ok:true}}
  const stages=lc.validateStages(b.stages);const types=(Array.isArray(b.requestTypes)?b.requestTypes:[]).map(String).filter(t=>(lc.REQUEST_TYPES as readonly string[]).includes(t));
  if(b.id){const id=idOf(b.id,'Template');const r=await batch([stmt("UPDATE lifecycle_templates SET name=?,kind=?,description=?,request_types_json=?,stages_json=?,version=version+1,status='active',updated_at=? WHERE id=? AND tenant_id=?",str(b.name,'Name',120),str(b.kind||'custom','Kind',40),str(b.description,'Description',1000,false),JSON.stringify(types),JSON.stringify(stages),now(),id,u.tenantId),auditStatement(u,'Lifecycle template updated (requests in flight keep their version)',id,'Lifecycle',null,{stages:stages.length})]);if(!r[0].meta.changes)throw new HttpError(404,'Template not found.');return {id}}
  const id=uid();await batch([stmt("INSERT INTO lifecycle_templates(id,tenant_id,name,kind,description,request_types_json,stages_json,status,version,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'active',1,?,?,?)",id,u.tenantId,str(b.name,'Name',120),str(b.kind||'custom','Kind',40),str(b.description,'Description',1000,false),JSON.stringify(types),JSON.stringify(stages),u.id,now(),now()),auditStatement(u,'Lifecycle template created',id,'Lifecycle',null,{stages:stages.length})]);return {id};
 }
 if(action==='service-save')return lc.saveService(u,b);
 if(action==='service-action')return lc.serviceAction(u,idOf(b.id,'Service'),str(b.op,'Operation',20),b);
 const r=await lc.loadRequest(u,idOf(b.id,'Request'));
 switch(action){
  case 'update':return lc.updateRequest(u,r,b);
  case 'submit':return lc.submit(u,r);
  case 'withdraw':{if(r.requester_id!==u.id&&u.role!=='admin')throw new HttpError(403,'Only the requester can withdraw.');if(['Closed','Completed','Rejected','Withdrawn'].includes(r.status))throw new HttpError(409,'This request is already finished.');await batch([stmt("UPDATE business_requests SET status='Withdrawn',closed_at=?,version=version+1,updated_at=? WHERE id=? AND tenant_id=?",now(),now(),r.id,u.tenantId),stmt("UPDATE lifecycle_approvals SET status='cancelled' WHERE tenant_id=? AND request_id=? AND status IN ('pending','waiting')",u.tenantId,r.id),auditStatement(u,`Request ${r.number} withdrawn`,r.id,r.department,{status:r.status},{status:'Withdrawn'})]);await (await import('../../server/finance')).reconcileRequest(u.tenantId,r.id,u.id,'Request withdrawn');return {ok:true}}
  case 'decide':return lc.decide(u,r,idOf(b.approvalId,'Approval'),b.decision==='reject'?'reject':b.decision==='changes'?'changes':'approve',str(b.comment,'Comment',2000,false));
  case 'complete-stage':return lc.completeStage(u,r,str(b.stage,'Stage',40),str(b.outcome||'Completed','Outcome',500));
  case 'skip-stage':return lc.skipStage(u,r,str(b.stage,'Stage',40),str(b.reason,'Reason',300));
  case 'link':return lc.linkRecord(u,r,b.kind==='budget'?'budget':b.kind==='goal'?'goal':'project',idOf(b.recordId,'Record'));
  case 'case-save':return lc.saveCase(u,r,b);
  case 'benefit-add':return lc.addBenefit(u,r,b);
  case 'benefit-measure':return lc.measureBenefit(u,r,idOf(b.benefitId,'Benefit'),num(b.value,'Value',-1e13,1e13),str(b.note,'Note',1000,false));
  case 'review-schedule':return lc.scheduleReview(u,r,b);
  case 'review-complete':return lc.completeReview(u,r,idOf(b.reviewId,'Review'),b);
  // Linked records are created by their own modules (with the caller's permissions) and then linked.
  case 'create-project':{const p=await dispatch<{id:string}>(req,'projects',{action:'create',name:str(b.name||r.title,'Project name',200),type:str(b.type||(r.request_type==='it'?'it':r.request_type==='capex'?'capital':'internal'),'Type',30),department:r.department,description:`${r.business_need}\n\nExpected outcome: ${r.expected_outcome}`.slice(0,4000),businessCase:r.business_need.slice(0,4000),managerId:b.managerId||u.id,targetDate:r.required_date||undefined,approvedBudget:b.approvedBudget?Number(b.approvedBudget):undefined});await lc.linkRecord(u,await lc.loadRequest(u,r.id),'project',p.id);if(r.goal_id){const {loadWork}=await import('../../server/work');const g=await loadWork(u,r.goal_id).catch(()=>null);if(g&&['initiative','programme'].includes(g.kind)){const d=parseJson<Record<string,unknown>>(g.data_json,{});await dispatch(req,'business',{action:'save',id:g.id,data:{...d,projects:[...new Set([...(Array.isArray(d.projects)?d.projects as string[]:[]),p.id])]}}).catch(()=>{})}}return {projectId:p.id}}
  case 'create-budget':{const fresh=await lc.loadRequest(u,r.id);const bud=await dispatch<{id:string}>(req,'purchasing',{action:'budget',name:str(b.name||`${r.number} · ${r.title}`,'Budget name',120),department:r.department,costCentre:str(b.costCentre,'Cost centre',40,false),periodStart:str(b.periodStart||now().slice(0,10),'Start',10),periodEnd:str(b.periodEnd||`${new Date().getUTCFullYear()}-12-31`,'End',10),amount:num(b.amount??r.estimated_cost,'Amount',0,1e13),currency:r.currency});
   await batch([stmt('UPDATE budgets SET contingency=?,funding_source=?,project_id=coalesce(project_id,?) WHERE id=? AND tenant_id=?',b.contingency?num(b.contingency,'Contingency',0,1e13):0,str(b.fundingSource,'Funding source',120,false),fresh.project_id,bud.id,u.tenantId)]);await lc.linkRecord(u,fresh,'budget',bud.id);return {budgetId:bud.id}}
  case 'create-requisition':{const fresh=await lc.loadRequest(u,r.id);const c=await first<{costs_json:string}>('SELECT costs_json FROM business_cases WHERE tenant_id=? AND request_id=?',u.tenantId,r.id);
   const lines=Array.isArray(b.lines)&&b.lines.length?b.lines:parseJson<{label:string,amount:number}[]>(c?.costs_json,[]).filter(x=>x.amount>0).map(x=>({description:x.label,qty:1,unit:'ea',unitPrice:x.amount,taxRate:0}));
   if(!lines.length)lines.push({description:r.title,qty:1,unit:'ea',unitPrice:r.estimated_cost||0,taxRate:0});
   const pr=await dispatch<{id:string,number:string}>(req,'purchasing',{action:'save',kind:'PR',title:str(b.title||r.title,'Title',200),justification:`${r.number}: ${r.business_need}`.slice(0,4000),department:r.department,location:r.location,projectId:fresh.project_id||undefined,budgetId:fresh.budget_id||undefined,requestId:r.id,currency:r.currency,lines,submit:b.submit===true});return {prId:pr.id,number:pr.number}}
 }
 throw new HttpError(400,'Unknown action.');
},{module:'lifecycle'});
export type {Member};
