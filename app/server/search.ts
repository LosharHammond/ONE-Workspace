import {hasAction,canActOn} from '../access-policy';
import {all,first} from './core';
import {canSeeAsset,canSeeTicket,canWorkTicket,canSeeDoc,canSeeFile,canSeePage,type AssetRow,type TicketRow,type PurchaseRow,type FileRow,type PageRow} from './entities';
import type {Member} from './policy';
import {canSeeTask,taskContext,canSeeProject,canAccessChannel,TASK_SELECT,type TaskRow,type ProjectRow,type ChannelRow} from './collab';

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
export type SourceType='person'|'ticket'|'doc'|'asset'|'page'|'file'|'vendor'|'item'|'order'|'task'|'project'|'message';
type Clause={sql:string,binds:string[]}|null;
// Loads matching records of every type the person may see, with each module's visibility rule applied.
// `clause(type,cols,idCol)` returns the WHERE fragment for that type, or null to skip the type.
async function collect(u:Member,clause:(type:SourceType,cols:string[],idCol:string)=>Clause,limit:number):Promise<Hit[]>{
 const c={person:clause('person',['name','email','title','department'],'id'),asset:clause('asset',['name','code','serial','model','category','location','notes'],'id'),ticket:clause('ticket',['title','number','description','category'],'id'),doc:clause('doc',['d.title','d.number','d.justification'],'d.id'),file:(()=>{const c=clause('file',['name','tags','description'],'id');if(!c||!/LIKE/.test(c.sql))return c;const terms=c.binds.filter((_,i)=>i%3===0);const extra=terms.map(()=>"EXISTS(SELECT 1 FROM file_artifacts a WHERE a.tenant_id=files.tenant_id AND a.file_id=files.id AND a.kind IN ('summary','text') AND a.content LIKE ?)").join(' OR ');return {sql:`(${c.sql} OR ${extra})`,binds:[...c.binds,...terms]}})(),task:clause('task',['t.title','t.description','t.tags','t.number'],'t.id'),project:clause('project',['name','code','description','business_case','tags'],'id'),message:clause('message',['body'],'id'),page:clause('page',['title','body'],'id'),vendor:clause('vendor',['name','category'],'id'),item:clause('item',['i.name','i.sku','i.category'],'i.id'),order:clause('order',['title','number','description'],'id')};
 const q=<T,>(ok:boolean,cl:Clause,sql:(w:string)=>string):Promise<T[]>=>ok&&cl?all<T>(sql(cl.sql),u.tenantId,...cl.binds):Promise.resolve([]);
 const [people,assets,tickets,docs,files,pages,vendors,items,orders,taskRows,projectRows,messageRows]=await Promise.all([
  q<{id:string,name:string,email:string,department:string,title:string,phone:string,location:string}>(hasAction(u,'people'),c.person,w=>`SELECT id,name,email,department,title,phone,location FROM members WHERE tenant_id=? AND active=1 AND ${w} LIMIT ${Math.min(limit,20)}`),
  q<AssetRow>(true,c.asset,w=>`SELECT * FROM assets WHERE tenant_id=? AND ${w} LIMIT ${limit}`),
  q<TicketRow>(true,c.ticket,w=>`SELECT * FROM tickets WHERE tenant_id=? AND ${w} ORDER BY created_at DESC LIMIT ${limit}`),
  q<PurchaseRow>(true,c.doc,w=>`SELECT d.*,(SELECT group_concat(j.value) FROM approvals a, json_each(a.approver_ids) j WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id) AS approver_ids FROM purchase_docs d WHERE d.tenant_id=? AND ${w} ORDER BY d.created_at DESC LIMIT ${limit}`),
  q<FileRow>(true,c.file,w=>`SELECT * FROM files WHERE tenant_id=? AND ${w} LIMIT ${limit}`),
  q<PageRow>(true,c.page,w=>`SELECT * FROM pages WHERE tenant_id=? AND ${w} LIMIT ${limit}`),
  q<{id:string,name:string,category:string,email:string,phone:string}>(hasAction(u,'suppliers'),c.vendor,w=>`SELECT id,name,category,email,phone FROM vendors WHERE tenant_id=? AND ${w} LIMIT ${Math.min(limit,20)}`),
  q<{id:string,sku:string,name:string,category:string,unit:string,min_stock:number,qty:number}>(hasAction(u,'inventory'),c.item,w=>`SELECT i.id,i.sku,i.name,i.category,i.unit,i.min_stock,(SELECT coalesce(sum(s.qty),0) FROM stock_levels s WHERE s.item_id=i.id AND s.tenant_id=i.tenant_id) AS qty FROM inventory_items i WHERE i.tenant_id=? AND ${w} LIMIT ${Math.min(limit,20)}`).catch(()=>[]),
  q<{id:string,number:string,title:string,description:string,status:string,department:string,assignee_id:string|null,created_by:string,due_at:string|null}>(hasAction(u,'schedules'),c.order,w=>`SELECT id,number,title,description,status,department,assignee_id,created_by,due_at FROM work_orders WHERE tenant_id=? AND ${w} ORDER BY created_at DESC LIMIT ${limit}`),
  q<TaskRow>(!u.disabledPages?.includes('tasks'),c.task,w=>`SELECT ${TASK_SELECT} FROM tasks t WHERE t.tenant_id=? AND t.deleted_at IS NULL AND ${w} ORDER BY t.updated_at DESC LIMIT ${limit}`).catch(()=>[]),
  q<ProjectRow>(!u.disabledPages?.includes('projects'),c.project,w=>`SELECT * FROM projects WHERE tenant_id=? AND ${w} LIMIT ${Math.min(limit,30)}`).catch(()=>[]),
  q<{id:string,channel_id:string,thread_id:string|null,author_id:string,body:string,created_at:string}>(!u.disabledPages?.includes('messages'),c.message,w=>`SELECT id,channel_id,thread_id,author_id,body,created_at FROM messages WHERE tenant_id=? AND deleted_at IS NULL AND hidden=0 AND ${w} ORDER BY created_at DESC LIMIT ${limit}`).catch(()=>[]),
 ]);
 // Tasks, projects and messages pass the same visibility rules as their modules.
 const tctx=await taskContext(u,taskRows);
 const channelIds=[...new Set(messageRows.map(m=>m.channel_id))];const channels=channelIds.length?await all<ChannelRow>(`SELECT * FROM channels WHERE tenant_id=? AND id IN (${channelIds.map(()=>'?').join(',')})`,u.tenantId,...channelIds):[];const okChannels=new Set<string>();for(const ch of channels)if(await canAccessChannel(u,ch))okChannels.add(ch.id);
 const visibleFiles=files.filter(f=>canSeeFile(u,f));const sums=visibleFiles.length?await all<{file_id:string,content:string}>(`SELECT file_id,content FROM file_artifacts WHERE tenant_id=? AND kind='summary' AND file_id IN (${visibleFiles.slice(0,100).map(()=>'?').join(',')})`,u.tenantId,...visibleFiles.slice(0,100).map(f=>f.id)):[];const summaryOf=new Map(sums.map(x=>[x.file_id,String((JSON.parse(x.content||'{}') as {short?:string}).short||'')]));
 return [
  ...people.map(p=>({type:'Person',id:p.id,title:p.name,sub:[p.title,p.department,p.email].filter(Boolean).join(' · '),link:`#/people/directory/${p.id}`,text:`${p.name}; ${p.title||''}; department ${p.department}; ${p.email}; ${p.location||''}`,score:0})),
  ...tickets.filter(t=>canSeeTicket(u,t)).map(t=>({type:'Ticket',id:t.id,title:`${t.number} · ${t.title}`,sub:`${t.status} · ${t.priority}`,link:`#/tickets/${t.id}`,text:`Ticket ${t.number} "${t.title}". Status ${t.status}, priority ${t.priority}, category ${t.category||'—'}, department ${t.department}, created ${t.created_at.slice(0,10)}${t.due_at?`, due ${t.due_at.slice(0,16)}`:''}. ${clip(t.description,500)}`,score:0})),
  ...docs.filter(d=>canSeeDoc(u,d)).map(d=>({type:d.kind==='PR'?'Requisition':'Purchase order',id:d.id,title:`${d.number} · ${d.title}`,sub:d.status,link:`#/purchasing/${d.kind.toLowerCase()}/${d.id}`,text:`${d.kind} ${d.number} "${d.title}". Status ${d.status}, total ${d.currency} ${d.total}, department ${d.department}, created ${d.created_at.slice(0,10)}. ${clip(d.justification,400)}`,score:0})),
  ...assets.filter(a=>canSeeAsset(u,a)).map(a=>({type:'Asset',id:a.id,title:`${a.code} · ${a.name}`,sub:`${a.status}${a.location?' · '+a.location:''}`,link:`#/assets/${a.id}`,text:`Asset ${a.code} "${a.name}". Category ${a.category}, status ${a.status}, condition ${a.condition||'—'}, location ${a.location||'—'}, department ${a.department||'—'}, ${a.brand||''} ${a.model||''} serial ${a.serial||'—'}, purchased ${a.purchase_date||'—'}, warranty until ${a.warranty_until||'—'}. ${clip(a.notes,200)}`,score:0})),
  ...pages.filter(p=>canSeePage(u,p)).map(p=>({type:'Page',id:p.id,title:p.title,sub:p.department||'Company',link:`#/spaces/page/${p.id}`,text:`${p.kind==='announcement'?'Announcement':'Page'} "${p.title}" (${p.department||'Company'}, ${p.status}, updated ${p.updated_at.slice(0,10)}): ${clip(p.body,1200)}`,score:0})),
  ...visibleFiles.map(f=>({type:'File',id:f.id,title:f.name,sub:f.department||'Company files',link:`#/files/${f.folder_id||'root'}/${f.id}`,text:`File "${f.name}" (${f.mime}, ${f.department||'company'}, tags ${f.tags||'—'}): ${clip(f.description,300)}${summaryOf.get(f.id)?` Summary: ${clip(summaryOf.get(f.id),800)}`:''}`,score:0})),
  ...taskRows.filter(t=>canSeeTask(u,t,tctx.projects,tctx.spaces)).map(t=>({type:'Task',id:t.id,title:t.title,sub:`${t.status}${t.due_date?` · due ${t.due_date}`:''}`,link:`#/tasks/all/${t.id}`,text:`Task "${t.title}" (${t.type}), status ${t.status}, priority ${t.priority}${t.due_date?`, due ${t.due_date}`:''}${t.project_id?', in a project':''}. ${clip(t.description,500)}`,score:0})),
  ...projectRows.filter(p=>canSeeProject(u,p)).map(p=>({type:'Project',id:p.id,title:`${p.code} · ${p.name}`,sub:`${p.stage} · ${p.health}`,link:`#/projects/${p.id}`,text:`Project ${p.code} "${p.name}" (${p.type}), stage ${p.stage}, health ${p.health}, progress ${p.progress}%, department ${p.department}, start ${p.start_date||'—'}, target ${p.target_date||'—'}. ${clip(p.description,600)}`,score:0})),
  ...messageRows.filter(m=>okChannels.has(m.channel_id)).map(m=>({type:'Message',id:m.id,title:clip(m.body,80),sub:m.created_at.slice(0,10),link:`#/messages/${m.channel_id}`,text:`Message posted ${m.created_at.slice(0,16)}: ${clip(m.body,600)}`,score:0})),
  ...vendors.map(v=>({type:'Vendor',id:v.id,title:v.name,sub:v.category||'Vendor',link:`#/purchasing/vendors/${v.id}`,text:`Vendor ${v.name}; category ${v.category||'—'}; ${v.email||''} ${v.phone||''}`,score:0})),
  ...items.map(i=>({type:'Stock item',id:i.id,title:`${i.sku} · ${i.name}`,sub:`${i.qty} ${i.unit} in stock`,link:`#/inventory/items/${i.id}`,text:`Stock item ${i.sku} "${i.name}", category ${i.category}, ${i.qty} ${i.unit} on hand, reorder level ${i.min_stock}${i.qty<=i.min_stock?' (below reorder level)':''}`,score:0})),
  ...orders.filter(o=>o.assignee_id===u.id||canActOn(u,'schedules','view',o.department||u.department,o.created_by)).map(o=>({type:'Work order',id:o.id,title:`${o.number} · ${o.title}`,sub:o.status,link:`#/maintenance/orders/${o.id}`,text:`Work order ${o.number} "${o.title}", status ${o.status}${o.due_at?`, due ${o.due_at.slice(0,10)}`:''}. ${clip(o.description,300)}`,score:0})),
 ];
}
function perTypeCap(hits:Hit[],perType:number){const byType=new Map<string,number>();return hits.filter(h=>{const n=byType.get(h.type)||0;if(n>=perType)return false;byType.set(h.type,n+1);return true})}
// Keyword search.
// Work Graph records that have no module search of their own (goals, customers, contracts, services,
// meetings, decisions, Studio app records, synced external records). searchNodes re-checks visibility.
const GRAPH_ONLY=['goal','objective','initiative','customer','contract','service','meeting','decision','studio_record','external'];
async function graphHits(u:Member,terms:string[]):Promise<Hit[]>{
 if(!hasAction(u,'graph'))return [];
 const {searchNodes}=await import('./graph');
 const nodes=await searchNodes(u,terms.join(' '),GRAPH_ONLY,20).catch(()=>[]);
 return nodes.map(n=>({type:n.label,id:n.sourceId,title:n.title,sub:[n.status,n.provider?`from ${n.provider}`:''].filter(Boolean).join(' · '),link:n.url,text:`${n.label} "${n.title}"${n.status?`, status ${n.status}`:''}${n.department?`, ${n.department}`:''}. ${clip(n.summary||'',500)}${n.provider?` (source: ${n.provider}, ${n.syncMode||'live'})`:''}`,score:0}));
}
// Maps an app route to the Work Graph record it shows, for connected context in the assistant.
export function routeGraphRef(route:string):{type:string,id:string}|null{
 const p=route.replace(/^#?\/?/,'').split('?')[0].split('/');const id=(x?:string)=>x&&/^[A-Za-z0-9_-]{8,80}$/.test(x)?x:null;
 switch(p[0]){
  case 'tickets':return id(p[1])?{type:'ticket',id:p[1]}:null;
  case 'assets':return id(p[1])?{type:'asset',id:p[1]}:id(p[2])?{type:'asset',id:p[2]}:null;
  case 'projects':return id(p[1])?{type:'project',id:p[1]}:null;
  case 'tasks':return id(p[2])?{type:'task',id:p[2]}:null;
  case 'purchasing':return (p[1]==='pr'||p[1]==='po')&&id(p[2])?{type:p[1].toUpperCase(),id:p[2]}:null;
  case 'people':return p[1]==='directory'&&id(p[2])?{type:'person',id:p[2]}:null;
  case 'files':return id(p[2])?{type:'file',id:p[2]}:null;
  case 'maintenance':return p[1]==='orders'&&id(p[2])?{type:'work_order',id:p[2]}:null;
  case 'business':return id(p[2])?{type:p[1],id:p[2]}:null;
  case 'apps':return p[2]==='table'&&id(p[4])?{type:'studio_record',id:p[4]}:null;
 }
 return null;
}
export async function searchWorkspace(u:Member,terms:string[],perType=8):Promise<Hit[]>{
 if(!terms.length)return [];
 const hits=[...await collect(u,(_t,cols)=>where(cols,terms),60),...await graphHits(u,terms)];
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
 // Files: the generated summary and the start of the extracted text or transcript (same access as the file).
 if(app==='files'){const fr=await first<FileRow&{deleted_at:string|null}>('SELECT * FROM files WHERE id=? AND tenant_id=?',id,u.tenantId);if(fr&&canSeeFile(u,fr)){const arts=await all<{kind:string,content:string}>("SELECT kind,content FROM file_artifacts WHERE tenant_id=? AND file_id=? AND kind IN ('summary','text','transcript_edit') ORDER BY created_at DESC",u.tenantId,fr.id);const sum=arts.find(x=>x.kind==='summary')?.content||'';const txt=arts.find(x=>x.kind==='transcript_edit')?(JSON.parse(arts.find(x=>x.kind==='transcript_edit')!.content) as {text:string,speaker?:string}[]).map(x=>(x.speaker?x.speaker+': ':'')+x.text).join(' '):arts.find(x=>x.kind==='text')?.content||'';return {type:'File',id:fr.id,title:fr.name,sub:fr.processing_status||'',link:`#/files/${fr.folder_id||'root'}/${fr.id}`,score:99,text:`File "${fr.name}" (${fr.mime}). Processing: ${fr.processing_status}. Summary: ${clip(sum,3000)}. Content (untrusted): ${clip(txt,9000)}`}}}
 if(app==='projects'){const pr=await first<ProjectRow>('SELECT * FROM projects WHERE id=? AND tenant_id=?',id,u.tenantId);if(pr&&canSeeProject(u,pr)){const [open,overdue,risks]=await Promise.all([first<{n:number}>("SELECT count(*) AS n FROM tasks WHERE tenant_id=? AND project_id=? AND deleted_at IS NULL AND status NOT IN ('Done','Cancelled')",u.tenantId,pr.id),first<{n:number}>("SELECT count(*) AS n FROM tasks WHERE tenant_id=? AND project_id=? AND deleted_at IS NULL AND status NOT IN ('Done','Cancelled') AND due_date<date('now')",u.tenantId,pr.id),all<{title:string,status:string}>("SELECT title,status FROM project_records WHERE tenant_id=? AND project_id=? AND kind IN ('risk','issue') AND deleted_at IS NULL LIMIT 20",u.tenantId,pr.id)]);return {type:'Project',id:pr.id,title:`${pr.code} · ${pr.name}`,sub:pr.stage,link:`#/projects/${pr.id}`,score:99,text:`Project ${pr.code} "${pr.name}" (${pr.type}), stage ${pr.stage}, health ${pr.health}, progress ${pr.progress}%, start ${pr.start_date||'—'}, target ${pr.target_date||'—'}, approved budget ${pr.currency} ${pr.approved_budget}. Open tasks ${open?.n||0}, overdue ${overdue?.n||0}. Risks and issues: ${risks.map(r=>`${r.title} (${r.status})`).join('; ')||'none'}. ${clip(pr.description,1500)}`}}}
 if(app==='tasks'){const tr=await first<TaskRow>(`SELECT ${TASK_SELECT} FROM tasks t WHERE t.id=? AND t.tenant_id=?`,id,u.tenantId);if(tr){const c=await taskContext(u,[tr]);if(canSeeTask(u,tr,c.projects,c.spaces))return {type:'Task',id:tr.id,title:tr.title,sub:tr.status,link:`#/tasks/all/${tr.id}`,score:99,text:`Task "${tr.title}", status ${tr.status}, priority ${tr.priority}, due ${tr.due_date||'—'}. ${clip(tr.description,2000)}`}}}
 if(app==='messages'){const ch=await first<ChannelRow>('SELECT * FROM channels WHERE id=? AND tenant_id=?',id,u.tenantId);if(ch&&await canAccessChannel(u,ch)){const msgs=await all<{body:string,created_at:string,name:string|null}>('SELECT x.body,x.created_at,m.name FROM messages x LEFT JOIN members m ON m.id=x.author_id WHERE x.tenant_id=? AND x.channel_id=? AND x.deleted_at IS NULL AND x.hidden=0 ORDER BY x.created_at DESC LIMIT 40',u.tenantId,ch.id);return {type:'Conversation',id:ch.id,title:`#${ch.name}`,sub:'',link:`#/messages/${ch.id}`,score:99,text:`Recent messages (untrusted), newest last: ${msgs.reverse().map(m=>`[${m.created_at.slice(0,16)}] ${m.name||'Someone'}: ${clip(m.body,300)}`).join(' | ')}`}}}
 return null;
}
