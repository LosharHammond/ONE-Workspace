import {all,first,stmt,batch,uid,now,HttpError,auditStatement} from './core';
import {departmentKey} from '../access-policy';
import {notify} from './notify';
import type {Member} from './policy';

// A workflow is an ordered list of steps. Each step resolves to one or more
// approvers at submission time; any one of them may decide the step.
export type StepType='manager'|'department_head'|'department'|'role'|'access'|'user';
export type Step={name:string,type:StepType,ref?:string,minAmount?:number};
export type Doc={id:string,kind:'PR'|'PO',number:string,title:string,department:string,total:number,currency:string,requester_id:string};
export type ApprovalRow={id:string,doc_id:string,step_no:number,step_name:string,approver_ids:string,status:string,decided_by:string|null,decided_at:string|null,comment:string,created_at:string};

export const defaultSteps:Record<'PR'|'PO',Step[]>={
 PR:[{name:'Reporting manager',type:'manager'},{name:'Department head',type:'department_head'},{name:'Finance approval',type:'department',ref:'Finance',minAmount:10000}],
 PO:[{name:'Procurement head',type:'department',ref:'Procurement'},{name:'Management approval',type:'access',ref:'admin',minAmount:50000}],
};
export function validSteps(v:unknown):Step[]{
 if(!Array.isArray(v)||v.length<1||v.length>8)throw new HttpError(400,'A workflow needs between one and eight steps.');
 return v.map((s,i)=>{const x=s as Record<string,unknown>;const type=String(x.type) as StepType;if(!['manager','department_head','department','role','access','user'].includes(type))throw new HttpError(400,`Step ${i+1} has an unknown approver type.`);const name=String(x.name||'').trim().slice(0,80);if(!name)throw new HttpError(400,`Name step ${i+1}.`);const ref=x.ref===undefined||x.ref===null?undefined:String(x.ref).trim().slice(0,160);if(['department','role','access','user'].includes(type)&&!ref)throw new HttpError(400,`Choose who approves step ${i+1}.`);const minAmount=x.minAmount===undefined||x.minAmount===''||x.minAmount===null?undefined:Number(x.minAmount);if(minAmount!==undefined&&(!Number.isFinite(minAmount)||minAmount<0))throw new HttpError(400,`Step ${i+1} threshold must be a positive amount.`);return {name,type,ref,minAmount}});
}

type Person={id:string,role:string,department:string,role_id:string|null,manager_id:string|null,active:number};
async function heads(tenantId:string,department:string,people:Person[]){
 const d=await first<{head_id:string|null}>('SELECT head_id FROM departments WHERE tenant_id=? AND lower(name)=lower(?)',tenantId,department);
 if(d?.head_id&&people.some(p=>p.id===d.head_id))return [d.head_id];
 return people.filter(p=>p.role==='manager'&&departmentKey(p.department)===departmentKey(department)).map(p=>p.id);
}
async function resolve(tenantId:string,step:Step,doc:Doc,people:Person[]):Promise<string[]>{
 const requester=people.find(p=>p.id===doc.requester_id);
 switch(step.type){
  case 'manager':return requester?.manager_id&&people.some(p=>p.id===requester.manager_id)?[requester.manager_id]:[];
  case 'department_head':return heads(tenantId,doc.department,people);
  case 'department':return heads(tenantId,step.ref||'',people);
  case 'access':return people.filter(p=>p.role===step.ref).map(p=>p.id);
  case 'user':return people.some(p=>p.id===step.ref)?[step.ref!]:[];
  case 'role':{const role=await first<{id:string}>('SELECT id FROM roles WHERE tenant_id=? AND (id=? OR lower(name)=lower(?))',tenantId,step.ref,step.ref);return role?people.filter(p=>p.role_id===role.id).map(p=>p.id):[]}
 }
}
export async function workflowFor(tenantId:string,kind:'PR'|'PO',department:string,total:number){
 const flows=await all<{id:string,name:string,department:string,min_amount:number,steps_json:string}>('SELECT id,name,department,min_amount,steps_json FROM approval_workflows WHERE tenant_id=? AND doc_type=? AND active=1 AND min_amount<=? ORDER BY min_amount DESC',tenantId,kind,total);
 const match=flows.find(f=>f.department!=='*'&&departmentKey(f.department)===departmentKey(department))||flows.find(f=>f.department==='*');
 return match?{name:match.name,steps:JSON.parse(match.steps_json) as Step[]}:{name:'Default approval',steps:defaultSteps[kind]};
}

// Builds the approval chain for a submitted document. Steps without an eligible
// approver are skipped and recorded; the requester can never approve their own document.
export async function startApproval(u:Member,doc:Doc,req?:Request){
 const people=await all<Person>('SELECT id,role,department,role_id,manager_id,active FROM members WHERE tenant_id=? AND active=1',u.tenantId);
 const flow=await workflowFor(u.tenantId,doc.kind,doc.department,doc.total);
 const rows:{step:Step,ids:string[],status:string,comment:string}[]=[];
 for(const step of flow.steps){
  if(step.minAmount!==undefined&&doc.total<step.minAmount){rows.push({step,ids:[],status:'Skipped',comment:`Below ${step.minAmount.toLocaleString()} threshold`});continue}
  const ids=(await resolve(u.tenantId,step,doc,people)).filter(id=>id!==doc.requester_id);
  rows.push({step,ids,status:ids.length?'Waiting':'Skipped',comment:ids.length?'':'No eligible approver'});
 }
 // Never let a document through unapproved: fall back to administrators.
 if(!rows.some(r=>r.status==='Waiting')){const admins=people.filter(p=>p.role==='admin'&&p.id!==doc.requester_id).map(p=>p.id);if(admins.length)rows.push({step:{name:'Administrator approval',type:'access',ref:'admin'},ids:admins,status:'Waiting',comment:'Fallback: no workflow approver was available'})}
 const firstIdx=rows.findIndex(r=>r.status==='Waiting');
 if(firstIdx<0)throw new HttpError(409,'No one else in this workspace can approve this document. Add an approver or administrator first.');
 rows[firstIdx].status='Pending';
 const t=now();
 await batch([
  stmt('DELETE FROM approvals WHERE tenant_id=? AND doc_id=?',u.tenantId,doc.id),
  ...rows.map((r,i)=>stmt('INSERT INTO approvals(id,tenant_id,doc_id,step_no,step_name,approver_ids,status,comment,created_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,doc.id,i+1,r.step.name,JSON.stringify(r.ids),r.status,r.comment,t)),
  stmt("UPDATE purchase_docs SET status='Pending approval',submitted_at=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=?",t,t,doc.id,u.tenantId),
  auditStatement(u,`${doc.kind} submitted for approval`,doc.id,doc.department,null,{workflow:flow.name,steps:rows.map(r=>({name:r.step.name,status:r.status}))}),
 ]);
 await notify(u,rows[firstIdx].ids,{kind:'approval',title:`Approval needed: ${doc.number}`,body:`${doc.title}\n${doc.currency} ${doc.total.toLocaleString(undefined,{minimumFractionDigits:2})} · ${doc.department}\nStep: ${rows[firstIdx].step.name}`,link:`#/purchasing/${doc.kind.toLowerCase()}/${doc.id}`},req);
}

export async function decide(u:Member,doc:Doc,decision:'approve'|'reject',comment:string,req?:Request){
 const steps=await all<ApprovalRow>('SELECT * FROM approvals WHERE tenant_id=? AND doc_id=? ORDER BY step_no',u.tenantId,doc.id);
 const current=steps.find(s=>s.status==='Pending');
 if(!current)throw new HttpError(409,'This document is not awaiting approval.');
 if(doc.requester_id===u.id)throw new HttpError(403,'You cannot approve your own document.');
 const approvers=JSON.parse(current.approver_ids) as string[];
 const override=!approvers.includes(u.id);
 if(override&&u.role!=='admin')throw new HttpError(403,`This step is assigned to another approver (${current.step_name}).`);
 if(decision==='reject'&&!comment)throw new HttpError(400,'Add a reason when rejecting.');
 const t=now(),note=(override?'[Administrator override] ':'')+comment;
 const next=steps.find(s=>s.step_no>current.step_no&&s.status==='Waiting');
 const finalStatus=decision==='reject'?'Rejected':next?null:'Approved';
 const res=await batch([
  stmt("UPDATE approvals SET status=?,decided_by=?,decided_at=?,comment=? WHERE id=? AND status='Pending'",decision==='approve'?'Approved':'Rejected',u.id,t,note,current.id),
  ...(decision==='reject'?[stmt("UPDATE approvals SET status='Cancelled' WHERE tenant_id=? AND doc_id=? AND status='Waiting'",u.tenantId,doc.id)]:next?[stmt("UPDATE approvals SET status='Pending' WHERE id=?",next.id)]:[]),
  ...(finalStatus?[stmt('UPDATE purchase_docs SET status=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=?',finalStatus,t,doc.id,u.tenantId)]:[stmt('UPDATE purchase_docs SET updated_at=? WHERE id=? AND tenant_id=?',t,doc.id,u.tenantId)]),
  auditStatement(u,`${doc.kind} ${decision==='approve'?'approved':'rejected'} · ${current.step_name}`,doc.id,doc.department,null,{step:current.step_name,comment:note}),
 ]);
 if(!res[0].meta.changes)throw new HttpError(409,'Someone else decided this step. Refresh to see the latest status.');
 const link=`#/purchasing/${doc.kind.toLowerCase()}/${doc.id}`;
 if(decision==='reject')await notify(u,[doc.requester_id],{kind:'rejected',title:`${doc.number} was rejected`,body:`${doc.title}\n${current.step_name}: ${comment}`,link},req);
 else if(next)await notify(u,JSON.parse(next.approver_ids),{kind:'approval',title:`Approval needed: ${doc.number}`,body:`${doc.title}\n${doc.currency} ${doc.total.toLocaleString(undefined,{minimumFractionDigits:2})} · ${doc.department}\nStep: ${next.step_name} (previous step approved)`,link},req);
 else await notify(u,[doc.requester_id],{kind:'approved',title:`${doc.number} is fully approved`,body:doc.kind==='PR'?`${doc.title}\nProcurement can now raise a purchase order.`:`${doc.title}\nThe order can now be issued to the vendor.`,link},req);
 return finalStatus||'Pending approval';
}
