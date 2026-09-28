import {hasAction,canActOn} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,num,oneOf,idOf,date,auditStatement,nextNumber,tenantOf,tenantSettings} from '../../server/core';
import {loadProject} from '../../server/collab';
import {canSeeDoc,isApprover,docPage,type PurchaseRow} from '../../server/entities';
import {startApproval,decide,validSteps,workflowFor,type Doc} from '../../server/approvals';
import {notify,sendEmail,emailReady,escapeHtml as esc} from '../../server/notify';
import {moveStatements} from '../../server/stock';
import {newAssetCode} from '../../server/entities';
import type {Member} from '../../server/policy';

type Line={inventory_item_id:string|null,returned_qty:number,id:string,doc_id:string,line_no:number,description:string,item_code:string,qty:number,unit:string,unit_price:number,tax_rate:number,received_qty:number};
const docSelect="SELECT d.*,(SELECT group_concat(j.value) FROM approvals a, json_each(a.approver_ids) j WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id AND a.status IN ('Pending','Approved','Waiting')) AS approver_ids,(SELECT a.step_name FROM approvals a WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id AND a.status='Pending') AS pending_step,(SELECT a.approver_ids FROM approvals a WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id AND a.status='Pending') AS pending_ids FROM purchase_docs d";
// Delegates covering a pending approver may open (and decide) the document while the delegation is active.
async function delegatedFor(u:Member,d:PurchaseRow&{pending_ids:string|null}){const pend=d.pending_ids?JSON.parse(d.pending_ids) as string[]:[];if(!pend.length||d.status!=='Pending approval'||d.requester_id===u.id)return false;const {actingFor}=await import('../../server/delegation');return (await actingFor(u,pend,d.kind==='PO'?'procurement':'purchasing',{itemType:'approval',amount:d.total,source:{type:d.kind,id:d.id}})).length>0}
async function load(u:Member,id:string){const d=await first<PurchaseRow&{pending_ids:string|null,pending_step:string|null,delegated?:boolean}>(`${docSelect} WHERE d.id=? AND d.tenant_id=?`,id,u.tenantId);if(!d)throw new HttpError(404,'Document not found.');if(!canSeeDoc(u,d)){if(!await delegatedFor(u,d))throw new HttpError(404,'Document not found.');d.delegated=true}else if(!d.pending_ids?.includes(u.id)&&await delegatedFor(u,d))d.delegated=true;return d}
const asDoc=(d:PurchaseRow):Doc=>({id:d.id,kind:d.kind,number:d.number,title:d.title,department:d.department,total:d.total,currency:d.currency,requester_id:d.requester_id});
function validLines(v:unknown){
 if(!Array.isArray(v)||!v.length||v.length>100)throw new HttpError(400,'Add between 1 and 100 line items.');
 return v.map((x,i)=>{const l=x as Record<string,unknown>;return {inventory_item_id:l.inventoryItemId?idOf(l.inventoryItemId,`Line ${i+1} item`):null,description:str(l.description,`Line ${i+1} description`,300),item_code:str(l.itemCode,`Line ${i+1} item code`,60,false),qty:num(l.qty,`Line ${i+1} quantity`,0.0001,1e9),unit:str(l.unit||'ea',`Line ${i+1} unit`,20),unit_price:num(l.unitPrice??0,`Line ${i+1} unit price`,0,1e11),tax_rate:num(l.taxRate??0,`Line ${i+1} tax rate`,0,100),line_kind:l.kind==='service'||l.lineKind==='service'?'service':'goods'}});
}
const totals=(lines:{qty:number,unit_price:number,tax_rate:number}[])=>{const subtotal=lines.reduce((s,l)=>s+l.qty*l.unit_price,0),tax=lines.reduce((s,l)=>s+l.qty*l.unit_price*l.tax_rate/100,0);const r=(n:number)=>Math.round(n*100)/100;return {subtotal:r(subtotal),tax:r(tax),total:r(subtotal+tax)}};
function permissions(u:Member,d:PurchaseRow&{pending_ids?:string|null}){
 const own=d.requester_id===u.id||d.created_by===u.id;const page=docPage(d.kind);
 const pending=d.pending_ids?JSON.parse(d.pending_ids) as string[]:[];
 return {
  canEdit:['Draft','Rejected'].includes(d.status)&&(own||canActOn(u,page,'update',d.department,d.requester_id)),
  canSubmit:['Draft','Rejected'].includes(d.status)&&own,
  canDecide:d.status==='Pending approval'&&d.requester_id!==u.id&&(pending.includes(u.id)||u.role==='admin'||!!(d as {delegated?:boolean}).delegated),
  isAssignedApprover:pending.includes(u.id),
  canRecall:d.status==='Pending approval'&&own,
  canCancel:['Draft','Rejected','Approved'].includes(d.status)&&(own||u.role==='admin')&&!(d.kind==='PO'&&d.status==='Issued'),
  canConvert:d.kind==='PR'&&['Approved','Partially converted'].includes(d.status)&&hasAction(u,'procurement','create'),
  canChange:d.kind==='PO'&&['Approved','Issued','Partially received'].includes(d.status)&&canActOn(u,'procurement','update',d.department,d.requester_id),
  canInvoice:d.kind==='PO'&&['Issued','Partially received','Received','Closed'].includes(d.status)&&(canActOn(u,'procurement','update',d.department,d.requester_id)||hasAction(u,'budgets','update')),
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
  const [invoices,changeOrders,receipts,orders]=await Promise.all([all('SELECT id,number,vendor_invoice_no AS vendorInvoiceNo,amount,tax,currency,invoice_date AS invoiceDate,due_date AS dueDate,status,match_json AS matchJson,paid_amount AS paidAmount,paid_at AS paidAt,file_id AS fileId,created_at AS createdAt FROM purchase_invoices WHERE tenant_id=? AND po_id=? ORDER BY created_at',u.tenantId,d.id),all('SELECT id,number,reason,delta,status,created_by AS createdBy,created_at AS createdAt FROM purchase_change_orders WHERE tenant_id=? AND po_id=? ORDER BY created_at',u.tenantId,d.id),all('SELECT id,number,kind,lines_json AS linesJson,acceptance_json AS acceptanceJson,received_by AS receivedBy,created_at AS createdAt FROM goods_receipts WHERE tenant_id=? AND po_id=? ORDER BY created_at',u.tenantId,d.id),d.kind==='PR'?all('SELECT id,number,status,total,vendor_id AS vendorId FROM purchase_docs WHERE tenant_id=? AND pr_id=? ORDER BY created_at',u.tenantId,d.id):Promise.resolve([])]);
  return {invoices,changeOrders,receipts,orders,doc:d,lines,approvals:approvals.map(a=>({...a,approverIds:JSON.parse(String(a.approverIds))})),comments,history,vendor,related,workflowPreview:flow,quotations,budget,canQuote:['Draft','Pending approval','Approved','Rejected'].includes(d.status)&&(d.requester_id===u.id||hasAction(u,'procurement','create')),...permissions(u,d),emailReady:emailReady()};
 }
 if(view==='vendors'){if(!hasAction(u,'suppliers')&&!hasAction(u,'procurement'))throw new HttpError(403,'Vendors are not available to your account.');return {vendors:await all('SELECT v.*,(SELECT count(*) FROM purchase_docs d WHERE d.vendor_id=v.id AND d.tenant_id=v.tenant_id) AS orders,(SELECT coalesce(sum(total),0) FROM purchase_docs d WHERE d.vendor_id=v.id AND d.tenant_id=v.tenant_id AND d.status NOT IN (\'Draft\',\'Cancelled\',\'Rejected\')) AS spend FROM vendors v WHERE v.tenant_id=? ORDER BY v.name',u.tenantId),canEdit:hasAction(u,'suppliers','create')}}
 if(view==='budgets'){if(!hasAction(u,'budgets'))throw new HttpError(403,'Budgets are not available to your account.');const rows=await all<{id:string}>('SELECT * FROM budgets WHERE tenant_id=? ORDER BY period_end DESC,name',u.tenantId);return {budgets:await Promise.all(rows.map(r=>budgetUsage(u,r.id))),canEdit:hasAction(u,'budgets','create')}}
 if(view==='workflows'){if(u.role!=='admin')throw new HttpError(403,'Only administrators manage approval workflows.');return {workflows:(await all<{steps_json:string}>('SELECT * FROM approval_workflows WHERE tenant_id=? ORDER BY doc_type,min_amount',u.tenantId)).map(w=>({...w,steps:JSON.parse(w.steps_json)}))}}
 const kind=url.searchParams.get('kind');
 const rows=await all<PurchaseRow&{pending_ids:string|null}>(`${docSelect} WHERE d.tenant_id=? ${kind?'AND d.kind=?':''} ORDER BY d.created_at DESC LIMIT 3000`,u.tenantId,...(kind?[kind]:[]));
 return {docs:rows.filter(d=>canSeeDoc(u,d)).map(d=>({...d,awaitingMe:d.status==='Pending approval'&&d.requester_id!==u.id&&!!d.pending_ids&&JSON.parse(d.pending_ids).includes(u.id),involved:isApprover(u,d)})),canCreatePR:hasAction(u,'requests','create'),canCreatePO:hasAction(u,'procurement','create')};
},{module:'purchasing'});

export const POST=route(async(req,u)=>{
 const b=await readBody(req,200000);const out=await postAction(req,u,b) as Record<string,unknown>|undefined;
 // Financial ledger: the changed documents (and budgets) are reconciled into immutable events.
 const fin=await import('../../server/finance');const action=String(b.action||'');
 if(action==='budget'&&out?.id)await fin.reconcileBudget(u.tenantId,String(out.id),u.id,'Budget saved');
 else{for(const id of new Set([b.id,out?.id].filter((x):x is string=>typeof x==='string')))await fin.reconcileDoc(u.tenantId,id,u.id,`Purchasing: ${action}`)}
 return out;
},{module:'purchasing'});
async function postAction(req:Request,u:Member,b:Record<string,unknown>){const action=String(b.action||'');
 if(action==='save')return save(u,b,req);
 if(action==='vendor')return saveVendor(u,b);
 if(action==='budget')return saveBudget(u,b);
 if(action==='workflow'||action==='delete-workflow')return saveWorkflow(u,b,action);
 const d=await load(u,idOf(b.id,'Document'));const p=permissions(u,d);const link=`#/purchasing/${d.kind.toLowerCase()}/${d.id}`;
 switch(action){
  case 'submit':{if(!p.canSubmit)throw new HttpError(403,'Only the requester can submit a draft.');const lines=await first<{n:number}>('SELECT count(*) AS n FROM purchase_lines WHERE tenant_id=? AND doc_id=?',u.tenantId,d.id);if(!lines?.n)throw new HttpError(400,'Add at least one line item first.');await startApproval(u,asDoc(d),req);return {ok:true}}
  case 'decide':{const decision=oneOf(b.decision,['approve','reject'] as const,'decision');const status=await decide(u,asDoc(d),decision,str(b.comment,'Comment',1000,false),req);return {status}}
  case 'recall':{if(!p.canRecall)throw new HttpError(403,'Only the requester can recall this document.');await batch([stmt("UPDATE approvals SET status='Cancelled' WHERE tenant_id=? AND doc_id=? AND status IN ('Pending','Waiting')",u.tenantId,d.id),stmt("UPDATE purchase_docs SET status='Draft',updated_at=?,version=version+1 WHERE id=? AND tenant_id=?",now(),d.id,u.tenantId),auditStatement(u,`${d.kind} recalled to draft`,d.id,d.department,{status:d.status},{status:'Draft'})]);return {ok:true}}
  case 'cancel':{if(!p.canCancel)throw new HttpError(403,'You cannot cancel this document.');
   if(d.kind==='PO'&&d.pr_id){const own=await all<{pr_line_id:string|null,qty:number}>('SELECT pr_line_id,qty FROM purchase_lines WHERE tenant_id=? AND doc_id=?',u.tenantId,d.id);await batch([...own.filter(l=>l.pr_line_id).map(l=>stmt('UPDATE purchase_lines SET ordered_qty=max(0,ordered_qty-?) WHERE id=? AND tenant_id=?',l.qty,l.pr_line_id,u.tenantId)),stmt("UPDATE purchase_docs SET status=CASE WHEN (SELECT coalesce(sum(ordered_qty),0) FROM purchase_lines WHERE tenant_id=? AND doc_id=?)>0 THEN 'Partially converted' ELSE 'Approved' END,updated_at=?,version=version+1 WHERE id=? AND tenant_id=? AND status IN ('Converted','Partially converted')",u.tenantId,d.pr_id,now(),d.pr_id,u.tenantId)]);await (await import('../../server/finance')).reconcileDoc(u.tenantId,d.pr_id,u.id,'Order cancelled; quantities released')}await batch([stmt("UPDATE approvals SET status='Cancelled' WHERE tenant_id=? AND doc_id=? AND status IN ('Pending','Waiting')",u.tenantId,d.id),stmt("UPDATE purchase_docs SET status='Cancelled',updated_at=?,version=version+1 WHERE id=? AND tenant_id=?",now(),d.id,u.tenantId),auditStatement(u,`${d.kind} cancelled`,d.id,d.department,{status:d.status},{status:'Cancelled',reason:str(b.comment,'Reason',500,false)})]);return {ok:true}}
  case 'convert':{
   if(!p.canConvert)throw new HttpError(403,'Converting requisitions requires purchase order access.');
   const selectedQuote=await first<{vendor_id:string}>('SELECT vendor_id FROM quotations WHERE tenant_id=? AND doc_id=? AND selected=1',u.tenantId,d.id);
   const vendorId=b.vendorId?idOf(b.vendorId,'Vendor'):selectedQuote?.vendor_id||null;if(vendorId&&!await first('SELECT id FROM vendors WHERE id=? AND tenant_id=?',vendorId,u.tenantId))throw new HttpError(400,'Vendor not found.');
   const lines=await all<Line&{ordered_qty:number,line_kind:string}>('SELECT * FROM purchase_lines WHERE tenant_id=? AND doc_id=? ORDER BY line_no',u.tenantId,d.id);
   // Lines (and quantities) to order now; the rest stays open for further orders, possibly with other vendors.
   const pick=Array.isArray(b.lines)&&b.lines.length?(b.lines as Record<string,unknown>[]).map(x=>{const l=lines.find(y=>y.id===x.lineId);if(!l)throw new HttpError(400,'Unknown line.');const q=num(x.qty,'Quantity to order',0,1e9);if(q>l.qty-l.ordered_qty+1e-9)throw new HttpError(400,`Line ${l.line_no}: only ${l.qty-l.ordered_qty} left to order.`);return {l,q}}).filter(x=>x.q>0):lines.map(l=>({l,q:l.qty-l.ordered_qty})).filter(x=>x.q>1e-9);
   if(!pick.length)throw new HttpError(409,'Everything on this requisition has already been ordered.');
   const sum=totals(pick.map(x=>({qty:x.q,unit_price:x.l.unit_price,tax_rate:x.l.tax_rate})));
   const remaining=lines.some(l=>{const x=pick.find(y=>y.l.id===l.id);return l.qty-l.ordered_qty-(x?.q||0)>1e-9});
   const t=await tenantOf(u);const number=await nextNumber(u.tenantId,String(tenantSettings(t).poPrefix||'PO'),true,['purchase_docs','number']);const id=uid(),ts=now();
   await batch([
    stmt('INSERT INTO purchase_docs(id,tenant_id,kind,number,title,justification,department,location,requester_id,vendor_id,pr_id,needed_by,currency,subtotal,tax,total,status,terms,created_by,created_at,updated_at,project_id,budget_id,request_id,cost_centre) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,'PO',number,d.title,d.justification,d.department,d.location,u.id,vendorId,d.id,d.needed_by,d.currency,sum.subtotal,sum.tax,sum.total,'Draft',String(tenantSettings(t).poTerms||''),u.id,ts,ts,(d as unknown as {project_id:string|null}).project_id||null,(d as unknown as {budget_id:string|null}).budget_id||null,(d as unknown as {request_id:string|null}).request_id||null,(d as unknown as {cost_centre:string}).cost_centre||''),
    ...pick.map((x,i)=>stmt('INSERT INTO purchase_lines(id,tenant_id,doc_id,line_no,description,item_code,qty,unit,unit_price,tax_rate,inventory_item_id,pr_line_id,line_kind) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,id,i+1,x.l.description,x.l.item_code,x.q,x.l.unit,x.l.unit_price,x.l.tax_rate,x.l.inventory_item_id,x.l.id,x.l.line_kind||'goods')),
    ...pick.map(x=>stmt('UPDATE purchase_lines SET ordered_qty=ordered_qty+? WHERE id=? AND tenant_id=?',x.q,x.l.id,u.tenantId)),
    stmt("UPDATE purchase_docs SET status=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=? AND status IN ('Approved','Partially converted')",remaining?'Partially converted':'Converted',ts,d.id,u.tenantId),
    auditStatement(u,`${remaining?'Partly converted':'Converted'} to ${number}`,d.id,d.department,{status:d.status},{status:remaining?'Partially converted':'Converted',po:number,lines:pick.map(x=>({line:x.l.line_no,qty:x.q}))}),
    auditStatement(u,`Purchase order created from ${d.number}`,id,d.department,null,{number,pr:d.number,vendorId}),
   ]);
   await notify(u,[d.requester_id],{kind:'purchasing',title:`${d.number} → purchase order ${number}${remaining?' (partial)':''}`,body:d.title,link:`#/purchasing/po/${id}`},req);
   return {id,number,remaining};
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
   const updates=(b.lines as Record<string,unknown>[]).map(x=>{const l=lines.find(y=>y.id===x.lineId);if(!l)throw new HttpError(400,'Unknown line.');const q=num(x.qty,'Received quantity',0,1e9);if(l.received_qty+q>l.qty+1e-9)throw new HttpError(400,`Line ${l.line_no}: receiving more than ordered.`);const assets=x.createAssets?Math.round(num(x.createAssets,'Assets to create',0,500)):0;if(assets>q)throw new HttpError(400,`Line ${l.line_no}: cannot create more assets than units received.`);const details=Array.isArray(x.assetDetails)?(x.assetDetails as Record<string,unknown>[]).slice(0,500):[];const every=x.maintenanceEveryDays?Math.round(num(x.maintenanceEveryDays,'Maintenance interval (days)',1,3650)):0;return {l,q,assets,details,every,category:str(x.assetCategory,'Asset category',80,false),location:str(x.assetLocation,'Asset location',200,false),department:str(x.assetDepartment,'Asset department',160,false),custodian:x.custodianId?idOf(x.custodianId,'Custodian'):null,warranty:date(x.warrantyUntil,'Warranty until'),toStock:!!x.toStock&&!!l.inventory_item_id}}).filter(x=>x.q>0);
   if(!updates.length)throw new HttpError(400,'Enter at least one received quantity.');
   const store=str(b.store,'Receiving store',200,false)||d.location;
   if(updates.some(x=>x.toStock)&&!store)throw new HttpError(400,'Choose the store receiving the stock.');
   if(updates.some(x=>x.toStock)&&!hasAction(u,'inventory','update')&&!hasAction(u,'receipts','create'))throw new HttpError(403,'Updating stock needs inventory access.');
   if(updates.some(x=>x.assets)&&!hasAction(u,'assets','create'))throw new HttpError(403,'Creating assets needs the Create permission on assets.');
   const full=lines.every(l=>{const up=updates.find(x=>x.l.id===l.id);return l.received_qty+(up?.q||0)>=l.qty-1e-9});
   const grn=await nextNumber(u.tenantId,'GRN');
   const vendor=d.vendor_id?await first<{name:string}>('SELECT name FROM vendors WHERE id=? AND tenant_id=?',d.vendor_id,u.tenantId):null;
   const extra:D1PreparedStatement[]=[];const createdAssets:string[]=[];const createdAssetIds:string[]=[];
   // Receipt and warranty documents attached to the receipt are linked to every asset it creates.
   const fileIds=Array.isArray(b.fileIds)?(b.fileIds as unknown[]).map(x=>idOf(x,'File')).slice(0,20):[];for(const fid of fileIds)if(!await first('SELECT id FROM files WHERE id=? AND tenant_id=?',fid,u.tenantId))throw new HttpError(400,'File not found.');
   // Service receipts record acceptance against the agreed criteria.
   const service=b.service===true||updates.every(x=>(x.l as unknown as {line_kind?:string}).line_kind==='service');const acceptance=service?{criteriaMet:b.criteriaMet!==false,rating:b.rating?Math.round(num(b.rating,'Rating',1,5)):null,notes:str(b.acceptanceNotes,'Acceptance notes',2000,false),evidence:fileIds,acceptedBy:u.id,acceptedAt:now()}:{};
   for(const x of updates){
    if(x.toStock)extra.push(...await moveStatements(u,{itemId:x.l.inventory_item_id!,type:'receipt',qty:x.q,to:store,reference:`${d.number} / ${grn}`,unitCost:x.l.unit_price}));
    for(let i=0;i<x.assets;i++){const id=uid(),code=await newAssetCode(u);createdAssets.push(code);createdAssetIds.push(id);
     // Per-unit details (serial number, asset tag, location, department, custodian, warranty) override line defaults.
     const det=x.details[i]||{};const serial=str(det.serial,'Serial number',120,false);const tag=str(det.tag,'Asset tag',120,false)||code;const loc=str(det.location,'Location',200,false)||x.location||store||d.location;const dept=str(det.department,'Department',160,false)||x.department||d.department;
     const custodian=det.custodianId?idOf(det.custodianId,'Custodian'):x.custodian;if(custodian&&!await first('SELECT id FROM members WHERE id=? AND tenant_id=? AND active=1',custodian,u.tenantId))throw new HttpError(400,'The custodian must be an active person.');
     const warranty=date(det.warrantyUntil,'Warranty until')||x.warranty;const cat=str(det.category,'Category',80,false)||x.category;
     extra.push(stmt("INSERT INTO assets(id,tenant_id,code,name,category,kind,status,condition,location,department,cost_centre,purchase_date,purchase_cost,vendor,notes,barcode,serial,assigned_to,warranty_until,created_by,created_at,updated_at,project_id,purchase_doc_id) VALUES(?,?,?,?,?,'Physical',?,'New',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",id,u.tenantId,code,x.l.description.slice(0,160),cat,custodian?'In use':'In store',loc,dept,(d as unknown as {cost_centre:string}).cost_centre||'',now().slice(0,10),x.l.unit_price*(1+x.l.tax_rate/100),vendor?.name||'',`Received on ${d.number} (${grn}).`,tag,serial,custodian,warranty,u.id,now(),now(),(d as unknown as {project_id:string|null}).project_id||null,d.id),auditStatement(u,`Asset created from ${d.number}`,id,dept,null,{code,grn,serial,tag,custodian,warranty}));
     if(x.every)extra.push(stmt("INSERT INTO maintenance_plans(id,tenant_id,asset_id,title,description,interval_value,interval_unit,next_due,assignee_id,department,checklist,estimated_cost,active,created_by,created_at) VALUES(?,?,?,?,?,?,'days',?,NULL,?,'[]',0,1,?,?)",uid(),u.tenantId,id,`Preventive maintenance: ${x.l.description.slice(0,80)}`,`Scheduled at receipt ${grn}`,x.every,new Date(Date.now()+x.every*86400000).toISOString().slice(0,10),dept,u.id,now()));
     for(const fid of fileIds)extra.push(stmt('INSERT OR IGNORE INTO file_links(id,tenant_id,file_id,entity_type,entity_id,created_by,created_at) VALUES(?,?,?,?,?,?,?)',uid(),u.tenantId,fid,'asset',id,u.id,now()));
    }
   }
   await batch([...updates.map(x=>stmt('UPDATE purchase_lines SET received_qty=received_qty+? WHERE id=? AND tenant_id=?',x.q,x.l.id,u.tenantId)),stmt('UPDATE purchase_docs SET status=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=?',full?'Received':'Partially received',now(),d.id,u.tenantId),...extra,
    // A goods receipt record (for the Work Graph and receipt history): PO → receipt → assets.
    stmt('INSERT INTO goods_receipts(id,tenant_id,po_id,number,lines_json,received_by,created_at,kind,acceptance_json,store_location) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,d.id,grn,JSON.stringify(updates.map(x=>({lineId:x.l.id,description:x.l.description,qty:x.q,value:Math.round(x.q*x.l.unit_price*(1+x.l.tax_rate/100)*100)/100}))),u.id,now(),service?'service':'goods',JSON.stringify(acceptance),store||''),auditStatement(u,`Goods received · ${grn}`,d.id,d.department,null,{grn,store,note:str(b.note,'Note',500,false),assets:createdAssets,lines:updates.map(x=>({line:x.l.line_no,description:x.l.description,qty:x.q,toStock:x.toStock}))})]);
   await notify(u,[d.requester_id,d.created_by],{kind:'purchasing',title:`${d.number}: goods ${full?'fully':'partly'} received (${grn})`,body:d.title,link},req);
   for(const fid of fileIds)await stmt('INSERT OR IGNORE INTO file_links(id,tenant_id,file_id,entity_type,entity_id,created_by,created_at) VALUES(?,?,?,?,?,?,?)',uid(),u.tenantId,fid,'PO',d.id,u.id,now()).run();
   return {ok:true,grn,status:full?'Received':'Partially received',assets:createdAssets,assetIds:createdAssetIds,service};
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
  // Change order on an approved/issued order: quantities and prices change with a reason; increases need re-approval.
  case 'change-order':{
   if(!p.canChange)throw new HttpError(403,'Changing this order needs purchase order update access.');
   if(b.version!==undefined&&Number(b.version)!==d.version)throw new HttpError(409,'This order changed. Refresh and review the latest version.');
   const reason=str(b.reason,'Reason for the change',1000);const lines=await all<Line>('SELECT * FROM purchase_lines WHERE tenant_id=? AND doc_id=? ORDER BY line_no',u.tenantId,d.id);
   const changes=(Array.isArray(b.lines)?b.lines:[]) as Record<string,unknown>[];if(!changes.length)throw new HttpError(400,'Change at least one line.');
   const next=lines.map(l=>{const c=changes.find(x=>x.lineId===l.id);if(!c)return {...l};const qty=c.qty!==undefined?num(c.qty,`Line ${l.line_no} quantity`,0,1e9):l.qty;const price=c.unitPrice!==undefined?num(c.unitPrice,`Line ${l.line_no} price`,0,1e12):l.unit_price;if(qty+1e-9<l.received_qty)throw new HttpError(400,`Line ${l.line_no}: ${l.received_qty} already received.`);return {...l,qty,unit_price:price}});
   const before=totals(lines),after=totals(next);const delta=Math.round((after.total-before.total)*100)/100;
   const co=await nextNumber(u.tenantId,'CO');
   await batch([...next.map(l=>stmt('UPDATE purchase_lines SET qty=?,unit_price=? WHERE id=? AND tenant_id=?',l.qty,l.unit_price,l.id,u.tenantId)),
    stmt('UPDATE purchase_docs SET subtotal=?,tax=?,total=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=?',after.subtotal,after.tax,after.total,now(),d.id,u.tenantId),
    stmt('INSERT INTO purchase_change_orders(id,tenant_id,po_id,number,reason,before_json,after_json,delta,status,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,d.id,co,reason,JSON.stringify(lines.map(l=>({id:l.id,qty:l.qty,price:l.unit_price}))),JSON.stringify(next.map(l=>({id:l.id,qty:l.qty,price:l.unit_price}))),delta,delta>0?'Pending approval':'Applied',u.id,now()),
    auditStatement(u,`Change order ${co}`,d.id,d.department,{total:before.total},{total:after.total,delta,reason})]);
   // Increases go back through the approval chain before the order can proceed.
   if(delta>0){const fresh=await load(u,d.id);await startApproval(u,asDoc(fresh),req)}
   return {ok:true,number:co,delta,reapproval:delta>0};
  }
  case 'invoice':{
   if(!p.canInvoice)throw new HttpError(403,'Recording invoices needs procurement or budget access.');
   const amount=num(b.amount,'Invoice amount',0,1e13),tax=b.tax!==undefined&&b.tax!==''?num(b.tax,'Tax',0,1e13):0;const currency=str(b.currency||d.currency,'Currency',8).toUpperCase();
   const lines=await all<Line>('SELECT * FROM purchase_lines WHERE tenant_id=? AND doc_id=?',u.tenantId,d.id);const received=Math.round(lines.reduce((n,l)=>n+l.received_qty*l.unit_price*(1+l.tax_rate/100),0)*100)/100;
   const prior=await first<{n:number}>("SELECT coalesce(sum(amount+tax),0) AS n FROM purchase_invoices WHERE tenant_id=? AND po_id=? AND status<>'Cancelled'",u.tenantId,d.id);const invoiced=Math.round(((prior?.n||0)+amount+tax)*100)/100;
   const tol=Number(tenantSettings(await tenantOf(u)).invoiceTolerancePct??2)/100;const reasons:string[]=[];
   if(currency!==d.currency)reasons.push(`Currency ${currency} differs from the order (${d.currency}).`);
   if(invoiced>d.total*(1+tol)+0.005)reasons.push(`Invoiced ${invoiced.toLocaleString()} exceeds the order total ${d.total.toLocaleString()}.`);
   if(invoiced>received*(1+tol)+0.005)reasons.push(`Invoiced ${invoiced.toLocaleString()} exceeds the value received ${received.toLocaleString()}.`);
   const status=reasons.length?'Exception':'Matched';const id=uid();const number=await nextNumber(u.tenantId,'INV');
   const fileId=b.fileId?idOf(b.fileId,'File'):null;if(fileId&&!await first('SELECT id FROM files WHERE id=? AND tenant_id=?',fileId,u.tenantId))throw new HttpError(400,'File not found.');
   await batch([stmt('INSERT INTO purchase_invoices(id,tenant_id,po_id,number,vendor_invoice_no,amount,tax,currency,invoice_date,due_date,status,match_json,file_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,d.id,number,str(b.vendorInvoiceNo,'Vendor invoice number',80),amount,tax,currency,date(b.invoiceDate,'Invoice date',true),date(b.dueDate,'Due date'),status,JSON.stringify({ordered:d.total,received,invoiced,tolerancePct:tol*100,reasons}),fileId,u.id,now()),
    auditStatement(u,`Invoice ${number} recorded (${status})`,d.id,d.department,null,{amount,tax,status,reasons}),(await import('../../server/inbox')).inboxEventStatement(u.tenantId,'invoice',id)]);
   return {id,number,status,match:{ordered:d.total,received,invoiced,reasons}};
  }
  case 'invoice-approve':case 'pay':{
   const inv=await first<{id:string,number:string,amount:number,tax:number,paid_amount:number,status:string}>('SELECT * FROM purchase_invoices WHERE id=? AND tenant_id=? AND po_id=?',idOf(b.invoiceId,'Invoice'),u.tenantId,d.id);if(!inv)throw new HttpError(404,'Invoice not found.');
   if(action==='invoice-approve'){if(inv.status!=='Exception')throw new HttpError(409,'Only exceptions need approval.');if(u.role!=='admin'&&!hasAction(u,'budgets','approve')&&!hasAction(u,'procurement','approve'))throw new HttpError(403,'Approving invoice exceptions needs approval rights.');await batch([stmt("UPDATE purchase_invoices SET status='Approved' WHERE id=?",inv.id),auditStatement(u,`Invoice ${inv.number} exception approved`,d.id,d.department,{status:inv.status},{status:'Approved',reason:str(b.reason,'Reason',500)}),(await import('../../server/inbox')).inboxEventStatement(u.tenantId,'invoice',inv.id)]);return {ok:true}}
   if(!['Matched','Approved','Partially paid'].includes(inv.status))throw new HttpError(409,'Only matched or approved invoices can be paid.');if(!p.canInvoice)throw new HttpError(403,'Recording payments needs procurement or budget access.');
   const amt=num(b.amount,'Payment amount',0.01,1e13);const total=inv.amount+inv.tax;if(inv.paid_amount+amt>total+0.005)throw new HttpError(400,'The payment exceeds the invoice balance.');
   const paid=Math.round((inv.paid_amount+amt)*100)/100;const st=paid>=total-0.005?'Paid':'Partially paid';
   await batch([stmt('UPDATE purchase_invoices SET paid_amount=?,paid_at=?,status=? WHERE id=?',paid,date(b.paidAt,'Payment date')||now().slice(0,10),st,inv.id),auditStatement(u,`Payment recorded on ${inv.number}`,d.id,d.department,{paid:inv.paid_amount},{paid,status:st,reference:str(b.reference,'Reference',120,false)})]);
   return {ok:true,status:st,paid};
  }
  case 'close':{if(!p.canClose)throw new HttpError(403,'You cannot close this order.');await batch([stmt("UPDATE purchase_docs SET status='Closed',updated_at=?,version=version+1 WHERE id=? AND tenant_id=?",now(),d.id,u.tenantId),auditStatement(u,'PO closed',d.id,d.department,{status:d.status},{status:'Closed'})]);return {ok:true}}
 }
 throw new HttpError(400,'Unknown action.');
}

async function save(u:Member,b:Record<string,unknown>,req:Request){
 const kind=oneOf(b.kind,['PR','PO'] as const,'document type');const page=docPage(kind);
 const lines=validLines(b.lines);const sum=totals(lines);
 const t=await tenantOf(u);
 const fields={title:str(b.title,'Title',200),justification:str(b.justification,'Justification',4000,false),department:str(b.department,'Department',160),location:str(b.location,'Delivery location',200,false),needed_by:date(b.neededBy,'Needed by'),currency:str(b.currency||t.currency,'Currency',8),terms:str(b.terms,'Terms',4000,false),vendor_id:b.vendorId?idOf(b.vendorId,'Vendor'):null,cost_centre:str(b.costCentre,'Cost centre',40,false),budget_id:b.budgetId?idOf(b.budgetId,'Budget'):null};
 if(fields.budget_id&&!await first('SELECT id FROM budgets WHERE id=? AND tenant_id=?',fields.budget_id,u.tenantId))throw new HttpError(400,'Budget not found.');
 for(const l of lines)if(l.inventory_item_id&&!await first('SELECT id FROM inventory_items WHERE id=? AND tenant_id=?',l.inventory_item_id,u.tenantId))throw new HttpError(400,'Inventory item not found.');
 if(fields.vendor_id&&!await first('SELECT id FROM vendors WHERE id=? AND tenant_id=?',fields.vendor_id,u.tenantId))throw new HttpError(400,'Vendor not found.');
 const projectId=b.projectId?(await loadProject(u,idOf(b.projectId,'Project'))).id:null;
 const requestId=b.requestId?idOf(b.requestId,'Request'):null;if(requestId&&!await first('SELECT id FROM business_requests WHERE id=? AND tenant_id=?',requestId,u.tenantId))throw new HttpError(400,'Business request not found.');
 const ts=now();let id:string,number:string;
 if(b.id){
  const d=await load(u,idOf(b.id,'Document'));if(!permissions(u,d).canEdit)throw new HttpError(403,'Only drafts and rejected documents can be edited.');
  if(b.version!==undefined&&b.version!==d.version)throw new HttpError(409,'This document changed. Refresh and review the latest version.');
  id=d.id;number=d.number;
  await batch([stmt('UPDATE purchase_docs SET title=?,justification=?,department=?,location=?,needed_by=?,currency=?,terms=?,vendor_id=?,cost_centre=?,budget_id=?,subtotal=?,tax=?,total=?,status=\'Draft\',updated_at=?,version=version+1,project_id=coalesce(?,project_id),request_id=coalesce(?,request_id) WHERE id=? AND tenant_id=?',fields.title,fields.justification,fields.department,fields.location,fields.needed_by,fields.currency,fields.terms,fields.vendor_id,fields.cost_centre,fields.budget_id,sum.subtotal,sum.tax,sum.total,ts,projectId,requestId,id,u.tenantId),stmt('DELETE FROM purchase_lines WHERE tenant_id=? AND doc_id=?',u.tenantId,id),...lines.map((l,i)=>stmt('INSERT INTO purchase_lines(id,tenant_id,doc_id,line_no,description,item_code,qty,unit,unit_price,tax_rate,inventory_item_id,line_kind) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,id,i+1,l.description,l.item_code,l.qty,l.unit,l.unit_price,l.tax_rate,l.inventory_item_id,l.line_kind)),auditStatement(u,`${kind} edited`,id,fields.department,{total:d.total},{total:sum.total,lines:lines.length})]);
 }else{
  if(!hasAction(u,page,'create'))throw new HttpError(403,kind==='PR'?'Raising requisitions is not available to your account.':'Creating purchase orders is not available to your account.');
  if(!canActOn(u,page,'create',fields.department,u.id)&&!(kind==='PR'&&fields.department===u.department))throw new HttpError(403,'You cannot raise documents for this department.');
  id=uid();number=await nextNumber(u.tenantId,String(tenantSettings(t)[kind==='PR'?'prPrefix':'poPrefix']||kind),true,['purchase_docs','number']);
  await batch([stmt('INSERT INTO purchase_docs(id,tenant_id,kind,number,title,justification,department,location,requester_id,vendor_id,needed_by,currency,subtotal,tax,total,status,terms,created_by,created_at,updated_at,cost_centre,budget_id,project_id,request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,kind,number,fields.title,fields.justification,fields.department,fields.location,u.id,fields.vendor_id,fields.needed_by,fields.currency,sum.subtotal,sum.tax,sum.total,'Draft',fields.terms,u.id,ts,ts,fields.cost_centre,fields.budget_id,projectId,requestId),...lines.map((l,i)=>stmt('INSERT INTO purchase_lines(id,tenant_id,doc_id,line_no,description,item_code,qty,unit,unit_price,tax_rate,inventory_item_id,line_kind) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,id,i+1,l.description,l.item_code,l.qty,l.unit,l.unit_price,l.tax_rate,l.inventory_item_id,l.line_kind)),auditStatement(u,`${kind} drafted`,id,fields.department,null,{number,total:sum.total})]);
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
