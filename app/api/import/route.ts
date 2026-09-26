import {route,readBody,HttpError,all,stmt,batch,uid,now,auditStatement} from '../../server/core';
import type {SourceRow} from '../../server/source-records';
// Promotes the read-only snapshots imported from earlier systems (asset register, tickets,
// requisitions, purchase orders, locations) into live One Workspace records.
// Safe to repeat: each live record remembers its source row and is created only once.
type P=Record<string,unknown>;
const pick=(p:P,...keys:string[])=>{for(const k of keys){const v=p[k];if(v!==null&&v!==undefined&&String(v).trim())return String(v).trim()}return ''};
const amount=(v:string)=>{const n=Number(v.replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:0};
// Accepts ISO dates and the dd/mm/yyyy exports common in Ghana.
function isoDate(v:string){if(!v)return null;const m=v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);if(m)return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;const d=Date.parse(v);return Number.isFinite(d)?new Date(d).toISOString().slice(0,10):null}
const assetStatus=(s:string)=>/maint|repair|service/i.test(s)?'Maintenance':/retir|dispos|scrap|write/i.test(s)?'Retired':/lost|stolen|missing/i.test(s)?'Lost':/store|avail|stock|unassign/i.test(s)?'In store':'In use';
const ticketStatus=(s:string)=>/close/i.test(s)?'Closed':/resolv|complet|done/i.test(s)?'Resolved':/progress|work/i.test(s)?'In progress':/hold|wait|pend/i.test(s)?'On hold':/open|assign/i.test(s)?'Open':'New';
const priority=(s:string)=>/urgent|critical|p1/i.test(s)?'Urgent':/high|p2/i.test(s)?'High':/low|p4/i.test(s)?'Low':'Medium';
const docStatus=(s:string,kind:string)=>/cancel/i.test(s)?'Cancelled':/reject/i.test(s)?'Rejected':/close/i.test(s)?(kind==='PO'?'Closed':'Converted'):/receiv/i.test(s)?(kind==='PO'?'Received':'Converted'):/approv/i.test(s)?'Approved':/draft/i.test(s)?'Draft':/issue|sent|release/i.test(s)?(kind==='PO'?'Issued':'Approved'):'Approved';

export const GET=route(async(_req,u)=>{
 if(u.role!=='admin')throw new HttpError(403,'Only administrators can promote imported data.');
 const counts=await all<{dataset:string,rows:number}>("SELECT b.dataset,count(*) AS rows FROM source_rows r JOIN import_batches b ON b.id=r.batch_id WHERE b.tenant_id=? AND b.id=(SELECT b2.id FROM import_batches b2 WHERE b2.dataset=b.dataset AND b2.tenant_id=b.tenant_id ORDER BY b2.imported_at DESC LIMIT 1) GROUP BY b.dataset",u.tenantId);
 const promoted=await all<{kind:string,n:number}>("SELECT 'assets' AS kind,count(*) AS n FROM assets WHERE tenant_id=? AND source_id IS NOT NULL UNION ALL SELECT 'tickets',count(*) FROM tickets WHERE tenant_id=? AND source_id IS NOT NULL UNION ALL SELECT 'purchasing',count(*) FROM purchase_docs WHERE tenant_id=? AND source_id IS NOT NULL",u.tenantId,u.tenantId,u.tenantId);
 return {datasets:counts,promoted};
});

export const POST=route(async(req,u)=>{
 if(u.role!=='admin')throw new HttpError(403,'Only administrators can promote imported data.');
 const b=await readBody(req);const wanted=new Set(Array.isArray(b.datasets)?b.datasets.map(String):['assets','tickets','purchasing','locations']);
 const rows=await all<SourceRow>("SELECT r.id,r.source_key,r.payload_json,b.dataset,b.source,b.imported_at FROM source_rows r JOIN import_batches b ON b.id=r.batch_id WHERE b.tenant_id=? AND b.id=(SELECT b2.id FROM import_batches b2 WHERE b2.dataset=b.dataset AND b2.tenant_id=b.tenant_id ORDER BY b2.imported_at DESC LIMIT 1) ORDER BY b.dataset,r.row_number",u.tenantId);
 const people=await all<{id:string,name:string,email:string}>('SELECT id,name,email FROM members WHERE tenant_id=?',u.tenantId);
 const who=(v:string)=>{if(!v)return null;const email=v.match(/[^\s(<]+@[^\s)>]+/)?.[0]?.toLowerCase();const n=v.replace(/\(.*\)/,'').trim().toLowerCase();return people.find(p=>(email&&p.email.toLowerCase()===email)||p.name.toLowerCase()===n)?.id||null};
 const existingCodes=new Set((await all<{code:string}>('SELECT code FROM assets WHERE tenant_id=?',u.tenantId)).map(r=>r.code));
 const vendors=new Map((await all<{id:string,name:string}>('SELECT id,name FROM vendors WHERE tenant_id=?',u.tenantId)).map(v=>[v.name.toLowerCase(),v.id]));
 const s:D1PreparedStatement[]=[];const ts=now();const tally:Record<string,number>={assets:0,tickets:0,requisitions:0,orders:0,vendors:0,locations:0};
 const paths=new Set<string>();
 for(const r of rows){
  const p=JSON.parse(r.payload_json) as P;const src=`import:${r.id}`;
  if((r.dataset==='assets'||r.dataset==='it-assets')&&wanted.has('assets')){
   let code=pick(p,'Asset Code','Asset Tag','Tag No')||pick(p,'Serial Number','Serial No')||r.source_key||r.id.slice(0,8);
   if(existingCodes.has(code))code=`${code}-${r.id.slice(0,4)}`;existingCodes.add(code);
   const location=pick(p,'Location','Assets Unit','Unit').replaceAll('&gt;','>');
   s.push(stmt('INSERT OR IGNORE INTO assets(id,tenant_id,code,name,category,kind,brand,model,serial,status,condition,location,department,assigned_to,purchase_date,purchase_cost,warranty_until,vendor,notes,source_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,code.slice(0,60),(pick(p,'Asset Name','Asset Type','Description')||code).slice(0,160),pick(p,'Category','Asset Category','Asset Type').slice(0,80),r.dataset==='it-assets'?'IT':'Physical',pick(p,'Brand','Make').slice(0,80),pick(p,'Model').slice(0,80),pick(p,'Serial No','Serial Number').slice(0,120),assetStatus(pick(p,'Status','Asset Status')),'Good',location.slice(0,200),pick(p,'Department','Assets Department').slice(0,160),who(pick(p,'Transferred To','Full Name','Assigned To','User')),isoDate(pick(p,'Purchase Date','Acquisition Date')),amount(pick(p,'Purchase Price','Cost','Purchase Cost','Value')),isoDate(pick(p,'Warranty Expiry','Warranty End Date')),pick(p,'Vendor','Supplier').slice(0,160),pick(p,'Description','Notes','Remarks').slice(0,4000),src,u.id,ts,ts));
   tally.assets++;if(location)paths.add(location);
  }
  if(r.dataset==='tickets'&&wanted.has('tickets')){
   const number=pick(p,'Ticket No','Ticket Number')||`IMP-${r.id.slice(0,6)}`;const status=ticketStatus(pick(p,'Status','Ticket Status'));const created=isoDate(pick(p,'Created Date','Raised On','Date'))||ts.slice(0,10);
   s.push(stmt('INSERT OR IGNORE INTO tickets(id,tenant_id,number,title,description,type,category,priority,status,department,assignee_id,requester_id,location,resolved_at,source_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,number.slice(0,60),(pick(p,'Description','Subject','Title')||number).slice(0,200),[pick(p,'Description'),pick(p,'Remarks')].filter(Boolean).join('\n\n').slice(0,8000),/maint/i.test(pick(p,'Ticket Type'))?'Maintenance':'Incident',pick(p,'Ticket Type','Category').slice(0,80),priority(pick(p,'Priority')),status,(pick(p,'Ticket Group','Department','Assigned Group')||'IT').slice(0,160),who(pick(p,'Assigned To')),who(pick(p,'Raised By','Requested By','Created By'))||u.id,pick(p,'Location').replaceAll('&gt;','>').slice(0,200),['Resolved','Closed'].includes(status)?created+'T00:00:00.000Z':null,src,created+'T00:00:00.000Z',ts));
   tally.tickets++;
  }
  if((r.dataset==='purchase-requisitions'||r.dataset==='purchase-orders')&&wanted.has('purchasing')){
   const kind=r.dataset==='purchase-orders'?'PO':'PR';
   const number=(kind==='PO'?pick(p,'Purchase Order #','PO Number'):pick(p,'Requisition No','PR Number'))||`${kind}-IMP-${r.id.slice(0,6)}`;
   const total=amount(pick(p,'PO Value (with Tax)','Total Amount','Amount','Total','Estimated Cost'));
   let vendorId:string|null=null;const vendor=pick(p,'Vendor','Supplier');
   if(kind==='PO'&&vendor){vendorId=vendors.get(vendor.toLowerCase())||null;if(!vendorId){vendorId=uid();vendors.set(vendor.toLowerCase(),vendorId);s.push(stmt('INSERT OR IGNORE INTO vendors(id,tenant_id,name,category,status,notes,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',vendorId,u.tenantId,vendor.slice(0,160),'Imported','Active','Created from imported purchase orders.',u.id,ts));tally.vendors++}}
   const id=uid();const created=isoDate(pick(p,'PO Date','Created Date','Requisition Date','Date'))||ts.slice(0,10);
   s.push(stmt('INSERT OR IGNORE INTO purchase_docs(id,tenant_id,kind,number,title,justification,department,location,requester_id,vendor_id,needed_by,currency,subtotal,tax,total,status,source_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,kind,number.slice(0,60),(pick(p,'Description','PR Description','Request Type')||number).slice(0,200),`Imported from ${r.source}.`,(pick(p,'Department')||'Unassigned').slice(0,160),pick(p,'Delivery Location','Location').replaceAll('&gt;','>').slice(0,200),who(pick(p,'Requested By','PO Created By','Created By'))||u.id,vendorId,isoDate(pick(p,'Required Date','Delivery Date')),(pick(p,'Currency')||'GHS').slice(0,8),total,0,total,docStatus(pick(p,'PO Status','Status','PR Status'),kind),src,u.id,created+'T00:00:00.000Z',ts));
   // One summary line keeps imported totals consistent until the full line items are re-entered.
   s.push(stmt('INSERT INTO purchase_lines(id,tenant_id,doc_id,line_no,description,qty,unit,unit_price) SELECT ?,?,?,1,?,1,?,? WHERE EXISTS(SELECT 1 FROM purchase_docs WHERE id=? AND tenant_id=?)',uid(),u.tenantId,id,'Imported total',"lot",total,id,u.tenantId));
   tally[kind==='PO'?'orders':'requisitions']++;
  }
  if(r.dataset==='locations'&&wanted.has('locations')){const unit=pick(p,'Unit','Location','Name');if(unit)paths.add(unit)}
 }
 if(wanted.has('locations')||wanted.has('assets'))for(const path of paths){const parts=path.split('>').map(x=>x.trim()).filter(Boolean);for(let i=0;i<parts.length;i++){const full=parts.slice(0,i+1).join(' > ');s.push(stmt('INSERT OR IGNORE INTO locations(id,tenant_id,name,parent_id,path,kind,created_at) VALUES(?,?,?,(SELECT id FROM locations WHERE tenant_id=? AND path=?),?,?,?)',uid(),u.tenantId,parts[i].slice(0,120),u.tenantId,parts.slice(0,i).join(' > '),full.slice(0,400),i===0?'Site':'Unit',ts));tally.locations++}}
 // Normalise stored asset locations to the "A > B" path format used by the location tree.
 s.push(stmt("UPDATE assets SET location=replace(replace(location,'>',' > '),'  ',' ') WHERE tenant_id=? AND location LIKE '%>%' AND location NOT LIKE '% > %'",u.tenantId));
 s.push(auditStatement(u,'Imported data promoted to live records',u.tenantId,'Administration',null,tally));
 for(let i=0;i<s.length;i+=90)await batch(s.slice(i,i+90));
 return {processed:tally};
});
