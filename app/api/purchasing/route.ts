import {hasAction,canActOn} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,num,oneOf,idOf,date,auditStatement,nextNumber,tenantOf,tenantSettings} from '../../server/core';
import {canSeeDoc,isApprover,docPage,type PurchaseRow} from '../../server/entities';
import {startApproval,decide,validSteps,workflowFor,type Doc} from '../../server/approvals';
import {notify,sendEmail,emailReady,escapeHtml as esc} from '../../server/notify';
import type {Member} from '../../server/policy';

type Line={id:string,doc_id:string,line_no:number,description:string,item_code:string,qty:number,unit:string,unit_price:number,tax_rate:number,received_qty:number};
const docSelect="SELECT d.*,(SELECT group_concat(j.value) FROM approvals a, json_each(a.approver_ids) j WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id AND a.status IN ('Pending','Approved','Waiting')) AS approver_ids,(SELECT a.step_name FROM approvals a WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id AND a.status='Pending') AS pending_step,(SELECT a.approver_ids FROM approvals a WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id AND a.status='Pending') AS pending_ids FROM purchase_docs d";
async function load(u:Member,id:string){const d=await first<PurchaseRow&{pending_ids:string|null,pending_step:string|null}>(`${docSelect} WHERE d.id=? AND d.tenant_id=?`,id,u.tenantId);if(!d||!canSeeDoc(u,d))throw new HttpError(404,'Document not found.');return d}
const asDoc=(d:PurchaseRow):Doc=>({id:d.id,kind:d.kind,number:d.number,title:d.title,department:d.department,total:d.total,currency:d.currency,requester_id:d.requester_id});
function validLines(v:unknown){
 if(!Array.isArray(v)||!v.length||v.length>100)throw new HttpError(400,'Add between 1 and 100 line items.');
 return v.map((x,i)=>{const l=x as Record<string,unknown>;return {description:str(l.description,`Line ${i+1} description`,300),item_code:str(l.itemCode,`Line ${i+1} item code`,60,false),qty:num(l.qty,`Line ${i+1} quantity`,0.0001,1e9),unit:str(l.unit||'ea',`Line ${i+1} unit`,20),unit_price:num(l.unitPrice??0,`Line ${i+1} unit price`,0,1e11),tax_rate:num(l.taxRate??0,`Line ${i+1} tax rate`,0,100)}});
}
const totals=(lines:{qty:number,unit_price:number,tax_rate:number}[])=>{const subtotal=lines.reduce((s,l)=>s+l.qty*l.unit_price,0),tax=lines.reduce((s,l)=>s+l.qty*l.unit_price*l.tax_rate/100,0);const r=(n:number)=>Math.round(n*100)/100;return {subtotal:r(subtotal),tax:r(tax),total:r(subtotal+tax)}};
function permissions(u:Member,d:PurchaseRow&{pending_ids?:string|null}){
 const own=d.requester_id===u.id||d.created_by===u.id;const page=docPage(d.kind);
 const pending=d.pending_ids?JSON.parse(d.pending_ids) as string[]:[];
 return {
  canEdit:['Draft','Rejected'].includes(d.status)&&(own||canActOn(u,page,'update',d.department,d.requester_id)),
  canSubmit:['Draft','Rejected'].includes(d.status)&&own,
  canDecide:d.status==='Pending approval'&&d.requester_id!==u.id&&(pending.includes(u.id)||u.role==='admin'),
  isAssignedApprover:pending.includes(u.id),
  canRecall:d.status==='Pending approval'&&own,
  canCancel:['Draft','Rejected','Approved'].includes(d.status)&&(own||u.role==='admin')&&!(d.kind==='PO'&&d.status==='Issued'),
  canConvert:d.kind==='PR'&&d.status==='Approved'&&hasAction(u,'procurement','create'),
  canIssue:d.kind==='PO'&&d.status==='Approved'&&canActOn(u,'procurement','update',d.department,d.requester_id),
  canReceive:d.kind==='PO'&&['Issued','Partially received'].includes(d.status)&&(hasAction(u,'receipts','create')||canActOn(u,'procurement','update',d.department,d.requester_id)),
  canClose:d.kind==='PO'&&['Received','Partially received'].includes(d.status)&&canActOn(u,'procurement','update',d.department,d.requester_id),
 };
}

export const GET=route(async(req,u)=>{
 const url=new URL(req.url),view=url.searchParams.get('view')||'list',id=url.searchParams.get('id');
 if(id){
  const d=await load(u,idOf(id,'Document'));
  const [lines,approvals,comments,history,vendor,related]=await Promise.all([
   all<Line>('SELECT * FROM purchase_lines WHERE tenant_id=? AND doc_id=? ORDER BY line_no',u.tenantId,d.id),
   all('SELECT id,step_no AS stepNo,step_name AS stepName,approver_ids AS approverIds,status,decided_by AS decidedBy,decided_at AS decidedAt,comment FROM approvals WHERE tenant_id=? AND doc_id=? ORDER BY step_no',u.tenantId,d.id),
   all('SELECT id,author_id AS authorId,body,created_at AS createdAt FROM comments WHERE tenant_id=? AND entity_type=? AND entity_id=? ORDER BY created_at',u.tenantId,d.kind,d.id),
   all('SELECT id,action,actor,created_at AS createdAt FROM audit WHERE tenant_id=? AND record_id=? ORDER BY created_at DESC LIMIT 50',u.tenantId,d.id),
   d.vendor_id?first('SELECT * FROM vendors WHERE id=? AND tenant_id=?',d.vendor_id,u.tenantId):null,
   all('SELECT id,kind,number,status,total FROM purchase_docs WHERE tenant_id=? AND (pr_id=? OR id=?) AND id!=?',u.tenantId,d.id,d.pr_id,d.id),
  ]);
  const flow=['Draft','Rejected'].includes(d.status)?await workflowFor(u.tenantId,d.kind,d.department,d.total):null;
  return {doc:d,lines,approvals:approvals.map(a=>({...a,approverIds:JSON.parse(String(a.approverIds))})),comments,history,vendor,related,workflowPreview:flow,...permissions(u,d),emailReady:emailReady()};
 }
 if(view==='vendors'){if(!hasAction(u,'suppliers')&&!hasAction(u,'procurement'))throw new HttpError(403,'Vendors are not available to your account.');return {vendors:await all('SELECT v.*,(SELECT count(*) FROM purchase_docs d WHERE d.vendor_id=v.id AND d.tenant_id=v.tenant_id) AS orders,(SELECT coalesce(sum(total),0) FROM purchase_docs d WHERE d.vendor_id=v.id AND d.tenant_id=v.tenant_id AND d.status NOT IN (\'Draft\',\'Cancelled\',\'Rejected\')) AS spend FROM vendors v WHERE v.tenant_id=? ORDER BY v.name',u.tenantId),canEdit:hasAction(u,'suppliers','create')}}
 if(view==='workflows'){if(u.role!=='admin')throw new HttpError(403,'Only administrators manage approval workflows.');return {workflows:(await all<{steps_json:string}>('SELECT * FROM approval_workflows WHERE tenant_id=? ORDER BY doc_type,min_amount',u.tenantId)).map(w=>({...w,steps:JSON.parse(w.steps_json)}))}}
 const kind=url.searchParams.get('kind');
 const rows=await all<PurchaseRow&{pending_ids:string|null}>(`${docSelect} WHERE d.tenant_id=? ${kind?'AND d.kind=?':''} ORDER BY d.created_at DESC LIMIT 3000`,u.tenantId,...(kind?[kind]:[]));
 return {docs:rows.filter(d=>canSeeDoc(u,d)).map(d=>({...d,awaitingMe:d.status==='Pending approval'&&d.requester_id!==u.id&&!!d.pending_ids&&JSON.parse(d.pending_ids).includes(u.id),involved:isApprover(u,d)})),canCreatePR:hasAction(u,'requests','create'),canCreatePO:hasAction(u,'procurement','create')};
});

export const POST=route(async(req,u)=>{
 const b=await readBody(req,200000);const action=String(b.action||'');
 if(action==='save')return save(u,b,req);
 if(action==='vendor')return saveVendor(u,b);
 if(action==='workflow'||action==='delete-workflow')return saveWorkflow(u,b,action);
 const d=await load(u,idOf(b.id,'Document'));const p=permissions(u,d);const link=`#/purchasing/${d.kind.toLowerCase()}/${d.id}`;
 switch(action){
  case 'submit':{if(!p.canSubmit)throw new HttpError(403,'Only the requester can submit a draft.');const lines=await first<{n:number}>('SELECT count(*) AS n FROM purchase_lines WHERE tenant_id=? AND doc_id=?',u.tenantId,d.id);if(!lines?.n)throw new HttpError(400,'Add at least one line item first.');await startApproval(u,asDoc(d),req);return {ok:true}}
  case 'decide':{const decision=oneOf(b.decision,['approve','reject'] as const,'decision');const status=await decide(u,asDoc(d),decision,str(b.comment,'Comment',1000,false),req);return {status}}
  case 'recall':{if(!p.canRecall)throw new HttpError(403,'Only the requester can recall this document.');await batch([stmt("UPDATE approvals SET status='Cancelled' WHERE tenant_id=? AND doc_id=? AND status IN ('Pending','Waiting')",u.tenantId,d.id),stmt("UPDATE purchase_docs SET status='Draft',updated_at=?,version=version+1 WHERE id=? AND tenant_id=?",now(),d.id,u.tenantId),auditStatement(u,`${d.kind} recalled to draft`,d.id,d.department,{status:d.status},{status:'Draft'})]);return {ok:true}}
  case 'cancel':{if(!p.canCancel)throw new HttpError(403,'You cannot cancel this document.');await batch([stmt("UPDATE approvals SET status='Cancelled' WHERE tenant_id=? AND doc_id=? AND status IN ('Pending','Waiting')",u.tenantId,d.id),stmt("UPDATE purchase_docs SET status='Cancelled',updated_at=?,version=version+1 WHERE id=? AND tenant_id=?",now(),d.id,u.tenantId),auditStatement(u,`${d.kind} cancelled`,d.id,d.department,{status:d.status},{status:'Cancelled',reason:str(b.comment,'Reason',500,false)})]);return {ok:true}}
  case 'convert':{
   if(!p.canConvert)throw new HttpError(403,'Converting requisitions requires purchase order access.');
   const vendorId=b.vendorId?idOf(b.vendorId,'Vendor'):null;if(vendorId&&!await first('SELECT id FROM vendors WHERE id=? AND tenant_id=?',vendorId,u.tenantId))throw new HttpError(400,'Vendor not found.');
   const lines=await all<Line>('SELECT * FROM purchase_lines WHERE tenant_id=? AND doc_id=? ORDER BY line_no',u.tenantId,d.id);
   const t=await tenantOf(u);const number=await nextNumber(u.tenantId,String(tenantSettings(t).poPrefix||'PO'));const id=uid(),ts=now();
   await batch([
    stmt('INSERT INTO purchase_docs(id,tenant_id,kind,number,title,justification,department,location,requester_id,vendor_id,pr_id,needed_by,currency,subtotal,tax,total,status,terms,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,'PO',number,d.title,d.justification,d.department,d.location,u.id,vendorId,d.id,d.needed_by,d.currency,d.subtotal,d.tax,d.total,'Draft',String(tenantSettings(t).poTerms||'Payment within 30 days of invoice. Deliver to the location stated above.'),u.id,ts,ts),
    ...lines.map(l=>stmt('INSERT INTO purchase_lines(id,tenant_id,doc_id,line_no,description,item_code,qty,unit,unit_price,tax_rate) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,id,l.line_no,l.description,l.item_code,l.qty,l.unit,l.unit_price,l.tax_rate)),
    stmt("UPDATE purchase_docs SET status='Converted',updated_at=?,version=version+1 WHERE id=? AND tenant_id=? AND status='Approved'",ts,d.id,u.tenantId),
    auditStatement(u,`Converted to ${number}`,d.id,d.department,{status:d.status},{status:'Converted',po:number}),
    auditStatement(u,`Purchase order created from ${d.number}`,id,d.department,null,{number,pr:d.number}),
   ]);
   await notify(u,[d.requester_id],{kind:'purchasing',title:`${d.number} became purchase order ${number}`,body:d.title,link:`#/purchasing/po/${id}`},req);
   return {id,number};
  }
  case 'issue':{
   if(!p.canIssue)throw new HttpError(403,'Issuing purchase orders requires purchase order update access.');
   let emailed=false,emailError='';
   if(b.email){const vendor=d.vendor_id?await first<{name:string,email:string}>('SELECT name,email FROM vendors WHERE id=? AND tenant_id=?',d.vendor_id,u.tenantId):null;if(!vendor?.email)throw new HttpError(400,'Add an email address to the vendor first, or issue without email.');const t=await tenantOf(u);const lines=await all<Line>('SELECT * FROM purchase_lines WHERE tenant_id=? AND doc_id=? ORDER BY line_no',u.tenantId,d.id);try{await sendEmail(vendor.email,`Purchase order ${d.number} from ${t.legal_name||t.name}`,poEmail(t.legal_name||t.name,vendor.name,d,lines),u.email);emailed=true}catch(e){emailError=e instanceof Error?e.message:'Email failed.'}}
   await batch([stmt("UPDATE purchase_docs SET status='Issued',updated_at=?,version=version+1 WHERE id=? AND tenant_id=?",now(),d.id,u.tenantId),auditStatement(u,emailed?'PO issued and emailed to vendor':'PO issued',d.id,d.department,{status:d.status},{status:'Issued',emailed})]);
   return {ok:true,emailed,emailError};
  }
  case 'receive':{
   if(!p.canReceive)throw new HttpError(403,'Receiving goods is not part of your role.');
   if(!Array.isArray(b.lines)||!b.lines.length)throw new HttpError(400,'Enter the quantities received.');
   const lines=await all<Line>('SELECT * FROM purchase_lines WHERE tenant_id=? AND doc_id=?',u.tenantId,d.id);
   const updates=(b.lines as Record<string,unknown>[]).map(x=>{const l=lines.find(y=>y.id===x.lineId);if(!l)throw new HttpError(400,'Unknown line.');const q=num(x.qty,'Received quantity',0,1e9);if(l.received_qty+q>l.qty+1e-9)throw new HttpError(400,`Line ${l.line_no}: receiving more than ordered.`);return {l,q}}).filter(x=>x.q>0);
   if(!updates.length)throw new HttpError(400,'Enter at least one received quantity.');
   const full=lines.every(l=>{const up=updates.find(x=>x.l.id===l.id);return l.received_qty+(up?.q||0)>=l.qty-1e-9});
   const grn=await nextNumber(u.tenantId,'GRN');
   await batch([...updates.map(x=>stmt('UPDATE purchase_lines SET received_qty=received_qty+? WHERE id=? AND tenant_id=?',x.q,x.l.id,u.tenantId)),stmt('UPDATE purchase_docs SET status=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=?',full?'Received':'Partially received',now(),d.id,u.tenantId),auditStatement(u,`Goods received · ${grn}`,d.id,d.department,null,{grn,note:str(b.note,'Note',500,false),lines:updates.map(x=>({line:x.l.line_no,description:x.l.description,qty:x.q}))})]);
   await notify(u,[d.requester_id,d.created_by],{kind:'purchasing',title:`${d.number}: goods ${full?'fully':'partly'} received (${grn})`,body:d.title,link},req);
   return {ok:true,grn,status:full?'Received':'Partially received'};
  }
  case 'close':{if(!p.canClose)throw new HttpError(403,'You cannot close this order.');await batch([stmt("UPDATE purchase_docs SET status='Closed',updated_at=?,version=version+1 WHERE id=? AND tenant_id=?",now(),d.id,u.tenantId),auditStatement(u,'PO closed',d.id,d.department,{status:d.status},{status:'Closed'})]);return {ok:true}}
 }
 throw new HttpError(400,'Unknown action.');
});

async function save(u:Member,b:Record<string,unknown>,req:Request){
 const kind=oneOf(b.kind,['PR','PO'] as const,'document type');const page=docPage(kind);
 const lines=validLines(b.lines);const sum=totals(lines);
 const t=await tenantOf(u);
 const fields={title:str(b.title,'Title',200),justification:str(b.justification,'Justification',4000,false),department:str(b.department,'Department',160),location:str(b.location,'Delivery location',200,false),needed_by:date(b.neededBy,'Needed by'),currency:str(b.currency||t.currency,'Currency',8),terms:str(b.terms,'Terms',4000,false),vendor_id:b.vendorId?idOf(b.vendorId,'Vendor'):null};
 if(fields.vendor_id&&!await first('SELECT id FROM vendors WHERE id=? AND tenant_id=?',fields.vendor_id,u.tenantId))throw new HttpError(400,'Vendor not found.');
 const ts=now();let id:string,number:string;
 if(b.id){
  const d=await load(u,idOf(b.id,'Document'));if(!permissions(u,d).canEdit)throw new HttpError(403,'Only drafts and rejected documents can be edited.');
  if(b.version!==undefined&&b.version!==d.version)throw new HttpError(409,'This document changed. Refresh and review the latest version.');
  id=d.id;number=d.number;
  await batch([stmt('UPDATE purchase_docs SET title=?,justification=?,department=?,location=?,needed_by=?,currency=?,terms=?,vendor_id=?,subtotal=?,tax=?,total=?,status=\'Draft\',updated_at=?,version=version+1 WHERE id=? AND tenant_id=?',fields.title,fields.justification,fields.department,fields.location,fields.needed_by,fields.currency,fields.terms,fields.vendor_id,sum.subtotal,sum.tax,sum.total,ts,id,u.tenantId),stmt('DELETE FROM purchase_lines WHERE tenant_id=? AND doc_id=?',u.tenantId,id),...lines.map((l,i)=>stmt('INSERT INTO purchase_lines(id,tenant_id,doc_id,line_no,description,item_code,qty,unit,unit_price,tax_rate) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,id,i+1,l.description,l.item_code,l.qty,l.unit,l.unit_price,l.tax_rate)),auditStatement(u,`${kind} edited`,id,fields.department,{total:d.total},{total:sum.total,lines:lines.length})]);
 }else{
  if(!hasAction(u,page,'create'))throw new HttpError(403,kind==='PR'?'Raising requisitions is not available to your account.':'Creating purchase orders is not available to your account.');
  if(!canActOn(u,page,'create',fields.department,u.id)&&!(kind==='PR'&&fields.department===u.department))throw new HttpError(403,'You cannot raise documents for this department.');
  id=uid();number=await nextNumber(u.tenantId,String(tenantSettings(t)[kind==='PR'?'prPrefix':'poPrefix']||kind));
  await batch([stmt('INSERT INTO purchase_docs(id,tenant_id,kind,number,title,justification,department,location,requester_id,vendor_id,needed_by,currency,subtotal,tax,total,status,terms,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,kind,number,fields.title,fields.justification,fields.department,fields.location,u.id,fields.vendor_id,fields.needed_by,fields.currency,sum.subtotal,sum.tax,sum.total,'Draft',fields.terms,u.id,ts,ts),...lines.map((l,i)=>stmt('INSERT INTO purchase_lines(id,tenant_id,doc_id,line_no,description,item_code,qty,unit,unit_price,tax_rate) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,id,i+1,l.description,l.item_code,l.qty,l.unit,l.unit_price,l.tax_rate)),auditStatement(u,`${kind} drafted`,id,fields.department,null,{number,total:sum.total})]);
 }
 if(b.submit){const d=await load(u,id);await startApproval(u,asDoc(d),req)}
 return {id,number};
}

async function saveVendor(u:Member,b:Record<string,unknown>){
 if(!hasAction(u,'suppliers',b.id?'update':'create'))throw new HttpError(403,'Vendor management is not available to your account.');
 const email=str(b.email,'Email',160,false);if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new HttpError(400,'Enter a valid vendor email.');
 const v=[str(b.name,'Vendor name',160),email,str(b.phone,'Phone',40,false),str(b.address,'Address',400,false),str(b.taxId,'Tax ID',60,false),str(b.category,'Category',80,false),oneOf(b.status||'Active',['Active','Under review','Inactive'] as const,'status'),str(b.notes,'Notes',2000,false)];
 if(b.id){const id=idOf(b.id,'Vendor');const before=await first('SELECT * FROM vendors WHERE id=? AND tenant_id=?',id,u.tenantId);if(!before)throw new HttpError(404,'Vendor not found.');await batch([stmt('UPDATE vendors SET name=?,email=?,phone=?,address=?,tax_id=?,category=?,status=?,notes=? WHERE id=? AND tenant_id=?',...v,id,u.tenantId),auditStatement(u,'Vendor updated',id,'Procurement',before,{name:v[0]})]);return {id}}
 if(await first('SELECT id FROM vendors WHERE tenant_id=? AND lower(name)=lower(?)',u.tenantId,v[0]))throw new HttpError(409,'A vendor with this name already exists.');
 const id=uid();await batch([stmt('INSERT INTO vendors(id,tenant_id,name,email,phone,address,tax_id,category,status,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,...v,u.id,now()),auditStatement(u,'Vendor added',id,'Procurement',null,{name:v[0]})]);return {id};
}

async function saveWorkflow(u:Member,b:Record<string,unknown>,action:string){
 if(u.role!=='admin')throw new HttpError(403,'Only administrators manage approval workflows.');
 if(action==='delete-workflow'){const id=idOf(b.id,'Workflow');await batch([stmt('DELETE FROM approval_workflows WHERE id=? AND tenant_id=?',id,u.tenantId),auditStatement(u,'Approval workflow deleted',id,'Administration',null,null)]);return {ok:true}}
 const values=[oneOf(b.docType,['PR','PO'] as const,'document type'),str(b.name,'Workflow name',120),str(b.department||'*','Department',160),num(b.minAmount??0,'Minimum amount',0,1e12),JSON.stringify(validSteps(b.steps)),b.active===false?0:1];
 if(b.id){const id=idOf(b.id,'Workflow');const r=await batch([stmt('UPDATE approval_workflows SET doc_type=?,name=?,department=?,min_amount=?,steps_json=?,active=?,updated_at=? WHERE id=? AND tenant_id=?',...values,now(),id,u.tenantId),auditStatement(u,'Approval workflow updated',id,'Administration',null,{name:values[1]})]);if(!r[0].meta.changes)throw new HttpError(404,'Workflow not found.');return {id}}
 const id=uid();await batch([stmt('INSERT INTO approval_workflows(id,tenant_id,doc_type,name,department,min_amount,steps_json,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,...values,now(),now()),auditStatement(u,'Approval workflow created',id,'Administration',null,{name:values[1]})]);return {id};
}

function poEmail(company:string,vendor:string,d:PurchaseRow,lines:Line[]){
 const money=(n:number)=>`${d.currency} ${n.toLocaleString('en',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
 return `<div style="font-family:Segoe UI,Arial,sans-serif;color:#14151a;max-width:680px;margin:auto;padding:24px"><h2 style="margin:0">${esc(company)}</h2><p style="color:#666;margin:4px 0 20px">Purchase order <b>${esc(d.number)}</b> · ${new Date().toLocaleDateString('en-GB')}</p><p>Dear ${esc(vendor)},</p><p>Please supply the following${d.needed_by?` by <b>${esc(d.needed_by)}</b>`:''}${d.location?`, delivered to <b>${esc(d.location)}</b>`:''}.</p><table style="width:100%;border-collapse:collapse;font-size:14px"><tr style="background:#f3f3ef"><th align="left" style="padding:8px">#</th><th align="left" style="padding:8px">Description</th><th align="right" style="padding:8px">Qty</th><th align="right" style="padding:8px">Unit price</th><th align="right" style="padding:8px">Amount</th></tr>${lines.map(l=>`<tr style="border-bottom:1px solid #eee"><td style="padding:8px">${l.line_no}</td><td style="padding:8px">${esc(l.description)}</td><td align="right" style="padding:8px">${l.qty} ${esc(l.unit)}</td><td align="right" style="padding:8px">${money(l.unit_price)}</td><td align="right" style="padding:8px">${money(l.qty*l.unit_price)}</td></tr>`).join('')}<tr><td colspan="4" align="right" style="padding:8px">Tax</td><td align="right" style="padding:8px">${money(d.tax)}</td></tr><tr><td colspan="4" align="right" style="padding:8px"><b>Total</b></td><td align="right" style="padding:8px"><b>${money(d.total)}</b></td></tr></table>${d.terms?`<p style="color:#555;white-space:pre-line;margin-top:18px"><b>Terms</b><br>${esc(d.terms)}</p>`:''}<p style="color:#999;font-size:12px;margin-top:24px">Please quote ${esc(d.number)} on your delivery note and invoice. Reply to this email with any questions.</p></div>`;
}
