'use client';
import {useState} from 'react';
import {useApi,go,downloadCsv} from './lib';
import {Header,Grid,ErrorNote,Skeleton,Empty,Btn,Chip,Icon,Stat,type Col} from './kit';

type ReportInfo={id:string,title:string,page:string};
type ReportMeta={category:string,description:string,icon:string,tone:string};
const REPORT_META:Record<string,ReportMeta>={
 'tickets-sla':{category:'Service desk',description:'Compare ticket volume, resolution time, overdue work and SLA performance by category and priority.',icon:'Gauge',tone:'orange'},
 'tickets-aging':{category:'Service desk',description:'See where open tickets are accumulating and which age bands contain overdue work.',icon:'Clock',tone:'orange'},
 'assets-register':{category:'Assets & operations',description:'Review the complete asset register with ownership, cost, warranty and current book value.',icon:'Boxes',tone:'teal'},
 'assets-by-location':{category:'Assets & operations',description:'Understand asset distribution, status and value across every company location.',icon:'MapPin',tone:'teal'},
 'inventory-valuation':{category:'Assets & operations',description:'Track on-hand value, minimum levels and the items that need replenishment.',icon:'Package',tone:'amber'},
 'maintenance-costs':{category:'Assets & operations',description:'Compare work-order volume, overdue maintenance, parts and labour cost by asset.',icon:'Wrench',tone:'indigo'},
 'purchasing-spend':{category:'Finance & purchasing',description:'Analyse approved purchase-order spend by department, cost centre and vendor.',icon:'Receipt',tone:'green'},
 'budget-usage':{category:'Finance & purchasing',description:'Monitor budget, committed spend, actual spend and remaining balance.',icon:'PiggyBank',tone:'green'},
 'people-directory':{category:'People & governance',description:'Review active, invited and disabled membership totals by department.',icon:'Users',tone:'sky'},
 'user-activity':{category:'People & governance',description:'Audit workspace activity and sign-ins over the last 90 days.',icon:'History',tone:'violet'},
};
const CATEGORY_ORDER=['Service desk','Assets & operations','Finance & purchasing','People & governance'];
const fallback:ReportMeta={category:'Workspace',description:'Explore live, permission-scoped workspace data.',icon:'ChartColumn',tone:'blue'};
const moneyKeys=/^(Cost|Value|Total|Amount|Spent|Committed|Remaining|Book value|Unit cost|Parts cost|Labour cost)$/i;
const wholeKeys=/^(Tickets|Resolved|Met SLA|Overdue|Open|Assets|In use|In store|Maintenance|Orders|On hand|Minimum|Reorder qty|Work orders|Completed|Active|Invited|Disabled|Active in 30 days|Actions|Sign-ins)$/i;

function formatValue(key:string,value:unknown){
 if(value===null||value===undefined||value==='')return <span className="muted">—</span>;
 if(typeof value==='number'){
  if(key.includes('%'))return `${new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(value)}%`;
  if(moneyKeys.test(key))return new Intl.NumberFormat(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}).format(value);
  if(wholeKeys.test(key))return new Intl.NumberFormat().format(value);
  return new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(value);
 }
 if(/^(Priority|Status|Needs reorder)$/i.test(key))return <Chip tone={String(value)==='Yes'?'amber':undefined}>{String(value)}</Chip>;
 return String(value);
}

export default function Reports({parts}:{parts:string[]}){
 const [query,setQuery]=useState('');
 const list=useApi<{reports:ReportInfo[]}>('/api/reports');
 const id=parts[0];
 const r=useApi<{title:string,rows:Record<string,string|number|null>[],canExport:boolean}>(id?'/api/reports?report='+encodeURIComponent(id):null);

 if(!id){
  const reports=list.data?.reports||[];const q=query.trim().toLowerCase();
  const filtered=reports.filter(x=>{const m=REPORT_META[x.id]||fallback;return `${x.title} ${m.category} ${m.description}`.toLowerCase().includes(q)});
  const groups=CATEGORY_ORDER.map(category=>[category,filtered.filter(x=>(REPORT_META[x.id]||fallback).category===category)] as const).filter(([,items])=>items.length);
  const uncategorised=filtered.filter(x=>!CATEGORY_ORDER.includes((REPORT_META[x.id]||fallback).category));if(uncategorised.length)groups.push(['Workspace',uncategorised]);
  return <div className="page reports-page">
   <Header icon="ChartColumn" tone="blue" title="Reports" subtitle="Live, permission-aware views across your workspace. Search, filter, save a view or export only the data you can access." actions={<Btn icon="RefreshCw" onClick={list.reload}>Refresh catalogue</Btn>}/>
   <ErrorNote error={list.error} onRetry={list.reload}/>
   {!list.data?<Skeleton rows={8}/>:!reports.length?<Empty icon="ChartColumn" title="No reports available to you">Your role does not currently include any report sources.</Empty>:<>
    <div className="report-overview">
     <Stat label="Available reports" value={reports.length} icon="ChartColumn" tone="blue" sub="Based on your role and enabled modules"/>
     <Stat label="Business areas" value={new Set(reports.map(x=>(REPORT_META[x.id]||fallback).category)).size} icon="LayoutGrid" tone="violet" sub="Service, operations, finance and people"/>
     <Stat label="Data protection" value="Scoped" icon="ShieldCheck" tone="green" sub="Every result follows workspace permissions"/>
    </div>
    <label className="report-search"><Icon name="Search" size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find a report by name, purpose or business area…" aria-label="Find a report"/>{query&&<button type="button" className="link" onClick={()=>setQuery('')} aria-label="Clear report search"><Icon name="X" size={14}/></button>}</label>
    {!filtered.length?<Empty icon="SearchX" title="No reports match your search">Try a broader name or business area.</Empty>:groups.map(([category,items])=><section className="report-group" key={category}>
     <div className="report-group-head"><h2>{category}</h2><span>{items.length}</span></div>
     <div className="report-catalog">{items.map(x=>{const m=REPORT_META[x.id]||fallback;return <a key={x.id} href={`#/reports/${x.id}`} className={`report-card tone-${m.tone}`}>
      <span className="report-card-icon"><Icon name={m.icon} size={20}/></span><span className="report-card-main"><b>{x.title}</b><p>{m.description}</p><span className="report-card-meta"><Icon name="Database" size={13}/><span>Live workspace data</span><Icon name="ArrowRight" size={15}/></span></span>
     </a>})}</div>
    </section>)}
   </>}
  </div>;
 }

 type ReportRow=Record<string,unknown>&{id:string};
 const rows:ReportRow[]=(r.data?.rows||[]).map((x,i)=>({id:String(i),...x}));const keys=Object.keys(r.data?.rows[0]||{});const meta=REPORT_META[id]||fallback;
 const cols:Col<ReportRow>[]=keys.map(k=>({key:k,label:k,align:typeof r.data?.rows[0]?.[k]==='number'?'right':undefined,value:x=>(x[k]??'') as string|number,render:x=>formatValue(k,x[k])}));
 const attention=keys.includes('Needs reorder')?rows.filter(x=>x['Needs reorder']==='Yes').length:keys.includes('Overdue')?rows.reduce((n,x)=>n+Number(x.Overdue||0),0):keys.includes('Remaining')?rows.filter(x=>Number(x.Remaining)<0).length:0;
 const primaryKey=['Total','Value','Amount','Spent','Assets','Tickets','Open','Actions','Work orders','Active'].find(k=>keys.includes(k));
 const primary=primaryKey?rows.reduce((n,x)=>n+Number(x[primaryKey]||0),0):keys.length;
 return <div className="page reports-page">
  <div className="report-detail-head"><Btn variant="ghost" icon="ArrowLeft" onClick={()=>go('reports')}>All reports</Btn><span>/</span><span>{meta.category}</span><Chip tone="blue">Live</Chip></div>
  <Header icon={meta.icon} tone={meta.tone} title={r.data?.title||'Report'} subtitle={meta.description} actions={r.data?.canExport&&<Btn variant="primary" icon="Download" onClick={()=>downloadCsv(id,[keys,...(r.data?.rows||[]).map(x=>keys.map(k=>x[k]??''))])}>Export CSV</Btn>}/>
  <ErrorNote error={r.error} onRetry={r.reload}/>
  {!r.data?<Skeleton rows={8}/>:<>
   <div className="report-summary"><Stat label="Rows" value={rows.length.toLocaleString()} icon="Table" tone="blue" sub="Visible to your current access"/><Stat label={primaryKey||'Columns'} value={typeof primary==='number'?new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(primary):primary} icon="ChartBar" tone="violet" sub={primaryKey?'Total across visible rows':`${keys.length} fields in this report`}/><div className={attention?'attention':''}><Stat label="Needs attention" value={attention.toLocaleString()} icon={attention?'TriangleAlert':'CircleCheck'} tone={attention?'amber':'green'} sub={attention?'Overdue, low-stock or over-budget items':'No flagged items in this view'}/></div></div>
   <Grid id={'report-'+id} rows={rows} cols={cols} empty={<Empty icon="ChartColumn" title="No data for this report">Records will appear here when the source modules contain visible data.</Empty>}/>
  </>}
 </div>;
}
