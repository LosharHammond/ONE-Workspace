import {hasAction,canActOn,departmentKey} from '../access-policy';
import {all,first,stmt,batch,run,uid,now,parseJson,HttpError,auditStatement} from './core';
import {registerJob,enqueueStatement,kick} from './jobs';
import type {Member} from './policy';

// Universal Work Inbox — a permission-aware PROJECTION of work waiting for people. Source records stay in their
// modules; each inbox item points at its source (type, id, url, version) and the actions the source module
// offers. Items are (re)computed per source record by adapters when a domain event arrives, so processing is
// idempotent (unique recipient+dedupe key), retryable (event outbox), observable (/api/inbox?view=health) and
// rebuildable (inbox.rebuild job). Items no longer produced by their source are closed, never deleted.
export type Desired={recipient:string,key:string,module:string,itemType:string,title:string,description?:string,priority?:'low'|'normal'|'high'|'critical',businessImpact?:string,amount?:number|null,currency?:string,dueAt?:string|null,slaAt?:string|null,assigner?:string|null,actions:string[],page:string,action?:string,department?:string,projectId?:string|null,location?:string,groupId?:string|null,url:string,version?:string};
type Adapter=(tenantId:string,id:string)=>Promise<Desired[]|null>;
export type ItemRow={id:string,tenant_id:string,recipient_id:string,dedupe_key:string,source_module:string,source_type:string,source_id:string,source_url:string,source_version:string,item_type:string,title:string,description:string,priority:string,impact_score:number,business_impact:string,financial_amount:number|null,currency:string,status:string,due_at:string|null,sla_at:string|null,assigner_id:string|null,actions_json:string,required_page:string,required_action:string,department:string,project_id:string|null,location:string,group_id:string|null,read_at:string|null,snoozed_until:string|null,delegated_from:string|null,escalated_from:string|null,escalation_level:number,completed_at:string|null,completed_by:string|null,completion_json:string,graph_node_id:string|null,created_at:string,updated_at:string};

const APPROVE=['approve','reject','request_changes','delegate','escalate','comment','open'];
const today=()=>new Date().toISOString().slice(0,10);
const IN=(l:unknown[])=>l.map(()=>'?').join(',');
async function admins(tenantId:string){return (await all<{id:string}>("SELECT id FROM members WHERE tenant_id=? AND active=1 AND role='admin'",tenantId)).map(r=>r.id)}
export async function deptHeads(tenantId:string,dept:string){const d=await first<{head_id:string|null}>('SELECT head_id FROM departments WHERE tenant_id=? AND lower(name)=lower(?)',tenantId,dept||'');if(d?.head_id)return [d.head_id];return (await all<{id:string,department:string}>("SELECT id,department FROM members WHERE tenant_id=? AND active=1 AND role='manager'",tenantId)).filter(m=>departmentKey(m.department)===departmentKey(dept)).map(m=>m.id)}
const prio=(p:string|null|undefined):Desired['priority']=>{const x=String(p||'').toLowerCase();return x==='critical'||x==='urgent'?'critical':x==='high'?'high':x==='low'?'low':'normal'};

// ── Source adapters (each returns what SHOULD be in inboxes for one source record) ──
const adapters:Record<string,Adapter>={
 async PR(t,id){return purchase(t,id)},async PO(t,id){return purchase(t,id)},
 async task(t,id){
  const k=await first<{id:string,title:string,status:string,priority:string,owner_id:string,department:string,project_id:string|null,due_date:string|null,deleted_at:string|null,approval_status:string,approver_id:string|null,updated_at:string,created_by:string,milestone:number}>('SELECT id,title,status,priority,owner_id,department,project_id,due_date,deleted_at,approval_status,approver_id,updated_at,created_by,milestone FROM tasks WHERE id=? AND tenant_id=?',id,t);
  if(!k)return null;if(k.deleted_at)return [];
  const out:Desired[]=[];const base={module:'tasks',department:k.department,projectId:k.project_id,url:`#/tasks/all/${k.id}`,version:k.updated_at,page:'tasks'};
  if(!['Done','Cancelled'].includes(k.status)){const who=(await all<{member_id:string}>("SELECT member_id FROM task_assignees WHERE tenant_id=? AND task_id=? AND kind='assignee'",t,k.id)).map(r=>r.member_id);for(const r of who.length?who:[k.owner_id])out.push({...base,recipient:r,key:`task:${k.id}`,itemType:k.milestone?'milestone':'task',title:k.title,description:`${k.status}${k.project_id?' · project task':''}`,priority:prio(k.priority),dueAt:k.due_date,assigner:k.created_by!==r?k.created_by:null,actions:['complete','comment','reassign','follow_up','snooze','delegate','open']})}
  if(k.approval_status==='pending'&&k.approver_id)out.push({...base,recipient:k.approver_id,key:`task-approval:${k.id}`,itemType:'approval',title:`Approve task: ${k.title}`,priority:'high',assigner:k.owner_id,actions:['approve','reject','comment','open']});
  return out;
 },
 async ticket(t,id){
  const k=await first<{id:string,number:string,title:string,status:string,priority:string,department:string,assignee_id:string|null,requester_id:string,due_at:string|null,approval_status:string,approver_id:string|null,version:number,location:string}>('SELECT id,number,title,status,priority,department,assignee_id,requester_id,due_at,approval_status,approver_id,version,location FROM tickets WHERE id=? AND tenant_id=?',id,t);
  if(!k)return null;const out:Desired[]=[];const base={module:'tickets',department:k.department,location:k.location,url:`#/tickets/${k.id}`,version:String(k.version),page:'maintenance'};
  if(k.assignee_id&&!['Resolved','Closed','Cancelled'].includes(k.status))out.push({...base,recipient:k.assignee_id,key:`ticket:${k.id}`,itemType:'ticket',title:`${k.number} · ${k.title}`,description:k.status,priority:prio(k.priority),slaAt:k.due_at,dueAt:k.due_at,assigner:k.requester_id,actions:['complete','comment','reassign','escalate','follow_up','snooze','open']});
  if(k.approval_status==='Pending'&&k.approver_id)out.push({...base,recipient:k.approver_id,key:`ticket-approval:${k.id}`,itemType:'approval',title:`Approve ${k.number}: ${k.title}`,priority:'high',assigner:k.requester_id,actions:['approve','reject','comment','open']});
  return out;
 },
 async project(t,id){
  const p=await first<{id:string,code:string,name:string,department:string,approval_status:string|null,sponsor_id:string|null,manager_id:string|null,owner_id:string|null,updated_at:string,archived_at?:string|null}>('SELECT * FROM projects WHERE id=? AND tenant_id=?',id,t);if(!p)return null;
  const out:Desired[]=[];const base={module:'projects',department:p.department,projectId:p.id,url:`#/projects/${p.id}`,version:p.updated_at,page:'projects'};
  if(p.approval_status&&p.approval_status.startsWith('pending:')){const to=p.approval_status.slice(8);const who=p.sponsor_id?[p.sponsor_id]:[...await deptHeads(t,p.department),...await admins(t)];for(const r of new Set(who))if(r!==p.manager_id)out.push({...base,recipient:r,key:`project-approval:${p.id}:${to}`,itemType:'approval',title:`${p.code} · ${p.name}`,description:`Stage change to ${to}`,priority:'high',assigner:p.manager_id,actions:['approve','reject','comment','open']})}
  // New team members are told once about their assignment (informational; dismiss or open).
  for(const m of await all<{member_id:string,role:string,added_at?:string}>("SELECT member_id,role FROM project_members WHERE tenant_id=? AND project_id=?",t,p.id).catch(()=>[]))if(m.member_id!==p.manager_id)out.push({...base,recipient:m.member_id,key:`project-member:${p.id}`,itemType:'assignment',title:`You are on ${p.code} · ${p.name}`,description:`Role: ${m.role||'member'}`,priority:'low',assigner:p.manager_id,actions:['acknowledge','open','dismiss']});
  return out;
 },
 async project_record(t,id){
  const r=await first<{id:string,project_id:string,kind:string,title:string,status:string,priority:string,owner_id:string|null,due_date:string|null,deleted_at:string|null}>('SELECT id,project_id,kind,title,status,priority,owner_id,due_date,deleted_at FROM project_records WHERE id=? AND tenant_id=?',id,t);if(!r)return null;
  if(r.deleted_at||!['risk','issue'].includes(r.kind)||!r.owner_id||/closed|resolved|done|mitigated/i.test(r.status))return [];
  return [{recipient:r.owner_id,key:`${r.kind}:${r.id}`,module:'projects',itemType:r.kind,title:`${r.kind==='risk'?'Risk':'Issue'}: ${r.title}`,description:r.status,priority:prio(r.priority),dueAt:r.due_date,projectId:r.project_id,url:`#/projects/${r.project_id}`,page:'projects',actions:['comment','follow_up','open','snooze']}];
 },
 async work_order(t,id){
  const w=await first<{id:string,number:string,title:string,status:string,priority:string,assignee_id:string|null,department:string,due_at:string|null,created_by:string,updated_at:string}>('SELECT id,number,title,status,priority,assignee_id,department,due_at,created_by,updated_at FROM work_orders WHERE id=? AND tenant_id=?',id,t);if(!w)return null;
  if(!w.assignee_id||['Completed','Cancelled'].includes(w.status))return [];
  return [{recipient:w.assignee_id,key:`work-order:${w.id}`,module:'maintenance',itemType:'maintenance',title:`${w.number} · ${w.title}`,description:w.status,priority:prio(w.priority),dueAt:w.due_at,slaAt:w.due_at,department:w.department,assigner:w.created_by,url:`#/maintenance/orders/${w.id}`,version:w.updated_at,page:'schedules',actions:['complete','comment','reassign','follow_up','open']}];
 },
 async page(t,id){
  const p=await first<{id:string,title:string,kind:string,status:string,requires_ack:number,acl_json:string|null,department:string,expires_at:string|null,author_id:string,priority:string,publish_at:string|null}>('SELECT id,title,kind,status,requires_ack,acl_json,department,expires_at,author_id,priority,publish_at FROM pages WHERE id=? AND tenant_id=?',id,t);if(!p)return null;
  if(p.kind!=='announcement'||!p.requires_ack||p.status!=='Published'||(p.expires_at&&p.expires_at<now())||(p.publish_at&&p.publish_at>now()))return [];
  const {audienceMembers,aclOf}=await import('./acl');
  const aud=await audienceMembers(t,p.acl_json?aclOf(p.acl_json):p.department?aclOf(null,{visibility:'department',department:p.department}):aclOf(null,{visibility:'company'}));
  const acked=new Set((await all<{member_id:string}>('SELECT member_id FROM announcement_receipts WHERE tenant_id=? AND page_id=? AND acked_at IS NOT NULL',t,p.id)).map(r=>r.member_id));
  return aud.filter(m=>!acked.has(m)&&m!==p.author_id).map(m=>({recipient:m,key:`ack:${p.id}`,module:'spaces',itemType:'acknowledgement',title:`Acknowledge: ${p.title}`,priority:prio(p.priority),dueAt:p.expires_at,assigner:p.author_id,url:`#/spaces/page/${p.id}`,page:'knowledge',actions:['acknowledge','open']}));
 },
 async studio_record(t,id){
  const out:Desired[]=[];
  for(const a of await all<{id:string,app_id:string,stage_name:string,approver_ids:string,decisions_json:string,due_at:string|null}>("SELECT id,app_id,stage_name,approver_ids,decisions_json,due_at FROM studio_approvals WHERE tenant_id=? AND record_id=? AND status='pending'",t,id)){
   const m=parseJson<{title?:string,link?:string,requesterId?:string,decisions?:{by:string}[]}>(a.decisions_json,{});
   for(const r of parseJson<string[]>(a.approver_ids,[]))if(!(m.decisions||[]).some(d=>d.by===r))out.push({recipient:r,key:`studio-approval:${a.id}`,module:'studio',itemType:'approval',title:m.title||'App record approval',description:a.stage_name,priority:'high',dueAt:a.due_at,slaAt:a.due_at,assigner:m.requesterId||null,url:m.link||'#/studio/approvals',version:a.id,page:'studio',actions:APPROVE});
  }
  return out;
 },
 async ai_approval(t,id){
  const a=await first<{id:string,tool:string,effect:string,risk:string,requested_by:string,status:string,agent_id:string}>('SELECT id,tool,effect,risk,requested_by,status,agent_id FROM ai_action_approvals WHERE id=? AND tenant_id=?',id,t);if(!a)return null;if(a.status!=='pending')return [];
  const who=a.risk==='high'?await admins(t):[a.requested_by,...await admins(t)];
  return [...new Set(who)].map(r=>({recipient:r,key:`ai-approval:${a.id}`,module:'agents',itemType:'ai_approval',title:`AI proposes: ${a.tool.replace(/_/g,' ')}`,description:a.effect,priority:a.risk==='high'?'high' as const:'normal' as const,businessImpact:`${a.risk} risk`,url:'#/inbox/approvals',version:a.status,page:'agents',actions:['approve','reject','open']}));
 },
 async connector_action(t,id){
  const r=await first<{id:string,connector_id:string,action:string,status:string,requested_by:string}>('SELECT id,connector_id,action,status,requested_by FROM connector_action_runs WHERE id=? AND tenant_id=?',id,t);if(!r)return null;if(r.status!=='pending_confirmation')return [];
  const c=await first<{name:string,scope:string,owner_member_id:string|null}>('SELECT name,scope,owner_member_id FROM connectors WHERE id=? AND tenant_id=?',r.connector_id,t);if(!c)return [];
  const who=c.scope==='user'&&c.owner_member_id?[c.owner_member_id]:[r.requested_by,...await admins(t)];
  return [...new Set(who)].filter(x=>!x.startsWith('agent:')).map(x=>({recipient:x,key:`connector-action:${r.id}`,module:'connectors',itemType:'connector_action',title:`${c.name}: confirm “${r.action}”`,priority:'normal' as const,url:'#/inbox/approvals',version:r.status,page:'connectors',action:'view',actions:['approve','reject','open']}));
 },
 async connector(t,id){
  const c=await first<{id:string,name:string,health:string,status:string,last_error:string,last_ok_at:string|null}>('SELECT id,name,health,status,last_error,last_ok_at FROM connectors WHERE id=? AND tenant_id=?',id,t);if(!c)return null;
  if(!/fail|error|down|unhealthy/i.test(`${c.health} ${c.status}`)||!c.last_error)return [];
  return (await admins(t)).map(r=>({recipient:r,key:`connector-failure:${c.id}`,module:'connectors',itemType:'alert',title:`Connector failing: ${c.name}`,description:c.last_error.slice(0,300),priority:'high' as const,url:`#/admin/connectors/${c.id}`,page:'connectors',action:'view',actions:['open','snooze','dismiss']}));
 },
 async automation_run(t,id){
  const r=await first<{id:string,app_id:string,automation_id:string,status:string,error:string}>('SELECT id,app_id,automation_id,status,error FROM studio_automation_runs WHERE id=? AND tenant_id=?',id,t);if(!r)return null;if(!['failed','blocked'].includes(r.status))return [];
  const a=await first<{name:string}>('SELECT name FROM studio_apps WHERE id=? AND tenant_id=?',r.app_id,t);
  return (await admins(t)).map(x=>({recipient:x,key:`workflow-exception:${r.id}`,module:'studio',itemType:'exception',title:`Automation failed in ${a?.name||'an app'}`,description:r.error.slice(0,300),priority:'high' as const,url:`#/studio/apps/${r.app_id}/automations`,page:'studio',action:'view',actions:['retry','open','dismiss']}));
 },
 async invoice(t,id){
  const i=await first<{id:string,po_id:string,number:string,vendor_invoice_no:string,amount:number,tax:number,currency:string,status:string,match_json:string,due_date:string|null}>('SELECT * FROM purchase_invoices WHERE id=? AND tenant_id=?',id,t);if(!i)return null;
  const po=await first<{id:string,number:string,created_by:string,requester_id:string,department:string,project_id:string|null}>('SELECT id,number,created_by,requester_id,department,project_id FROM purchase_docs WHERE id=? AND tenant_id=?',i.po_id,t);if(!po)return [];
  if(i.status!=='Exception')return [];
  const why=parseJson<{reasons?:string[]}>(i.match_json,{}).reasons||[];
  return [...new Set([po.created_by,...await admins(t)])].map(r=>({recipient:r,key:`invoice-exception:${i.id}`,module:'purchasing',itemType:'exception',title:`Invoice ${i.vendor_invoice_no} on ${po.number} does not match`,description:why.join('; ').slice(0,300),priority:'high' as const,amount:i.amount+i.tax,currency:i.currency,dueAt:i.due_date,department:po.department,projectId:po.project_id,url:`#/purchasing/po/${po.id}`,version:i.status,page:'procurement',actions:['open','comment','follow_up']}));
 },
 async vendor(t,id){
  const v=await first<{id:string,name:string,status:string}>('SELECT id,name,status FROM vendors WHERE id=? AND tenant_id=?',id,t);if(!v)return null;if(v.status!=='Under review')return [];
  return [...new Set([...await deptHeads(t,'Procurement'),...await admins(t)])].map(r=>({recipient:r,key:`vendor-review:${v.id}`,module:'purchasing',itemType:'review',title:`Review vendor: ${v.name}`,priority:'normal' as const,url:`#/purchasing/vendors/${v.id}`,page:'suppliers',actions:['open','comment','follow_up']}));
 },
 async inventory_item(t,id){
  const i=await first<{id:string,sku:string,name:string,min_stock:number,qty:number,status:string}>('SELECT i.id,i.sku,i.name,i.min_stock,i.status,(SELECT coalesce(sum(s.qty),0) FROM stock_levels s WHERE s.item_id=i.id AND s.tenant_id=i.tenant_id) AS qty FROM inventory_items i WHERE i.id=? AND i.tenant_id=?',id,t);if(!i)return null;
  if(i.status!=='Active'||!(i.min_stock>0)||i.qty>i.min_stock)return [];
  const who=(await all<{id:string}>("SELECT id FROM members WHERE tenant_id=? AND active=1 AND role IN ('admin','manager')",t)).map(r=>r.id);
  return who.map(r=>({recipient:r,key:`inventory-low:${i.id}`,module:'inventory',itemType:'alert',title:`Low stock: ${i.sku} · ${i.name}`,description:`${i.qty} on hand, reorder level ${i.min_stock}`,priority:i.qty<=0?'high' as const:'normal' as const,url:`#/inventory/items/${i.id}`,page:'inventory',actions:['open','follow_up','snooze','dismiss']}));
 },
 async maintenance_plan(t,id){
  const p=await first<{id:string,title:string,next_due:string|null,assignee_id:string|null,department:string,active:number,asset_id:string}>('SELECT id,title,next_due,assignee_id,department,active,asset_id FROM maintenance_plans WHERE id=? AND tenant_id=?',id,t);if(!p)return null;
  const soon=new Date(Date.now()+3*86400000).toISOString().slice(0,10);if(!p.active||!p.next_due||p.next_due>soon)return [];
  const who=p.assignee_id?[p.assignee_id]:await deptHeads(t,p.department);
  return who.map(r=>({recipient:r,key:`maintenance-due:${p.id}:${p.next_due}`,module:'maintenance',itemType:'alert',title:`Maintenance due: ${p.title}`,dueAt:p.next_due,priority:(p.next_due&&p.next_due<today()?'high':'normal') as Desired['priority'],department:p.department,url:'#/maintenance/plans',page:'schedules',actions:['open','follow_up','snooze']}));
 },
 async work_record(t,id){
  const r=await first<{id:string,kind:string,number:string,title:string,status:string,owner_id:string|null,data_json:string,department:string,end_date:string|null,deleted_at:string|null}>('SELECT id,kind,number,title,status,owner_id,data_json,department,end_date,deleted_at FROM work_records WHERE id=? AND tenant_id=?',id,t);if(!r)return null;if(r.deleted_at)return [];
  const d=parseJson<Record<string,unknown>>(r.data_json,{});const out:Desired[]=[];const url=['objective','key_result','initiative','programme','strategy','theme','goal'].includes(r.kind)?`#/strategy/item/${r.id}`:r.kind==='decision'?`#/knowledge/decisions/${r.id}`:`#/business/${r.kind}/${r.id}`;
  if(r.kind==='contract'&&typeof d.renewalDate==='string'&&r.owner_id&&!['Expired','Terminated'].includes(r.status)&&d.renewalDate<=new Date(Date.now()+30*86400000).toISOString().slice(0,10))out.push({recipient:r.owner_id,key:`contract-renewal:${r.id}:${d.renewalDate}`,module:'business',itemType:'contract',title:`Contract renewal: ${r.title}`,dueAt:String(d.renewalDate),priority:'high',department:r.department,url,page:'business',actions:['open','follow_up','snooze']});
  if(r.kind==='decision'&&['Proposed','Under review'].includes(r.status)){const dm=typeof d.decidedBy==='string'&&d.decidedBy?d.decidedBy:r.owner_id;if(dm)out.push({recipient:dm,key:`decision-review:${r.id}:${r.status}`,module:'knowledge',itemType:'review',title:`Decision to review: ${r.title}`,priority:'normal',department:r.department,url,page:'business',actions:['approve','reject','comment','open']})}
  // Check-ins: objectives and key results whose next check-in is due.
  if(['objective','key_result','initiative'].includes(r.kind)&&r.owner_id&&typeof d.nextCheckIn==='string'&&d.nextCheckIn<=today()&&!['Achieved','Completed','Cancelled','Missed'].includes(r.status))out.push({recipient:r.owner_id,key:`check-in:${r.id}:${d.nextCheckIn}`,module:'strategy',itemType:'check_in',title:`Check-in due: ${r.title}`,dueAt:String(d.nextCheckIn),priority:'normal',department:r.department,url,page:'strategy',actions:['check_in','open','snooze']});
  return out;
 },
 async lifecycle(t,id){
  const r=await first<{id:string,number:string,title:string,status:string,requester_id:string,department:string,estimated_cost:number,currency:string,project_id:string|null,version:number,priority:string,required_date:string|null}>('SELECT id,number,title,status,requester_id,department,estimated_cost,currency,project_id,version,priority,required_date FROM business_requests WHERE id=? AND tenant_id=?',id,t);if(!r)return null;
  const out:Desired[]=[];const base={module:'lifecycle',department:r.department,projectId:r.project_id,url:`#/lifecycle/${r.id}`,version:String(r.version),page:'lifecycle',amount:r.estimated_cost,currency:r.currency};
  for(const a of await all<{id:string,name:string,approver_ids_json:string,decisions_json:string,stage_key:string}>("SELECT id,name,approver_ids_json,decisions_json,stage_key FROM lifecycle_approvals WHERE tenant_id=? AND request_id=? AND status='pending'",t,r.id)){
   const done=new Set(parseJson<{by:string}[]>(a.decisions_json,[]).map(x=>x.by));
   for(const p of parseJson<string[]>(a.approver_ids_json,[]))if(!done.has(p))out.push({...base,recipient:p,key:`lifecycle-approval:${a.id}`,itemType:'approval',title:`${r.number} · ${r.title}`,description:`Approval: ${a.name}`,priority:prio(r.priority)==='normal'?'high':prio(r.priority),dueAt:r.required_date,assigner:r.requester_id,version:`${r.version}:${a.id}`,actions:APPROVE});
  }
  for(const s of await all<{id:string,name:string,owner_id:string|null,due_at:string|null,stage_key:string}>("SELECT id,name,owner_id,due_at,stage_key FROM lifecycle_stages WHERE tenant_id=? AND request_id=? AND status='active'",t,r.id))
   if(s.owner_id&&!out.some(o=>o.recipient===s.owner_id))out.push({...base,recipient:s.owner_id,key:`lifecycle-stage:${s.id}`,itemType:'lifecycle_stage',title:`${r.number}: ${s.name}`,description:r.title,priority:prio(r.priority),dueAt:s.due_at,slaAt:s.due_at,assigner:r.requester_id,actions:['open','complete_stage','comment','snooze']});
  if(r.status==='Changes requested')out.push({...base,recipient:r.requester_id,key:`lifecycle-changes:${r.id}:${r.version}`,itemType:'task',title:`Update ${r.number}: changes requested`,priority:'high',actions:['open','comment']});
  return out;
 },
 async service_delivery(t,id){
  const s=await first<{id:string,number:string,title:string,status:string,owner_id:string,due_at:string|null,department:string,project_id:string|null}>('SELECT id,number,title,status,owner_id,due_at,department,project_id FROM service_deliveries WHERE id=? AND tenant_id=?',id,t);if(!s)return null;
  if(s.status!=='Delivered')return [];
  return [{recipient:s.owner_id,key:`service-acceptance:${s.id}`,module:'lifecycle',itemType:'approval',title:`Accept service: ${s.number} · ${s.title}`,priority:'high',dueAt:s.due_at,department:s.department,projectId:s.project_id,url:`#/lifecycle/services/${s.id}`,page:'lifecycle',actions:['open']}];
 },
 async outcome_review(t,id){
  const o=await first<{id:string,title:string,status:string,owner_id:string|null,review_date:string|null,request_id:string|null,project_id:string|null}>('SELECT id,title,status,owner_id,review_date,request_id,project_id FROM outcome_reviews WHERE id=? AND tenant_id=?',id,t);if(!o)return null;
  if(o.status!=='Scheduled'||!o.owner_id||!o.review_date||o.review_date>new Date(Date.now()+7*86400000).toISOString().slice(0,10))return [];
  return [{recipient:o.owner_id,key:`outcome-review:${o.id}`,module:'lifecycle',itemType:'review',title:`Outcome review: ${o.title}`,dueAt:o.review_date,priority:'normal',projectId:o.project_id,url:o.request_id?`#/lifecycle/${o.request_id}`:'#/lifecycle',page:'lifecycle',actions:['open','snooze']}];
 },
 async knowledge_review(t,id){
  const r=await first<{id:string,knowledge_id:string,reason:string,detail:string,assignee_id:string|null,status:string,due_at:string|null}>('SELECT * FROM knowledge_reviews WHERE id=? AND tenant_id=?',id,t);if(!r)return null;
  if(r.status!=='open'||!r.assignee_id)return [];
  const k=await first<{title:string,url:string,department:string}>('SELECT title,url,department FROM knowledge_sources WHERE id=? AND tenant_id=?',r.knowledge_id,t);
  return [{recipient:r.assignee_id,key:`knowledge-review:${r.id}`,module:'knowledge',itemType:'review',title:`Review knowledge: ${k?.title||'content'}`,description:`${r.reason.replace(/_/g,' ')}${r.detail?` — ${r.detail}`:''}`.slice(0,300),dueAt:r.due_at,priority:'normal',department:k?.department||'',url:`#/knowledge/reviews/${r.id}`,page:'knowledge',actions:['complete','open','snooze','delegate']}];
 },
 async question(t,id){
  const q=await first<{id:string,title:string,status:string,escalated_to:string,asker_id:string}>('SELECT id,title,status,escalated_to,asker_id FROM knowledge_questions WHERE id=? AND tenant_id=?',id,t);if(!q)return null;
  if(q.status!=='escalated'||!q.escalated_to)return [];
  return (await deptHeads(t,q.escalated_to)).filter(r=>r!==q.asker_id).map(r=>({recipient:r,key:`question:${q.id}`,module:'knowledge',itemType:'question',title:`Question for ${q.escalated_to}: ${q.title}`,priority:'normal' as const,department:q.escalated_to,url:`#/knowledge/questions/${q.id}`,page:'knowledge',assigner:q.asker_id,actions:['open','reply','delegate']}));
 },
 async suggestion(t,id){
  const s=await first<{id:string,kind:string,status:string,payload_json:string,created_by:string}>('SELECT id,kind,status,payload_json,created_by FROM knowledge_suggestions WHERE id=? AND tenant_id=?',id,t);if(!s)return null;
  if(s.status!=='pending'||!['decision','action_item'].includes(s.kind)||s.created_by.startsWith('agent:')&&false)return [];
  const p=parseJson<{title?:string,reviewerId?:string}>(s.payload_json,{});const who=p.reviewerId?[p.reviewerId]:s.created_by&&!s.created_by.startsWith('system')&&!s.created_by.startsWith('agent:')?[s.created_by]:await admins(t);
  return who.map(r=>({recipient:r,key:`suggestion:${s.id}`,module:'knowledge',itemType:'ai_suggestion',title:`AI suggests a ${s.kind==='decision'?'decision':'task'}: ${p.title||''}`.slice(0,200),priority:'normal' as const,url:`#/knowledge/suggestions`,page:'knowledge',actions:['approve','reject','open']}));
 },
};
async function purchase(t:string,id:string):Promise<Desired[]|null>{
 const d=await first<{id:string,kind:string,number:string,title:string,status:string,total:number,currency:string,department:string,requester_id:string,created_by:string,project_id:string|null,version:number,needed_by:string|null,location:string}>('SELECT id,kind,number,title,status,total,currency,department,requester_id,created_by,project_id,version,needed_by,location FROM purchase_docs WHERE id=? AND tenant_id=?',id,t);if(!d)return null;
 const out:Desired[]=[];const base={module:'purchasing',department:d.department,projectId:d.project_id,location:d.location,url:`#/purchasing/${d.kind.toLowerCase()}/${d.id}`,version:String(d.version),amount:d.total,currency:d.currency,page:d.kind==='PO'?'procurement':'requests'};
 if(d.status==='Pending approval'){const a=await first<{id:string,step_name:string,approver_ids:string,created_at:string}>("SELECT id,step_name,approver_ids,created_at FROM approvals WHERE tenant_id=? AND doc_id=? AND status='Pending' LIMIT 1",t,d.id);
  if(a)for(const r of parseJson<string[]>(a.approver_ids,[]))out.push({...base,recipient:r,key:`purchase-approval:${a.id}`,itemType:'approval',title:`${d.number} · ${d.title}`,description:`${a.step_name} · ${d.currency} ${d.total.toLocaleString()}`,priority:d.total>=50000?'high':'normal',businessImpact:d.kind==='PO'?'Purchase order approval':'Purchase requisition approval',dueAt:d.needed_by,assigner:d.requester_id,actions:APPROVE,page:'requests'})}
 if(d.kind==='PO'&&['Issued','Partially received'].includes(d.status))for(const r of new Set([d.created_by,d.requester_id]))out.push({...base,recipient:r,key:`goods-receipt:${d.id}`,itemType:'receipt',title:`Receive goods: ${d.number} · ${d.title}`,description:d.status,priority:d.needed_by&&d.needed_by<today()?'high':'normal',dueAt:d.needed_by,actions:['open','follow_up','snooze']});
 if(d.kind==='PR'&&d.status==='Approved')for(const r of await deptHeads(t,'Procurement'))out.push({...base,recipient:r,key:`convert-pr:${d.id}`,itemType:'task',title:`Raise a purchase order for ${d.number}`,description:d.title,priority:'normal',assigner:d.requester_id,actions:['open','snooze'],page:'procurement'});
 return out;
}
// Maps any graph/source type to its adapter.
const ADAPTER_OF:Record<string,string>={PR:'PR',PO:'PO',task:'task',milestone:'task',ticket:'ticket',project:'project',project_record:'project_record',risk:'project_record',issue:'project_record',work_order:'work_order',page:'page',studio_record:'studio_record',ai_approval:'ai_approval',connector_action:'connector_action',connector:'connector',automation_run:'automation_run',invoice:'invoice',vendor:'vendor',inventory_item:'inventory_item',maintenance_plan:'maintenance_plan',work_record:'work_record',goal:'work_record',objective:'work_record',key_result:'work_record',initiative:'work_record',programme:'work_record',strategy:'work_record',theme:'work_record',contract:'work_record',decision:'work_record',lifecycle:'lifecycle',request:'lifecycle',service_delivery:'service_delivery',outcome_review:'outcome_review',knowledge_review:'knowledge_review',question:'question',suggestion:'suggestion'};
export const inboxSourceTypes=Object.keys(ADAPTER_OF);
// Canonical source type stored on items (one per source table).
const CANON:Record<string,string>={lifecycle:'request',milestone:'task',risk:'project_record',issue:'project_record',goal:'work_record',objective:'work_record',key_result:'work_record',initiative:'work_record',programme:'work_record',strategy:'work_record',theme:'work_record',contract:'work_record',decision:'work_record'};
export const canonType=(t:string)=>CANON[t]||t;

async function settings(tenantId:string){
 const {platformSetting}=await import('./platform-settings');const plat=await platformSetting<Record<string,unknown>>('inboxDefaults',{});
 const rules=await all<{kind:string,config_json:string,enabled:number,name:string,id:string}>('SELECT id,kind,name,config_json,enabled FROM inbox_rules WHERE tenant_id=? AND enabled=1',tenantId);
 const modules=rules.find(r=>r.kind==='modules');
 return {platform:plat,rules:rules.map(r=>({...r,config:parseJson<Record<string,unknown>>(r.config_json,{})})),disabledModules:new Set(parseJson<{disabled?:string[]}>(modules?.config_json,{}).disabled||(plat.disabledModules as string[]|undefined)||[])};
}

// ── Projection: bring one source record's items in line with its adapter ──
export async function syncSource(tenantId:string,type:string,id:string){
 const name=ADAPTER_OF[type];if(!name)return {skipped:true};
 const desired=await adapters[name](tenantId,id);
 const cfg=await settings(tenantId);
 const list=(desired||[]).filter(d=>!cfg.disabledModules.has(d.module));
 const {delegatesOf}=await import('./delegation');
 // Delegates covering a recipient receive their own copy (marked "delegated from").
 const withDelegates:(Desired&{delegatedFrom?:string})[]=[...list];
 for(const d of list)for(const del of await delegatesOf(tenantId,d.recipient,d.module,d.itemType,{type:canonType(type),id}))if(del!==d.recipient)withDelegates.push({...d,recipient:del,key:`${d.key}:for:${d.recipient}`,delegatedFrom:d.recipient});
 const node=await first<{id:string}>('SELECT id FROM graph_nodes WHERE tenant_id=? AND source_id=? AND deleted_at IS NULL LIMIT 1',tenantId,id);
 const sourceType=canonType(type);
 const ts=now();const s:D1PreparedStatement[]=[];
 const sla=(d:Desired)=>{if(d.slaAt)return d.slaAt;const r=cfg.rules.find(x=>x.kind==='sla'&&(!x.config.itemType||x.config.itemType===d.itemType)&&(!x.config.module||x.config.module===d.module));const h=Number(r?.config.hours||(cfg.platform.slaHours as Record<string,number>|undefined)?.[d.itemType]||0);return h?new Date(Date.now()+h*3600000).toISOString():null};
 for(const d of withDelegates){
  s.push(stmt(`INSERT INTO inbox_items(id,tenant_id,recipient_id,dedupe_key,source_module,source_type,source_id,source_url,source_version,item_type,title,description,priority,impact_score,business_impact,financial_amount,currency,status,due_at,sla_at,assigner_id,actions_json,required_page,required_action,department,project_id,location,group_id,delegated_from,graph_node_id,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,'open',?,?,?,?,?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(tenant_id,recipient_id,dedupe_key) DO UPDATE SET title=excluded.title,description=excluded.description,priority=excluded.priority,business_impact=excluded.business_impact,financial_amount=excluded.financial_amount,currency=excluded.currency,due_at=excluded.due_at,sla_at=coalesce(inbox_items.sla_at,excluded.sla_at),source_url=excluded.source_url,source_version=excluded.source_version,actions_json=excluded.actions_json,required_page=excluded.required_page,required_action=excluded.required_action,department=excluded.department,project_id=excluded.project_id,location=excluded.location,graph_node_id=excluded.graph_node_id,delegated_from=excluded.delegated_from,
    status=CASE WHEN inbox_items.status IN ('done','cancelled') AND inbox_items.completion_json LIKE '%"reason":"source"%' THEN 'open' ELSE inbox_items.status END,completed_at=CASE WHEN inbox_items.status IN ('done','cancelled') AND inbox_items.completion_json LIKE '%"reason":"source"%' THEN NULL ELSE inbox_items.completed_at END,updated_at=excluded.updated_at`,
   uid(),tenantId,d.recipient,d.key,d.module,sourceType,id,d.url,d.version||'',d.itemType,d.title.slice(0,300),(d.description||'').slice(0,600),d.priority||'normal',d.businessImpact||'',d.amount??null,d.currency||'',d.dueAt||null,sla(d),d.assigner||null,JSON.stringify(d.actions),d.page,d.action||'view',d.department||'',d.projectId||null,d.location||'',d.groupId||null,d.delegatedFrom||null,node?.id||null,ts,ts));
 }
 // Close what the source no longer asks for (escalation copies follow their base item).
 const keep=new Set(withDelegates.map(d=>`${d.recipient}|${d.key}`));const baseKeys=new Set(withDelegates.map(d=>d.key));
 const open=await all<{id:string,recipient_id:string,dedupe_key:string,escalated_from:string|null}>("SELECT id,recipient_id,dedupe_key,escalated_from FROM inbox_items WHERE tenant_id=? AND source_id=? AND status IN ('open','snoozed')",tenantId,id);
 for(const o of open){const baseKey=o.dedupe_key.split(':esc:')[0];if(keep.has(`${o.recipient_id}|${o.dedupe_key}`)||(o.escalated_from&&baseKeys.has(baseKey)))continue;s.push(stmt("UPDATE inbox_items SET status='done',completed_at=?,completion_json=?,updated_at=? WHERE id=?",ts,JSON.stringify({reason:'source',note:'Resolved in the source module'}),ts,o.id))}
 for(let i=0;i<s.length;i+=80)await batch(s.slice(i,i+80));
 await scoreItems(tenantId,id,cfg);
 return {items:withDelegates.length,closed:s.length-withDelegates.length};
}
// Rule-based impact score (also used for "rule-based ordering"); evidence is recomputed on read.
async function scoreItems(tenantId:string,sourceId:string,cfg:Awaited<ReturnType<typeof settings>>){
 for(const i of await all<ItemRow>("SELECT * FROM inbox_items WHERE tenant_id=? AND source_id=? AND status='open'",tenantId,sourceId)){const sc=score(i,cfg.rules).score;if(sc!==i.impact_score)await run('UPDATE inbox_items SET impact_score=? WHERE id=?',sc,i.id)}
}
export function score(i:Pick<ItemRow,'priority'|'due_at'|'sla_at'|'financial_amount'|'item_type'|'source_module'|'escalation_level'>,rules:{kind:string,name:string,config:Record<string,unknown>}[]=[]){
 const ev:string[]=[];let s={critical:90,high:70,normal:40,low:20}[i.priority as 'high']??40;ev.push(`Priority ${i.priority} (+${s})`);
 const t=today(),week=new Date(Date.now()+7*86400000).toISOString().slice(0,10);const due=i.due_at?.slice(0,10);
 if(due&&due<t){s+=30;ev.push(`Overdue since ${due} (+30)`)}else if(due===t){s+=20;ev.push('Due today (+20)')}else if(due&&due<=week){s+=10;ev.push(`Due ${due} (+10)`)}
 if(i.sla_at&&i.sla_at<now()){s+=25;ev.push('SLA breached (+25)')}
 if(i.financial_amount&&i.financial_amount>0){const f=Math.min(20,Math.round(Math.log10(i.financial_amount)*4));s+=f;ev.push(`Financial impact ${Math.round(i.financial_amount).toLocaleString()} (+${f})`)}
 if(['approval','ai_approval','connector_action'].includes(i.item_type)){s+=10;ev.push('Someone is waiting on your decision (+10)')}
 if(i.escalation_level>0){s+=15;ev.push('Escalated to you (+15)')}
 for(const r of rules.filter(r=>r.kind==='priority')){const c=r.config;if((c.itemType&&c.itemType!==i.item_type)||(c.module&&c.module!==i.source_module)||(c.minAmount!=null&&!(Number(i.financial_amount||0)>=Number(c.minAmount))))continue;const b=Number(c.boost||0);if(b){s+=b;ev.push(`Company rule “${r.name}” (${b>0?'+':''}${b})`)}}
 return {score:Math.max(0,Math.min(200,s)),evidence:ev};
}
// Rebuild: every source that can produce items (idempotent; closes stale items).
export async function rebuild(tenantId:string){
 const q=async(sql:string)=>(await all<{id:string}>(sql,tenantId)).map(r=>r.id);
 const sources:[string,string[]][]=[
  ['PR',await q("SELECT id FROM purchase_docs WHERE tenant_id=? AND kind='PR' AND status IN ('Pending approval','Approved')")],['PO',await q("SELECT id FROM purchase_docs WHERE tenant_id=? AND kind='PO' AND status IN ('Pending approval','Issued','Partially received')")],
  ['task',await q("SELECT id FROM tasks WHERE tenant_id=? AND deleted_at IS NULL AND (status NOT IN ('Done','Cancelled') OR approval_status='pending')")],['ticket',await q("SELECT id FROM tickets WHERE tenant_id=? AND (status NOT IN ('Resolved','Closed','Cancelled') OR approval_status='Pending')")],
  ['project',await q("SELECT id FROM projects WHERE tenant_id=?")],['project_record',await q("SELECT id FROM project_records WHERE tenant_id=? AND kind IN ('risk','issue') AND deleted_at IS NULL")],
  ['work_order',await q("SELECT id FROM work_orders WHERE tenant_id=? AND status NOT IN ('Completed','Cancelled')")],['page',await q("SELECT id FROM pages WHERE tenant_id=? AND kind='announcement' AND requires_ack=1 AND status='Published'")],
  ['studio_record',await q("SELECT DISTINCT record_id AS id FROM studio_approvals WHERE tenant_id=? AND status='pending'")],['ai_approval',await q("SELECT id FROM ai_action_approvals WHERE tenant_id=? AND status='pending'")],
  ['connector_action',await q("SELECT id FROM connector_action_runs WHERE tenant_id=? AND status='pending_confirmation'")],['connector',await q('SELECT id FROM connectors WHERE tenant_id=?')],
  ['automation_run',await q("SELECT id FROM studio_automation_runs WHERE tenant_id=? AND status IN ('failed','blocked')")],['invoice',await q("SELECT id FROM purchase_invoices WHERE tenant_id=? AND status='Exception'")],
  ['vendor',await q("SELECT id FROM vendors WHERE tenant_id=? AND status='Under review'")],['inventory_item',await q("SELECT id FROM inventory_items WHERE tenant_id=? AND status='Active' AND min_stock>0")],
  ['maintenance_plan',await q('SELECT id FROM maintenance_plans WHERE tenant_id=? AND active=1')],['work_record',await q("SELECT id FROM work_records WHERE tenant_id=? AND deleted_at IS NULL AND kind IN ('contract','decision','objective','key_result','initiative')")],
  ['lifecycle',await q("SELECT id FROM business_requests WHERE tenant_id=? AND status NOT IN ('Closed','Rejected','Withdrawn')")],['service_delivery',await q("SELECT id FROM service_deliveries WHERE tenant_id=? AND status='Delivered'")],
  ['outcome_review',await q("SELECT id FROM outcome_reviews WHERE tenant_id=? AND status='Scheduled'")],['knowledge_review',await q("SELECT id FROM knowledge_reviews WHERE tenant_id=? AND status='open'")],
  ['question',await q("SELECT id FROM knowledge_questions WHERE tenant_id=? AND status='escalated'")],['suggestion',await q("SELECT id FROM knowledge_suggestions WHERE tenant_id=? AND status='pending'")],
 ];
 let n=0;const seen=new Set<string>();for(const [type,ids] of sources)for(const id of ids){seen.add(id);await syncSource(tenantId,type,id);n++}
 // Anything still open whose source is no longer active is re-checked (closed if its adapter no longer yields it).
 for(const o of await all<{source_type:string,source_id:string}>("SELECT DISTINCT source_type,source_id FROM inbox_items WHERE tenant_id=? AND status='open' AND dedupe_key NOT LIKE 'notification:%' AND dedupe_key NOT LIKE 'manual:%'",tenantId))if(!seen.has(o.source_id)){await syncSource(tenantId,o.source_type,o.source_id);n++}
 return n;
}
registerJob('inbox.rebuild',async job=>{await rebuild(job.tenant_id)});
registerJob('inbox.sync',async job=>{const p=parseJson<{type?:string}>(job.payload_json,{});if(p.type)await syncSource(job.tenant_id,p.type,job.ref_id)});

// Domain-event consumer: resolve what changed and re-project its inbox items.
export async function onDomainEvent(e:{tenant_id:string,type:string,entity_id:string,action:string,payload_json:string},entityType:string|null){
 const p=parseJson<Record<string,unknown>>(e.payload_json,{});
 let type=entityType||'';
 if(e.type==='studio.record'||e.type==='studio.approval')type='studio_record';
 if(e.type==='connector.webhook'||e.type==='connector.record')return;
 if(e.type==='inbox')type=String(p.type||'');
 if(!type)return;
 // Audit rows are written against the record they concern; approvals belong to their document.
 const id=type==='studio_record'&&typeof p.recordId==='string'?p.recordId:e.entity_id;
 await syncSource(e.tenant_id,type,id);
 if(type==='PO'||type==='PR'){for(const i of await all<{id:string}>('SELECT id FROM purchase_invoices WHERE tenant_id=? AND po_id=?',e.tenant_id,id))await syncSource(e.tenant_id,'invoice',i.id)}
}
// Explicit inbox events for sources that are not audited records (AI approvals, connector actions, …).
export const inboxEventStatement=(tenantId:string,type:string,id:string)=>stmt("INSERT INTO domain_events(id,tenant_id,type,entity_id,action,actor,payload_json,status,attempts,error,created_at) VALUES(?,?,'inbox',?,'inbox sync','system',?,'pending',0,'',?)",uid(),tenantId,id,JSON.stringify({type}),now());

// Notifications (mentions, direct messages, comments and status alerts) become informational inbox items.
// Kinds already represented by structured items (approvals, assignments, acknowledgements) are skipped.
const STRUCTURED=new Set(['approval','task','ticket','ai-approval','connector-confirmation','announcement','maintenance']);
export async function fromNotifications(tenantId:string,rows:{id:string,memberId:string,kind:string,title:string,body:string,link:string}[]){
 const s=rows.filter(r=>!STRUCTURED.has(r.kind)).map(r=>{const type=r.kind==='mention'?'mention':r.kind==='message'?'message':r.kind==='comment'?'mention':'alert';const ts=now();
  return stmt("INSERT INTO inbox_items(id,tenant_id,recipient_id,dedupe_key,source_module,source_type,source_id,source_url,item_type,title,description,priority,status,actions_json,required_page,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'open',?,'',?,?) ON CONFLICT(tenant_id,recipient_id,dedupe_key) DO NOTHING",uid(),tenantId,r.memberId,`notification:${r.id}`,'notifications','notification',r.id,r.link||'',type,r.title.slice(0,300),r.body.slice(0,600),type==='mention'?'normal':'low',JSON.stringify(type==='alert'?['open','dismiss','snooze','mark_unread']:['open','reply','dismiss','snooze','mark_unread','follow_up']),ts,ts)});
 if(s.length)await batch(s);
}

// ── Reading: permission-checked at query time ──
const GRAPH_TYPE:Record<string,string[]>={PR:['PR'],PO:['PO'],task:['task','milestone'],ticket:['ticket'],project:['project'],project_record:['risk','issue','project_record'],work_order:['work_order'],page:['page'],studio_record:['studio_record'],work_record:['goal','objective','key_result','initiative','programme','strategy','theme','contract','decision','customer','service','meeting'],vendor:['vendor'],inventory_item:['inventory_item'],maintenance_plan:['maintenance_plan'],invoice:[],request:['request'],service_delivery:['service_delivery'],outcome_review:['outcome_review'],knowledge_review:['knowledge'],question:['question']};
export async function authorize(u:Member,items:ItemRow[]){
 if(!items.length)return [];
 const {visibleNodes}=await import('./graph');
 const pageOk=items.filter(i=>!i.required_page||u.role==='admin'||hasAction(u,i.required_page,i.required_action||'view')||i.item_type==='approval'||i.delegated_from||i.escalated_from);
 // Source visibility through the Work Graph node of the record, re-checked with the module's own rule.
 const bySource=new Map<string,ItemRow[]>();for(const i of pageOk)bySource.set(i.source_id,[...(bySource.get(i.source_id)||[]),i]);
 const ids=[...bySource.keys()];const nodes=[];for(let k=0;k<ids.length;k+=90){const part=ids.slice(k,k+90);nodes.push(...await all<import('./graph').GraphNode>(`SELECT * FROM graph_nodes WHERE tenant_id=? AND deleted_at IS NULL AND source_id IN (${IN(part)})`,u.tenantId,...part))}
 const vis=await visibleNodes(u,nodes);const nodeBySource=new Map<string,{ok:boolean}>();for(const n of nodes){const types=GRAPH_TYPE[pageOk.find(i=>i.source_id===n.source_id)?.source_type||'']||[n.type];if(!types.includes(n.type)&&types.length)continue;nodeBySource.set(n.source_id,{ok:(nodeBySource.get(n.source_id)?.ok||false)||vis.has(n.id)})}
 const {activeFor}=await import('./delegation');const out:ItemRow[]=[];
 for(const i of pageOk){
  if(i.recipient_id!==u.id)continue;
  const n=nodeBySource.get(i.source_id);
  // Approvers and assignees are authorised by the source module when the item is produced; a record that
  // later becomes hidden (graph check fails) drops out, except items routed through an active delegation.
  if(n&&!n.ok&&!['approval','ai_approval','connector_action','acknowledgement'].includes(i.item_type)){if(!i.delegated_from)continue;if(!(await activeFor(u.tenantId,u.id,i.source_module,i.item_type)).some(d=>d.delegator_id===i.delegated_from))continue}
  if(i.delegated_from&&!(await activeFor(u.tenantId,u.id,i.source_module,i.item_type,{type:i.source_type,id:i.source_id})).some(d=>d.delegator_id===i.delegated_from))continue;
  out.push(i);
 }
 return out;
}
export type ViewOpts={view:string,q?:string,type?:string,module?:string,priority?:string,department?:string,sort?:string,page?:number,size?:number,group?:string};
export async function listFor(u:Member,o:ViewOpts){
 const t=now(),d=today(),week=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
 const openish="status='open' AND (snoozed_until IS NULL OR snoozed_until<=?)";
 const views:Record<string,[string,unknown[]]>={
  all:[`${openish}`,[t]],attention:[`${openish}`,[t]],approvals:[`${openish} AND item_type IN ('approval','ai_approval','connector_action')`,[t]],tasks:[`${openish} AND item_type IN ('task','milestone','ticket','maintenance','lifecycle_stage','check_in','receipt','review','assignment','risk','issue')`,[t]],
  assigned:[`${openish} AND item_type IN ('task','milestone','ticket','maintenance','lifecycle_stage','risk','issue')`,[t]],mentions:[`${openish} AND item_type='mention'`,[t]],messages:[`${openish} AND item_type='message'`,[t]],alerts:[`${openish} AND item_type IN ('alert','exception','contract')`,[t]],
  overdue:[`${openish} AND due_at IS NOT NULL AND substr(due_at,1,10)<?`,[t,d]],today:[`${openish} AND substr(due_at,1,10)=?`,[t,d]],week:[`${openish} AND substr(due_at,1,10)>=? AND substr(due_at,1,10)<=?`,[t,d,week]],
  high:[`${openish} AND (priority IN ('high','critical') OR impact_score>=80)`,[t]],financial:[`${openish} AND financial_amount>0`,[t]],delegated:[`${openish} AND delegated_from IS NOT NULL`,[t]],
  snoozed:["status='open' AND snoozed_until>?",[t]],completed:["status IN ('done','dismissed','cancelled')",[]],
 };
 const [w,args]=views[o.view]||views.all;
 const rows=await all<ItemRow>(`SELECT * FROM inbox_items WHERE tenant_id=? AND recipient_id=? AND ${w} ORDER BY ${o.view==='completed'?'completed_at DESC':'impact_score DESC,due_at IS NULL,due_at'} LIMIT 1500`,u.tenantId,u.id,...args);
 let items=await authorize(u,rows);
 const q=(o.q||'').toLowerCase().trim();
 if(q)items=items.filter(i=>`${i.title} ${i.description} ${i.business_impact}`.toLowerCase().includes(q));
 if(o.type)items=items.filter(i=>i.item_type===o.type);if(o.module)items=items.filter(i=>i.source_module===o.module);if(o.priority)items=items.filter(i=>i.priority===o.priority);if(o.department)items=items.filter(i=>departmentKey(i.department)===departmentKey(o.department!));
 const sorts:Record<string,(a:ItemRow,b:ItemRow)=>number>={rules:(a,b)=>b.impact_score-a.impact_score,due:(a,b)=>String(a.due_at||'9999').localeCompare(String(b.due_at||'9999')),priority:(a,b)=>['critical','high','normal','low'].indexOf(a.priority)-['critical','high','normal','low'].indexOf(b.priority)||b.impact_score-a.impact_score,newest:(a,b)=>b.created_at.localeCompare(a.created_at),amount:(a,b)=>Number(b.financial_amount||0)-Number(a.financial_amount||0)};
 if(o.sort&&sorts[o.sort])items.sort(sorts[o.sort]);
 const size=Math.min(200,Math.max(10,o.size||50)),page=Math.max(1,o.page||1);
 const rules=(await settings(u.tenantId)).rules;
 return {total:items.length,page,size,items:items.slice((page-1)*size,page*size).map(i=>shape(i,rules))};
}
export function shape(i:ItemRow,rules:{kind:string,name:string,config:Record<string,unknown>}[]=[]){
 const d=today();const sc=score(i,rules);
 return {id:i.id,sourceModule:i.source_module,sourceType:i.source_type,sourceId:i.source_id,url:i.source_url,version:i.source_version,type:i.item_type,title:i.title,description:i.description,priority:i.priority,score:sc.score,evidence:sc.evidence,businessImpact:i.business_impact,amount:i.financial_amount,currency:i.currency,status:i.status,dueAt:i.due_at,slaAt:i.sla_at,overdue:!!i.due_at&&i.due_at.slice(0,10)<d,slaBreached:!!i.sla_at&&i.sla_at<now(),assignerId:i.assigner_id,actions:parseJson<string[]>(i.actions_json,[]),department:i.department,projectId:i.project_id,location:i.location,read:!!i.read_at,snoozedUntil:i.snoozed_until,delegatedFrom:i.delegated_from,escalatedFrom:i.escalated_from,escalationLevel:i.escalation_level,completedAt:i.completed_at,completion:parseJson(i.completion_json,{}),createdAt:i.created_at};
}
export async function counts(u:Member){
 const t=now();const rows=await all<ItemRow>("SELECT * FROM inbox_items WHERE tenant_id=? AND recipient_id=? AND status='open' AND (snoozed_until IS NULL OR snoozed_until<=?) LIMIT 2000",u.tenantId,u.id,t);
 const items=await authorize(u,rows);const d=today();
 return {all:items.length,unread:items.filter(i=>!i.read_at).length,approvals:items.filter(i=>['approval','ai_approval','connector_action'].includes(i.item_type)).length,tasks:items.filter(i=>['task','milestone','ticket','maintenance','lifecycle_stage','check_in','receipt','review','assignment','risk','issue'].includes(i.item_type)).length,mentions:items.filter(i=>i.item_type==='mention').length,messages:items.filter(i=>i.item_type==='message').length,alerts:items.filter(i=>['alert','exception','contract'].includes(i.item_type)).length,overdue:items.filter(i=>i.due_at&&i.due_at.slice(0,10)<d).length,delegated:items.filter(i=>i.delegated_from).length,snoozed:(await first<{n:number}>("SELECT count(*) AS n FROM inbox_items WHERE tenant_id=? AND recipient_id=? AND status='open' AND snoozed_until>?",u.tenantId,u.id,t))?.n||0};
}
export async function loadItem(u:Member,id:string){const i=await first<ItemRow>('SELECT * FROM inbox_items WHERE id=? AND tenant_id=?',id,u.tenantId);if(!i)throw new HttpError(404,'Inbox item not found.');const ok=await authorize(u,[i]);if(!ok.length)throw new HttpError(404,'Inbox item not found.');return i}

// Current version of a source record, for optimistic concurrency ("this changed since you loaded it").
export async function currentVersion(tenantId:string,i:ItemRow){
 switch(i.source_type){
  case 'PR':case 'PO':return String((await first<{version:number}>('SELECT version FROM purchase_docs WHERE id=? AND tenant_id=?',i.source_id,tenantId))?.version??'');
  case 'task':return (await first<{updated_at:string}>('SELECT updated_at FROM tasks WHERE id=? AND tenant_id=?',i.source_id,tenantId))?.updated_at||'';
  case 'ticket':return String((await first<{version:number}>('SELECT version FROM tickets WHERE id=? AND tenant_id=?',i.source_id,tenantId))?.version??'');
  case 'request':{const r=await first<{version:number}>('SELECT version FROM business_requests WHERE id=? AND tenant_id=?',i.source_id,tenantId);return i.source_version.includes(':')?`${r?.version}:${i.source_version.split(':')[1]}`:String(r?.version??'')}
  case 'work_order':return (await first<{updated_at:string}>('SELECT updated_at FROM work_orders WHERE id=? AND tenant_id=?',i.source_id,tenantId))?.updated_at||'';
 }
 return i.source_version;
}

// ── SLA, escalation and digests (scheduled) ──
export async function slaSweep(tenantId:string){
 const cfg=await settings(tenantId);const rules=cfg.rules.filter(r=>r.kind==='escalation');const t=now();let escalated=0;
 const def=(cfg.platform.escalation as {afterHours?:number,to?:string}|undefined)||{};
 const due=await all<ItemRow>("SELECT * FROM inbox_items WHERE tenant_id=? AND status='open' AND escalated_from IS NULL AND escalation_level=0 AND coalesce(sla_at,due_at) IS NOT NULL LIMIT 500",tenantId);
 for(const i of due){
  const r=rules.find(x=>(!x.config.itemType||x.config.itemType===i.item_type)&&(!x.config.module||x.config.module===i.source_module));const after=Number(r?.config.afterHours??def.afterHours??-1);if(after<0)continue;
  const at=i.sla_at||`${i.due_at!.slice(0,10)}T23:59:59.000Z`;if(new Date(Date.parse(at)+after*3600000).toISOString()>t)continue;
  const to=String(r?.config.to||def.to||'department_head');const member=await first<{manager_id:string|null,department:string}>('SELECT manager_id,department FROM members WHERE id=? AND tenant_id=?',i.recipient_id,tenantId);
  let targets:string[]=to==='manager'&&member?.manager_id?[member.manager_id]:to.startsWith('person:')?[to.slice(7)]:await deptHeads(tenantId,i.department||member?.department||'');
  targets=targets.filter(x=>x!==i.recipient_id);if(!targets.length)targets=(await admins(tenantId)).filter(x=>x!==i.recipient_id);
  const s:D1PreparedStatement[]=[stmt('UPDATE inbox_items SET escalation_level=1,updated_at=? WHERE id=?',t,i.id)];
  for(const x of targets){
   s.push(stmt("INSERT INTO inbox_items(id,tenant_id,recipient_id,dedupe_key,source_module,source_type,source_id,source_url,source_version,item_type,title,description,priority,impact_score,financial_amount,currency,status,due_at,sla_at,actions_json,required_page,required_action,department,project_id,escalated_from,escalation_level,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'high',?,?,?,'open',?,?,?,?,?,?,?,?,1,?,?) ON CONFLICT(tenant_id,recipient_id,dedupe_key) DO NOTHING",uid(),tenantId,x,`${i.dedupe_key}:esc:1`,i.source_module,i.source_type,i.source_id,i.source_url,i.source_version,i.item_type,`Escalated: ${i.title}`,`Not actioned in time by the assignee. ${i.description}`.slice(0,600),i.impact_score+15,i.financial_amount,i.currency,i.due_at,i.sla_at,i.actions_json,i.required_page,i.required_action,i.department,i.project_id,i.recipient_id,t,t));
   // For approvals the escalation target may decide (a one-item delegation, recorded and time-limited).
   if(['approval'].includes(i.item_type))s.push(stmt("INSERT INTO inbox_delegations(id,tenant_id,delegator_id,delegate_id,modules_json,item_types_json,source_type,source_id,starts_at,ends_at,reason,out_of_office,status,created_by,created_at) VALUES(?,?,?,?,'[]','[]',?,?,?,?,'Escalation (SLA missed)',0,'active','system',?)",uid(),tenantId,i.recipient_id,x,i.source_type,i.source_id,t,new Date(Date.now()+7*86400000).toISOString(),t));
  }
  s.push(stmt('INSERT INTO audit (id,action,actor,record_id,department,before_json,after_json,created_at,tenant_id) VALUES (?,?,?,?,?,NULL,?,?,?)',uid(),'Inbox item escalated (SLA)','system',i.source_id,i.department,JSON.stringify({item:i.id,to:targets}),t,tenantId));
  await batch(s);escalated++;
  const {notify}=await import('./notify');await notify({id:'system',tenantId},targets,{kind:'approval',title:`Escalated to you: ${i.title}`,body:i.description,link:'#/inbox/all'});
 }
 // Reminders that fell due come back to the top of the inbox.
 await run("UPDATE inbox_items SET snoozed_until=NULL,read_at=NULL,updated_at=? WHERE tenant_id=? AND status='open' AND snoozed_until IS NOT NULL AND snoozed_until<=?",t,tenantId,t);
 // Retention: completed items older than the configured period are removed from the projection (sources stay).
 const ret=cfg.rules.find(r=>r.kind==='retention');const days=Number(ret?.config.completedDays??cfg.platform.retentionDays??180);
 await run("DELETE FROM inbox_items WHERE tenant_id=? AND status IN ('done','dismissed','cancelled') AND completed_at<?",tenantId,new Date(Date.now()-days*86400000).toISOString());
 return escalated;
}
export async function digest(tenantId:string){
 const cfg=await settings(tenantId);const rule=cfg.rules.find(r=>r.kind==='digest');const freq=String(rule?.config.frequency||cfg.platform.digest||'none');if(freq==='none')return 0;
 const {notify}=await import('./notify');let sent=0;
 for(const m of await all<{recipient_id:string,n:number,overdue:number}>("SELECT recipient_id,count(*) AS n,sum(CASE WHEN due_at<? THEN 1 ELSE 0 END) AS overdue FROM inbox_items WHERE tenant_id=? AND status='open' GROUP BY recipient_id",today(),tenantId)){await notify({id:'system',tenantId},[m.recipient_id],{kind:'digest',title:`Your inbox: ${m.n} item${m.n===1?'':'s'}${m.overdue?`, ${m.overdue} overdue`:''}`,link:'#/inbox',email:true});sent++}
 return sent;
}
registerJob('inbox.sweep',async job=>{await slaSweep(job.tenant_id);const h=new Date().getUTCHours();if(h===6)await digest(job.tenant_id);await enqueueStatement(job.tenant_id,'inbox.sweep',job.tenant_id,{},{key:`inbox-sweep:${new Date(Date.now()+3600000).toISOString().slice(0,13)}`,delaySec:3600}).run()});
export async function ensureSweep(tenantId:string){await enqueueStatement(tenantId,'inbox.sweep',tenantId,{},{key:`inbox-sweep:${new Date().toISOString().slice(0,13)}`}).run();kick(1)}

export async function audit(u:Member,i:ItemRow,action:string,result:unknown={}){await batch([stmt('INSERT INTO inbox_item_actions(id,tenant_id,item_id,actor_id,action,result_json,created_at) VALUES(?,?,?,?,?,?,?)',uid(),u.tenantId,i.id,u.id,action,JSON.stringify(result).slice(0,2000),now()),auditStatement(u,`Inbox: ${action.replace(/_/g,' ')}`,i.source_id,i.department,null,{item:i.id,type:i.item_type,...(typeof result==='object'&&result?result:{})})])}
export {canActOn};
