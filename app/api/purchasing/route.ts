import {hasAction,canActOn} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,num,oneOf,idOf,date,auditStatement,nextNumber,tenantOf,tenantSettings} from '../../server/core';
import {canSeeDoc,isApprover,docPage,type PurchaseRow} from '../../server/entities';
import {startApproval,decide,validSteps,workflowFor,type Doc} from '../../server/approvals';
import {notify,sendEmail,emailReady,escapeHtml as esc} from '../../server/notify';
import {moveStatements} from '../../server/stock';
import {newAssetCode} from '../../server/entities';
import type {Member} from '../../server/policy';

type Line={inventory_item_id:string|null,returned_qty:number,id:string,doc_id:string,line_no:number,description:string,item_code:string,qty:number,unit:string,unit_price:number,tax_rate:number,received_qty:number};
const docSelect="SELECT d.*,(SELECT group_concat(j.value) FROM approvals a, json_each(a.approver_ids) j WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id AND a.status IN ('Pending','Approved','Waiting')) AS approver_ids,(SELECT a.step_name FROM approvals a WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id AND a.status='Pending') AS pending_step,(SELECT a.approver_ids FROM approvals a WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id AND a.status='Pending') AS pending_ids FROM purchase_docs d";
async function load(u:Member,id:string){const d=await first<PurchaseRow&{pending_ids:string|null,pending_step:string|null}>(`${docSelect} WHERE d.id=? AND d.tenant_id=?`,id,u.tenantId);if(!d||!canSeeDoc(u,d))throw new HttpError(404,'Document not found.');return d}
const asDoc=(d:PurchaseRow):Doc=>({id:d.id,kind:d.kind,number:d.number,title:d.title,department:d.department,total:d.total,currency:d.currency,requester_id:d.requester_id});
function validLines(v:unknown){
 if(!Array.isArray(v)||!v.length||v.length>100)throw new HttpError(400,'Add between 1 and 100 line items.');
 return v.map((x,i)=>{const l=x as Record<string,unknown>;return {inventory_item_id:l.inventoryItemId?idOf(l.inventoryItemId,`Line ${i+1} item`):null,description:str(l.description,`Line ${i+1} description`,300),item_code:str(l.itemCode,`Line ${i+1} item code`,60,false),qty:num(l.qty,`Line ${i+1} quantity`,0.0001,1e9),unit:str(l.unit||'ea',`Line ${i+1} unit`,20),unit_price:num(l.unitPrice??0,`Line ${i+1} unit price`,0,1e11),tax_rate:num(l.taxRate??0,`Line ${i+1} tax rate`,0,100)}});
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
  const [quotations,budget]=await Promise.all([all('SELECT q.*,v.name AS vendor_name FROM quotations q JOIN vendors v ON v.id=q.vendor_id AND v.tenant_id=q.tenant_id WHERE q.tenant_id=? AND q.doc_id=? ORDER BY q.amount',u.tenantId,d.id),d.budget_id?budgetUsage(u,d.budget_id):null]);
  const flow=['Draft','Rejected'].includes(d.status)?await workflowFor(u.tenantId,d.kind,d.department,d.total):null;
  return {doc:d,lines,approvals:approvals.map(a=>({...a,approverIds:JSON.parse(String(a.approverIds))})),comments,history,vendor,related,workflowPreview:flow,quotations,budget,canQuote:['Draft','Pending approval','Approved','Rejected'].includes(d.status)&&(d.requester_id===u.id||hasAction(u,'procurement','create')),...permissions(u,d),emailReady:emailReady()};
 }
 if(view==='vendors'){if(!hasAction(u,'suppliers')&&!hasAction(u,'procurement'))throw new HttpError(403,'Vendors are not available to your account.');return {vendors:await all('SELECT v.*,(SELECT count(*) FROM purchase_docs d WHERE d.vendor_id=v.id AND d.tenant_id=v.tenant_id) AS orders,(SELECT coalesce(sum(total),0) FROM purchase_docs d WHERE d.vendor_id=v.id AND d.tenant_id=v.tenant_id AND d.status NOT IN (\'Draft\',\'Cancelled\',\'Rejected\')) AS spend FROM vendors v WHERE v.tenant_id=? ORDER BY v.name',u.tenantId),canEdit:hasAction(u,'suppliers','create')}}
 if(view==='budgets'){if(!hasAction(u,'budgets'))throw new HttpError(403,'Budgets are not available to your account.');const rows=await all<{id:string}>('SELECT * FROM budgets WHERE tenant_id=? ORDER BY period_end DESC,name',u.tenantId);return {budgets:await Promise.all(rows.map(r=>budgetUsage(u,r.id))),canEdit:hasAction(u,'budgets','create')}}
 if(view==='workflows'){if(u.role!=='admin')throw new HttpError(403,'Only administrators manage approval workflows.');return {workflows:(await all<{steps_json:string}>('SELECT * FROM approval_workflows WHERE tenant_id=? ORDER BY doc_type,min_amount',u.tenantId)).map(w=>({...w,steps:JSON.parse(w.steps_json)}))}}
 const kind=url.searchParams.get('kind');
 const rows=await all<PurchaseRow&{pending_ids:string|null}>(`${docSelect} WHERE d.tenant_id=? ${kind?'AND d.kind=?':''} ORDER BY d.created_at DESC LIMIT 3000`,u.tenantId,...(kind?[kind]:[]));
 return {docs:rows.filter(d=>canSeeDoc(u,d)).map(d=>({...d,awaitingMe:d.status==='Pending approval'&&d.requester_id!==u.id&&!!d.pending_ids&&JSON.parse(d.pending_ids).includes(u.id),involved:isApprover(u,d)})),canCreatePR:hasAction(u,'requests','create'),canCreatePO:hasAction(u,'procurement','create')};
},{module:'purchasing'});

export const POST=route(async(req,u)=>{
 const b=await readBody(req,200000);const action=String(b.action||'');
 if(action==='save')return save(u,b,req);
 if(action==='vendor')return saveVendor(u,b);
 if(action==='budget')return saveBudget(u,b);
 if(action==='workflow'||action==='delete-workflow')return saveWorkflow(u,b,action);
 const d=await load(u,idOf(b.id,'Document'));const p=permissions(u,d);const link=`#/purchasing/${d.kind.toLowerCase()}/${d.id}`;
 switch(action){
  case 'submit':{if(!p.canSubmit)throw new HttpError(403,'Only the requester can submit a draft.');const lines=await first<{n:number}>('SELECT count(*) AS n FROM purchase_lines WHERE tenant_id=? AND doc_id=?',u.tenantId,d.id);if(!lines?.n)throw new HttpError(400,'Add at least one line item first.');await startApproval(u,asDoc(d),req);return {ok:true}}
  case 'decide':{const decision=oneOf(b.decision,['approve','reject'] as const,'decision');const status=await decide(u,asDoc(d),decision,str(b.comment,'Comment',1000,false),req);return {status}}
  case 'recall':{if(!p.canRecall)throw new HttpError(403,'Only the requester can recall this document.');await batch([stmt("UPDATE approvals SET status='Cancelled' WHERE tenant_id=? AND doc_id=? AND status IN ('Pending','Waiting')",u.tenantId,d.id),stmt("UPDATE purchase_docs SET status='Draft',updated_at=?,version=version+1 WHERE id=? AND tenant_id=?",now(),d.id,u.tenantId),auditStatement(u,`${d.kind} recalled to draft`,d.id,d.department,{status:d.status},{status:'Draft'})]);return {ok:true}}
  case 'cancel':{if(!p.canCancel)throw new HttpError(403,'You cannot cancel this document.');await batch([stmt("UPDATE approvals SET status='Cancelled' WHERE tenant_id=? AND doc_id=? AND status IN ('Pending','Waiting')",u.tenantId,d.id),stmt("UPDATE purchase_docs SET status='Cancelled',updated_at=?,version=version+1 WHERE id=? AND tenant_id=?",now(),d.id,u.tenantId),auditStatement(u,`${d.kind} cancelled`,d.id,d.department,{status:d.status},{status:'Cancelled',reason:str(b.comment,'Reason',500,false)})]);return {ok:true}}
  case 'convert':{
   if(!p.canConvert)throw new HttpError(403,'Converting requisitions requires purchase order access.');
   const selectedQuote=await first<{vendor_id:string}>('SELECT vendor_id FROM quotations WHERE tenant_id=? AND doc_id=? AND selected=1',u.tenantId,d.id);
   const vendorId=b.vendorId?idOf(b.vendorId,'Vendor'):selectedQuote?.vendor_id||null;if(vendorId&&!await first('SELECT id FROM vendors WHERE id=? AND tenant_id=?',vendorId,u.tenantId))throw new HttpError(400,'Vendor not found.');
   const lines=await all<Line>('SELECT * FROM purchase_lines WHERE tenant_id=? AND doc_id=? ORDER BY line_no',u.tenantId,d.id);
   const t=await tenantOf(u);const number=await nextNumber(u.tenantId,String(tenantSettings(t).poPrefix||'PO'));const id=uid(),ts=now();
   await batch([
    stmt('INSERT INTO purchase_docs(id,tenant_id,kind,number,title,justification,department,location,requester_id,vendor_id,pr_id,needed_by,currency,subtotal,tax,total,status,terms,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,'PO',number,d.title,d.justification,d.department,d.location,u.id,vendorId,d.id,d.needed_by,d.currency,d.subtotal,d.tax,d.total,'Draft',String(tenantSettings(t).poTerms||'Payment within 30 days of invoice. Deliver to the location stated above.'),u.id,ts,ts),
    ...lines.map(l=>stmt('INSERT INTO purchase_lines(id,tenant_id,doc_id,line_no,description,item_code,qty,unit,unit_price,tax_rate,inventory_item_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,id,l.line_no,l.description,l.item_code,l.qty,l.unit,l.unit_price,l.tax_rate,l.inventory_item_id)),
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
  // Goods receipt. Lines linked to an inventory item can be put into stock at a store; any line can
  // also create asset records (one per unit) for equipment that should be tracked individually.
  case 'receive':{
   if(!p.canReceive)throw new HttpError(403,'Receiving goods is not part of your role.');
   if(!Array.isArray(b.lines)||!b.lines.length)throw new HttpError(400,'Enter the quantities received.');
   const lines=await all<Line>('SELECT * FROM purchase_lines WHERE tenant_id=? AND doc_id=?',u.tenantId,d.id);
   const updates=(b.lines as Record<string,unknown>[]).map(x=>{const l=lines.find(y=>y.id===x.lineId);if(!l)throw new HttpError(400,'Unknown line.');const q=num(x.qty,'Received quantity',0,1e9);if(l.received_qty+q>l.qty+1e-9)throw new HttpError(400,`Line ${l.line_no}: receiving more than ordered.`);const assets=x.createAssets?Math.round(num(x.createAssets,'Assets to create',0,500)):0;if(assets>q)throw new HttpError(400,`Line ${l.line_no}: cannot create more assets than units received.`);return {l,q,assets,category:str(x.assetCategory,'Asset category',80,false),toStock:!!x.toStock&&!!l.inventory_item_id}}).filter(x=>x.q>0);
   if(!updates.length)throw new HttpError(400,'Enter at least one received quantity.');
   const store=str(b.store,'Receiving store',200,false)||d.location;
   if(updates.some(x=>x.toStock)&&!store)throw new HttpError(400,'Choose the store receiving the stock.');
   if(updates.some(x=>x.toStock)&&!hasAction(u,'inventory','update')&&!hasAction(u,'receipts','create'))throw new HttpError(403,'Updating stock needs inventory access.');
   if(updates.some(x=>x.assets)&&!hasAction(u,'assets','create'))throw new HttpError(403,'Creating assets needs the Create permission on assets.');
   const full=lines.every(l=>{const up=updates.find(x=>x.l.id===l.id);return l.received_qty+(up?.q||0)>=l.qty-1e-9});
   const grn=await nextNumber(u.tenantId,'GRN');
   const vendor=d.vendor_id?await first<{name:string}>('SELECT name FROM vendors WHERE id=? AND tenant_id=?',d.vendor_id,u.tenantId):null;
   const extra:D1PreparedStatement[]=[];const createdAssets:string[]=[];
   for(const x of updates){
    if(x.toStock)extra.push(...await moveStatements(u,{itemId:x.l.inventory_item_id!,type:'receipt',qty:x.q,to:store,reference:`${d.number} / ${grn}`,unitCost:x.l.unit_price}));
    for(let i=0;i<x.assets;i++){const id=uid(),code=await newAssetCode(u);createdAssets.push(code);extra.push(stmt("INSERT INTO assets(id,tenant_id,code,name,category,kind,status,condition,location,department,cost_centre,purchase_date,purchase_cost,vendor,notes,barcode,created_by,created_at,updated_at) VALUES(?,?,?,?,?,'Physical','In store','New',?,?,?,?,?,?,?,?,?,?,?)",id,u.tenantId,code,x.l.description.slice(0,160),x.category,d.location,d.department,(d as unknown as {cost_centre:string}).cost_centre||'',now().slice(0,10),x.l.unit_price,vendor?.name||'',`Received on ${d.number} (${grn}).`,code,u.id,now(),now()),auditStatement(u,`Asset created from ${d.number}`,id,d.department,null,{code,grn}))}
   }
   await batch([...updates.map(x=>stmt('UPDATE purchase_lines SET received_qty=received_qty+? WHERE id=? AND tenant_id=?',x.q,x.l.id,u.tenantId)),stmt('UPDATE purchase_docs SET status=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=?',full?'Received':'Partially received',now(),d.id,u.tenantId),...extra,auditStatement(u,`Goods received · ${grn}`,d.id,d.department,null,{grn,store,note:str(b.note,'Note',500,false),assets:createdAssets,lines:updates.map(x=>({line:x.l.line_no,description:x.l.description,qty:x.q,toStock:x.toStock}))})]);
   await notify(u,[d.requester_id,d.created_by],{kind:'purchasing',title:`${d.number}: goods ${full?'fully':'partly'} received (${grn})`,body:d.title,link},req);
   return {ok:true,grn,status:full?'Received':'Partially received',assets:createdAssets};
  }
  // Return to vendor: reduces received quantities and, for stock lines, takes the goods back out of the store.
  case 'return':{
   if(d.kind!=='PO'||!['Partially received','Received','Closed'].includes(d.status))throw new HttpError(409,'Only received goods can be returned.');
   if(!(hasAction(u,'receipts','create')||canActOn(u,'procurement','update',d.department,d.requester_id)))throw new HttpError(403,'Returning goods is not part of your role.');
   if(!Array.isArray(b.lines)||!b.lines.length)throw new HttpError(400,'Enter the quantities returned.');
   const reason=str(b.reason,'Reason',500);const store=str(b.store,'Store',200,false)||d.location;
   const lines=await all<Line>('SELECT * FROM purchase_lines WHERE tenant_id=? AND doc_id=?',u.tenantId,d.id);
   const ups=(b.lines as Record<string,unknown>[]).map(x=>{const l=lines.find(y=>y.id===x.lineId);if(!l)throw new HttpError(400,'Unknown line.');const q=num(x.qty,'Returned quantity',0,1e9);if(q>l.received_qty-l.returned_qty+1e-9)throw new HttpError(400,`Line ${l.line_no}: cannot return more than was received.`);return {l,q,fromStock:!!x.fromStock&&!!l.inventory_item_id}}).filter(x=>x.q>0);
   if(!ups.length)throw new HttpError(400,'Enter at least one returned quantity.');
   const rtn=await nextNumber(u.tenantId,'RTV');const s:D1PreparedStatement[]=[];
   for(const x of ups){s.push(stmt('UPDATE purchase_lines SET returned_qty=returned_qty+?,received_qty=received_qty-? WHERE id=? AND tenant_id=?',x.q,x.q,x.l.id,u.tenantId));if(x.fromStock)s.push(...await moveStatements(u,{itemId:x.l.inventory_item_id!,type:'issue',qty:x.q,from:store,reference:`${d.number} / ${rtn}`,note:`Returned to vendor: ${reason}`}))}
   await batch([...s,stmt("UPDATE purchase_docs SET status='Partially received',updated_at=?,version=version+1 WHERE id=? AND tenant_id=? AND status IN ('Received','Closed')",now(),d.id,u.tenantId),auditStatement(u,`Goods returned to vendor · ${rtn}`,d.id,d.department,null,{rtn,reason,lines:ups.map(x=>({line:x.l.line_no,qty:x.q}))})]);
   return {ok:true,rtn};
  }
  // Quotations collected against a requisition or order; one can be marked as selected.
  case 'quote':{
   if(!(d.requester_id===u.id||hasAction(u,'procurement','create')))throw new HttpError(403,'Adding quotations is not part of your role.');
   const vendorId=idOf(b.vendorId,'Vendor');if(!await first('SELECT id FROM vendors WHERE id=? AND tenant_id=?',vendorId,u.tenantId))throw new HttpError(400,'Vendor not found.');
   const fileId=b.fileId?idOf(b.fileId,'File'):null;if(fileId&&!await first('SELECT id FROM files WHERE id=? AND tenant_id=?',fileId,u.tenantId))throw new HttpError(400,'File not found.');
   const qid=uid();await batch([stmt('INSERT INTO quotations(id,tenant_id,doc_id,vendor_id,amount,currency,valid_until,notes,file_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',qid,u.tenantId,d.id,vendorId,num(b.amount,'Quoted amount',0,1e12),str(b.currency||d.currency,'Currency',8),date(b.validUntil,'Valid until'),str(b.notes,'Notes',1000,false),fileId,u.id,now()),auditStatement(u,'Quotation added',d.id,d.department,null,{vendorId,amount:b.amount})]);
   return {id:qid};
  }
  case 'quote-select':{
   if(!hasAction(u,'procurement','create')&&d.requester_id!==u.id)throw new HttpError(403,'Selecting quotations is not part of your role.');
   const q=await first<{id:string,vendor_id:string,amount:number}>('SELECT id,vendor_id,amount FROM quotations WHERE id=? AND tenant_id=? AND doc_id=?',idOf(b.quoteId,'Quotation'),u.tenantId,d.id);if(!q)throw new HttpError(404,'Quotation not found.');
   await batch([stmt('UPDATE quotations SET selected=CASE WHEN id=? THEN 1 ELSE 0 END WHERE tenant_id=? AND doc_id=?',q.id,u.tenantId,d.id),...(d.kind==='PO'&&['Draft','Rejected'].includes(d.status)?[stmt('UPDATE purchase_docs SET vendor_id=?,updated_at=? WHERE id=? AND tenant_id=?',q.vendor_id,now(),d.id,u.tenantId)]:[]),auditStatement(u,'Quotation selected',d.id,d.department,null,{quotation:q.id,amount:q.amount})]);
   return {ok:true};
  }
  case 'close':{if(!p.canClose)throw new HttpError(403,'You cannot close this order.');await batch([stmt("UPDATE purchase_docs SET status='Closed',updated_at=?,version=version+1 WHERE id=? AND tenant_id=?",now(),d.id,u.tenantId),auditStatement(u,'PO closed',d.id,d.department,{status:d.status},{status:'Closed'})]);return {ok:true}}
 }
 throw new HttpError(400,'Unknown action.');
},{module:'purchasing'});

async function save(u:Member,b:Record<string,unknown>,req:Request){
 const kind=oneOf(b.kind,['PR','PO'] as const,'document type');const page=docPage(kind);
 const lines=validLines(b.lines);const sum=totals(lines);
 const t=await tenantOf(u);
 const fields={title:str(b.title,'Title',200),justification:str(b.justification,'Justification',4000,false),department:str(b.department,'Department',160),location:str(b.location,'Delivery location',200,false),needed_by:date(b.neededBy,'Needed by'),currency:str(b.currency||t.currency,'Currency',8),terms:str(b.terms,'Terms',4000,false),vendor_id:b.vendorId?idOf(b.vendorId,'Vendor'):null,cost_centre:str(b.costCentre,'Cost centre',40,false),budget_id:b.budgetId?idOf(b.budgetId,'Budget'):null};
 if(fields.budget_id&&!await first('SELECT id FROM budgets WHERE id=? AND tenant_id=?',fields.budget_id,u.tenantId))throw new HttpError(400,'Budget not found.');
 for(const l of lines)if(l.inventory_item_id&&!await first('SELECT id FROM inventory_items WHERE id=? AND tenant_id=?',l.inventory_item_id,u.tenantId))throw new HttpError(400,'Inventory item not found.');
 if(fields.vendor_id&&!await first('SELECT id FROM vendors WHERE id=? AND tenant_id=?',fields.vendor_id,u.tenantId))throw new HttpError(400,'Vendor not found.');
 const ts=now();let id:string,number:string;
 if(b.id){
  const d=await load(u,idOf(b.id,'Document'));if(!permissions(u,d).canEdit)throw new HttpError(403,'Only drafts and rejected documents can be edited.');
  if(b.version!==undefined&&b.version!==d.version)throw new HttpError(409,'This document changed. Refresh and review the latest version.');
  id=d.id;number=d.number;
  await batch([stmt('UPDATE purchase_docs SET title=?,justification=?,department=?,location=?,needed_by=?,currency=?,terms=?,vendor_id=?,cost_centre=?,budget_id=?,subtotal=?,tax=?,total=?,status=\'Draft\',updated_at=?,version=version+1 WHERE id=? AND tenant_id=?',fields.title,fields.justification,fields.department,fields.location,fields.needed_by,fields.currency,fields.terms,fields.vendor_id,fields.cost_centre,fields.budget_id,sum.subtotal,sum.tax,sum.total,ts,id,u.tenantId),stmt('DELETE FROM purchase_lines WHERE tenant_id=? AND doc_id=?',u.tenantId,id),...lines.map((l,i)=>stmt('INSERT INTO purchase_lines(id,tenant_id,doc_id,line_no,description,item_code,qty,unit,unit_price,tax_rate,inventory_item_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,id,i+1,l.description,l.item_code,l.qty,l.unit,l.unit_price,l.tax_rate,l.inventory_item_id)),auditStatement(u,`${kind} edited`,id,fields.department,{total:d.total},{total:sum.total,lines:lines.length})]);
 }else{
  if(!hasAction(u,page,'create'))throw new HttpError(403,kind==='PR'?'Raising requisitions is not available to your account.':'Creating purchase orders is not available to your account.');
  if(!canActOn(u,page,'create',fields.department,u.id)&&!(kind==='PR'&&fields.department===u.department))throw new HttpError(403,'You cannot raise documents for this department.');
  id=uid();number=await nextNumber(u.tenantId,String(tenantSettings(t)[kind==='PR'?'prPrefix':'poPrefix']||kind));
  await batch([stmt('INSERT INTO purchase_docs(id,tenant_id,kind,number,title,justification,department,location,requester_id,vendor_id,needed_by,currency,subtotal,tax,total,status,terms,created_by,created_at,updated_at,cost_centre,budget_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,kind,number,fields.title,fields.justification,fields.department,fields.location,u.id,fields.vendor_id,fields.needed_by,fields.currency,sum.subtotal,sum.tax,sum.total,'Draft',fields.terms,u.id,ts,ts,fields.cost_centre,fields.budget_id),...lines.map((l,i)=>stmt('INSERT INTO purchase_lines(id,tenant_id,doc_id,line_no,description,item_code,qty,unit,unit_price,tax_rate,inventory_item_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,id,i+1,l.description,l.item_code,l.qty,l.unit,l.unit_price,l.tax_rate,l.inventory_item_id)),auditStatement(u,`${kind} drafted`,id,fields.department,null,{number,total:sum.total})]);
 }
 if(b.submit){const d=await load(u,id);await startApproval(u,asDoc(d),req)}
 return {id,number};
}

// Budget with committed (approved, not yet ordered requisitions) and spent (orders) amounts.
async function budgetUsage(u:Member,id:string){
 const b=await first<Record<string,unknown>&{id:string,amount:number}>('SELECT * FROM budgets WHERE id=? AND tenant_id=?',id,u.tenantId);
 if(!b)return null;
 const r=await first<{spent:number,committed:number}>("SELECT coalesce(sum(CASE WHEN kind='PO' AND status NOT IN ('Draft','Cancelled','Rejected') THEN total END),0) AS spent,coalesce(sum(CASE WHEN kind='PR' AND status IN ('Pending approval','Approved') THEN total END),0) AS committed FROM purchase_docs WHERE tenant_id=? AND budget_id=?",u.tenantId,id);
 return {...b,spent:r?.spent||0,committed:r?.committed||0,remaining:b.amount-(r?.spent||0)-(r?.committed||0)};
}
async function saveBudget(u:Member,b:Record<string,unknown>){
 if(!hasAction(u,'budgets',b.id?'update':'create'))throw new HttpError(403,'Managing budgets is not part of your role.');
 const v={name:str(b.name,'Budget name',120),department:str(b.department,'Department',160,false),cost_centre:str(b.costCentre,'Cost centre',40,false),period_start:date(b.periodStart,'Start date',true)!,period_end:date(b.periodEnd,'End date',true)!,amount:num(b.amount,'Amount',0,1e13),currency:str(b.currency||'GHS','Currency',8).toUpperCase(),status:oneOf(b.status||'Active',['Draft','Active','Closed'] as const,'status')};
 if(v.period_end<v.period_start)throw new HttpError(400,'The end date must be after the start date.');
 if(b.id){const id=idOf(b.id,'Budget');const r=await batch([stmt('UPDATE budgets SET name=?,department=?,cost_centre=?,period_start=?,period_end=?,amount=?,currency=?,status=? WHERE id=? AND tenant_id=?',v.name,v.department,v.cost_centre,v.period_start,v.period_end,v.amount,v.currency,v.status,id,u.tenantId),auditStatement(u,'Budget updated',id,v.department,null,v)]);if(!r[0].meta.changes)throw new HttpError(404,'Budget not found.');return {id}}
 const id=uid();await batch([stmt('INSERT INTO budgets(id,tenant_id,name,department,cost_centre,period_start,period_end,amount,currency,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,v.name,v.department,v.cost_centre,v.period_start,v.period_end,v.amount,v.currency,v.status,u.id,now()),auditStatement(u,'Budget created',id,v.department,null,v)]);return {id};
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
