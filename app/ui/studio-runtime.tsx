'use client';
import {useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {api,useApi,go,ago,cx,dateTime,downloadCsv} from './lib';
import {useApp,Btn,Chip,Header,Field,ErrorNote,Skeleton,Empty,Icon,Note,Tabs,Modal,Markdown,PersonSelect,DeptSelect,LocationInput,Card} from './kit';
import {ConnectedContext} from './context';
import {test,evalFormula,type AppDef,type StudioField,type StudioForm,type StudioTable,type StudioReport} from '../studio-def';

// Runtime of published Workspace Studio apps: tables, forms (with conditional fields, drafts and formulas),
// record pages with workflow steps and approvals, and reports. Every call goes through the server, which
// applies the app's roles, table permissions, record scope and field read/write roles.
export type Rec={id:string,number:string,status:string,statusName:string,statusKind:string,title:string,data:Record<string,unknown>,department:string,ownerId:string,isDraft:boolean,version:number,createdBy:string,createdAt:string,updatedAt:string};
type AppInfo={app:{id:string,slug:string,name:string,description:string,icon:string,status:string,publishedVersion:number|null},definition:AppDef,version:number,canManage:boolean};

// ── Field inputs for all Studio field types ──
function RecordPicker({relation,value,onChange,multiple}:{relation:string,value:string[],onChange:(v:string[])=>void,multiple?:boolean}){
 const [q,setQ]=useState('');const [res,setRes]=useState<{id:string,sourceId:string,title:string,label:string}[]>([]);const [names,setNames]=useState<Record<string,string>>({});
 useEffect(()=>{if(q.trim().length<2){setRes([]);return}const t=setTimeout(()=>api<{nodes:typeof res}>(`/api/graph?q=${encodeURIComponent(q)}&types=${encodeURIComponent(relation)}`).then(r=>setRes(r.nodes)).catch(()=>setRes([])),250);return()=>clearTimeout(t)},[q,relation]);
 return <div className="rec-picker">{value.map(v=><Chip key={v} tone="violet">{names[v]||v.slice(0,8)} <button type="button" className="link" aria-label="Remove" onClick={()=>onChange(value.filter(x=>x!==v))}>×</button></Chip>)}
  {(multiple||!value.length)&&<input value={q} onChange={e=>setQ(e.target.value)} placeholder={`Find a ${relation}…`}/>}
  {res.length>0&&<div className="mini-list">{res.map(r=><button type="button" key={r.id} className="mini-row" onClick={()=>{setNames({...names,[r.sourceId]:r.title});onChange(multiple?[...new Set([...value,r.sourceId])]:[r.sourceId]);setQ('');setRes([])}}><Chip tone="gray">{r.label}</Chip><span>{r.title}</span></button>)}</div>}
 </div>;
}
function LookupPicker({app,table,value,onChange}:{app:string,table:string,value:string,onChange:(v:string)=>void}){
 const {data}=useApi<{records:Rec[]}>(`/api/studio/records?app=${encodeURIComponent(app)}&table=${encodeURIComponent(table)}&size=200`);
 return <select value={value} onChange={e=>onChange(e.target.value)}><option value="">—</option>{(data?.records||[]).map(r=><option key={r.id} value={r.id}>{r.number} · {r.title}</option>)}</select>;
}
function SignaturePad({value,onChange}:{value:string,onChange:(v:string)=>void}){
 const ref=useRef<HTMLCanvasElement>(null);const drawing=useRef(false);
 const pos=(e:React.PointerEvent)=>{const r=ref.current!.getBoundingClientRect();return [e.clientX-r.left,e.clientY-r.top]};
 return <div className="sig">{value?<img src={value} alt="Signature" className="sig-img"/>:<canvas ref={ref} width={360} height={110} className="sig-pad" aria-label="Draw your signature"
  onPointerDown={e=>{drawing.current=true;const c=ref.current!.getContext('2d')!;c.lineWidth=2;c.lineCap='round';c.strokeStyle='#222';const [x,y]=pos(e);c.beginPath();c.moveTo(x,y)}}
  onPointerMove={e=>{if(!drawing.current)return;const c=ref.current!.getContext('2d')!;const [x,y]=pos(e);c.lineTo(x,y);c.stroke()}}
  onPointerUp={()=>{drawing.current=false;onChange(ref.current!.toDataURL('image/png'))}}/>}
  {value&&<Btn size="sm" variant="ghost" onClick={()=>onChange('')}>Clear signature</Btn>}</div>;
}
export function FieldInput({f,value,onChange,app,data}:{f:StudioField,value:unknown,onChange:(v:unknown)=>void,app:string,data:Record<string,unknown>}):ReactNode{
 const s=value==null?'':String(value);
 switch(f.type){
  case 'richtext':return <textarea rows={5} value={s} onChange={e=>onChange(e.target.value)} placeholder="Markdown supported"/>;
  case 'number':case 'currency':case 'percent':return <input type="number" value={s} min={f.min} max={f.max} step="any" onChange={e=>onChange(e.target.value===''?'':Number(e.target.value))}/>;
  case 'rating':return <div className="rating" role="radiogroup" aria-label={f.label}>{Array.from({length:f.max||5},(_,i)=><button type="button" key={i} aria-label={`${i+1}`} className={cx(Number(value)>i&&'on')} onClick={()=>onChange(i+1)}><Icon name="Star" size={18}/></button>)}</div>;
  case 'date':return <input type="date" value={s} onChange={e=>onChange(e.target.value)}/>;
  case 'datetime':return <input type="datetime-local" value={s.slice(0,16)} onChange={e=>onChange(e.target.value)}/>;
  case 'email':return <input type="email" value={s} onChange={e=>onChange(e.target.value)}/>;
  case 'phone':return <input type="tel" value={s} onChange={e=>onChange(e.target.value)}/>;
  case 'address':return <textarea rows={2} value={s} onChange={e=>onChange(e.target.value)}/>;
  case 'select':return <select value={s} onChange={e=>onChange(e.target.value)}><option value="">—</option>{(f.options||[]).map(o=><option key={o}>{o}</option>)}</select>;
  case 'radio':return <div className="radio-row">{(f.options||[]).map(o=><label key={o}><input type="radio" checked={s===o} onChange={()=>onChange(o)}/>{o}</label>)}</div>;
  case 'multiselect':{const v=Array.isArray(value)?value.map(String):[];return <div className="radio-row">{(f.options||[]).map(o=><label key={o}><input type="checkbox" checked={v.includes(o)} onChange={e=>onChange(e.target.checked?[...v,o]:v.filter(x=>x!==o))}/>{o}</label>)}</div>}
  case 'checkbox':return <label className="check"><input type="checkbox" checked={value===true} onChange={e=>onChange(e.target.checked)}/>{f.help||'Yes'}</label>;
  case 'person':return <PersonSelect value={s||null} onChange={v=>onChange(v||'')}/>;
  case 'department':return <DeptSelect value={s} onChange={v=>onChange(v)}/>;
  case 'location':return <LocationInput value={s} onChange={v=>onChange(v)}/>;
  case 'group':case 'role':return <input value={s} onChange={e=>onChange(e.target.value)} placeholder={f.type==='group'?'Group id':'Role id'}/>;
  case 'file':{const v=Array.isArray(value)?value.map(String):s?[s]:[];return <FilePick value={v} onChange={onChange}/>}
  case 'signature':return <SignaturePad value={s} onChange={onChange}/>;
  case 'lookup':return <LookupPicker app={app} table={String(f.lookupTable)} value={s} onChange={onChange}/>;
  case 'relationship':return <RecordPicker relation={String(f.relation)} value={Array.isArray(value)?value.map(String):s?[s]:[]} onChange={onChange} multiple/>;
  case 'formula':{let v:unknown='';try{v=evalFormula(f.formula||'',data)}catch{v='—'}return <output className="formula-out">{String(v??'—')}</output>}
  case 'autonumber':return <output className="muted">Assigned when saved</output>;
  case 'repeating':{const rows=Array.isArray(value)?value as Record<string,unknown>[]:[];return <div className="repeat">{rows.map((r,i)=><div key={i} className="repeat-row">{(f.subfields||[]).map(sf=><Field key={sf.key} label={sf.label}><FieldInput f={sf} value={r[sf.key]} app={app} data={r} onChange={v=>onChange(rows.map((x,j)=>j===i?{...x,[sf.key]:v}:x))}/></Field>)}<Btn size="sm" variant="ghost" icon="Trash2" title="Remove row" onClick={()=>onChange(rows.filter((_,j)=>j!==i))}/></div>)}<Btn size="sm" icon="Plus" onClick={()=>onChange([...rows,{}])}>Add row</Btn></div>}
 }
 return <input value={s} onChange={e=>onChange(e.target.value)} pattern={f.pattern} maxLength={1000}/>;
}
function FilePick({value,onChange}:{value:string[],onChange:(v:unknown)=>void}){
 const {toast}=useApp();const [busy,setBusy]=useState(false);
 return <div className="row-gap">{value.map(id=><Chip key={id} tone="gray"><a href={`#/files/root/${id}`}>File</a> <button type="button" className="link" onClick={()=>onChange(value.filter(x=>x!==id))}>×</button></Chip>)}
  <label className={cx('btn btn-sm',busy&&'busy')}><Icon name="Upload" size={14}/>Upload<input type="file" hidden onChange={async e=>{const file=e.target.files?.[0];if(!file)return;setBusy(true);try{const fd=new FormData();fd.append('file',file);const r=await fetch('/api/files',{method:'POST',body:fd});const j=await r.json() as {id?:string,error?:string,files?:{id:string}[]};if(!r.ok)throw new Error(j.error||'Upload failed.');const id=j.id||j.files?.[0]?.id;if(id)onChange([...value,id])}catch(err){toast((err as Error).message,'error')}finally{setBusy(false)}}}/></label></div>;
}
export function FieldValue({f,v}:{f:StudioField,v:unknown}){
 const {person}=useApp();
 if(v===undefined||v===null||v===''||(Array.isArray(v)&&!v.length))return <span className="muted">—</span>;
 switch(f.type){
  case 'checkbox':return <>{v?'Yes':'No'}</>;
  case 'person':return <>{person(String(v))?.name||'Unknown person'}</>;
  case 'richtext':return <Markdown text={String(v)}/>;
  case 'signature':return <img src={String(v)} alt="Signature" className="sig-img"/>;
  case 'rating':return <>{'★'.repeat(Number(v))}</>;
  case 'currency':return <>{f.currency||''} {Number(v).toLocaleString()}</>;
  case 'percent':return <>{Number(v)}%</>;
  case 'datetime':return <>{dateTime(String(v))}</>;
  case 'file':return <>{(v as string[]).map(id=><a key={id} className="chip chip-gray" href={`#/files/root/${id}`}>File</a>)}</>;
  case 'repeating':{const rows=v as Record<string,unknown>[];return <table className="plain"><thead><tr>{(f.subfields||[]).map(s=><th key={s.key}>{s.label}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{(f.subfields||[]).map(s=><td key={s.key}><FieldValue f={s} v={r[s.key]}/></td>)}</tr>)}</tbody></table>}
 }
 return <>{Array.isArray(v)?v.join(', '):String(v)}</>;
}

// ── Form (create or edit) ──
export function RecordForm({app,def,form,table,record,preview,onDone,onCancel}:{app:string,def:AppDef,form?:StudioForm,table:StudioTable,record?:Rec,preview?:boolean,onDone:(r:{id:string})=>void,onCancel?:()=>void}){
 const {toast}=useApp();
 const [data,setData]=useState<Record<string,unknown>>(()=>record?{...record.data}:Object.fromEntries(table.fields.filter(f=>f.default!==undefined).map(f=>[f.key,f.default])));
 const [busy,setBusy]=useState<string|null>(null);const [err,setErr]=useState('');
 const sections=form?form.sections:[{title:'',fields:table.fields.map(f=>f.key)}];
 const byKey=new Map(table.fields.map(f=>[f.key,f]));
 const save=async(draft:boolean)=>{setBusy(draft?'draft':'save');setErr('');try{const r=await api<{id:string}>('/api/studio/records',record?{action:'update',app,table:table.key,id:record.id,data,draft,baseVersion:record.version,preview}:{action:'create',app,table:table.key,form:form?.key,data,draft,preview});toast(draft?'Draft saved':record?'Saved':'Submitted');onDone(r)}catch(e){setErr((e as Error).message)}finally{setBusy(null)}};
 return <form className="studio-form" onSubmit={e=>{e.preventDefault();save(false)}}>
  <ErrorNote error={err}/>
  {sections.map((s,i)=><fieldset key={i} className="form-section">{s.title&&<legend>{s.title}</legend>}<div className="form-grid">
   {s.fields.map(k=>byKey.get(k)).filter((f):f is StudioField=>!!f).filter(f=>!f.showIf||test(f.showIf,data)).map(f=><Field key={f.key} label={`${f.label}${f.required?' *':''}`} hint={f.help} wide={['richtext','repeating','address','signature','multiselect','relationship'].includes(f.type)}><FieldInput f={f} value={data[f.key]} app={app} data={data} onChange={v=>setData(d=>({...d,[f.key]:v}))}/></Field>)}
  </div></fieldset>)}
  <div className="row-gap"><Btn type="submit" variant="primary" busy={busy==='save'}>{form?.submitLabel||(record?'Save':'Submit')}</Btn>{(form?.allowDraft??true)&&(!record||record.isDraft)&&<Btn busy={busy==='draft'} onClick={()=>save(true)}>Save as draft</Btn>}{onCancel&&<Btn variant="ghost" onClick={onCancel}>Cancel</Btn>}</div>
 </form>;
}

// ── Reports ──
const PALETTE=['#6D5EF8','#2E8BF0','#0E9AA7','#E6A100','#E0569B','#14A06F','#F2711C','#4A4FD9'];
type ReportResult={report:Pick<StudioReport,'key'|'name'|'chart'|'groupBy'|'column'|'measure'|'source'>,total:number,count:number,series:{name:string,value:number,count:number}[],pivot:{columns:string[],rows:{name:string,cells:number[],total:number}[]}|null,rows:Record<string,unknown>[],canExport:boolean};
export function ReportChart({r}:{r:ReportResult}){
 const s=r.series;const max=Math.max(1,...s.map(x=>x.value));const chart=r.report.chart;
 if(!r.count)return <Empty icon="ChartColumn" title="No data yet">Records that match this report will appear here.</Empty>;
 if(chart==='kpi')return <div className="lb-kpi"><b>{r.total.toLocaleString()}</b><small>{r.report.measure.op}{r.report.measure.field?` of ${r.report.measure.field}`:''} · {r.count} records</small></div>;
 if(chart==='pie'||chart==='donut'){const total=s.reduce((n,x)=>n+x.value,0)||1;let acc=0;const stops=s.slice(0,8).map((x,i)=>{const a=acc;acc+=x.value/total*360;return `${PALETTE[i]} ${a}deg ${acc}deg`}).join(',');return <div className="lb-pie"><div className={cx('pie',chart==='donut'&&'donut')} style={{background:`conic-gradient(${stops}${acc<360?`,#8884 ${acc}deg 360deg`:''})`}} role="img" aria-label={s.map(x=>`${x.name}: ${x.value}`).join(', ')}/><ul>{s.slice(0,8).map((x,i)=><li key={x.name}><span className="tile-dot" style={{background:PALETTE[i]}}/>{x.name}<b>{x.value.toLocaleString()}</b></li>)}{s.length>8&&<li className="muted">+{s.length-8} more (see table)</li>}</ul></div>}
 if(chart==='line'||chart==='area'){const W=560,H=180,P=28;const pts=s.map((x,i)=>[P+(s.length<2?0:i*(W-2*P)/(s.length-1)),H-P-(x.value/max)*(H-2*P)]);const d=pts.map((p,i)=>`${i?'L':'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return <svg className="rep-line" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={s.map(x=>`${x.name}: ${x.value}`).join(', ')}><line x1={P} x2={W-P} y1={H-P} y2={H-P} className="axis"/>{chart==='area'&&pts.length>1&&<path d={`${d} L${pts[pts.length-1][0]},${H-P} L${pts[0][0]},${H-P} Z`} fill={PALETTE[0]} opacity=".18"/>}<path d={d} fill="none" stroke={PALETTE[0]} strokeWidth="2"/>{pts.map((p,i)=><circle key={i} cx={p[0]} cy={p[1]} r="4" fill={PALETTE[0]}><title>{`${s[i].name}: ${s[i].value}`}</title></circle>)}{s.length>0&&<><text x={P} y={H-8} className="tick">{s[0].name}</text><text x={W-P} y={H-8} textAnchor="end" className="tick">{s[s.length-1].name}</text><text x={P} y={14} className="tick">{max.toLocaleString()}</text></>}</svg>}
 if(chart==='funnel')return <div className="rep-funnel">{s.slice(0,10).map(x=><div key={x.name} className="rep-funnel-row"><span>{x.name}</span><i style={{width:`${Math.max(6,x.value/max*100)}%`}} title={`${x.name}: ${x.value}`}/><b>{x.value.toLocaleString()}</b></div>)}</div>;
 if(chart==='pivot'&&r.pivot)return <div className="lb-table"><table className="plain"><thead><tr><th>{r.report.groupBy}</th>{r.pivot.columns.map(c=><th key={c}>{c}</th>)}<th>Total</th></tr></thead><tbody>{r.pivot.rows.map(x=><tr key={x.name}><td>{x.name}</td>{x.cells.map((c,i)=><td key={i}>{c||''}</td>)}<td><b>{x.total}</b></td></tr>)}</tbody></table></div>;
 if(chart==='timeline'||chart==='calendar')return <ul className="lb-cal">{s.map(x=><li key={x.name}><span className="lb-date">{x.name}</span><span>{x.count} record{x.count===1?'':'s'}</span><b>{x.value.toLocaleString()}</b></li>)}</ul>;
 if(chart==='table'||chart==='map'){const rows=r.rows.slice(0,100);const keys=Object.keys(rows[0]||{}).filter(k=>!['link'].includes(k)).slice(0,7);return <>{chart==='map'&&<Note>Grouped by location.</Note>}<div className="lb-table"><table className="plain"><thead><tr>{keys.map(k=><th key={k}>{k}</th>)}</tr></thead><tbody>{rows.map((x,i)=><tr key={i}>{keys.map((k,j)=><td key={k}>{j===0&&x.link?<a href={String(x.link)}>{String(x[k]??'')}</a>:Array.isArray(x[k])?(x[k] as unknown[]).join(', '):String(x[k]??'')}</td>)}</tr>)}</tbody></table></div></>}
 return <div className="lb-bars" role="img" aria-label={s.map(x=>`${x.name}: ${x.value}`).join(', ')}>{s.slice(0,15).map(x=><div key={x.name} className="lb-bar" title={`${x.name}: ${x.value}`}><span>{x.name}</span><i style={{width:`${Math.max(3,x.value/max*100)}%`}}/><b>{x.value.toLocaleString()}</b></div>)}</div>;
}
export function ReportView({app,reportKey,preview}:{app:string,reportKey:string,preview?:boolean}){
 const {toast}=useApp();const {data,error,reload}=useApi<ReportResult>(`/api/studio/records?app=${encodeURIComponent(app)}&report=${encodeURIComponent(reportKey)}${preview?'&preview=1':''}`);
 if(error)return <ErrorNote error={error} onRetry={reload}/>;if(!data)return <Skeleton rows={4}/>;
 return <Card title={data.report.name} actions={data.canExport&&<Btn size="sm" icon="Download" onClick={async()=>{try{const r=await api<{rows:Record<string,unknown>[]}>('/api/studio/records',{action:'export-report',app,report:reportKey});{const keys=Object.keys(r.rows[0]||{});downloadCsv(`${data.report.key}.csv`,[keys,...r.rows.map(x=>keys.map(k=>Array.isArray(x[k])?(x[k] as unknown[]).join("; "):x[k]??""))])}}catch(e){toast((e as Error).message,'error')}}}>Export</Btn>}><ReportChart r={data}/><details className="rep-table"><summary>Show as table</summary><table className="plain"><thead><tr><th>{data.report.groupBy||'Group'}</th><th>Records</th><th>Value</th></tr></thead><tbody>{data.series.map(x=><tr key={x.name}><td>{x.name}</td><td>{x.count}</td><td>{x.value}</td></tr>)}</tbody></table></details></Card>;
}

// ── App runtime: #/apps/<slug>/<table|form|report|page>/<key>/<recordId?> ──
export default function AppRuntime({parts}:{parts:string[]}){
 const [slug,kind,key,rid]=parts;
 const list=useApi<{apps:AppInfo['app'][]}>(slug?null:'/api/studio');
 const info=useApi<AppInfo>(slug?`/api/studio?id=${encodeURIComponent(slug)}&version=published`:null);
 if(!slug)return <div className="page"><Header icon="AppWindow" tone="violet" title="Apps" subtitle="Company apps built in Workspace Studio that are published for you."/><ErrorNote error={list.error} onRetry={list.reload}/>
  {!list.data?<Skeleton/>:!list.data.apps.filter(a=>a.publishedVersion).length?<Empty icon="AppWindow" title="No apps published for you yet"/>:<div className="module-grid">{list.data.apps.filter(a=>a.publishedVersion&&a.status!=='archived').map(a=><a key={a.id} className="module-card" href={`#/apps/${a.slug}`}><Icon name={a.icon||'AppWindow'} size={20}/><div><b>{a.name}</b><small>{a.description||`Version ${a.publishedVersion}`}</small></div></a>)}</div>}</div>;
 if(info.error)return <div className="page"><ErrorNote error={info.error} onRetry={info.reload}/></div>;
 if(!info.data)return <div className="page"><Skeleton rows={8}/></div>;
 const def=info.data.definition;const a=info.data.app;
 const nav=def.nav.length?def.nav:[...def.tables.map(t=>({label:t.name,kind:'table' as const,ref:t.key})),...def.forms.map(f=>({label:f.name,kind:'form' as const,ref:f.key})),...def.reports.map(r=>({label:r.name,kind:'report' as const,ref:r.key}))];
 const first=nav[0];const k=kind||first?.kind;const ref=key||first?.ref;
 return <div className="page">
  <Header icon={a.icon||'AppWindow'} tone="violet" title={a.name} subtitle={a.description} actions={info.data.canManage&&<Btn icon="PanelsTopLeft" onClick={()=>go(`studio/apps/${a.id}`)}>Open in Studio</Btn>}/>
  <nav className="app-nav">{nav.map(n=><a key={`${n.kind}:${n.ref}`} href={n.kind==='page'?`#/pages/${n.ref}`:`#/apps/${a.slug}/${n.kind}/${n.ref}`} className={cx('app-nav-link',k===n.kind&&ref===n.ref&&'on')}>{n.label}</a>)}</nav>
  {k==='table'&&ref&&(rid?<RecordPage app={a.slug} def={def} tableKey={ref} id={rid}/>:<TableView app={a.slug} def={def} tableKey={ref}/>)}
  {k==='form'&&ref&&(()=>{const f=def.forms.find(x=>x.key===ref);const t=f&&def.tables.find(x=>x.key===f.table);return f&&t?<Card title={f.name}><RecordForm app={a.slug} def={def} form={f} table={t} onDone={r=>go(`apps/${a.slug}/table/${t.key}/${r.id}`)}/></Card>:<Empty title="Form not found"/>})()}
  {k==='report'&&ref&&<ReportView app={a.slug} reportKey={ref}/>}
  {!first&&<Empty icon="AppWindow" title="This app has nothing to show yet"/>}
 </div>;
}
export function TableView({app,def,tableKey,preview,limit}:{app:string,def:AppDef,tableKey:string,preview?:boolean,limit?:number}){
 const t=def.tables.find(x=>x.key===tableKey);const [q,setQ]=useState('');const [status,setStatus]=useState('');const [mine,setMine]=useState(false);const [creating,setCreating]=useState(false);const [page,setPage]=useState(1);
 const wf=def.workflows.find(w=>w.key===t?.workflow);
 const {data,error,reload}=useApi<{records:Rec[],total:number,page:number,size:number}>(t?`/api/studio/records?app=${encodeURIComponent(app)}&table=${t.key}&q=${encodeURIComponent(q)}&status=${encodeURIComponent(status)}&mine=${mine?1:0}&page=${page}&size=${limit||50}${preview?'&preview=1':''}`:null);
 if(!t)return <Empty title="Table not found"/>;
 const cols=t.fields.filter(f=>!['richtext','repeating','signature','file'].includes(f.type)).slice(0,5);
 const form=def.forms.find(f=>f.table===t.key);
 return <div className="studio-table">
  <div className="toolbar"><input type="search" placeholder={`Search ${t.name}…`} value={q} onChange={e=>{setQ(e.target.value);setPage(1)}} aria-label="Search"/>{wf&&<select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Status"><option value="">All statuses</option>{wf.states.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>}<label className="check"><input type="checkbox" checked={mine} onChange={e=>setMine(e.target.checked)}/>Mine</label><span className="spacer"/><Btn variant="primary" icon="Plus" onClick={()=>setCreating(true)}>New {t.name.replace(/s$/,'').toLowerCase()}</Btn></div>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:!data.records.length?<Empty icon="Table2" title={`No ${t.name.toLowerCase()} yet`}/>:<div className="lb-table"><table className="plain"><thead><tr><th>Number</th><th>{t.fields.find(f=>f.key===t.titleField)?.label||'Title'}</th>{wf&&<th>Status</th>}{cols.filter(c=>c.key!==t.titleField).map(c=><th key={c.key}>{c.label}</th>)}<th>Updated</th></tr></thead>
   <tbody>{data.records.map(r=><tr key={r.id}><td><a href={`#/apps/${app}/table/${t.key}/${r.id}`}>{r.number||'—'}</a></td><td>{r.title}{r.isDraft&&<> <Chip tone="amber">draft</Chip></>}</td>{wf&&<td><Chip tone={r.statusKind==='end'?'green':'violet'}>{r.statusName}</Chip></td>}{cols.filter(c=>c.key!==t.titleField).map(c=><td key={c.key}><FieldValue f={c} v={r.data[c.key]}/></td>)}<td className="muted">{ago(r.updatedAt)}</td></tr>)}</tbody></table>
   {data.total>data.size&&<div className="row-gap"><Btn size="sm" disabled={page<=1} onClick={()=>setPage(page-1)}>Previous</Btn><span className="muted small">Page {data.page} of {Math.ceil(data.total/data.size)}</span><Btn size="sm" disabled={page*data.size>=data.total} onClick={()=>setPage(page+1)}>Next</Btn></div>}</div>}
  {creating&&<Modal open wide onClose={()=>setCreating(false)} title={form?.name||`New ${t.name}`}><RecordForm app={app} def={def} form={form} table={t} preview={preview} onCancel={()=>setCreating(false)} onDone={()=>{setCreating(false);reload()}}/></Modal>}
 </div>;
}
type Detail={record:Rec,transitions:{id:string,label:string,to:string,approval:boolean,blocked:string}[],workflow:{states:{id:string,name:string,kind:string}[],current:string}|null,versions:{version:number,status:string,editedBy:string,createdAt:string}[],approvals:{id:string,stage:number,name:string,status:string,mode:string,quorum:number,approvers:string[],decisions:{by:string,approve:boolean,comment:string,at:string}[],createdAt:string,decidedAt:string|null}[],history:{action:string,createdAt:string,who:string}[]};
export function RecordPage({app,def,tableKey,id,preview}:{app:string,def:AppDef,tableKey:string,id:string,preview?:boolean}){
 const {s,toast,person,ask}=useApp();const t=def.tables.find(x=>x.key===tableKey)!;
 const {data,error,reload}=useApi<Detail>(`/api/studio/records?app=${encodeURIComponent(app)}&id=${encodeURIComponent(id)}${preview?'&preview=1':''}`);
 const [tab,setTab]=useState('details');const [editing,setEditing]=useState(false);const [busy,setBusy]=useState('');
 if(error)return <ErrorNote error={error} onRetry={reload}/>;if(!data)return <Skeleton rows={6}/>;
 const r=data.record;const hidden=t.fields.filter(f=>!(f.key in r.data));
 const step=async(tr:Detail['transitions'][number])=>{const comment=await ask({title:tr.label,body:tr.approval?'This step needs approval. Approvers will be notified.':`Move to “${tr.to}”.`,input:{label:'Comment (optional)',multiline:true},confirm:tr.label});if(comment===false)return;setBusy(tr.id);try{const res=await api<{status?:string,pending?:boolean}>('/api/studio/records',{action:'transition',app,id:r.id,transition:tr.id,comment:comment||'',preview});toast(res.pending?'Sent for approval':'Done');reload();window.dispatchEvent(new Event('ows:graph-changed'))}catch(e){toast((e as Error).message,'error')}finally{setBusy('')}};
 const decide=async(approvalId:string,approve:boolean)=>{const comment=await ask({title:approve?'Approve':'Reject',input:{label:'Comment',multiline:true},confirm:approve?'Approve':'Reject',danger:!approve});if(comment===false)return;try{await api('/api/studio/records',{action:'decide',approvalId,approve,comment:comment||''});toast(approve?'Approved':'Rejected');reload()}catch(e){toast((e as Error).message,'error')}};
 return <div className="record-page">
  <div className="record-head"><div><small className="muted">{r.number}</small><h2>{r.title}</h2><div className="row-gap">{data.workflow&&<Chip tone={r.statusKind==='end'?'green':'violet'}>{r.statusName}</Chip>}{r.isDraft&&<Chip tone="amber">Draft</Chip>}<span className="muted small">{person(r.createdBy)?.name||''} · updated {ago(r.updatedAt)} · v{r.version}</span></div></div>
   <div className="row-gap">{data.transitions.map(tr=><Btn key={tr.id} variant="primary" busy={busy===tr.id} disabled={!!tr.blocked} title={tr.blocked||`Move to ${tr.to}`} icon={tr.approval?'Stamp':'ArrowRight'} onClick={()=>step(tr)}>{tr.label}</Btn>)}<Btn icon="Pencil" onClick={()=>setEditing(true)}>Edit</Btn></div></div>
  {data.transitions.some(x=>x.blocked)&&<Note tone="warn">{data.transitions.filter(x=>x.blocked).map(x=>`${x.label}: ${x.blocked}`).join(' · ')}</Note>}
  {data.workflow&&<ol className="wf-steps">{data.workflow.states.map(st=><li key={st.id} className={cx(st.id===r.status&&'on',st.kind==='end'&&'end')}>{st.name}</li>)}</ol>}
  <Tabs value={tab} onChange={setTab} items={[{id:'details',label:'Details'},{id:'approvals',label:'Approvals',count:data.approvals.length},{id:'connected',label:'Connected'},{id:'history',label:'History',count:data.history.length},{id:'versions',label:'Versions',count:data.versions.length}]}/>
  {tab==='details'&&<div className="kv-grid">{t.fields.filter(f=>f.key in r.data).map(f=><div key={f.key} className="kv"><small>{f.label}</small><div><FieldValue f={f} v={r.data[f.key]}/></div></div>)}{hidden.length>0&&<p className="muted small"><Icon name="Lock" size={12}/> {hidden.length} field{hidden.length===1?' is':'s are'} restricted for your role.</p>}</div>}
  {tab==='approvals'&&(!data.approvals.length?<Empty icon="Stamp" title="No approvals on this record"/>:<ul className="approval-list">{data.approvals.map(a=><li key={a.id}><div><b>{a.name}</b> <Chip tone={a.status==='approved'?'green':a.status==='rejected'?'red':'amber'}>{a.status}</Chip> <small className="muted">{a.mode==='all'?'Everyone must approve':a.mode==='quorum'?`${a.quorum} approvals needed`:'Any one approver'}</small></div>
   <small>{a.approvers.map(x=>person(x)?.name||'Someone').join(', ')}</small>{a.decisions.map((d,i)=><div key={i} className="small">{person(d.by)?.name}: {d.approve?'approved':'rejected'}{d.comment&&` — “${d.comment}”`} · {ago(d.at)}</div>)}
   {a.status==='pending'&&a.approvers.includes(s.user.id)&&!a.decisions.some(d=>d.by===s.user.id)&&<div className="row-gap"><Btn size="sm" variant="primary" icon="Check" onClick={()=>decide(a.id,true)}>Approve</Btn><Btn size="sm" icon="X" onClick={()=>decide(a.id,false)}>Reject</Btn></div>}</li>)}</ul>)}
  {tab==='connected'&&<ConnectedContext type="studio_record" id={r.id}/>}
  {tab==='history'&&<ol className="timeline">{data.history.map((h,i)=><li key={i}><span className="dot"/><div><b>{h.action}</b><small>{h.who||'System'} · {ago(h.createdAt)}</small></div></li>)}</ol>}
  {tab==='versions'&&<ul className="mini-list">{data.versions.map(v=><li key={v.version} className="mini-row"><b>v{v.version}</b><span>{v.status} · {person(v.editedBy)?.name||''} · {dateTime(v.createdAt)}</span></li>)}</ul>}
  {editing&&<Modal open wide onClose={()=>setEditing(false)} title={`Edit ${r.number||r.title}`}><RecordForm app={app} def={def} table={t} record={r} preview={preview} onCancel={()=>setEditing(false)} onDone={()=>{setEditing(false);reload()}}/></Modal>}
 </div>;
}

// ── Custom fields added in Studio to built-in modules, shown on their record pages ──
export function CustomFields({type,id}:{type:string,id:string}){
 const {toast}=useApp();
 const {data,reload}=useApi<{fields:StudioField[],stages:string[],values:Record<string,unknown>,stage:string,canEdit:boolean}>(`/api/extensions?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`);
 const [edit,setEdit]=useState<Record<string,unknown>|null>(null);const [busy,setBusy]=useState(false);
 const visible=useMemo(()=>data?.fields||[],[data]);
 if(!data||(!visible.length&&!data.stages.length))return null;
 const save=async(extra:Record<string,unknown>={})=>{setBusy(true);try{await api('/api/extensions',{type,id,values:edit||{},...extra});toast('Saved');setEdit(null);reload()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}};
 return <Card title="Custom fields" className="custom-fields" actions={data.canEdit&&!edit&&visible.length>0&&<Btn size="sm" icon="Pencil" onClick={()=>setEdit({...data.values})}>Edit</Btn>}>
  {data.stages.length>0&&<div className="row-gap"><small className="muted">Stage</small>{data.canEdit?<select aria-label="Stage" value={data.stage} onChange={e=>api('/api/extensions',{type,id,stage:e.target.value,values:{}}).then(()=>{toast('Stage updated');reload()}).catch(err=>toast((err as Error).message,'error'))}><option value="">—</option>{data.stages.map(s=><option key={s}>{s}</option>)}</select>:<Chip tone="violet">{data.stage||'—'}</Chip>}</div>}
  {edit?<form onSubmit={e=>{e.preventDefault();save()}}><div className="form-grid">{visible.filter(f=>!f.showIf||test(f.showIf,edit)).map(f=><Field key={f.key} label={`${f.label}${f.required?' *':''}`} hint={f.help}><FieldInput f={f} value={edit[f.key]} app="" data={edit} onChange={v=>setEdit({...edit,[f.key]:v})}/></Field>)}</div><div className="row-gap"><Btn type="submit" variant="primary" busy={busy}>Save</Btn><Btn variant="ghost" onClick={()=>setEdit(null)}>Cancel</Btn></div></form>
   :<div className="kv-grid">{visible.map(f=><div key={f.key} className="kv"><small>{f.label}</small><div><FieldValue f={f} v={data.values[f.key]}/></div></div>)}</div>}
 </Card>;
}
