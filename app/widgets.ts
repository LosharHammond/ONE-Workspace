// Controlled widget registry for the visual page builder, shared by the browser and the server.
// Pages are stored as JSON metadata only: no HTML, scripts or code. Every widget config is validated
// against this registry on the server before it is saved, and every data widget is resolved on the
// server with the viewer's own permissions (see server/widgets.ts).
//
// Adding a widget type (developers):
//  1. Add a WidgetDef below (type, fields, optional data source).
//  2. If it shows records, add a source in server/widgets.ts (query + visibility rule).
//  3. Render it in app/ui/builder.tsx (renderWidget). Company administrators then configure it without code.
export type FieldType='text'|'textarea'|'markdown'|'number'|'select'|'boolean'|'url'|'link'|'lines'|'source'|'report'|'connector'|'action';
export type WidgetField={key:string,label:string,type:FieldType,options?:string[],max?:number,min?:number,required?:boolean,hint?:string};
export type WidgetDef={type:string,label:string,icon:string,category:'Content'|'Data'|'Work'|'AI & connectors',description:string,fields:WidgetField[],source?:string,page?:string};
export type SourceDef={id:string,label:string,page:string,fields:string[],filters:Record<string,string[]|'text'>,sort:string[],dateField?:string,groupBy:string[]};

// Data sources a widget can read. The page is the permission page the viewer needs.
export const dataSources:SourceDef[]=[
 {id:'tickets',label:'Tickets',page:'maintenance',fields:['number','title','status','priority','category','department','assignee','due'],filters:{status:['Open','In progress','On hold','Resolved','Closed'],priority:['Low','Medium','High','Critical'],category:'text',department:'text',mine:['assigned','requested']},sort:['created','due','priority'],dateField:'due',groupBy:['status','priority','category','department']},
 {id:'assets',label:'Assets',page:'assets',fields:['code','name','category','status','location','department','assignee','warranty'],filters:{status:['In use','In store','Maintenance','Retired','Disposed','Lost'],category:'text',location:'text',department:'text',mine:['assigned']},sort:['code','name','warranty'],dateField:'warranty',groupBy:['status','category','location','department']},
 {id:'people',label:'People',page:'people',fields:['name','title','department','location','email','phone'],filters:{department:'text',location:'text'},sort:['name','department'],groupBy:['department','location']},
 {id:'requisitions',label:'Purchase requisitions',page:'requests',fields:['number','title','status','department','total','needed'],filters:{status:['Draft','Pending','Approved','Rejected','Converted','Cancelled'],department:'text',mine:['requested']},sort:['created','total','needed'],dateField:'needed',groupBy:['status','department']},
 {id:'orders',label:'Purchase orders',page:'procurement',fields:['number','title','status','department','total'],filters:{status:'text',department:'text'},sort:['created','total'],groupBy:['status','department']},
 {id:'approvals',label:'My approvals',page:'overview',fields:['number','title','step','total','since'],filters:{},sort:['since'],groupBy:[]},
 {id:'work_orders',label:'Work orders',page:'schedules',fields:['number','title','status','priority','assignee','due'],filters:{status:['Open','In progress','On hold','Completed','Cancelled'],priority:['Low','Medium','High','Critical'],mine:['assigned']},sort:['due','created'],dateField:'due',groupBy:['status','priority']},
 {id:'inventory',label:'Stock items',page:'inventory',fields:['sku','name','category','qty','min','unit'],filters:{category:'text',low:['yes']},sort:['name','qty'],groupBy:['category']},
 {id:'files',label:'Files',page:'documents',fields:['name','department','updated','size'],filters:{department:'text'},sort:['updated','name'],groupBy:['department']},
 {id:'announcements',label:'Announcements & pages',page:'knowledge',fields:['title','department','updated'],filters:{department:'text',kind:['announcement','page']},sort:['updated'],groupBy:['department']},
];
const common:WidgetField[]=[{key:'source',label:'Data source',type:'source',required:true},{key:'filters',label:'Filters',type:'text',hint:'field=value, separated by commas (e.g. status=Open, mine=assigned)',max:300},{key:'sort',label:'Sort by',type:'text',max:40},{key:'limit',label:'Rows',type:'number',min:1,max:50}];
export const widgetTypes:WidgetDef[]=[
 {type:'heading',label:'Heading',icon:'Heading2',category:'Content',description:'A section heading.',fields:[{key:'text',label:'Text',type:'text',required:true,max:140},{key:'level',label:'Size',type:'select',options:['1','2','3']}]},
 {type:'text',label:'Text',icon:'Type',category:'Content',description:'Formatted text (Markdown).',fields:[{key:'markdown',label:'Text',type:'markdown',required:true,max:8000}]},
 {type:'image',label:'Image',icon:'FileImage',category:'Content',description:'An image from Files or an https address.',fields:[{key:'url',label:'Image address',type:'url',required:true,max:500},{key:'alt',label:'Description',type:'text',max:200}]},
 {type:'button',label:'Button',icon:'Target',category:'Content',description:'A button to a page or website.',fields:[{key:'label',label:'Label',type:'text',required:true,max:60},{key:'link',label:'Link',type:'link',required:true,max:500},{key:'style',label:'Style',type:'select',options:['primary','secondary']}]},
 {type:'links',label:'Links',icon:'Link',category:'Content',description:'A list of links.',fields:[{key:'items',label:'Links',type:'lines',required:true,max:3000,hint:'One per line: Label | #/tickets or https://…'}]},
 {type:'form',label:'Request form',icon:'ClipboardList',category:'Work',description:'Lets people raise a ticket. Submitting uses their own permissions.',fields:[{key:'category',label:'Ticket category',type:'text',max:60},{key:'intro',label:'Intro text',type:'textarea',max:400}],page:'maintenance'},
 {type:'table',label:'Table',icon:'Table',category:'Data',description:'Records in rows and columns.',fields:[...common,{key:'columns',label:'Columns',type:'text',hint:'Comma separated field names',max:200}]},
 {type:'list',label:'List',icon:'List',category:'Data',description:'A compact list of records.',fields:common},
 {type:'kpi',label:'KPI card',icon:'Target',category:'Data',description:'A count of matching records.',fields:[{key:'source',label:'Data source',type:'source',required:true},{key:'filters',label:'Filters',type:'text',max:300}]},
 {type:'chart',label:'Chart',icon:'ChartColumn',category:'Data',description:'Records grouped into a bar or pie chart.',fields:[{key:'source',label:'Data source',type:'source',required:true},{key:'groupBy',label:'Group by',type:'text',required:true,max:40},{key:'kind',label:'Chart',type:'select',options:['bar','pie']},{key:'filters',label:'Filters',type:'text',max:300}]},
 {type:'calendar',label:'Calendar',icon:'CalendarClock',category:'Data',description:'Upcoming dates from tickets, work orders, requisitions or warranties.',fields:[{key:'source',label:'Data source',type:'source',required:true},{key:'days',label:'Days ahead',type:'number',min:1,max:365},{key:'filters',label:'Filters',type:'text',max:300}]},
 {type:'kanban',label:'Kanban board',icon:'Kanban',category:'Data',description:'Cards grouped by status.',fields:[{key:'source',label:'Data source',type:'source',required:true},{key:'filters',label:'Filters',type:'text',max:300},{key:'limit',label:'Cards',type:'number',min:1,max:100}]},
 {type:'tickets',label:'Tickets',icon:'LifeBuoy',category:'Work',description:'Ticket list (e.g. assigned to me).',source:'tickets',fields:[{key:'filters',label:'Filters',type:'text',max:300},{key:'limit',label:'Rows',type:'number',min:1,max:50}],page:'maintenance'},
 {type:'assets',label:'Assets',icon:'Boxes',category:'Work',description:'Asset list.',source:'assets',fields:[{key:'filters',label:'Filters',type:'text',max:300},{key:'limit',label:'Rows',type:'number',min:1,max:50}],page:'assets'},
 {type:'people',label:'People',icon:'Users',category:'Work',description:'People from the directory.',source:'people',fields:[{key:'filters',label:'Filters',type:'text',max:300},{key:'limit',label:'Rows',type:'number',min:1,max:50}],page:'people'},
 {type:'approvals',label:'My approvals',icon:'Stamp',category:'Work',description:'Documents waiting for the viewer’s approval.',source:'approvals',fields:[{key:'limit',label:'Rows',type:'number',min:1,max:50}]},
 {type:'files',label:'Files',icon:'FolderClosed',category:'Work',description:'Recent files.',source:'files',fields:[{key:'filters',label:'Filters',type:'text',max:300},{key:'limit',label:'Rows',type:'number',min:1,max:50}],page:'documents'},
 {type:'search',label:'Search',icon:'Search',category:'Work',description:'Workspace search box.',fields:[{key:'placeholder',label:'Placeholder',type:'text',max:80}]},
 {type:'report',label:'Embedded report',icon:'ChartColumn',category:'Data',description:'One of the workspace reports.',fields:[{key:'report',label:'Report',type:'report',required:true},{key:'limit',label:'Rows',type:'number',min:1,max:100}],page:'reports'},
 {type:'ai',label:'AI answer',icon:'Sparkles',category:'AI & connectors',description:'Asks the assistant a fixed question when the viewer clicks, using their permissions.',fields:[{key:'prompt',label:'Question',type:'textarea',required:true,max:500},{key:'buttonLabel',label:'Button label',type:'text',max:40}],page:'assistant'},
 {type:'connector',label:'Connector data',icon:'Link',category:'AI & connectors',description:'Rows from a connected service (read-only).',fields:[{key:'connector',label:'Connector',type:'connector',required:true},{key:'path',label:'Path or tool',type:'text',max:200,hint:'REST: /path relative to the base URL · MCP: a read-only tool name'},{key:'limit',label:'Rows',type:'number',min:1,max:50}],page:'connectors'},
];
export const widgetByType=new Map(widgetTypes.map(w=>[w.type,w]));
export type Widget={id:string,type:string,title?:string,description?:string,config:Record<string,unknown>,visibility?:{roles?:string[],departments?:string[],locations?:string[]},width?:number,refresh?:number};
export type Column={id:string,span:number,widgets:Widget[]};
export type Row={id:string,columns:Column[]};
export type Section={id:string,title?:string,kind:'grid'|'tabs',rows?:Row[],tabs?:{id:string,title:string,rows:Row[]}[]};
export type Layout={sections:Section[]};

export class LayoutError extends Error{}
const ID=/^[A-Za-z0-9_-]{1,40}$/;
const rid=()=>Math.random().toString(36).slice(2,10);
function text(v:unknown,max:number){if(v===undefined||v===null)return '';if(typeof v!=='string'&&typeof v!=='number')throw new LayoutError('Widget settings must be text.');const s=String(v);if(s.length>max)throw new LayoutError(`A widget setting is longer than ${max} characters.`);return s}
// Links: internal hash routes or https URLs only (no javascript:, data: or other schemes).
export function safeLink(v:string){const s=v.trim();if(!s)return '';if(/^#\/[\w\-/.%?=&]*$/.test(s))return s;try{const u=new URL(s);if(u.protocol==='https:')return u.toString()}catch{/* invalid */}throw new LayoutError(`"${s.slice(0,60)}" is not allowed. Use a workspace link (#/…) or an https address.`)}
function safeImage(v:string){const s=v.trim();if(/^\/api\/files\/(?:content|download)\?[\w=&%-]+$/.test(s))return s;return safeLink(s)}
export function parseFilters(v:string,source:SourceDef){const out:Record<string,string>={};for(const part of v.split(',').map(x=>x.trim()).filter(Boolean)){const [k,...rest]=part.split('=');const key=k.trim(),val=rest.join('=').trim();const allowed=source.filters[key];if(!allowed)throw new LayoutError(`"${key}" is not a filter for ${source.label}.`);if(Array.isArray(allowed)&&!allowed.includes(val))throw new LayoutError(`"${val}" is not a valid ${key} for ${source.label}.`);if(val.length>80)throw new LayoutError('Filter values must be short.');out[key]=val}return out}
function widget(w:any,lenient:boolean):Widget|null{
 const def=widgetByType.get(String(w?.type));if(!def){if(lenient)return null;throw new LayoutError(`Unknown widget type "${String(w?.type).slice(0,30)}".`)}
 const cfg=(w.config&&typeof w.config==='object'?w.config:{}) as Record<string,unknown>;const out:Record<string,unknown>={};
 for(const f of def.fields){
  let v=cfg[f.key];
  if(v===undefined||v===null||v===''){if(f.required&&!lenient)throw new LayoutError(`${def.label}: ${f.label} is required.`);continue}
  switch(f.type){
   case 'number':{const n=Number(v);if(!Number.isFinite(n))throw new LayoutError(`${def.label}: ${f.label} must be a number.`);v=Math.min(f.max??1e6,Math.max(f.min??0,Math.round(n)));break}
   case 'boolean':v=!!v;break;
   case 'select':v=text(v,40);if(f.options&&!f.options.includes(v as string)){if(lenient)continue;throw new LayoutError(`${def.label}: choose a valid ${f.label.toLowerCase()}.`)}break;
   case 'source':v=text(v,40);if(!dataSources.some(s=>s.id===v)){if(lenient)continue;throw new LayoutError(`${def.label}: choose a data source.`)}break;
   case 'url':v=safeImage(text(v,f.max||500));break;
   case 'link':v=safeLink(text(v,f.max||500));break;
   case 'lines':v=text(v,f.max||3000).split('\n').map(l=>{const [label,link]=l.split('|').map(x=>x.trim());return label&&link?`${label.slice(0,80)} | ${safeLink(link)}`:''}).filter(Boolean).join('\n');break;
   case 'report':case 'connector':case 'action':v=text(v,80);if(!ID.test(v as string)&&!/^[a-z-]+$/.test(v as string))throw new LayoutError(`${def.label}: choose a valid ${f.label.toLowerCase()}.`);break;
   default:v=text(v,f.max||500);
  }
  out[f.key]=v;
 }
 const src=dataSources.find(s=>s.id===(out.source||def.source));
 if(src&&typeof out.filters==='string'&&out.filters){try{parseFilters(out.filters,src)}catch(e){if(!lenient)throw e;delete out.filters}}
 if(src&&typeof out.groupBy==='string'&&!src.groupBy.includes(out.groupBy)){if(!lenient)throw new LayoutError(`${def.label}: ${src.label} can be grouped by ${src.groupBy.join(', ')||'nothing'}.`);delete out.groupBy}
 const list=(x:unknown)=>Array.isArray(x)?x.map(v=>text(v,120)).filter(Boolean).slice(0,50):[];
 const vis=w.visibility&&typeof w.visibility==='object'?{roles:list(w.visibility.roles),departments:list(w.visibility.departments),locations:list(w.visibility.locations)}:undefined;
 return {id:ID.test(String(w.id))?String(w.id):rid(),type:def.type,title:text(w.title,120),description:text(w.description,300),config:out,visibility:vis,width:[3,4,6,8,12].includes(Number(w.width))?Number(w.width):undefined,refresh:w.refresh?Math.min(3600,Math.max(30,Math.round(Number(w.refresh))||0))||undefined:undefined};
}
function rows(rs:any,lenient:boolean):Row[]{if(!Array.isArray(rs))return [];return rs.slice(0,30).map((r:any)=>{const cols=Array.isArray(r?.columns)?r.columns.slice(0,4):[];return {id:ID.test(String(r?.id))?String(r.id):rid(),columns:cols.map((c:any)=>({id:ID.test(String(c?.id))?String(c.id):rid(),span:[3,4,6,8,9,12].includes(Number(c?.span))?Number(c.span):Math.max(3,Math.floor(12/Math.max(1,cols.length))),widgets:(Array.isArray(c?.widgets)?c.widgets.slice(0,20):[]).map((w:any)=>widget(w,lenient)).filter(Boolean) as Widget[]}))}})}
// Validates (strict) or repairs (lenient, for AI suggestions) a page layout.
export function validateLayout(input:any,lenient=false):Layout{
 // AI suggestions use a simpler shape: sections → columns → widgets.
 const sections=Array.isArray(input?.sections)?input.sections.slice(0,20):[];
 const out:Section[]=sections.map((s:any)=>{
  const base={id:ID.test(String(s?.id))?String(s.id):rid(),title:text(s?.title,120)};
  if(s?.kind==='tabs')return {...base,kind:'tabs' as const,tabs:(Array.isArray(s.tabs)?s.tabs.slice(0,8):[]).map((t:any)=>({id:ID.test(String(t?.id))?String(t.id):rid(),title:text(t?.title,60)||'Tab',rows:rows(t?.rows,lenient)}))};
  const rs=Array.isArray(s?.rows)?s.rows:Array.isArray(s?.columns)?[{columns:s.columns}]:[];
  return {...base,kind:'grid' as const,rows:rows(rs,lenient)};
 });
 const count=JSON.stringify(out).length;if(count>200000)throw new LayoutError('This page is too large. Split it into several pages.');
 return {sections:out};
}
