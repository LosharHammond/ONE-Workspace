import {hasAction,canActOn} from '../access-policy';
import {all,first} from './core';
import {canSeeAsset,canSeeTicket,canWorkTicket,canSeeDoc,canSeeFile,canSeePage,type AssetRow,type TicketRow,type PurchaseRow,type FileRow,type PageRow} from './entities';
import type {Member} from './policy';

// Workspace search shared by the command palette and the AI assistant. Every query is bound to the
// server-side workspace (u.tenantId) and every hit passes the same visibility rule as its module, so
// neither search nor AI can surface a record the person could not open themselves.
export type Hit={type:string,id:string,title:string,sub:string,link:string,text:string,score:number};
const clip=(s:unknown,n:number)=>String(s??'').replace(/\s+/g,' ').trim().slice(0,n);
function where(cols:string[],terms:string[]){const parts:string[]=[];const binds:string[]=[];for(const t of terms)for(const c of cols){parts.push(`${c} LIKE ?`);binds.push(`%${t.replace(/[%_]/g,'')}%`)}return {sql:`(${parts.join(' OR ')})`,binds}}
const STOP=new Set('the and for with that this what which who whom whose when where why how are was were been being have has had does did doing can could should would will shall may might must about into from onto over under than then them they their there these those our ours your yours you his her its not any all each few more most other some such only own same very just also show tell give list find me my mine please need needs want know summary summarize summarise explain what’s whats'.split(' '));
export function keywords(q:string,max=6){return [...new Set(q.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu,' ').split(/\s+/).filter(w=>w.length>=3&&!STOP.has(w)))].slice(0,max)}
function score(terms:string[],title:string,text:string){const t=title.toLowerCase(),x=text.toLowerCase();return terms.reduce((n,w)=>n+(t.includes(w)?3:0)+(x.includes(w)?1:0),0)}

// Source types shared by search, the knowledge index and vector retrieval.
export type SourceType='person'|'ticket'|'doc'|'asset'|'page'|'file'|'vendor'|'item'|'order';
type Clause={sql:string,binds:string[]}|null;
// Loads matching records of every type the person may see, with each module's visibility rule applied.
// `clause(type,cols,idCol)` returns the WHERE fragment for that type, or null to skip the type.
async function collect(u:Member,clause:(type:SourceType,cols:string[],idCol:string)=>Clause,limit:number):Promise<Hit[]>{
 const c={person:clause('person',['name','email','title','department'],'id'),asset:clause('asset',['name','code','serial','model','category','location','notes'],'id'),ticket:clause('ticket',['title','number','description','category'],'id'),doc:clause('doc',['d.title','d.number','d.justification'],'d.id'),file:clause('file',['name','tags','description'],'id'),page:clause('page',['title','body'],'id'),vendor:clause('vendor',['name','category'],'id'),item:clause('item',['i.name','i.sku','i.category'],'i.id'),order:clause('order',['title','number','description'],'id')};
 const q=<T,>(ok:boolean,cl:Clause,sql:(w:string)=>string):Promise<T[]>=>ok&&cl?all<T>(sql(cl.sql),u.tenantId,...cl.binds):Promise.resolve([]);
 const [people,assets,tickets,docs,files,pages,vendors,items,orders]=await Promise.all([
  q<{id:string,name:string,email:string,department:string,title:string,phone:string,location:string}>(hasAction(u,'people'),c.person,w=>`SELECT id,name,email,department,title,phone,location FROM members WHERE tenant_id=? AND active=1 AND ${w} LIMIT ${Math.min(limit,20)}`),
  q<AssetRow>(true,c.asset,w=>`SELECT * FROM assets WHERE tenant_id=? AND ${w} LIMIT ${limit}`),
  q<TicketRow>(true,c.ticket,w=>`SELECT * FROM tickets WHERE tenant_id=? AND ${w} ORDER BY created_at DESC LIMIT ${limit}`),
  q<PurchaseRow>(true,c.doc,w=>`SELECT d.*,(SELECT group_concat(j.value) FROM approvals a, json_each(a.approver_ids) j WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id) AS approver_ids FROM purchase_docs d WHERE d.tenant_id=? AND ${w} ORDER BY d.created_at DESC LIMIT ${limit}`),
  q<FileRow>(true,c.file,w=>`SELECT * FROM files WHERE tenant_id=? AND ${w} LIMIT ${limit}`),
  q<PageRow>(true,c.page,w=>`SELECT * FROM pages WHERE tenant_id=? AND ${w} LIMIT ${limit}`),
  q<{id:string,name:string,category:string,email:string,phone:string}>(hasAction(u,'suppliers'),c.vendor,w=>`SELECT id,name,category,email,phone FROM vendors WHERE tenant_id=? AND ${w} LIMIT ${Math.min(limit,20)}`),
  q<{id:string,sku:string,name:string,category:string,unit:string,min_stock:number,qty:number}>(hasAction(u,'inventory'),c.item,w=>`SELECT i.id,i.sku,i.name,i.category,i.unit,i.min_stock,(SELECT coalesce(sum(s.qty),0) FROM stock_levels s WHERE s.item_id=i.id AND s.tenant_id=i.tenant_id) AS qty FROM inventory_items i WHERE i.tenant_id=? AND ${w} LIMIT ${Math.min(limit,20)}`).catch(()=>[]),
  q<{id:string,number:string,title:string,description:string,status:string,department:string,assignee_id:string|null,created_by:string,due_at:string|null}>(hasAction(u,'schedules'),c.order,w=>`SELECT id,number,title,description,status,department,assignee_id,created_by,due_at FROM work_orders WHERE tenant_id=? AND ${w} ORDER BY created_at DESC LIMIT ${limit}`),
 ]);
 return [
  ...people.map(p=>({type:'Person',id:p.id,title:p.name,sub:[p.title,p.department,p.email].filter(Boolean).join(' · '),link:`#/people/directory/${p.id}`,text:`${p.name}; ${p.title||''}; department ${p.department}; ${p.email}; ${p.location||''}`,score:0})),
  ...tickets.filter(t=>canSeeTicket(u,t)).map(t=>({type:'Ticket',id:t.id,title:`${t.number} · ${t.title}`,sub:`${t.status} · ${t.priority}`,link:`#/tickets/${t.id}`,text:`Ticket ${t.number} "${t.title}". Status ${t.status}, priority ${t.priority}, category ${t.category||'—'}, department ${t.department}, created ${t.created_at.slice(0,10)}${t.due_at?`, due ${t.due_at.slice(0,16)}`:''}. ${clip(t.description,500)}`,score:0})),
  ...docs.filter(d=>canSeeDoc(u,d)).map(d=>({type:d.kind==='PR'?'Requisition':'Purchase order',id:d.id,title:`${d.number} · ${d.title}`,sub:d.status,link:`#/purchasing/${d.kind.toLowerCase()}/${d.id}`,text:`${d.kind} ${d.number} "${d.title}". Status ${d.status}, total ${d.currency} ${d.total}, department ${d.department}, created ${d.created_at.slice(0,10)}. ${clip(d.justification,400)}`,score:0})),
  ...assets.filter(a=>canSeeAsset(u,a)).map(a=>({type:'Asset',id:a.id,title:`${a.code} · ${a.name}`,sub:`${a.status}${a.location?' · '+a.location:''}`,link:`#/assets/${a.id}`,text:`Asset ${a.code} "${a.name}". Category ${a.category}, status ${a.status}, condition ${a.condition||'—'}, location ${a.location||'—'}, department ${a.department||'—'}, ${a.brand||''} ${a.model||''} serial ${a.serial||'—'}, purchased ${a.purchase_date||'—'}, warranty until ${a.warranty_until||'—'}. ${clip(a.notes,200)}`,score:0})),
  ...pages.filter(p=>canSeePage(u,p)).map(p=>({type:'Page',id:p.id,title:p.title,sub:p.department||'Company',link:`#/spaces/page/${p.id}`,text:`${p.kind==='announcement'?'Announcement':'Page'} "${p.title}" (${p.department||'Company'}, ${p.status}, updated ${p.updated_at.slice(0,10)}): ${clip(p.body,1200)}`,score:0})),
  ...files.filter(f=>canSeeFile(u,f)).map(f=>({type:'File',id:f.id,title:f.name,sub:f.department||'Company files',link:`#/files/${f.folder_id||'root'}/${f.id}`,text:`File "${f.name}" (${f.mime}, ${f.department||'company'}, tags ${f.tags||'—'}): ${clip(f.description,300)}`,score:0})),
  ...vendors.map(v=>({type:'Vendor',id:v.id,title:v.name,sub:v.category||'Vendor',link:`#/purchasing/vendors/${v.id}`,text:`Vendor ${v.name}; category ${v.category||'—'}; ${v.email||''} ${v.phone||''}`,score:0})),
  ...items.map(i=>({type:'Stock item',id:i.id,title:`${i.sku} · ${i.name}`,sub:`${i.qty} ${i.unit} in stock`,link:`#/inventory/items/${i.id}`,text:`Stock item ${i.sku} "${i.name}", category ${i.category}, ${i.qty} ${i.unit} on hand, reorder level ${i.min_stock}${i.qty<=i.min_stock?' (below reorder level)':''}`,score:0})),
  ...orders.filter(o=>o.assignee_id===u.id||canActOn(u,'schedules','view',o.department||u.department,o.created_by)).map(o=>({type:'Work order',id:o.id,title:`${o.number} · ${o.title}`,sub:o.status,link:`#/maintenance/orders/${o.id}`,text:`Work order ${o.number} "${o.title}", status ${o.status}${o.due_at?`, due ${o.due_at.slice(0,10)}`:''}. ${clip(o.description,300)}`,score:0})),
 ];
}
function perTypeCap(hits:Hit[],perType:number){const byType=new Map<string,number>();return hits.filter(h=>{const n=byType.get(h.type)||0;if(n>=perType)return false;byType.set(h.type,n+1);return true})}
// Keyword search.
export async function searchWorkspace(u:Member,terms:string[],perType=8):Promise<Hit[]>{
 if(!terms.length)return [];
 const hits=await collect(u,(_t,cols)=>where(cols,terms),60);
 return perTypeCap(hits.map(h=>({...h,score:score(terms,h.title,h.text)})).sort((a,b)=>b.score-a.score),perType);
}
// Specific records (e.g. vector-search candidates), each re-checked with the person's own permissions.
export async function hitsByIds(u:Member,refs:{type:SourceType,id:string,score:number}[]):Promise<Hit[]>{
 const ids=new Map<SourceType,string[]>();for(const r of refs)ids.set(r.type,[...(ids.get(r.type)||[]),r.id]);
 const hits=await collect(u,(t,_c,idCol)=>{const list=(ids.get(t)||[]).slice(0,50);return list.length?{sql:`${idCol} IN (${list.map(()=>'?').join(',')})`,binds:list}:null},50);
 const scoreOf=new Map(refs.map(r=>[r.id,r.score]));
 return hits.map(h=>({...h,score:scoreOf.get(h.id)||0})).sort((a,b)=>b.score-a.score);
}

// What needs this person's attention, computed with their own permissions.
export async function attention(u:Member){
 const [assigned,raised,approvals,orders,overdue]=await Promise.all([
  hasAction(u,'maintenance')?first<{n:number}>("SELECT count(*) AS n FROM tickets WHERE tenant_id=? AND assignee_id=? AND status NOT IN ('Resolved','Closed')",u.tenantId,u.id):null,
  hasAction(u,'maintenance')?first<{n:number}>("SELECT count(*) AS n FROM tickets WHERE tenant_id=? AND requester_id=? AND status NOT IN ('Resolved','Closed')",u.tenantId,u.id):null,
  hasAction(u,'requests')||hasAction(u,'procurement')?first<{n:number}>("SELECT count(*) AS n FROM approvals a JOIN purchase_docs d ON d.id=a.doc_id WHERE a.tenant_id=? AND a.status='Pending' AND d.requester_id!=? AND EXISTS(SELECT 1 FROM json_each(a.approver_ids) j WHERE j.value=?)",u.tenantId,u.id,u.id):null,
  hasAction(u,'schedules')?first<{n:number}>("SELECT count(*) AS n FROM work_orders WHERE tenant_id=? AND assignee_id=? AND status NOT IN ('Completed','Cancelled')",u.tenantId,u.id):null,
  hasAction(u,'maintenance')?first<{n:number}>("SELECT count(*) AS n FROM tickets WHERE tenant_id=? AND assignee_id=? AND status NOT IN ('Resolved','Closed') AND due_at<?",u.tenantId,u.id,new Date().toISOString()):null,
 ]);
 return {openTicketsAssignedToMe:assigned?.n??null,myOpenRequests:raised?.n??null,approvalsWaitingOnMe:approvals?.n??null,myOpenWorkOrders:orders?.n??null,myOverdueTickets:overdue?.n??null};
}

// The record behind the page the person is looking at (only if they can see it).
export async function contextRecord(u:Member,route:string):Promise<Hit|null>{
 const parts=route.replace(/^#?\/?/,'').split('/');const id=parts.find(p=>/^[A-Za-z0-9_-]{8,80}$/.test(p)&&p.includes('-'));if(!id)return null;
 const app=parts[0];
 if(app==='tickets'){const t=await first<TicketRow>('SELECT * FROM tickets WHERE id=? AND tenant_id=?',id,u.tenantId);if(t&&canSeeTicket(u,t)){const comments=await all<{body:string,internal:number,created_at:string}>('SELECT body,internal,created_at FROM comments WHERE tenant_id=? AND entity_type=? AND entity_id=? ORDER BY created_at DESC LIMIT 8',u.tenantId,'ticket',t.id).catch(()=>[]);return {type:'Ticket',id:t.id,title:`${t.number} · ${t.title}`,sub:t.status,link:`#/tickets/${t.id}`,score:99,text:`Ticket ${t.number} "${t.title}". Status ${t.status}, priority ${t.priority}, impact ${t.impact||'—'}, urgency ${t.urgency||'—'}, category ${t.category||'—'}/${t.subcategory||'—'}, department ${t.department}, location ${t.location||'—'}. Description: ${clip(t.description,1500)}. Recent comments: ${comments.filter(c=>!c.internal||canWorkTicket(u,t)).map(c=>clip(c.body,300)).join(' | ')||'none'}`}}}
 if(app==='assets'){const a=await first<AssetRow>('SELECT * FROM assets WHERE id=? AND tenant_id=?',id,u.tenantId);if(a&&canSeeAsset(u,a))return {type:'Asset',id:a.id,title:`${a.code} · ${a.name}`,sub:a.status,link:`#/assets/${a.id}`,score:99,text:`Asset ${a.code} "${a.name}", category ${a.category}, status ${a.status}, condition ${a.condition||'—'}, location ${a.location||'—'}, cost ${a.purchase_cost}, purchased ${a.purchase_date||'—'}, warranty ${a.warranty_until||'—'}, vendor ${a.vendor||'—'}. Notes: ${clip(a.notes,600)}`}}
 if(app==='purchasing'){const d=await first<PurchaseRow>("SELECT d.*,(SELECT group_concat(j.value) FROM approvals a, json_each(a.approver_ids) j WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id) AS approver_ids FROM purchase_docs d WHERE d.id=? AND d.tenant_id=?",id,u.tenantId);if(d&&canSeeDoc(u,d)){const lines=await all<{description:string,qty:number,unit_price:number}>('SELECT description,qty,unit_price FROM purchase_lines WHERE doc_id=? AND tenant_id=?',d.id,u.tenantId);return {type:d.kind==='PR'?'Requisition':'Purchase order',id:d.id,title:`${d.number} · ${d.title}`,sub:d.status,link:`#/purchasing/${d.kind.toLowerCase()}/${d.id}`,score:99,text:`${d.kind} ${d.number} "${d.title}", status ${d.status}, total ${d.currency} ${d.total}, department ${d.department}. Justification: ${clip(d.justification,800)}. Lines: ${lines.map(l=>`${l.qty} × ${clip(l.description,80)} @ ${l.unit_price}`).join('; ')}`}}}
 if(app==='spaces'){const p=await first<PageRow>('SELECT * FROM pages WHERE id=? AND tenant_id=?',id,u.tenantId);if(p&&canSeePage(u,p))return {type:'Page',id:p.id,title:p.title,sub:p.department||'Company',link:`#/spaces/page/${p.id}`,score:99,text:`Page "${p.title}" (${p.department||'Company'}): ${clip(p.body,3000)}`}}
 return null;
}
