import {hasAction} from '../../access-policy';
import {route,all} from '../../server/core';
import {canSeeAsset,canSeeTicket,canSeeDoc,canSeePage,type AssetRow,type TicketRow,type PurchaseRow,type PageRow} from '../../server/entities';
// Home screen: personal focus queue plus operational pulse for everything this person can see.
export const GET=route(async(_req,u)=>{
 const [tickets,assets,docs,pages,people]=await Promise.all([
  all<TicketRow>('SELECT * FROM tickets WHERE tenant_id=? ORDER BY created_at DESC LIMIT 4000',u.tenantId),
  all<AssetRow>('SELECT * FROM assets WHERE tenant_id=? LIMIT 6000',u.tenantId),
  all<PurchaseRow&{pending_ids:string|null,pending_step:string|null}>("SELECT d.*,(SELECT group_concat(j.value) FROM approvals a, json_each(a.approver_ids) j WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id) AS approver_ids,(SELECT a.approver_ids FROM approvals a WHERE a.doc_id=d.id AND a.status='Pending') AS pending_ids,(SELECT a.step_name FROM approvals a WHERE a.doc_id=d.id AND a.status='Pending') AS pending_step FROM purchase_docs d WHERE d.tenant_id=? ORDER BY d.created_at DESC LIMIT 4000",u.tenantId),
  all<PageRow>("SELECT * FROM pages WHERE tenant_id=? AND status='Published' ORDER BY pinned DESC,updated_at DESC LIMIT 40",u.tenantId),
  all<{department:string,active:number,created_at:string}>('SELECT department,active,created_at FROM members WHERE tenant_id=?',u.tenantId),
 ]);
 const T=tickets.filter(t=>canSeeTicket(u,t)),A=assets.filter(a=>canSeeAsset(u,a)),D=docs.filter(d=>canSeeDoc(u,d));
 const open=T.filter(t=>!['Resolved','Closed'].includes(t.status));const nowMs=Date.now();
 const months=[...Array(6)].map((_,i)=>{const d=new Date();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-5+i);return d.toISOString().slice(0,7)});
 const weeks=[...Array(8)].map((_,i)=>nowMs-(7-i)*7*86400000);
 const count=<R,>(rows:R[],key:(r:R)=>string)=>rows.reduce<Record<string,number>>((m,r)=>{const k=key(r)||'Unspecified';m[k]=(m[k]||0)+1;return m},{});
 const lite=(t:TicketRow)=>({id:t.id,number:t.number,title:t.title,status:t.status,priority:t.priority,due_at:t.due_at,department:t.department,assignee_id:t.assignee_id,requester_id:t.requester_id,created_at:t.created_at});
 const doc=(d:PurchaseRow&{pending_step?:string|null})=>({id:d.id,kind:d.kind,number:d.number,title:d.title,status:d.status,total:d.total,currency:d.currency,department:d.department,requester_id:d.requester_id,pending_step:d.pending_step,created_at:d.created_at});
 return {
  focus:{
   approvals:D.filter(d=>d.status==='Pending approval'&&d.requester_id!==u.id&&d.pending_ids&&JSON.parse(d.pending_ids).includes(u.id)).slice(0,8).map(doc),
   assigned:open.filter(t=>t.assignee_id===u.id).sort((a,b)=>String(a.due_at).localeCompare(String(b.due_at))).slice(0,8).map(lite),
   requested:T.filter(t=>t.requester_id===u.id&&t.status!=='Closed').slice(0,6).map(lite),
   myDocs:D.filter(d=>d.requester_id===u.id).slice(0,6).map(doc),
   myAssets:A.filter(a=>a.assigned_to===u.id).slice(0,8).map(a=>({id:a.id,code:a.code,name:a.name,category:a.category,status:a.status})),
  },
  announcements:pages.filter(p=>canSeePage(u,p)&&(p.kind==='announcement'||p.pinned)).slice(0,5).map(p=>({id:p.id,title:p.title,department:p.department,icon:p.icon,excerpt:p.body.replace(/[#*_>`[\]()-]/g,'').slice(0,180),updated_at:p.updated_at,author_id:p.author_id})),
  pulse:{
   people:hasAction(u,'people')?people.filter(p=>p.active).length:null,
   newPeople:people.filter(p=>p.active&&Date.parse(p.created_at)>nowMs-30*86400000).length,
   openTickets:open.length,
   overdue:open.filter(t=>t.due_at&&Date.parse(t.due_at)<nowMs).length,
   unassigned:open.filter(t=>!t.assignee_id).length,
   assets:A.length,assetValue:A.reduce((s,a)=>s+(a.purchase_cost||0),0),
   pendingApprovals:D.filter(d=>d.status==='Pending approval').length,
   openOrders:D.filter(d=>d.kind==='PO'&&['Approved','Issued','Partially received'].includes(d.status)).reduce((s,d)=>s+d.total,0),
  },
  charts:{
   ticketsByStatus:count(T,t=>t.status),
   ticketsByPriority:count(open,t=>t.priority),
   assetsByStatus:count(A,a=>a.status),
   assetsByCategory:count(A,a=>a.category),
   ticketTrend:weeks.map(w=>({week:new Date(w).toISOString().slice(0,10),opened:T.filter(t=>{const c=Date.parse(t.created_at);return c>=w&&c<w+7*86400000}).length,resolved:T.filter(t=>{const c=t.resolved_at?Date.parse(t.resolved_at):0;return c>=w&&c<w+7*86400000}).length})),
   spend:months.map(m=>({month:m,requested:D.filter(d=>d.kind==='PR'&&d.created_at.startsWith(m)&&!['Draft','Cancelled'].includes(d.status)).reduce((s,d)=>s+d.total,0),ordered:D.filter(d=>d.kind==='PO'&&d.created_at.startsWith(m)&&!['Draft','Cancelled','Rejected'].includes(d.status)).reduce((s,d)=>s+d.total,0)})),
   spendByDepartment:Object.entries(D.filter(d=>d.kind==='PO'&&!['Draft','Cancelled','Rejected'].includes(d.status)).reduce<Record<string,number>>((m,d)=>{m[d.department]=(m[d.department]||0)+d.total;return m},{})).sort((a,b)=>b[1]-a[1]).slice(0,8),
  },
 };
});
