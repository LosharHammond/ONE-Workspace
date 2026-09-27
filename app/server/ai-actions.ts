import {hasAction} from '../access-policy';
import {all,first,HttpError,tenantOf} from './core';
import {canSeeTicket,canWorkTicket,canSeeDoc,type TicketRow,type PurchaseRow} from './entities';
import {searchWorkspace,attention,contextRecord,keywords,type Hit} from './search';
import type {Member} from './policy';

// Reusable AI actions that pages and widgets invoke. Each action names the permission page it needs,
// loads its record through the normal visibility rules, and returns text and/or a *suggestion*.
// Suggestions are never saved here: the page shows a preview and the person confirms, and the change then
// goes through the ordinary API with its ordinary permission checks.
export type AiActionDef={id:string,label:string,page:string,entity?:'ticket'|'asset'|'purchase'|'page',input?:string,json?:boolean,mutates?:string,description:string};
export const aiActions:AiActionDef[]=[
 {id:'home.attention',label:'Summarize what needs my attention',page:'overview',description:'Your open tickets, approvals and work orders.'},
 {id:'home.trends',label:'Explain company trends',page:'overview',description:'Ticket and purchasing activity over the last 90 days.'},
 {id:'home.briefing',label:'Create an executive briefing',page:'overview',description:'A short briefing from records you can see.'},
 {id:'ticket.summarize',label:'Summarize ticket',page:'maintenance',entity:'ticket',description:'The issue, what has happened and what is next.'},
 {id:'ticket.triage',label:'Suggest priority and category',page:'maintenance',entity:'ticket',json:true,mutates:'ticket.update',description:'A suggested priority and category you can apply.'},
 {id:'ticket.reply',label:'Draft a response',page:'maintenance',entity:'ticket',json:true,mutates:'ticket.comment',description:'A reply draft you can edit before sending.'},
 {id:'ticket.assignee',label:'Recommend an assignee',page:'maintenance',entity:'ticket',json:true,mutates:'ticket.assign',description:'Who is best placed to take it.'},
 {id:'ticket.duplicates',label:'Detect duplicate tickets',page:'maintenance',entity:'ticket',json:true,description:'Similar tickets you can see.'},
 {id:'asset.summarize',label:'Summarize asset history',page:'assets',entity:'asset',description:'Custody, maintenance and changes.'},
 {id:'asset.missing',label:'Detect missing data',page:'assets',entity:'asset',description:'Fields worth completing.'},
 {id:'asset.maintenance',label:'Identify overdue maintenance',page:'assets',entity:'asset',description:'Open and overdue work orders.'},
 {id:'asset.replacement',label:'Recommend replacement planning',page:'assets',entity:'asset',description:'Age, warranty and repair history.'},
 {id:'purchase.summarize',label:'Summarize requisition',page:'requests',entity:'purchase',description:'What is being bought, why and where it stands.'},
 {id:'purchase.quotes',label:'Compare quotations',page:'procurement',entity:'purchase',description:'Quotations side by side.'},
 {id:'purchase.unusual',label:'Detect unusual spending',page:'requests',entity:'purchase',description:'Compared with the department’s recent documents.'},
 {id:'purchase.delay',label:'Explain approval delays',page:'requests',entity:'purchase',description:'Which steps are waiting and for how long.'},
 {id:'purchase.draft',label:'Draft a purchase description',page:'requests',input:'What do you need to buy and why?',json:true,mutates:'purchase.create',description:'A requisition draft you can review.'},
 {id:'people.announcement',label:'Draft an announcement',page:'knowledge',input:'What is the announcement about?',json:true,mutates:'page.create',description:'A draft for the company space.'},
 {id:'people.staffing',label:'Summarize staffing',page:'people',description:'Headcount by department from the directory.'},
 {id:'page.summarize',label:'Summarize document',page:'knowledge',entity:'page',description:'The key points.'},
 {id:'page.actions',label:'Extract actions',page:'knowledge',entity:'page',description:'Tasks, owners and dates mentioned.'},
 {id:'page.ask',label:'Ask about this document',page:'knowledge',entity:'page',input:'Your question',description:'Answered from the document with citations.'},
 {id:'page.draft',label:'Draft content',page:'knowledge',input:'What should the page cover?',json:true,mutates:'page.create',description:'A page draft you can edit.'},
 {id:'policy.answer',label:'Answer a policy question',page:'knowledge',input:'Your question',description:'From published pages you can read, with citations.'},
 {id:'builder.layout',label:'Suggest a page layout',page:'app-pages',input:'Describe the page you want',json:true,mutates:'page-builder.draft',description:'Widgets and a layout you can insert into the draft.'},
];
const routeFor:Record<string,string>={ticket:'tickets',asset:'assets',purchase:'purchasing/x',page:'spaces/page'};
const clip=(s:unknown,n:number)=>String(s??'').replace(/\s+/g,' ').trim().slice(0,n);

export type ActionContext={instructions:string,sources:Hit[],data:Record<string,unknown>};
// Builds the prompt material for an action. Throws 403/404 when the person may not use it.
export async function buildAction(u:Member,a:AiActionDef,entityId:string|undefined,input:string):Promise<ActionContext>{
 if(!hasAction(u,a.page))throw new HttpError(403,'You do not have access to this page.');
 let rec:Hit|null=null;
 if(a.entity){if(!entityId)throw new HttpError(400,'Choose a record.');rec=await contextRecord(u,`${routeFor[a.entity]}/${entityId}`);if(!rec)throw new HttpError(404,'Record not found.')}
 if(a.input&&!input.trim())throw new HttpError(400,`${a.input} is required.`);
 const sources:Hit[]=rec?[rec]:[];const data:Record<string,unknown>={};
 const t=await tenantOf(u);
 switch(a.id){
  case 'home.attention':case 'home.briefing':{
   data.attention=await attention(u);
   const mine=hasAction(u,'maintenance')?(await all<TicketRow>("SELECT * FROM tickets WHERE tenant_id=? AND (assignee_id=? OR requester_id=?) AND status NOT IN ('Resolved','Closed') ORDER BY due_at LIMIT 15",u.tenantId,u.id,u.id)).filter(x=>canSeeTicket(u,x)):[];
   sources.push(...mine.map(x=>({type:'Ticket',id:x.id,title:`${x.number} · ${x.title}`,sub:x.status,link:`#/tickets/${x.id}`,score:1,text:`${x.number} "${x.title}", ${x.status}, ${x.priority}${x.due_at?`, due ${x.due_at.slice(0,16)}`:''}${x.assignee_id===u.id?' (assigned to you)':' (raised by you)'}`})));
   if(a.id==='home.briefing')data.trends=await trends(u);
   break;
  }
  case 'home.trends':data.trends=await trends(u);break;
  case 'ticket.assignee':{
   const t2=await first<TicketRow>('SELECT * FROM tickets WHERE id=? AND tenant_id=?',entityId,u.tenantId);if(!t2||!canWorkTicket(u,t2))throw new HttpError(403,'You cannot assign this ticket.');
   data.candidates=await all("SELECT m.id,m.name,m.title,m.department,(SELECT count(*) FROM tickets k WHERE k.tenant_id=m.tenant_id AND k.assignee_id=m.id AND k.status NOT IN ('Resolved','Closed')) AS openTickets FROM members m WHERE m.tenant_id=? AND m.active=1 AND (lower(m.department)=lower(?) OR m.role='admin') ORDER BY openTickets LIMIT 25",u.tenantId,t2.department);
   break;
  }
  case 'ticket.duplicates':{
   const words=keywords(rec!.title,5);
   data.candidates=(await searchWorkspace(u,words,20)).filter(h=>h.type==='Ticket'&&h.id!==entityId&&h.score>=3).slice(0,10).map(h=>({id:h.id,title:h.title,text:clip(h.text,300),link:h.link}));
   break;
  }
  case 'asset.summarize':case 'asset.maintenance':case 'asset.replacement':{
   const [history,orders]=await Promise.all([all<{action:string,created_at:string}>('SELECT action,created_at FROM audit WHERE tenant_id=? AND record_id=? ORDER BY created_at DESC LIMIT 25',u.tenantId,entityId),hasAction(u,'schedules')||u.role==='admin'?all<{number:string,title:string,status:string,due_at:string|null,completed_at:string|null}>('SELECT number,title,status,due_at,completed_at FROM work_orders WHERE tenant_id=? AND asset_id=? ORDER BY created_at DESC LIMIT 15',u.tenantId,entityId).catch(()=>[]):[]]);
   data.history=history.map(h=>`${h.created_at.slice(0,10)} ${h.action}`);data.workOrders=orders;data.today=new Date().toISOString().slice(0,10);
   break;
  }
  case 'asset.missing':{
   const a2=await first<Record<string,unknown>>('SELECT code,name,category,serial,brand,model,location,department,purchase_date,purchase_cost,warranty_until,vendor,assigned_to FROM assets WHERE id=? AND tenant_id=?',entityId,u.tenantId);
   data.missingFields=Object.entries(a2||{}).filter(([,v])=>v===null||v===''||v===0).map(([k])=>k);
   break;
  }
  case 'purchase.quotes':{
   const d=await doc(u,entityId!);
   data.quotations=await all('SELECT v.name AS vendor,q.amount,q.currency,q.valid_until AS validUntil,q.notes,q.selected FROM quotations q LEFT JOIN vendors v ON v.id=q.vendor_id AND v.tenant_id=q.tenant_id WHERE q.tenant_id=? AND q.doc_id IN (?,coalesce(?,\'\'))',u.tenantId,d.id,d.pr_id);
   break;
  }
  case 'purchase.unusual':{
   const d=await doc(u,entityId!);
   const peers=(await all<PurchaseRow>("SELECT d.*,(SELECT group_concat(j.value) FROM approvals a, json_each(a.approver_ids) j WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id) AS approver_ids FROM purchase_docs d WHERE d.tenant_id=? AND d.kind=? AND lower(d.department)=lower(?) AND d.id!=? ORDER BY d.created_at DESC LIMIT 40",u.tenantId,d.kind,d.department,d.id)).filter(x=>canSeeDoc(u,x));
   data.peers=peers.map(p=>({number:p.number,title:clip(p.title,80),total:p.total,status:p.status,date:p.created_at.slice(0,10)}));
   break;
  }
  case 'purchase.delay':{
   const d=await doc(u,entityId!);
   data.steps=await all("SELECT step_no AS step,step_name AS name,status,created_at AS since,decided_at AS decidedAt,(SELECT group_concat(m.name) FROM json_each(a.approver_ids) j JOIN members m ON m.id=j.value AND m.tenant_id=a.tenant_id) AS approvers FROM approvals a WHERE a.tenant_id=? AND a.doc_id=? ORDER BY step_no",u.tenantId,d.id);data.now=new Date().toISOString();
   break;
  }
  case 'people.staffing':{
   data.byDepartment=await all('SELECT department,count(*) AS people FROM members WHERE tenant_id=? AND active=1 GROUP BY department ORDER BY people DESC',u.tenantId);
   break;
  }
  case 'policy.answer':case 'page.ask':{
   if(a.id==='policy.answer')sources.push(...(await searchWorkspace(u,keywords(input),6)).filter(h=>h.type==='Page'||h.type==='File'));
   break;
  }
  case 'purchase.draft':data.currency=t.currency;break;
  case 'builder.layout':break;
 }
 return {instructions:instructionsFor(a),sources,data};
}
async function doc(u:Member,id:string){const d=await first<PurchaseRow>("SELECT d.*,(SELECT group_concat(j.value) FROM approvals a, json_each(a.approver_ids) j WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id) AS approver_ids FROM purchase_docs d WHERE d.id=? AND d.tenant_id=?",id,u.tenantId);if(!d||!canSeeDoc(u,d))throw new HttpError(404,'Document not found.');return d}
// Weekly counts from records this person can see.
async function trends(u:Member){
 const since=new Date(Date.now()-90*86400000).toISOString();
 const week=(d:string)=>{const x=new Date(d);x.setUTCDate(x.getUTCDate()-x.getUTCDay());return x.toISOString().slice(0,10)};
 const tickets=hasAction(u,'maintenance')?(await all<TicketRow>('SELECT * FROM tickets WHERE tenant_id=? AND created_at>=? LIMIT 2000',u.tenantId,since)).filter(t=>canSeeTicket(u,t)):[];
 const docs=hasAction(u,'requests')||hasAction(u,'procurement')?(await all<PurchaseRow>("SELECT d.*,(SELECT group_concat(j.value) FROM approvals a, json_each(a.approver_ids) j WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id) AS approver_ids FROM purchase_docs d WHERE d.tenant_id=? AND d.created_at>=? LIMIT 2000",u.tenantId,since)).filter(d=>canSeeDoc(u,d)):[];
 const tally=<T,>(rows:T[],k:(r:T)=>string,v:(r:T)=>number=()=>1)=>Object.entries(rows.reduce((m,r)=>{const key=k(r);m[key]=(m[key]||0)+v(r);return m},{} as Record<string,number>)).sort();
 return {ticketsPerWeek:tally(tickets,t=>week(t.created_at)),ticketsByCategory:tally(tickets,t=>t.category||'Uncategorised'),openTickets:tickets.filter(t=>!['Resolved','Closed'].includes(t.status)).length,purchasingSpendPerWeek:tally(docs.filter(d=>d.kind==='PO'),d=>week(d.created_at),d=>d.total),requisitionsByStatus:tally(docs.filter(d=>d.kind==='PR'),d=>d.status),note:'Only records this person can see are counted.'};
}
function instructionsFor(a:AiActionDef){
 switch(a.id){
  case 'ticket.triage':return 'Suggest a priority (one of Low, Medium, High, Critical) and a short category for this ticket. Reply as JSON {"priority":string,"category":string,"reason":string}.';
  case 'ticket.reply':return 'Draft a polite, specific reply to the requester. Do not promise dates that are not in the record. Reply as JSON {"reply":string}.';
  case 'ticket.assignee':return 'From the candidates only, recommend who should take this ticket, balancing department fit and open ticket count. Reply as JSON {"assigneeId":string,"name":string,"reason":string}. Use an id from the candidates list exactly.';
  case 'ticket.duplicates':return 'Decide which candidate tickets are likely duplicates of the ticket in the sources. Reply as JSON {"duplicates":[{"id":string,"title":string,"reason":string}]} using only candidate ids; an empty list is fine.';
  case 'asset.missing':return 'Explain which of the missing fields matter most for this asset and why, in a short list.';
  case 'asset.maintenance':return 'List open or overdue work orders for this asset compared with today, and what to do next. If there are none, say so.';
  case 'asset.replacement':return 'Assess replacement planning for this asset from its age, warranty, condition and repair history. Say when evidence is insufficient.';
  case 'purchase.quotes':return 'Compare the quotations: price, validity and notes. Recommend one only if the evidence supports it, and say what is missing.';
  case 'purchase.unusual':return 'Compare this document with the department’s recent documents (peers) and say whether the amount or items look unusual, with reasons. Do not accuse anyone; describe patterns only.';
  case 'purchase.delay':return 'Explain which approval steps are pending, who they wait on and for how long, compared with now.';
  case 'purchase.draft':return 'Draft a purchase requisition from the request. Reply as JSON {"title":string,"justification":string,"lines":[{"description":string,"qty":number,"unit":string,"unitPrice":number}]}. Use 0 for unknown prices.';
  case 'people.announcement':return 'Draft a clear company announcement. Reply as JSON {"title":string,"body":string} with the body in Markdown.';
  case 'page.draft':return 'Draft a wiki page. Reply as JSON {"title":string,"body":string} with the body in Markdown.';
  case 'page.actions':return 'Extract the action items from the document: task, owner and date when stated. Use a list.';
  case 'page.ask':case 'policy.answer':return 'Answer the question only from the sources, citing them like [S1]. If they do not contain the answer, say so.';
  case 'builder.layout':return 'Design a page layout for One Workspace’s page builder. Reply as JSON {"title":string,"sections":[{"title":string,"columns":[{"widgets":[{"type":string,"title":string,"config":object}]}]}]}. Only use widget types from the "widgetTypes" list in the data, with config keys described there.';
  default:return `${a.label}. Be concise and specific; use short Markdown lists; cite sources like [S1].`;
 }
}
