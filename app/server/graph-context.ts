import {hasAction} from '../access-policy';
import {all,first} from './core';
import {context,findNode,visibleNodes,NODE_LABELS,type GraphNode} from './graph';
import {projectFinance,canManageProject,type ProjectRow} from './collab';
import type {Member} from './policy';

// Connected context ("360° view") for any record: the Work Graph neighbourhood grouped into sections that
// make sense for that record type, plus derived facts and a history. Every node is authorised for the viewer
// (graph.visibleNodes re-checks each source record); hidden neighbours are only counted, never described.
type Shaped=Awaited<ReturnType<typeof context>>['nodes'][number];
type Section={key:string,label:string,icon:string,types:string[],depth?:number,openOnly?:boolean,via?:string[]};
const S=(key:string,label:string,icon:string,types:string[],o:Partial<Section>={}):Section=>({key,label,icon,types,...o});
const people=S('people','People','Users',['person'],{depth:1});
const common:Section[]=[S('files','Files','Paperclip',['file']),S('external','Connected apps','Link',['external']),S('ai','AI activity','Sparkles',['agent_run','agent']),S('automation','Automations','Workflow',['automation_run'])];
export const PROFILES:Record<string,Section[]>={
 project:[S('team','Team','Users',['person'],{depth:1}),S('department','Department','Building2',['department'],{depth:1}),S('strategy','Goals & initiatives','Target',['goal','objective','initiative']),S('customers','Customers & contracts','Handshake',['customer','contract','service']),S('budget','Budget','PiggyBank',['budget']),S('purchasing','Requisitions & orders','ShoppingBag',['PR','PO']),S('vendors','Vendors','Store',['vendor']),S('receipts','Goods receipts','Truck',['receipt']),S('assets','Assets','Boxes',['asset']),S('milestones','Milestones','Flag',['milestone']),S('tasks','Outstanding tasks','ListTodo',['task'],{openOnly:true}),S('meetings','Meetings','CalendarClock',['meeting']),S('decisions','Decisions','Gavel',['decision']),S('risks','Risks & issues','TriangleAlert',['risk','issue']),S('tickets','Tickets','LifeBuoy',['ticket']),S('messages','Messages','MessageSquare',['message']),S('approvals','Approvals','Stamp',['person'],{depth:2,via:['approved_by']}),...common],
 asset:[S('purchase','Purchase request','ClipboardList',['PR']),S('order','Purchase order','FileText',['PO']),S('vendor','Vendor','Store',['vendor']),S('receipt','Goods receipt','Truck',['receipt']),S('custodian','Custodian','UserCheck',['person'],{depth:1}),S('department','Department','Building2',['department'],{depth:1}),S('location','Location','MapPin',['location'],{depth:1}),S('project','Project','FolderKanban',['project']),S('tickets','Tickets','LifeBuoy',['ticket']),S('maintenance','Maintenance','Wrench',['work_order','maintenance_plan']),S('services','Service contracts','Handshake',['service','contract']),...common],
 PR:[S('requester','Requester & approvers','Users',['person'],{depth:1}),S('project','Project','FolderKanban',['project']),S('budget','Budget','PiggyBank',['budget']),S('orders','Purchase orders','FileText',['PO']),S('vendor','Vendor','Store',['vendor']),S('assets','Assets received','Boxes',['asset']),...common],
 PO:[S('people','Requester & approvers','Users',['person'],{depth:1}),S('requisition','Requisition','ClipboardList',['PR']),S('vendor','Vendor','Store',['vendor']),S('receipts','Goods receipts','Truck',['receipt']),S('assets','Assets created','Boxes',['asset']),S('project','Project','FolderKanban',['project']),S('contracts','Contracts','FileSignature',['contract']),...common],
 ticket:[people,S('asset','Asset','Boxes',['asset']),S('work','Work orders','Wrench',['work_order']),S('tasks','Tasks','ListTodo',['task']),S('department','Department','Building2',['department'],{depth:1}),S('related','Related tickets','LifeBuoy',['ticket']),...common],
 task:[people,S('project','Project','FolderKanban',['project']),S('deps','Dependencies','GitBranch',['task','milestone']),S('decisions','Decisions','Gavel',['decision']),S('meetings','Meetings','CalendarClock',['meeting']),S('source','Source records','Link2',['ticket','PR','PO','asset']),...common],
 person:[S('department','Department','Building2',['department'],{depth:1}),S('manager','Reporting line','Network',['person'],{depth:1}),S('groups','Groups & roles','UsersRound',['group','role']),S('projects','Projects','FolderKanban',['project']),S('tasks','Open tasks','ListTodo',['task'],{openOnly:true}),S('assets','Assets in custody','Laptop',['asset']),S('tickets','Tickets','LifeBuoy',['ticket']),S('purchasing','Purchase requests','ShoppingBag',['PR','PO']),S('meetings','Meetings','CalendarClock',['meeting']),S('records','Goals & customers','Target',['goal','objective','initiative','customer','contract']),...common],
 vendor:[S('orders','Purchase orders & requests','FileText',['PO','PR']),S('assets','Assets supplied','Boxes',['asset']),S('contracts','Contracts','FileSignature',['contract']),S('projects','Projects','FolderKanban',['project']),...common],
 file:[S('attached','Attached to','Link2',['project','task','ticket','asset','PR','PO','vendor','page','meeting','contract','decision','customer']),people,...common],
 goal:[S('objectives','Objectives','Crosshair',['objective']),S('initiatives','Initiatives','Rocket',['initiative']),S('projects','Projects','FolderKanban',['project']),people,...common],
 objective:[S('goal','Goal','Target',['goal']),S('initiatives','Initiatives','Rocket',['initiative']),S('projects','Projects','FolderKanban',['project']),people,...common],
 initiative:[S('objective','Objective','Crosshair',['objective']),S('projects','Contributing projects','FolderKanban',['project']),S('tasks','Outstanding tasks','ListTodo',['task'],{openOnly:true}),S('purchasing','Spend','ShoppingBag',['PR','PO']),people,...common],
 customer:[S('contracts','Contracts','FileSignature',['contract']),S('services','Services','Handshake',['service']),S('projects','Projects','FolderKanban',['project']),S('meetings','Meetings','CalendarClock',['meeting']),S('decisions','Decisions','Gavel',['decision']),people,...common],
 contract:[S('customer','Customer','Building2',['customer']),S('services','Services','Handshake',['service']),S('vendors','Vendors','Store',['vendor']),S('projects','Delivery projects','FolderKanban',['project']),S('assets','Assets covered','Boxes',['asset']),people,...common],
 service:[S('contract','Contract','FileSignature',['contract']),S('customer','Customer','Building2',['customer']),S('assets','Assets covered','Boxes',['asset']),S('tickets','Tickets','LifeBuoy',['ticket']),...common],
 meeting:[S('attendees','Attendees','Users',['person'],{depth:1}),S('decisions','Decisions','Gavel',['decision']),S('projects','Projects','FolderKanban',['project']),S('customers','Customers','Building2',['customer']),S('tasks','Resulting tasks','ListTodo',['task']),...common],
 decision:[S('meeting','Decided in','CalendarClock',['meeting']),S('people','Decided by','UserCheck',['person'],{depth:1}),S('projects','Affected projects','FolderKanban',['project']),S('tasks','Resulting tasks','ListTodo',['task']),...common],
};
const DEFAULT:Section[]=[people,S('projects','Projects','FolderKanban',['project']),S('tasks','Tasks','ListTodo',['task','milestone']),S('records','Records','Link2',['PR','PO','asset','ticket','vendor','work_order','budget','receipt','page','space','message','goal','objective','initiative','customer','contract','service','meeting','decision','studio_record']),...common];
const closed=/^(done|cancelled|closed|completed|resolved)$/i;

export async function connectedContext(u:Member,type:string,sourceId:string){
 const root=await findNode(u,type,sourceId);
 const g=await context(u,root,{depth:2,limit:350});
 const byId=new Map(g.nodes.map(n=>[n.id,n]));
 // Distance and the relationship that reached each node from the root.
 const dist=new Map<string,number>([[root.id,0]]);const how=new Map<string,{label:string,via:string,type:string}>();
 let frontier=[root.id];for(let d=1;d<=2;d++){const next:string[]=[];for(const e of g.edges){for(const [from,to,label] of [[e.src,e.dst,e.label],[e.dst,e.src,e.inverseLabel]] as [string,string,string][]){if(frontier.includes(from)&&!dist.has(to)){dist.set(to,d);how.set(to,{label,via:from,type:e.type});next.push(to)}}}frontier=next}
 const profile=PROFILES[root.type]||DEFAULT;const used=new Set<string>([root.id]);
 const sections=profile.map(s=>{const items=g.nodes.filter(n=>!used.has(n.id)&&s.types.includes(n.type)&&dist.has(n.id)&&(!s.depth||dist.get(n.id)!<=s.depth)&&(!s.openOnly||!closed.test(n.status))&&(!s.via||s.via.includes(how.get(n.id)?.type||'')));
  if(!s.via)for(const n of items)used.add(n.id);
  return {key:s.key,label:s.label,icon:s.icon,items:items.slice(0,60).map(n=>item(n,how.get(n.id),byId,root.id,dist.get(n.id)!)),total:items.length};
 }).filter(s=>s.total>0);
 const facts=await factsFor(u,root,g.nodes);
 // History: the record's own audit trail plus that of connected records the viewer can see.
 const ids=[root.source_id,...g.nodes.filter(n=>dist.get(n.id)===1).map(n=>n.sourceId)].slice(0,80);
 const history=(await all<{action:string,created_at:string,record_id:string,who:string|null}>(`SELECT a.action,a.created_at,a.record_id,m.name AS who FROM audit a LEFT JOIN members m ON m.id=a.actor AND m.tenant_id=a.tenant_id WHERE a.tenant_id=? AND a.record_id IN (${ids.map(()=>'?').join(',')}) ORDER BY a.created_at DESC LIMIT 80`,u.tenantId,...ids)).map(h=>{const n=g.nodes.find(x=>x.sourceId===h.record_id);return {action:h.action,at:h.created_at,who:h.who||'System',record:n&&n.id!==root.id?{title:n.title,url:n.url,label:n.label}:null}});
 return {root:g.root,sections,facts,history,restricted:g.restricted,total:g.nodes.length-1,canLink:hasAction(u,'graph')};
}
function item(n:Shaped,h:{label:string,via:string}|undefined,byId:Map<string,Shaped>,rootId:string,d:number){
 const via=h&&h.via!==rootId?byId.get(h.via):null;
 return {id:n.id,type:n.type,label:n.label,sourceId:n.sourceId,title:n.title,status:n.status,url:n.url,summary:n.summary.slice(0,160),relation:h?.label||'',via:via?{title:via.title,url:via.url}:null,depth:d,meta:n.meta,provider:n.provider,syncMode:n.syncMode,lastVerifiedAt:n.lastVerifiedAt,externalId:n.externalId};
}
// Derived facts, only from records the viewer is allowed to see.
async function factsFor(u:Member,root:GraphNode|Shaped,nodes:Shaped[]){
 const type=root.type;const src='source_id' in root?root.source_id:(root as Shaped).sourceId;const out:{label:string,value:string|number,tone?:string}[]=[];
 const count=(t:string[],open=false)=>nodes.filter(n=>t.includes(n.type)&&(!open||!closed.test(n.status))).length;
 if(type==='project'){
  const p=await first<ProjectRow>('SELECT * FROM projects WHERE id=? AND tenant_id=?',src,u.tenantId);
  if(p&&(canManageProject(u,p)||hasAction(u,'requests')||hasAction(u,'procurement')||hasAction(u,'budgets'))){const f=await projectFinance(u.tenantId,p);out.push({label:'Approved budget',value:money(f.approved,f.currency)},{label:'Committed',value:money(f.committed,f.currency)},{label:'Actual',value:money(f.actual,f.currency)},{label:'Forecast variance',value:money(f.variance,f.currency),tone:f.variance<0?'red':'green'})}
  const today=new Date().toISOString().slice(0,10);out.push({label:'Open tasks',value:count(['task'],true)},{label:'Overdue',value:nodes.filter(n=>n.type==='task'&&!closed.test(n.status)&&String(n.meta.due||'9999')<today).length,tone:'amber'},{label:'Open risks & issues',value:nodes.filter(n=>['risk','issue'].includes(n.type)&&!/closed|resolved|mitigated/i.test(n.status)).length});
 }
 if(type==='asset'){
  const a=await first<{purchase_cost:number,warranty_until:string|null,purchase_date:string|null}>('SELECT purchase_cost,warranty_until,purchase_date FROM assets WHERE id=? AND tenant_id=?',src,u.tenantId);
  const wo=nodes.filter(n=>n.type==='work_order');const maint=wo.reduce((s,n)=>s+Number(n.meta.cost||0),0);
  if(a){out.push({label:'Purchase cost',value:a.purchase_cost||0},{label:'Maintenance cost',value:Math.round(maint*100)/100},{label:'Total cost of ownership',value:Math.round(((a.purchase_cost||0)+maint)*100)/100});const w=a.warranty_until;out.push({label:'Warranty',value:w?(w<new Date().toISOString().slice(0,10)?`Expired ${w}`:`Until ${w}`):'Not recorded',tone:w&&w<new Date().toISOString().slice(0,10)?'red':undefined})}
  out.push({label:'Open tickets',value:count(['ticket'],true)},{label:'Work orders',value:wo.length});
 }
 if(['customer','contract','initiative','goal'].includes(type)){const r=await first<{amount:number|null,currency:string,end_date:string|null,progress:number}>('SELECT amount,currency,end_date,progress FROM work_records WHERE id=? AND tenant_id=?',src,u.tenantId);if(r){if(r.amount!==null)out.push({label:type==='contract'?'Contract value':'Budget',value:money(r.amount,r.currency)});if(r.end_date)out.push({label:'Ends',value:r.end_date});out.push({label:'Progress',value:`${r.progress}%`})}out.push({label:'Connected projects',value:count(['project'])})}
 if(type==='person')out.push({label:'Open tasks',value:count(['task'],true)},{label:'Assets in custody',value:count(['asset'])},{label:'Projects',value:count(['project'])});
 return out;
}
const money=(n:number,c:string)=>`${c||''} ${Number(n||0).toLocaleString('en-US',{maximumFractionDigits:2})}`.trim();
// Short, citation-ready context for AI prompts (agents, assistant): titles and relationships only.
export async function contextForAi(u:Member,type:string,sourceId:string,maxItems=40){
 const c=await connectedContext(u,type,sourceId);
 const lines=c.sections.flatMap(s=>s.items.slice(0,8).map(i=>`- [${s.label}] ${i.label} “${i.title}” (${i.status||'—'}) ${i.relation?`— ${i.relation}`:''}${i.via?` via ${i.via.title}`:''} {${i.url}}`)).slice(0,maxItems);
 return {text:`Record: ${NODE_LABELS[c.root.type]||c.root.type} “${c.root.title}” (${c.root.status||'—'})\nFacts: ${c.facts.map(f=>`${f.label}: ${f.value}`).join('; ')||'none'}\nConnected records:\n${lines.join('\n')||'none'}${c.restricted?`\n(${c.restricted} connected records are not visible to this user and were omitted.)`:''}`,citations:c.sections.flatMap(s=>s.items.slice(0,8)).map((i,n)=>({n:n+1,type:i.label,title:i.title,link:i.url}))};
}
export {visibleNodes};
