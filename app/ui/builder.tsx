'use client';
import {Fragment,useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {api,useApi,go,cx,ago,dateTime,bytes} from './lib';
import {useApp,Btn,Chip,Header,Grid,Modal,Field,ErrorNote,Skeleton,Empty,Card,Icon,Note,Tabs,Markdown,TagPicker,Menu,type Col} from './kit';
import {widgetTypes,widgetByType,dataSources,type Widget,type Layout,type Section,type Row} from '../widgets';
import {AiActions} from './assistant';
import {ConnectedContext} from './context';
import {AgentRun} from './agents';
import {RecordForm,ReportChart,FieldValue} from './studio-runtime';
import type {AppDef,StudioForm,StudioTable} from '../studio-def';

// Visual page and widget builder. Layouts are metadata only (approved widgets + settings); the server
// validates every save and resolves widget data with each viewer's own permissions.
type PageSummary={id:string,slug:string,title:string,description:string,icon:string,status:string,draftVersion:number,publishedVersion:number|null,visibility:{roles?:string[],departments?:string[]},updatedAt:string,updatedBy:string};
type PageData={page:PageSummary,layout:Layout,version:number,canEdit:boolean,canPublish:boolean,canDelete:boolean};
const rid=()=>Math.random().toString(36).slice(2,10);
const emptyLayout=():Layout=>({sections:[{id:rid(),title:'',kind:'grid',rows:[{id:rid(),columns:[{id:rid(),span:12,widgets:[]}]}]}]});
const statusTone=(s:string)=>s==='published'?'green':s==='archived'?'gray':'amber';

export default function Pages({parts}:{parts:string[]}){
 if(parts[0]&&parts[1]==='edit')return <PageEditor id={parts[0]==='new'?null:parts[0]} template={parts[2]}/>;
 if(parts[0])return <PageView id={parts[0]}/>;
 return <PageList/>;
}
function PageList(){
 const {s}=useApp();const {data,error,reload}=useApi<{pages:PageSummary[],canCreate:boolean}>('/api/app-pages');const [choose,setChoose]=useState(false);
 const cols:Col<PageSummary>[]=[{key:'title',label:'Page',render:p=><div className="cell-title"><b>{p.title}</b><small>{p.description||`#/pages/${p.slug}`}</small></div>},{key:'status',label:'Status',width:110,render:p=><Chip tone={statusTone(p.status)}>{p.status}</Chip>},{key:'publishedVersion',label:'Published',width:110,render:p=>p.publishedVersion?`v${p.publishedVersion}`:'—'},{key:'draftVersion',label:'Latest',width:90,render:p=>`v${p.draftVersion}`},{key:'updatedAt',label:'Modified',width:170,render:p=><span className="muted">{ago(p.updatedAt)} · {p.updatedBy}</span>}];
 return <div className="page"><Header icon="LayoutGrid" tone="violet" title="Pages" subtitle={`Custom pages for ${s.tenant.name}, built from approved widgets. Every widget shows only what the viewer is allowed to see.`} actions={data?.canCreate&&<Btn variant="primary" icon="Plus" onClick={()=>setChoose(true)}>New page</Btn>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:!data.pages.length?<Empty icon="LayoutGrid" title="No pages yet" action={data.canCreate&&<Btn variant="primary" icon="Plus" onClick={()=>setChoose(true)}>New page</Btn>}>{data.canCreate?'Create dashboards, team pages and portals with drag-and-drop widgets.':'Nothing has been published for you yet.'}</Empty>:<Grid id="app-pages" rows={data.pages} cols={cols} onOpen={p=>go(`pages/${p.id}`)} exportName="pages"/>}
  {choose&&<TemplateChooser onClose={()=>setChoose(false)}/>}
 </div>;
}
function TemplateChooser({onClose}:{onClose:()=>void}){
 const {data}=useApi<{templates:{id:string,scope:string,name:string,description:string}[]}>('/api/app-pages?view=templates');
 return <Modal open onClose={onClose} title="New page" subtitle="Start blank or from a template.">
  <div className="page-pick"><button className="module-card" onClick={()=>{onClose();go('pages/new/edit')}}><Icon name="FilePlus" size={18}/><div><b>Blank page</b><small>An empty section to build on.</small></div></button>
   {(data?.templates||[]).map(t=><button key={t.id} className="module-card" onClick={()=>{onClose();go(`pages/new/edit/${t.id}`)}}><Icon name="LayoutGrid" size={18}/><div><b>{t.name} {t.scope==='platform'&&<Chip tone="violet">Platform</Chip>}</b><small>{t.description||'Template'}</small></div></button>)}</div>
 </Modal>;
}
function PageView({id}:{id:string}){
 const {data,error,reload}=useApi<PageData>(`/api/app-pages?id=${encodeURIComponent(id)}&version=published`);
 if(error)return <div className="page"><ErrorNote error={error} onRetry={reload}/>{/not published/.test(error)&&<Btn icon="Pencil" onClick={()=>go(`pages/${id}/edit`)}>Open the editor</Btn>}</div>;
 if(!data)return <div className="page"><Skeleton rows={8}/></div>;
 return <div className="page">
  <Header icon={data.page.icon||'LayoutGrid'} tone="violet" title={data.page.title} subtitle={data.page.description} actions={data.canEdit&&<Btn icon="Pencil" onClick={()=>go(`pages/${id}/edit`)}>Edit page</Btn>}/>
  <LayoutView layout={data.layout} pageId={data.page.id}/>
 </div>;
}
export function LayoutView({layout,pageId}:{layout:Layout,pageId?:string}){
 return <div className="lb-view">{layout.sections.map(s=><SectionView key={s.id} s={s} pageId={pageId}/>)}</div>;
}
function SectionView({s,pageId}:{s:Section,pageId?:string}){
 const [tab,setTab]=useState(s.tabs?.[0]?.id||'');
 const rows=(rs:Row[])=>rs.map(r=><div key={r.id} className="lb-row">{r.columns.map(c=><div key={c.id} className="lb-col" style={{'--span':c.span} as React.CSSProperties}>{c.widgets.map(w=><WidgetView key={w.id} w={w} pageId={pageId}/>)}</div>)}</div>);
 if(s.kind==='accordion')return <section className="lb-section">{s.title&&<h2 className="lb-section-title">{s.title}</h2>}{(s.tabs||[]).map((t,i)=><details key={t.id} className="lb-accordion" open={i===0}><summary>{t.title}</summary>{rows(t.rows)}</details>)}</section>;
 return <section className="lb-section">{s.title&&<h2 className="lb-section-title">{s.title}</h2>}{s.kind==='tabs'?<><Tabs value={tab} onChange={setTab} items={(s.tabs||[]).map(t=>({id:t.id,label:t.title}))}/>{rows(s.tabs?.find(t=>t.id===tab)?.rows||[])}</>:rows(s.rows||[])}</section>;
}

// ── Widgets ──
type WData={bars?:{id:string,link:string,title:string,status:string,progress:number,start:string,end:string}[],from?:string|null,to?:string|null,target?:number|null,pct?:number|null,comments?:{id:string,body:string,createdAt:string,author:string}[],records?:{id:string,number:string,title:string,statusName:string,data:Record<string,unknown>,updatedAt:string}[],app?:{id:string,slug:string,name:string},table?:StudioTable,form?:StudioForm,report?:any,result?:any,agent?:{id:string,name:string,description:string},prompt?:string,rows?:Record<string,any>[],total?:number,columns?:string[],count?:number,label?:string,groups?:{name:string,count:number,items:Record<string,any>[]}[],events?:{id:string,link:string,date:string,title:string,overdue:boolean}[]};
function useWidgetData(w:Widget,pageId?:string,enabled=true){
 const [data,setData]=useState<WData|null>(null),[err,setErr]=useState(''),[loading,setLoading]=useState(false);
 const key=JSON.stringify([w.type,w.config]);
 const load=useCallback(async()=>{setLoading(true);setErr('');try{setData(await api<WData>('/api/app-pages',{action:'data',widget:w,pageId}))}catch(e){setErr((e as Error).message)}finally{setLoading(false)}},[key,pageId]);// eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{if(enabled)load()},[load,enabled]);
 useEffect(()=>{if(!enabled||!w.refresh)return;const t=setInterval(()=>{if(document.visibilityState==='visible')load()},w.refresh*1000);return()=>clearInterval(t)},[load,enabled,w.refresh]);
 return {data,err,loading,reload:load};
}
const DATA=new Set(['table','list','kpi','chart','calendar','kanban','tickets','assets','people','approvals','files','connector','statistic','timeline','gantt','projects','tasks','inventory','purchasing','comments','studio-table','studio-report','studio-form','agent']);
export function WidgetView({w,pageId}:{w:Widget,pageId?:string}){
 const def=widgetByType.get(w.type);
 const [hidden,setHidden]=useState(false);
 const inner=DATA.has(w.type)?<DataWidget w={w} pageId={pageId} onEmpty={setHidden}/>:<StaticWidget w={w}/>;
 if(!def||hidden)return null;
 if(['heading'].includes(w.type))return inner;
 return <div className={cx('lb-widget',`w-${w.type}`)}>{(w.title||w.description)&&<div className="lb-widget-head">{w.title&&<b>{w.title}</b>}{w.description&&<small>{w.description}</small>}</div>}{inner}</div>;
}
function StaticWidget({w}:{w:Widget}){
 const {s,toast}=useApp();const c=w.config as Record<string,any>;
 const [q,setQ]=useState('');const [ans,setAns]=useState<string|null>(null),[busy,setBusy]=useState(false);const [form,setForm]=useState({title:'',description:''});
 switch(w.type){
  case 'heading':{const L=Number(c.level||2);return L===1?<h1 className="lb-h1">{c.text}</h1>:L===3?<h3 className="lb-h3">{c.text}</h3>:<h2 className="lb-h2">{c.text}</h2>}
  case 'text':case 'richtext':return <Markdown text={String(c.markdown||'')}/>;
  case 'video':return <figure className="lb-media"><video controls preload="metadata" src={String(c.url)}/>{c.caption&&<figcaption>{c.caption}</figcaption>}</figure>;
  case 'audio':return <figure className="lb-media"><audio controls preload="metadata" src={String(c.url)}/>{c.caption&&<figcaption>{c.caption}</figcaption>}</figure>;
  case 'divider':return <hr className="lb-divider"/>;
  case 'alert':return <Note tone={(['info','warn','ok'].includes(String(c.tone))?c.tone:'info') as 'info'}>{String(c.text||'')}</Note>;
  case 'graph':return <ConnectedContext type={String(c.recordType)} id={String(c.recordId)} compact/>;
  case 'inbox':return <InboxWidget limit={Number(c.limit||8)}/>;
  case 'image':return <img className="lb-image" src={String(c.url)} alt={String(c.alt||'')} loading="lazy" referrerPolicy="no-referrer"/>;
  case 'button':return <a className={cx('btn',c.style==='secondary'?'':'btn-primary')} href={String(c.link)} {...(String(c.link).startsWith('https:')?{target:'_blank',rel:'noopener noreferrer'}:{})}>{c.label}</a>;
  case 'links':return <ul className="lb-links">{String(c.items||'').split('\n').filter(Boolean).map((l,i)=>{const [label,link]=l.split('|').map(x=>x.trim());return <li key={i}><a href={link} {...(link.startsWith('https:')?{target:'_blank',rel:'noopener noreferrer'}:{})}><Icon name="Link" size={14}/>{label}</a></li>})}</ul>;
  case 'search':return <form className="lb-search" onSubmit={e=>{e.preventDefault();window.dispatchEvent(new CustomEvent('ows:search',{detail:q}))}}><Icon name="Search" size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder={String(c.placeholder||`Search ${s.tenant.name}…`)} aria-label="Search"/><Btn type="submit" size="sm">Search</Btn></form>;
  case 'form':return <form className="lb-form" onSubmit={async e=>{e.preventDefault();setBusy(true);try{const r=await api<{id:string}>('/api/tickets',{action:'create',title:form.title,description:form.description,category:c.category||'',type:'Service request',priority:'Medium',department:s.user.department});toast('Request submitted');setForm({title:'',description:''});go(`tickets/${r.id}`)}catch(err){toast((err as Error).message,'error')}finally{setBusy(false)}}}>{c.intro&&<p className="muted">{c.intro}</p>}<Field label="Subject"><input required value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></Field><Field label="Details"><textarea rows={3} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></Field><Btn type="submit" variant="primary" busy={busy}>Submit request</Btn></form>;
  case 'ai':return <div className="lb-ai">{ans===null?<Btn icon="Sparkles" busy={busy} onClick={async()=>{setBusy(true);try{const res=await fetch('/api/ai',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'chat',message:c.prompt,page:location.hash})});if(!res.ok)throw new Error(((await res.json().catch(()=>({}))) as {error?:string}).error||'AI is unavailable.');let out='';const reader=res.body!.getReader();const d=new TextDecoder();let buf='';while(true){const {done,value}=await reader.read();if(done)break;buf+=d.decode(value,{stream:true});for(const block of buf.split('\n\n').slice(0,-1)){const ev=/^event: (.+)$/m.exec(block)?.[1];const data=/^data: (.+)$/m.exec(block)?.[1];if(ev==='delta'&&data){out+=JSON.parse(data).text;setAns(out)}if(ev==='error'&&data)throw new Error(JSON.parse(data).error)}buf=buf.slice(buf.lastIndexOf('\n\n')+2)}setAns(out||'No answer.')}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}>{String(c.buttonLabel||'Ask AI')}</Btn>:<><Markdown text={ans}/><Btn size="sm" variant="ghost" onClick={()=>setAns(null)}>Ask again</Btn></>}<small className="muted">Answers use only what you can open.</small></div>;
  case 'report':return <ReportWidget id={String(c.report)} limit={Number(c.limit||10)}/>;
 }
 return null;
}
function InboxWidget({limit}:{limit:number}){const {data,error}=useApi<{approvals:{id:string,source:string,title:string,link:string,since:string}[],tasks:{id:string,title:string,due:string|null,overdue:boolean,link:string}[],counts:{approvals:number,tasks:number,overdue:number}}>('/api/inbox');if(error)return <p className="muted small">{error}</p>;if(!data)return <Skeleton rows={3}/>;const items=[...data.approvals.map(a=>({id:a.id,title:a.title,sub:a.source,link:a.link})),...data.tasks.map(t=>({id:t.id,title:t.title,sub:t.overdue?'Overdue task':t.due?`Task due ${t.due}`:'Task',link:t.link}))].slice(0,limit);return <div><p className="muted small">{data.counts.approvals} approvals · {data.counts.tasks} tasks{data.counts.overdue?` · ${data.counts.overdue} overdue`:''}</p>{items.length?<ul className="lb-list">{items.map(i=><li key={i.id}><a href={i.link}>{i.title}</a><small>{i.sub}</small></li>)}</ul>:<p className="muted small">Nothing waiting.</p>}<a className="link small" href="#/inbox">Open inbox</a></div>}
function ReportWidget({id,limit}:{id:string,limit:number}){const {data,error}=useApi<{title:string,rows:Record<string,unknown>[]}>(`/api/reports?report=${encodeURIComponent(id)}`);if(error)return <p className="muted small">{error}</p>;if(!data)return <Skeleton rows={3}/>;const rows=data.rows.slice(0,limit);const keys=Object.keys(rows[0]||{}).slice(0,6);return rows.length?<div className="lb-table"><table className="plain"><thead><tr>{keys.map(k=><th key={k}>{k}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{keys.map(k=><td key={k}>{String(r[k]??'')}</td>)}</tr>)}</tbody></table></div>:<p className="muted small">No rows.</p>}
// Categorical order is fixed (never cycled by rank); colours match the app's tone tokens.
const tones=['violet','sky','teal','amber','pink','green','orange','indigo'];
const toneHex:Record<string,string>={violet:'#6D5EF8',sky:'#2E8BF0',teal:'#0E9AA7',amber:'#E6A100',pink:'#E0569B',green:'#14A06F',orange:'#F2711C',indigo:'#4A4FD9'};
function DataWidget({w,pageId,onEmpty}:{w:Widget,pageId?:string,onEmpty?:(v:boolean)=>void}){
 const {data,err,loading,reload}=useWidgetData(w,pageId);
 const isEmpty=!!data&&!!((data.rows&&!data.rows.length)||(data.groups&&!data.groups.length)||(data.events&&!data.events.length)||(data.bars&&!data.bars.length)||(data.records&&!data.records.length)||(data.comments&&!data.comments.length));
 useEffect(()=>{onEmpty?.(!!w.config.hideWhenEmpty&&isEmpty)},[isEmpty,w.config.hideWhenEmpty,onEmpty]);
 if(err)return <div className="lb-state error"><Icon name="CircleAlert" size={15}/><span>{err}</span><Btn size="sm" variant="ghost" onClick={reload}>Retry</Btn></div>;
 if(!data)return <Skeleton rows={3}/>;
 const empty=<div className="lb-state"><Icon name="Inbox" size={15}/><span>Nothing to show.</span></div>;
 const label=(r:Record<string,any>)=>r.title||r.name||r.number||r.code||r.text||r.id;
 switch(w.type){
  case 'statistic':return <div className="lb-kpi"><b>{data.count?.toLocaleString()}</b><small>{data.label}{data.target?` · target ${data.target.toLocaleString()} (${data.pct}%)`:''}</small>{data.target?<div className="bar"><i style={{width:`${Math.min(100,data.pct||0)}%`}}/></div>:null}</div>;
  case 'timeline':return data.events?.length?<ol className="lb-timeline">{data.events.map(e=><li key={e.id} className={cx(e.overdue&&'overdue')}><span className="lb-date">{e.date}</span><a href={e.link}>{e.title}</a>{e.overdue&&<Chip tone="red">overdue</Chip>}</li>)}</ol>:empty;
  case 'gantt':{const bars=data.bars||[];if(!bars.length)return empty;const t0=Date.parse(data.from!),t1=Math.max(Date.parse(data.to!),t0+86400000);const span=t1-t0+86400000;return <div className="lb-gantt" role="img" aria-label={bars.map(b=>`${b.title}: ${b.start} to ${b.end}`).join('; ')}><div className="lb-gantt-scale"><span>{data.from}</span><span>{data.to}</span></div>{bars.map(b=>{const l=(Date.parse(b.start)-t0)/span*100,wd=Math.max(1.5,(Date.parse(b.end)-Date.parse(b.start)+86400000)/span*100);return <div key={b.id} className="lb-gantt-row"><a href={b.link} className="lb-gantt-label">{b.title}</a><div className="lb-gantt-track"><i className={cx('lb-gantt-bar',b.status==='Done'&&'done',b.status==='Blocked'&&'blocked')} style={{left:`${l}%`,width:`${Math.min(100-l,wd)}%`}} title={`${b.title} · ${b.start} → ${b.end} · ${b.status} · ${b.progress}%`}><span style={{width:`${b.progress}%`}}/></i></div></div>})}</div>}
  case 'comments':return data.comments?.length?<ul className="lb-comments">{data.comments.map(c=><li key={c.id}><b>{c.author||'Someone'}</b> <small className="muted">{ago(c.createdAt)}</small><Markdown text={c.body}/></li>)}</ul>:empty;
  case 'studio-table':{const recs=data.records||[];if(!recs.length)return empty;const cols=(data.table?.fields||[]).filter(f=>f.key!==data.table?.titleField&&!['richtext','repeating','signature','file'].includes(f.type)).slice(0,3);return <div className="lb-table"><table className="plain"><thead><tr><th>Record</th><th>Status</th>{cols.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{recs.map(r=><tr key={r.id}><td><a href={`#/apps/${data.app?.slug}/table/${data.table?.key}/${r.id}`}>{r.number} · {r.title}</a></td><td>{r.statusName}</td>{cols.map(c=><td key={c.key}><FieldValue f={c} v={r.data[c.key]}/></td>)}</tr>)}</tbody></table></div>}
  case 'studio-report':return data.result?<ReportChart r={{...data.result,report:data.report}}/>:empty;
  case 'studio-form':return data.form&&data.table&&data.app?<RecordForm app={data.app.slug} def={{tables:[data.table]} as unknown as AppDef} form={data.form} table={data.table} onDone={()=>reload()}/>:empty;
  case 'agent':return data.agent?<AgentRun agent={data.agent} page="app-pages" initial={data.prompt||''}/>:empty;
  case 'kpi':return <div className="lb-kpi"><b>{data.count?.toLocaleString()}</b><small>{w.title?'':data.label}</small></div>;
  case 'chart':{const g=data.groups||[];if(!g.length)return empty;const max=Math.max(...g.map(x=>x.count));const total=g.reduce((n,x)=>n+x.count,0);
   if(w.config.kind==='pie'){let acc=0;const stops=g.slice(0,8).map((x,i)=>{const a=acc;acc+=x.count/total*360;return `${toneHex[tones[i%8]]} ${a}deg ${acc}deg`}).join(',');return <div className="lb-pie"><div className="pie" style={{background:`conic-gradient(${stops})`}} role="img" aria-label={g.map(x=>`${x.name}: ${x.count}`).join(', ')}/><ul>{g.slice(0,8).map((x,i)=><li key={x.name}><span className={`tile-dot tone-${tones[i%8]}`}/>{x.name}<b>{x.count}</b></li>)}</ul></div>}
   return <div className="lb-bars" role="img" aria-label={g.map(x=>`${x.name}: ${x.count}`).join(', ')}>{g.slice(0,12).map(x=><div key={x.name} className="lb-bar"><span>{x.name}</span><i style={{width:`${Math.max(4,x.count/max*100)}%`}}/><b>{x.count}</b></div>)}</div>}
  case 'calendar':return data.events?.length?<ul className="lb-cal">{data.events.map(e=><li key={e.id} className={cx(e.overdue&&'overdue')}><span className="lb-date">{e.date}</span><a href={e.link}>{e.title}</a>{e.overdue&&<Chip tone="red">overdue</Chip>}</li>)}</ul>:empty;
  case 'kanban':return data.groups?.length?<div className="lb-kanban">{data.groups.map(g=><div key={g.name} className="lb-lane"><p>{g.name} <b>{g.count}</b></p>{g.items.map(i=><a key={i.id} href={i.link} className="lb-card">{label(i)}</a>)}</div>)}</div>:empty;
  case 'table':case 'connector':{const rows=data.rows||[];if(!rows.length)return empty;const cols=data.columns?.length?data.columns:Object.keys(rows[0]).filter(k=>!['id','link'].includes(k)).slice(0,6);return <div className="lb-table"><table className="plain"><thead><tr>{cols.map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={r.id||i}>{cols.map((c,j)=><td key={c}>{j===0&&r.link?<a href={r.link}>{String(r[c]??'')}</a>:c==='size'?bytes(Number(r[c])):String(r[c]??'')}</td>)}</tr>)}</tbody></table>{w.type==='connector'&&<small className="muted">From a connected service (read-only).</small>}{data.total!=null&&data.total>rows.length&&<small className="muted">{rows.length} of {data.total}</small>}{loading&&<small className="muted"> · refreshing…</small>}</div>}
  default:{const rows=data.rows||[];if(!rows.length)return empty;return <ul className="lb-list">{rows.map((r,i)=><li key={r.id||i}><a href={r.link}>{label(r)}</a><small>{[r.status,r.priority,r.department,r.due,r.step,r.title&&r.number?'':r.title].filter(Boolean).join(' · ')}</small></li>)}</ul>}
 }
}

// ── Editor ──
type Sel={s:number,t?:number,r:number,c:number,w:number}|null;
function PageEditor({id,template}:{id:string|null,template?:string}){
 const {s,toast,ask}=useApp();
 const [meta,setMeta]=useState({title:'',slug:'',description:'',icon:'LayoutGrid',visibility:{roles:[] as string[],departments:[] as string[]}});
 const [layout,setLayout]=useState<Layout|null>(id?null:emptyLayout());const [info,setInfo]=useState<PageData|null>(null);const [err,setErr]=useState('');
 const [sel,setSel]=useState<Sel>(null),[mode,setMode]=useState<'edit'|'preview'>('edit'),[dirty,setDirty]=useState(false),[busy,setBusy]=useState<string|null>(null),[panel,setPanel]=useState<string|null>(null);
 const drag=useRef<{kind:'new',type:string}|{kind:'move',from:NonNullable<Sel>}|null>(null);
 const load=useCallback(async()=>{if(!id)return;try{const d=await api<PageData>(`/api/app-pages?id=${id}`);setInfo(d);setLayout(d.layout);setMeta({title:d.page.title,slug:d.page.slug,description:d.page.description,icon:d.page.icon,visibility:{roles:d.page.visibility.roles||[],departments:d.page.visibility.departments||[]}});setDirty(false)}catch(e){setErr((e as Error).message)}},[id]);
 useEffect(()=>{load()},[load]);
useEffect(()=>{if(!id&&template==='home')setMeta(m=>({...m,slug:'home',title:m.title||'Home'}))},[id,template]);
 useEffect(()=>{if(!id&&template&&template!=='home')api<{layout:Layout,name:string}>('/api/app-pages',{action:'template-use',templateId:template}).then(r=>{setLayout(r.layout);setMeta(m=>({...m,title:m.title||r.name}))}).catch(e=>toast((e as Error).message,'error'))},[id,template,toast]);
 useEffect(()=>{const f=(e:BeforeUnloadEvent)=>{if(dirty){e.preventDefault()}};window.addEventListener('beforeunload',f);return()=>window.removeEventListener('beforeunload',f)},[dirty]);
 const update=(f:(l:Layout)=>void)=>setLayout(l=>{const n=JSON.parse(JSON.stringify(l)) as Layout;f(n);setDirty(true);return n});
 const rowsOf=(l:Layout,si:number,ti?:number)=>{const sec=l.sections[si];return ti!==undefined?sec.tabs![ti].rows:sec.rows!};
 const colOf=(l:Layout,p:{s:number,t?:number,r:number,c:number})=>rowsOf(l,p.s,p.t)[p.r].columns[p.c];
 const selected=useMemo(()=>sel&&layout?colOf(layout,sel)?.widgets[sel.w]:null,[sel,layout]);// eslint-disable-line react-hooks/exhaustive-deps
 function drop(target:{s:number,t?:number,r:number,c:number},index:number){const d=drag.current;drag.current=null;if(!d)return;update(l=>{const col=colOf(l,target);if(d.kind==='new'){const def=widgetByType.get(d.type)!;const w:Widget={id:rid(),type:def.type,title:['heading','text','button','image','search'].includes(def.type)?'':def.label,config:defaults(def.type)};col.widgets.splice(index,0,w);setSel({...target,w:index})}else{const from=colOf(l,d.from);const [w]=from.widgets.splice(d.from.w,1);const same=d.from.s===target.s&&d.from.t===target.t&&d.from.r===target.r&&d.from.c===target.c;const at=same&&d.from.w<index?index-1:index;col.widgets.splice(at,0,w);setSel({...target,w:at})}})}
 function moveSel(dir:-1|1){if(!sel)return;update(l=>{const col=colOf(l,sel);const j=sel.w+dir;if(j<0||j>=col.widgets.length)return;[col.widgets[sel.w],col.widgets[j]]=[col.widgets[j],col.widgets[sel.w]];setSel({...sel,w:j})})}
 async function save(note=''){if(!layout)return null;setBusy('save');try{const r=await api<{id:string,version:number}>('/api/app-pages',{action:'save',id,...meta,layout,note,baseVersion:info?.page.draftVersion});toast(`Saved as version ${r.version}`);setDirty(false);if(!id){go(`pages/${r.id}/edit`);return r}await load();return r}catch(e){toast((e as Error).message,'error');return null}finally{setBusy(null)}}
 const act=async(action:string,extra:Record<string,unknown>={},msg='Done')=>{if(!id)return;setBusy(action);try{const r=await api<any>('/api/app-pages',{action,id,...extra});toast(msg);await load();return r}catch(e){toast((e as Error).message,'error')}finally{setBusy(null)}};
 if(err)return <div className="page"><ErrorNote error={err}/></div>;
 if(!layout||(id&&!info))return <div className="page"><Skeleton rows={10}/></div>;
 if(id&&info&&!info.canEdit)return <div className="page"><Empty icon="Lock" title="You cannot edit this page"/></div>;
 const cats=[...new Set(widgetTypes.map(w=>w.category))];
 const colView=(pos:{s:number,t?:number,r:number,c:number},widgets:Widget[])=><div className="lb-col edit" style={{'--span':colOf(layout,pos).span} as React.CSSProperties} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();drop(pos,widgets.length)}}>
  {widgets.map((w,wi)=><div key={w.id} className={cx('lb-edit-widget',sel&&sel.s===pos.s&&sel.t===pos.t&&sel.r===pos.r&&sel.c===pos.c&&sel.w===wi&&'on')} draggable onDragStart={()=>{drag.current={kind:'move',from:{...pos,w:wi}}}} onDragOver={e=>{e.preventDefault();e.stopPropagation()}} onDrop={e=>{e.preventDefault();e.stopPropagation();drop(pos,wi)}} onClick={()=>setSel({...pos,w:wi})} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setSel({...pos,w:wi})}}} tabIndex={0} role="button" aria-label={`${widgetByType.get(w.type)?.label}: ${w.title||''}. Press Enter to edit.`}>
   <span className="lb-grip"><Icon name="ChevronsUpDown" size={14}/></span><Icon name={widgetByType.get(w.type)?.icon||'Square'} size={15}/><b>{w.title||widgetByType.get(w.type)?.label}</b><small>{w.type}{w.visibility&&(w.visibility.roles?.length||w.visibility.departments?.length)?' · restricted':''}</small>
  </div>)}
  <div className="lb-drop">Drop widgets here</div>
 </div>;
 const rowsView=(si:number,ti:number|undefined,rows:Row[])=><>{rows.map((r,ri)=><div key={r.id} className="lb-row edit"><div className="lb-row-tools"><select aria-label="Row layout" value={r.columns.map(c=>c.span).join('-')} onChange={e=>update(l=>{const spans=e.target.value.split('-').map(Number);const row=rowsOf(l,si,ti)[ri];const all=row.columns.flatMap(c=>c.widgets);row.columns=spans.map((sp,i)=>({id:row.columns[i]?.id||rid(),span:sp,widgets:i===0?all.filter((_,k)=>k%spans.length===0):all.filter((_,k)=>k%spans.length===i)}))})}>{['12','6-6','4-8','8-4','4-4-4','3-3-3-3','3-9','9-3'].map(o=><option key={o} value={o}>{o.split('-').length} column{o.includes('-')?'s':''} ({o})</option>)}</select><Btn size="sm" variant="ghost" icon="Trash2" title="Remove row" onClick={async()=>{if(r.columns.some(c=>c.widgets.length)&&await ask({title:'Remove this row and its widgets?',confirm:'Remove',danger:true})===false)return;update(l=>{rowsOf(l,si,ti).splice(ri,1)});setSel(null)}}/></div>{r.columns.map((c,ci)=><Fragment key={c.id}>{colView({s:si,t:ti,r:ri,c:ci},c.widgets)}</Fragment>)}</div>)}<Btn size="sm" variant="ghost" icon="Plus" onClick={()=>update(l=>{rowsOf(l,si,ti).push({id:rid(),columns:[{id:rid(),span:12,widgets:[]}]})})}>Add row</Btn></>;
 return <div className="page lb-editor-page">
  <div className="doc-top"><Btn variant="ghost" icon="ArrowLeft" onClick={async()=>{if(dirty&&await ask({title:'Leave without saving?',confirm:'Leave',danger:true})===false)return;go(id?`pages/${id}`:'pages')}}>Back</Btn>
   <div className="grow"/>
   <Tabs value={mode} onChange={v=>setMode(v as 'edit'|'preview')} items={[{id:'edit',label:'Edit'},{id:'preview',label:'Preview'}]}/>
   <AiActions only={['builder.layout']} label="Suggest layout" onApply={{'page-builder.draft':(d:Layout)=>{update(l=>{l.sections.push(...d.sections)})}}}/>
   {id&&<Btn icon="History" onClick={()=>setPanel('versions')}>Versions</Btn>}
   <Btn icon="Save" busy={busy==='save'} onClick={async()=>{const note=await ask({title:'Save draft',confirm:'Save',input:{label:'What changed? (optional)'}});if(note!==false)save(note)}}>Save draft</Btn>
   {id&&info?.canPublish&&<Btn variant="primary" icon="Send" busy={busy==='publish'} onClick={async()=>{if(dirty){const r=await save('Saved before publishing');if(!r)return}if(await ask({title:'Publish this page?',body:'Everyone who can see it will get the latest saved version.',confirm:'Publish'})!==false)act('publish',{},'Published')}}>Publish</Btn>}
   {id&&<MenuMore info={info!} act={act} onTemplate={()=>setPanel('template')}/>}
  </div>
  <div className="lb-meta">
   <input className="lb-title" aria-label="Page title" placeholder="Page title" value={meta.title} onChange={e=>{setMeta({...meta,title:e.target.value});setDirty(true)}}/>
   <div className="row-gap">{info&&<><Chip tone={statusTone(info.page.status)}>{info.page.status}</Chip><span className="muted small">Draft v{info.page.draftVersion}{info.page.publishedVersion?` · published v${info.page.publishedVersion}`:' · not published'}</span></>}{dirty&&<Chip tone="amber">Unsaved changes</Chip>}<Btn size="sm" variant="ghost" icon="Settings2" onClick={()=>setPanel('settings')}>Page settings</Btn></div>
  </div>
  {mode==='preview'?<div className="lb-preview"><Note>Preview with live data, as you see it. Viewers see only widgets and records their permissions allow.</Note><LayoutView layout={layout} pageId={id||undefined}/></div>:<div className="lb-editor">
   <aside className="lb-palette" aria-label="Widgets">{cats.map(c=><div key={c}><p className="rail-section">{c}</p>{widgetTypes.filter(w=>w.category===c).map(w=><button key={w.type} className="lb-palette-item" draggable onDragStart={()=>{drag.current={kind:'new',type:w.type}}} onClick={()=>{const pos=sel||{s:0,t:layout.sections[0]?.kind!=='grid'?0:undefined,r:0,c:0,w:0};drag.current={kind:'new',type:w.type};drop({s:pos.s,t:pos.t,r:pos.r,c:pos.c},colOf(layout,pos)?.widgets.length??0)}} title={`${w.description} Drag onto the page or click to add.`}><Icon name={w.icon} size={15}/>{w.label}</button>)}</div>)}</aside>
   <div className="lb-canvas">{layout.sections.map((sec,si)=><section key={sec.id} className="lb-section edit">
    <div className="lb-section-tools"><input aria-label="Section title" placeholder="Section title (optional)" value={sec.title||''} onChange={e=>update(l=>{l.sections[si].title=e.target.value})}/><select aria-label="Section type" value={sec.kind} onChange={e=>update(l=>{const x=l.sections[si];const to=e.target.value as Section['kind'];if(to!=='grid'&&x.kind==='grid'){x.kind=to;x.tabs=[{id:rid(),title:to==='accordion'?'Panel 1':'Tab 1',rows:x.rows||[]}];delete x.rows}else if(to==='grid'&&x.kind!=='grid'){x.kind='grid';x.rows=(x.tabs||[]).flatMap(t=>t.rows);delete x.tabs}else x.kind=to;setSel(null)})}><option value="grid">Rows & columns</option><option value="tabs">Tabs</option><option value="accordion">Accordion</option></select><Btn size="sm" variant="ghost" icon="ArrowUp" title="Move section up" disabled={si===0} onClick={()=>update(l=>{[l.sections[si-1],l.sections[si]]=[l.sections[si],l.sections[si-1]]})}/><Btn size="sm" variant="ghost" icon="Trash2" title="Remove section" onClick={async()=>{if(await ask({title:'Remove this section?',confirm:'Remove',danger:true})!==false){update(l=>{l.sections.splice(si,1)});setSel(null)}}}/></div>
    {sec.kind!=='grid'?(sec.tabs||[]).map((t,ti)=><div key={t.id} className="lb-tab-edit"><div className="row-gap"><input aria-label="Tab title" value={t.title} onChange={e=>update(l=>{l.sections[si].tabs![ti].title=e.target.value})}/><Btn size="sm" variant="ghost" icon="Trash2" title="Remove tab" onClick={()=>update(l=>{l.sections[si].tabs!.splice(ti,1)})}/></div>{rowsView(si,ti,t.rows)}</div>).concat(<Btn key="addtab" size="sm" variant="ghost" icon="Plus" onClick={()=>update(l=>{l.sections[si].tabs!.push({id:rid(),title:`Tab ${(l.sections[si].tabs||[]).length+1}`,rows:[{id:rid(),columns:[{id:rid(),span:12,widgets:[]}]}]})})}>Add tab</Btn>):rowsView(si,undefined,sec.rows||[])}
   </section>)}<Btn icon="Plus" onClick={()=>update(l=>{l.sections.push({id:rid(),title:'',kind:'grid',rows:[{id:rid(),columns:[{id:rid(),span:12,widgets:[]}]}]})})}>Add section</Btn></div>
   <aside className="lb-inspector" aria-label="Widget settings">{selected&&sel?<WidgetInspector w={selected} onChange={w=>update(l=>{colOf(l,sel).widgets[sel.w]=w})} onRemove={()=>{update(l=>{colOf(l,sel).widgets.splice(sel.w,1)});setSel(null)}} onMove={moveSel} onDuplicate={()=>update(l=>{const col=colOf(l,sel);col.widgets.splice(sel.w+1,0,{...JSON.parse(JSON.stringify(col.widgets[sel.w])),id:rid()})})}/>:<div className="muted small lb-hint"><Icon name="LayoutGrid" size={22}/><p>Drag widgets from the left onto the page, or click a widget to add it to the selected column. Select a widget to change its data, filters, visibility and width. Use the arrow buttons to reorder with the keyboard.</p></div>}</aside>
  </div>}
  {panel==='settings'&&<Modal open onClose={()=>setPanel(null)} title="Page settings" footer={<Btn variant="primary" onClick={()=>setPanel(null)}>Done</Btn>}><div className="form-grid">
   <Field label="Page address" hint={id?'Fixed after creation.':'Lowercase letters, numbers and dashes. Use “home” to add widgets to the Home page.'}><input value={meta.slug} disabled={!!id} placeholder="team-dashboard" onChange={e=>{setMeta({...meta,slug:e.target.value});setDirty(true)}}/></Field>
   <Field label="Icon"><input value={meta.icon} onChange={e=>{setMeta({...meta,icon:e.target.value});setDirty(true)}}/></Field>
   <Field label="Description" wide><input value={meta.description} onChange={e=>{setMeta({...meta,description:e.target.value});setDirty(true)}}/></Field>
   <Field label="Visible to roles" wide hint="Empty = everyone with access to custom pages."><TagPicker values={meta.visibility.roles} options={s.roles.map(r=>r.id)} onChange={v=>{setMeta({...meta,visibility:{...meta.visibility,roles:v}});setDirty(true)}} placeholder="All roles"/></Field>
   <Field label="Visible to departments" wide><TagPicker values={meta.visibility.departments} options={s.departments.map(d=>d.name)} onChange={v=>{setMeta({...meta,visibility:{...meta.visibility,departments:v}});setDirty(true)}} placeholder="All departments"/></Field>
   <p className="muted small wide">Role ids: {s.roles.map(r=>`${r.name} = ${r.id.slice(0,8)}…`).join(' · ')}</p>
  </div></Modal>}
  {panel==='versions'&&id&&<Versions id={id} info={info!} onClose={()=>setPanel(null)} onRollback={async v=>{await act('rollback',{version:v},`Rolled back to version ${v}`);setPanel(null)}}/>}
  {panel==='template'&&id&&<SaveTemplate onClose={()=>setPanel(null)} onSave={(name,scope)=>act('save-template',{name,scope},'Template saved').then(()=>setPanel(null))} owner={s.user.platformRole==='owner'}/>}
 </div>;
}
function MenuMore({info,act,onTemplate}:{info:PageData,act:(a:string,e?:Record<string,unknown>,m?:string)=>Promise<any>,onTemplate:()=>void}){
 const {ask}=useApp();
 return <Menu trigger={o=><Btn icon="Ellipsis" onClick={o} title="More"/>} items={[
  {label:'Duplicate page',icon:'Copy',onClick:async()=>{const r=await act('duplicate',{},'Duplicated');if(r?.id)go(`pages/${r.id}/edit`)}},
  {label:'Save as template',icon:'LayoutGrid',onClick:onTemplate},
  ...(info.page.publishedVersion&&info.canPublish?[{label:'Unpublish',icon:'CircleX',onClick:async()=>{if(await ask({title:'Unpublish this page?',body:'Viewers lose access until it is published again.',confirm:'Unpublish',danger:true})!==false)act('unpublish',{},'Unpublished')}}]:[]),
  info.page.status==='archived'?{label:'Restore',icon:'RotateCcw',onClick:()=>act('restore',{},'Restored')}:{label:'Archive',icon:'Archive',onClick:async()=>{if(await ask({title:'Archive this page?',body:'It disappears for viewers. You can restore it later.',confirm:'Archive',danger:true})!==false)act('archive',{},'Archived')}},
  ...(info.canDelete&&info.page.status==='archived'?['-' as const,{label:'Delete permanently',icon:'Trash2',danger:true,onClick:async()=>{const v=await ask({title:'Delete this page and all its versions?',body:<>Type <b>{info.page.title}</b> to confirm. This cannot be undone.</>,confirm:'Delete',danger:true,input:{label:'Page title',required:true}});if(v!==false&&v===info.page.title){await act('delete',{},'Deleted');go('pages')}}}]:[]),
 ]}/>;
}
function Versions({id,info,onClose,onRollback}:{id:string,info:PageData,onClose:()=>void,onRollback:(v:number)=>void}){
 const {ask}=useApp();const {data}=useApi<{versions:{version:number,note:string,createdBy:string,createdAt:string}[]}>(`/api/app-pages?id=${id}&versions=1`);const [cmp,setCmp]=useState<number[]>([]);const [diff,setDiff]=useState<any>(null);const [view,setView]=useState<{v:number,layout:Layout}|null>(null);
 useEffect(()=>{if(cmp.length===2)api(`/api/app-pages?id=${id}&compare=${cmp.join(',')}`).then((r:any)=>setDiff(r.diff)).catch(()=>setDiff(null));else setDiff(null)},[cmp,id]);
 return <Modal open wide onClose={onClose} title="Version history" subtitle="Every save is kept. Rolling back publishes an older version as a new one." footer={<Btn onClick={onClose}>Close</Btn>}>
  {!data?<Skeleton/>:<table className="plain"><thead><tr><th>Compare</th><th>Version</th><th>Note</th><th>By</th><th>When</th><th/></tr></thead><tbody>{data.versions.map(v=><tr key={v.version}><td><input type="checkbox" aria-label={`Compare version ${v.version}`} checked={cmp.includes(v.version)} onChange={e=>setCmp(e.target.checked?[...cmp,v.version].slice(-2).sort((a,b)=>a-b):cmp.filter(x=>x!==v.version))}/></td><td>v{v.version} {v.version===info.page.publishedVersion&&<Chip tone="green">published</Chip>}</td><td>{v.note}</td><td>{v.createdBy}</td><td className="muted">{dateTime(v.createdAt)}</td><td className="row-gap"><Btn size="sm" variant="ghost" onClick={async()=>{const r=await api<PageData>(`/api/app-pages?id=${id}&version=${v.version}`);setView({v:v.version,layout:r.layout})}}>View</Btn>{info.canPublish&&v.version!==info.page.publishedVersion&&<Btn size="sm" onClick={async()=>{if(await ask({title:`Roll back to version ${v.version}?`,body:'It is republished as a new version; no history is lost.',confirm:'Roll back'})!==false)onRollback(v.version)}}>Roll back</Btn>}</td></tr>)}</tbody></table>}
  {diff&&<Card title={`Changes from v${cmp[0]} to v${cmp[1]}`}><p><b>Added:</b> {diff.added.map((w:any)=>w.title||w.type).join(', ')||'—'}</p><p><b>Removed:</b> {diff.removed.map((w:any)=>w.title||w.type).join(', ')||'—'}</p><p><b>Changed:</b> {diff.changed.map((w:any)=>w.title||w.type).join(', ')||'—'}</p><p className="muted small">Sections: {diff.sections.before} → {diff.sections.after}</p></Card>}
  {view&&<Card title={`Version ${view.v}`}><LayoutView layout={view.layout} pageId={id}/></Card>}
 </Modal>;
}
function SaveTemplate({onClose,onSave,owner}:{onClose:()=>void,onSave:(name:string,scope:string)=>void,owner:boolean}){const [name,setName]=useState(''),[scope,setScope]=useState('company');return <Modal open onClose={onClose} title="Save as template" footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={!name.trim()} onClick={()=>onSave(name,scope)}>Save template</Btn></>}><Field label="Template name"><input autoFocus value={name} onChange={e=>setName(e.target.value)}/></Field>{owner&&<Field label="Available to"><select value={scope} onChange={e=>setScope(e.target.value)}><option value="company">This company</option><option value="platform">Every company (platform template)</option></select></Field>}</Modal>}
function defaults(type:string):Record<string,unknown>{switch(type){case 'heading':return {text:'Heading',level:'2'};case 'text':return {markdown:'Write something…'};case 'button':return {label:'Open',link:'#/home',style:'primary'};case 'links':return {items:'Home | #/home'};case 'table':case 'list':return {source:'tickets',limit:5};case 'kpi':return {source:'tickets',filters:'mine=assigned'};case 'chart':return {source:'tickets',groupBy:'status',kind:'bar'};case 'calendar':return {source:'tickets',days:30};case 'kanban':return {source:'tickets',limit:20};case 'tickets':return {filters:'mine=assigned',limit:5};case 'assets':case 'people':case 'files':case 'approvals':return {limit:5};case 'ai':return {prompt:'What needs my attention today?',buttonLabel:'Ask AI'};case 'image':return {url:'https://',alt:''};case 'report':return {report:'tickets-aging',limit:10};case 'connector':return {connector:'',path:'/',limit:10};case 'richtext':return {markdown:'## Title\n\nWrite something…'};case 'video':case 'audio':return {url:'https://',caption:''};case 'alert':return {text:'Important message',tone:'info'};case 'statistic':return {source:'tasks',filters:'mine=assigned',label:'My open tasks'};case 'timeline':return {source:'projects',days:90};case 'gantt':return {limit:30};case 'projects':return {limit:5};case 'tasks':return {filters:'mine=assigned',limit:8};case 'inventory':return {filters:'low=yes',limit:8};case 'purchasing':return {filters:'mine=requested',limit:5};case 'inbox':return {limit:8};case 'comments':return {entityType:'project',entityId:''};case 'graph':return {recordType:'project',recordId:''};case 'studio-form':return {app:'',form:''};case 'studio-table':return {app:'',table:'',limit:10};case 'studio-report':return {app:'',report:''};case 'agent':return {agentId:'',prompt:''};default:return {}}}
function WidgetInspector({w,onChange,onRemove,onMove,onDuplicate}:{w:Widget,onChange:(w:Widget)=>void,onRemove:()=>void,onMove:(d:-1|1)=>void,onDuplicate:()=>void}){
 const {s}=useApp();const def=widgetByType.get(w.type)!;const c=w.config as Record<string,any>;const set=(k:string,v:unknown)=>onChange({...w,config:{...w.config,[k]:v}});
 const src=dataSources.find(x=>x.id===(c.source||def.source));
 const {data:reports}=useApi<{reports:{id:string,title:string}[]}>(def.fields.some(f=>f.type==='report')?'/api/reports':null);
 const {data:conns}=useApi<{connectors:{id:string,name:string}[]}>(def.fields.some(f=>f.type==='connector')?'/api/connectors':null);
 const field=(f:typeof def.fields[number]):ReactNode=>{const v=c[f.key]??'';switch(f.type){
  case 'select':return <select value={String(v)} onChange={e=>set(f.key,e.target.value)}><option value="">—</option>{f.options!.map(o=><option key={o}>{o}</option>)}</select>;
  case 'number':return <input type="number" min={f.min} max={f.max} value={String(v)} onChange={e=>set(f.key,e.target.value===''?undefined:Number(e.target.value))}/>;
  case 'source':return <select value={String(v)} onChange={e=>set(f.key,e.target.value)}>{dataSources.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}</select>;
  case 'report':return <select value={String(v)} onChange={e=>set(f.key,e.target.value)}><option value="">Choose…</option>{(reports?.reports||[]).map(r=><option key={r.id} value={r.id}>{r.title}</option>)}</select>;
  case 'connector':return <select value={String(v)} onChange={e=>set(f.key,e.target.value)}><option value="">Choose…</option>{(conns?.connectors||[]).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select>;
  case 'markdown':case 'textarea':case 'lines':return <textarea rows={f.type==='markdown'?8:4} value={String(v)} onChange={e=>set(f.key,e.target.value)}/>;
  default:return <input value={String(v)} onChange={e=>set(f.key,e.target.value)}/>;
 }};
 return <div className="lb-insp">
  <div className="lb-insp-head"><Icon name={def.icon} size={16}/><b>{def.label}</b><div className="grow"/><Btn size="sm" variant="ghost" icon="ArrowUp" title="Move up" onClick={()=>onMove(-1)}/><Btn size="sm" variant="ghost" icon="ArrowDown" title="Move down" onClick={()=>onMove(1)}/><Btn size="sm" variant="ghost" icon="Copy" title="Duplicate" onClick={onDuplicate}/><Btn size="sm" variant="ghost" icon="Trash2" title="Remove" onClick={onRemove}/></div>
  <p className="muted small">{def.description}</p>
  <Field label="Title"><input value={w.title||''} onChange={e=>onChange({...w,title:e.target.value})}/></Field>
  <Field label="Description"><input value={w.description||''} onChange={e=>onChange({...w,description:e.target.value})}/></Field>
  {def.fields.map(f=><Field key={f.key} label={f.label} hint={f.key==='filters'&&src?`Filters for ${src.label}: ${Object.entries(src.filters).map(([k,o])=>Array.isArray(o)?`${k}=${o.join('|')}`:`${k}=text`).join(', ')}`:f.key==='groupBy'&&src?`One of: ${src.groupBy.join(', ')}`:f.key==='columns'&&src?`Available: ${src.fields.join(', ')}`:f.key==='sort'&&src?`One of: ${src.sort.join(', ')}`:f.hint}>{field(f)}</Field>)}
  <details><summary>Visibility & display</summary>
   <Field label="Visible to roles" hint="Empty = everyone who can see the page."><TagPicker values={w.visibility?.roles||[]} options={[...s.roles.map(r=>r.id),'admin','manager','employee','viewer']} onChange={v=>onChange({...w,visibility:{...w.visibility,roles:v}})} placeholder="Everyone"/></Field>
   <Field label="Visible to departments"><TagPicker values={w.visibility?.departments||[]} options={s.departments.map(d=>d.name)} onChange={v=>onChange({...w,visibility:{...w.visibility,departments:v}})} placeholder="All departments"/></Field>
   <Field label="Visible at locations"><TagPicker values={w.visibility?.locations||[]} options={s.locations.map(l=>l.path)} onChange={v=>onChange({...w,visibility:{...w.visibility,locations:v}})} placeholder="All locations"/></Field>
   {DATA.has(w.type)&&<Field label="Refresh every (seconds)" hint="Empty = only when the page opens."><input type="number" min={30} max={3600} value={w.refresh||''} onChange={e=>onChange({...w,refresh:e.target.value?Number(e.target.value):undefined})}/></Field>}
  </details>
  {DATA.has(w.type)&&<Note>Data comes from the server with each viewer's own permissions. Nobody sees records they couldn't open themselves.</Note>}
 </div>;
}

// Home page widgets: a published custom page with the address "home" appears above the Home dashboard.
export function HomeWidgets(){
 const {can}=useApp();const [d,setD]=useState<PageData|null>(null);
 useEffect(()=>{if(!can('app-pages'))return;api<PageData>('/api/app-pages?slug=home&version=published').then(setD).catch(()=>setD(null))},[can]);
 if(!d)return can('app-pages','create')?<div className="lb-home-edit"><Btn size="sm" variant="ghost" icon="Pencil" onClick={async()=>{try{const r=await api<{pages:PageSummary[]}>('/api/app-pages');const home=r.pages.find(p=>p.slug==='home');go(home?`pages/${home.id}/edit`:'pages/new/edit/home')}catch{go('pages')}}}>Customize Home with widgets</Btn></div>:null;
 return <div className="lb-home"><div className="lb-home-bar">{d.canEdit&&<Btn size="sm" variant="ghost" icon="Pencil" onClick={()=>go(`pages/${d.page.id}/edit`)}>Edit page</Btn>}</div><LayoutView layout={d.layout} pageId={d.page.id}/></div>;
}
