import {hasAction,canActOn,departmentKey} from '../access-policy';
import {all,HttpError} from './core';
import {canSeeAsset,canSeeTicket,canSeeDoc,canSeeFile,canSeePage,type AssetRow,type TicketRow,type PurchaseRow,type FileRow,type PageRow} from './entities';
import {widgetTypes,widgetByType,dataSources,parseFilters,validateLayout as validate,LayoutError,type Widget,type Layout} from '../widgets';
import {connectorRead} from './connectors';
import type {Member} from './policy';

// Resolves builder widgets on the server. The workspace is always the viewer's (u.tenantId) and every row
// passes the same visibility rule as its module: a widget can never show another company's data or a record
// the viewer could not open themselves.
export function validateLayout(input:unknown,lenient=false):Layout{try{return validate(input,lenient)}catch(e){if(e instanceof LayoutError)throw new HttpError(400,e.message);throw e}}
export function widgetCatalogForAi(){return {widgets:widgetTypes.map(w=>({type:w.type,label:w.label,description:w.description,config:Object.fromEntries(w.fields.map(f=>[f.key,f.options?f.options.join('|'):f.type]))})),sources:dataSources.map(s=>({id:s.id,label:s.label,fields:s.fields,filters:Object.fromEntries(Object.entries(s.filters).map(([k,v])=>[k,Array.isArray(v)?v.join('|'):'text'])),groupBy:s.groupBy}))}}
// Who may see a widget (roles, departments, locations); editors always see everything.
export function widgetVisible(u:Member,w:Widget){const v=w.visibility;if(!v||u.role==='admin')return true;if(v.roles?.length&&!v.roles.includes(u.roleId||'')&&!v.roles.includes(u.role))return false;if(v.departments?.length&&!v.departments.some(d=>departmentKey(d)===departmentKey(u.department)))return false;if(v.locations?.length&&!v.locations.some(l=>(u.location||'').toLowerCase().startsWith(l.toLowerCase())))return false;return true}
export function filterLayout(u:Member,l:Layout):Layout{const rows=(rs:Layout['sections'][number]['rows'])=>(rs||[]).map(r=>({...r,columns:r.columns.map(c=>({...c,widgets:c.widgets.filter(w=>widgetVisible(u,w))}))}));return {sections:l.sections.map(s=>s.kind==='tabs'?{...s,tabs:(s.tabs||[]).map(t=>({...t,rows:rows(t.rows)}))}:{...s,rows:rows(s.rows)})}}

type Out={id:string,link:string,[k:string]:unknown};
const day=(s:string|null|undefined)=>s?s.slice(0,10):'';
async function names(u:Member){return new Map((await all<{id:string,name:string}>('SELECT id,name FROM members WHERE tenant_id=?',u.tenantId)).map(m=>[m.id,m.name]))}
async function load(u:Member,source:string,f:Record<string,string>):Promise<Out[]>{
 const src=dataSources.find(s=>s.id===source);if(!src)throw new HttpError(400,'Unknown data source.');
 if(!hasAction(u,src.page))throw new HttpError(403,`${src.label} are not available to you.`);
 const n=await names(u);const eq=(a:string,b?:string)=>!b||(a||'').toLowerCase()===b.toLowerCase();
 switch(source){
  case 'tickets':return (await all<TicketRow>('SELECT * FROM tickets WHERE tenant_id=? ORDER BY created_at DESC LIMIT 500',u.tenantId)).filter(t=>canSeeTicket(u,t)&&eq(t.status,f.status)&&eq(t.priority,f.priority)&&eq(t.category,f.category)&&eq(t.department,f.department)&&(f.mine!=='assigned'||t.assignee_id===u.id)&&(f.mine!=='requested'||t.requester_id===u.id)).map(t=>({id:t.id,link:`#/tickets/${t.id}`,number:t.number,title:t.title,status:t.status,priority:t.priority,category:t.category,department:t.department,assignee:t.assignee_id?n.get(t.assignee_id)||'':'',due:day(t.due_at),created:t.created_at}));
  case 'assets':return (await all<AssetRow>('SELECT * FROM assets WHERE tenant_id=? ORDER BY code LIMIT 1000',u.tenantId)).filter(a=>canSeeAsset(u,a)&&eq(a.status,f.status)&&eq(a.category,f.category)&&eq(a.department,f.department)&&(!f.location||(a.location||'').toLowerCase().startsWith(f.location.toLowerCase()))&&(f.mine!=='assigned'||a.assigned_to===u.id)).map(a=>({id:a.id,link:`#/assets/${a.id}`,code:a.code,name:a.name,category:a.category,status:a.status,location:a.location,department:a.department,assignee:a.assigned_to?n.get(a.assigned_to)||'':'',warranty:day(a.warranty_until)}));
  case 'people':return (await all<{id:string,name:string,title:string,department:string,location:string,email:string,phone:string}>('SELECT id,name,title,department,location,email,phone FROM members WHERE tenant_id=? AND active=1 ORDER BY name LIMIT 1000',u.tenantId)).filter(p=>eq(p.department,f.department)&&(!f.location||(p.location||'').toLowerCase().startsWith(f.location.toLowerCase()))).map(p=>({...p,link:`#/people/directory/${p.id}`}));
  case 'requisitions':case 'orders':{
   const kind=source==='orders'?'PO':'PR';
   return (await all<PurchaseRow>("SELECT d.*,(SELECT group_concat(j.value) FROM approvals a, json_each(a.approver_ids) j WHERE a.doc_id=d.id AND a.tenant_id=d.tenant_id) AS approver_ids FROM purchase_docs d WHERE d.tenant_id=? AND d.kind=? ORDER BY d.created_at DESC LIMIT 500",u.tenantId,kind)).filter(d=>canSeeDoc(u,d)&&eq(d.status,f.status)&&eq(d.department,f.department)&&(f.mine!=='requested'||d.requester_id===u.id)).map(d=>({id:d.id,link:`#/purchasing/${kind.toLowerCase()}/${d.id}`,number:d.number,title:d.title,status:d.status,department:d.department,total:d.total,needed:day(d.needed_by),created:d.created_at}));
  }
  case 'approvals':return (await all<{id:string,kind:string,number:string,title:string,total:number,step:string,since:string}>("SELECT d.id,d.kind,d.number,d.title,d.total,a.step_name AS step,a.created_at AS since FROM approvals a JOIN purchase_docs d ON d.id=a.doc_id AND d.tenant_id=a.tenant_id WHERE a.tenant_id=? AND a.status='Pending' AND d.requester_id!=? AND EXISTS(SELECT 1 FROM json_each(a.approver_ids) j WHERE j.value=?) ORDER BY a.created_at LIMIT 100",u.tenantId,u.id,u.id)).map(d=>({...d,since:day(d.since),link:`#/purchasing/${d.kind.toLowerCase()}/${d.id}`}));
  case 'work_orders':return (await all<{id:string,number:string,title:string,status:string,priority:string,assignee_id:string|null,department:string,created_by:string,due_at:string|null,created_at:string}>('SELECT id,number,title,status,priority,assignee_id,department,created_by,due_at,created_at FROM work_orders WHERE tenant_id=? ORDER BY created_at DESC LIMIT 500',u.tenantId)).filter(o=>(o.assignee_id===u.id||canActOn(u,'schedules','view',o.department||u.department,o.created_by))&&eq(o.status,f.status)&&eq(o.priority,f.priority)&&(f.mine!=='assigned'||o.assignee_id===u.id)).map(o=>({id:o.id,link:`#/maintenance/orders/${o.id}`,number:o.number,title:o.title,status:o.status,priority:o.priority,assignee:o.assignee_id?n.get(o.assignee_id)||'':'',due:day(o.due_at),created:o.created_at}));
  case 'inventory':return (await all<{id:string,sku:string,name:string,category:string,unit:string,min:number,qty:number}>('SELECT i.id,i.sku,i.name,i.category,i.unit,i.min_stock AS min,(SELECT coalesce(sum(s.qty),0) FROM stock_levels s WHERE s.item_id=i.id AND s.tenant_id=i.tenant_id) AS qty FROM inventory_items i WHERE i.tenant_id=? ORDER BY i.name LIMIT 1000',u.tenantId)).filter(i=>eq(i.category,f.category)&&(f.low!=='yes'||i.qty<=i.min)).map(i=>({...i,link:`#/inventory/items/${i.id}`}));
  case 'files':return (await all<FileRow>('SELECT * FROM files WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 500',u.tenantId)).filter(x=>canSeeFile(u,x)&&eq(x.department,f.department)).map(x=>({id:x.id,link:`#/files/${x.folder_id||'root'}/${x.id}`,name:x.name,department:x.department||'Company',updated:day(x.updated_at),size:x.bytes}));
  case 'announcements':return (await all<PageRow>("SELECT * FROM pages WHERE tenant_id=? AND status='Published' ORDER BY updated_at DESC LIMIT 300",u.tenantId)).filter(p=>canSeePage(u,p)&&eq(p.department,f.department)&&(!f.kind||p.kind===f.kind)).map(p=>({id:p.id,link:`#/spaces/page/${p.id}`,title:p.title,department:p.department||'Company',updated:day(p.updated_at)}));
 }
 throw new HttpError(400,'Unknown data source.');
}
const sorters:Record<string,(a:Out,b:Out)=>number>={
 created:(a,b)=>String(b.created||'').localeCompare(String(a.created||'')),updated:(a,b)=>String(b.updated||'').localeCompare(String(a.updated||'')),
 due:(a,b)=>String(a.due||'9999').localeCompare(String(b.due||'9999')),needed:(a,b)=>String(a.needed||'9999').localeCompare(String(b.needed||'9999')),warranty:(a,b)=>String(a.warranty||'9999').localeCompare(String(b.warranty||'9999')),
 priority:(a,b)=>['Critical','High','Medium','Low'].indexOf(String(a.priority))-['Critical','High','Medium','Low'].indexOf(String(b.priority)),
 total:(a,b)=>Number(b.total||0)-Number(a.total||0),qty:(a,b)=>Number(a.qty||0)-Number(b.qty||0),since:(a,b)=>String(a.since||'').localeCompare(String(b.since||'')),
};
// Data for one validated widget, shaped for its display.
export async function widgetData(u:Member,raw:unknown){
 const layout=validateLayout({sections:[{rows:[{columns:[{widgets:[raw]}]}]}]});
 const w=layout.sections[0].rows![0].columns[0].widgets[0];
 const def=widgetByType.get(w.type)!;
 if(def.page&&!hasAction(u,def.page))throw new HttpError(403,`${def.label} widgets are not available to you.`);
 if(w.type==='connector')return {rows:await connectorRead(u,String(w.config.connector),String(w.config.path||''),Number(w.config.limit||20))};
 const sourceId=String(w.config.source||def.source||'');if(!sourceId)return {};
 const src=dataSources.find(s=>s.id===sourceId)!;
 let filters:Record<string,string>={};try{filters=parseFilters(String(w.config.filters||''),src)}catch(e){throw new HttpError(400,(e as Error).message)}
 let rows=await load(u,sourceId,filters);
 if(w.type==='kpi')return {count:rows.length,label:src.label};
 if(w.type==='chart'||w.type==='kanban'){const key=w.type==='kanban'?'status':String(w.config.groupBy||src.groupBy[0]||'status');const groups=new Map<string,Out[]>();for(const r of rows){const g=String(r[key]??'')||'—';groups.set(g,[...(groups.get(g)||[]),r])}const limit=Number(w.config.limit||60);return {groups:[...groups.entries()].map(([name,items])=>({name,count:items.length,items:w.type==='kanban'?items.slice(0,limit):[]})).sort((a,b)=>b.count-a.count)}}
 if(w.type==='calendar'){const field=src.dateField;if(!field)throw new HttpError(400,`${src.label} have no dates for a calendar.`);const today=new Date().toISOString().slice(0,10),end=new Date(Date.now()+Number(w.config.days||30)*86400000).toISOString().slice(0,10);rows=rows.filter(r=>{const d=String(r[field]||'');return d&&d<=end&&d>=new Date(Date.now()-7*86400000).toISOString().slice(0,10)}).sort((a,b)=>String(a[field]).localeCompare(String(b[field])));return {events:rows.slice(0,100).map(r=>({id:r.id,link:r.link,date:r[field],title:r.title||r.name,overdue:String(r[field])<today}))}}
 const sort=String(w.config.sort||'');if(sorters[sort])rows=[...rows].sort(sorters[sort]);
 const limit=Number(w.config.limit||10);
 const columns=String(w.config.columns||'').split(',').map(c=>c.trim()).filter(c=>src.fields.includes(c));
 return {rows:rows.slice(0,limit),total:rows.length,columns:columns.length?columns:src.fields.slice(0,5)};
}
