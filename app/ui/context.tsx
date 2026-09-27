'use client';
import {useEffect,useState} from 'react';
import {api,useApi,ago,cx} from './lib';
import {useApp,Btn,Chip,Field,ErrorNote,Skeleton,Empty,Icon,Modal,Note,Tabs} from './kit';

// Connected context: the Work Graph neighbourhood of a record, embedded in every module's record page.
// Everything shown has been authorised on the server for the viewer; hidden neighbours are only counted.
type Item={id:string,type:string,label:string,sourceId:string,title:string,status:string,url:string,summary:string,relation:string,via:{title:string,url:string}|null,depth:number,provider:string|null,syncMode:string|null,lastVerifiedAt:string|null,externalId:string|null};
type Ctx={root:{id:string,type:string,title:string,label:string},sections:{key:string,label:string,icon:string,items:Item[],total:number}[],facts:{label:string,value:string|number,tone?:string}[],history:{action:string,at:string,who:string,record:{title:string,url:string,label:string}|null}[],restricted:number,total:number,canLink:boolean};
const RELS:[string,string][]=[['related_to','is related to'],['depends_on','depends on'],['blocks','blocks'],['part_of','is part of'],['contributes_to','contributes to'],['resulted_in','resulted in'],['decided_in','was decided in'],['attached_to','is attached to'],['supplied_by','is supplied by'],['funded_by','is funded by'],['maintained_by','is maintained by'],['assigned_to','is assigned to'],['owns','owns'],['manages','manages']];

export function ConnectedContext({type,id,compact,title='Connected context'}:{type:string,id:string,compact?:boolean,title?:string}){
 const {can}=useApp();
 const {data,error,reload}=useApi<Ctx>(can('graph')?`/api/graph?view=context&type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`:null);
 const [tab,setTab]=useState('connected');const [linking,setLinking]=useState(false);const [open,setOpen]=useState<Record<string,boolean>>({});
 // Other panels (agents, forms) announce changes so the context stays current.
 useEffect(()=>{const f=()=>reload();window.addEventListener('ows:graph-changed',f);return()=>window.removeEventListener('ows:graph-changed',f)},[reload]);
 if(!can('graph'))return null;
 if(error)return <ErrorNote error={error} onRetry={reload}/>;
 if(!data)return <Skeleton rows={4}/>;
 const ask=()=>window.dispatchEvent(new CustomEvent('ows:agent',{detail:{recordType:type,recordId:id,title:data.root.title}}));
 return <section className={cx('ctx',compact&&'ctx-compact')} aria-label={title}>
  <div className="ctx-head"><div><h3>{title}</h3><small className="muted">{data.total} connected record{data.total===1?'':'s'} you can see{data.restricted?` · ${data.restricted} restricted`:''}</small></div>
   <div className="row-gap"><Btn size="sm" icon="Bot" onClick={ask}>Ask an agent</Btn>{data.canLink&&<Btn size="sm" icon="Link2" onClick={()=>setLinking(true)}>Connect a record</Btn>}<Btn size="sm" variant="ghost" icon="Network" title="Open in Work Graph" onClick={()=>{location.hash=`#/graph?type=${type}&id=${id}`}}/></div></div>
  {data.facts.length>0&&<div className="ctx-facts">{data.facts.map(f=><div key={f.label} className={cx('ctx-fact',f.tone&&`tone-${f.tone}`)}><small>{f.label}</small><b>{f.value}</b></div>)}</div>}
  {!compact&&<Tabs value={tab} onChange={setTab} items={[{id:'connected',label:'Connected',count:data.total},{id:'history',label:'History',count:data.history.length}]}/>}
  {(compact||tab==='connected')&&(!data.sections.length?<Empty icon="Network" title="Nothing connected yet">Links appear automatically as people work: assignments, purchases, files, approvals, meetings and decisions.</Empty>:
   <div className="ctx-sections">{data.sections.map(s=>{const show=open[s.key]?s.items:s.items.slice(0,compact?4:8);return <div key={s.key} className="ctx-section">
    <div className="ctx-section-head"><Icon name={s.icon} size={15}/><b>{s.label}</b><span className="count">{s.total}</span></div>
    <ul>{show.map(i=><li key={i.id}><a href={i.url} target={i.syncMode&&i.url.startsWith('http')?'_blank':undefined} rel="noreferrer"><span className="ctx-title">{i.title}</span></a>
     <span className="ctx-meta">{i.status&&<Chip tone="gray">{i.status}</Chip>}{i.relation&&<small className="muted">{i.relation}</small>}{i.via&&<small className="muted">via <a href={i.via.url}>{i.via.title}</a></small>}{i.provider&&<small className="ctx-lineage" title={`External ID ${i.externalId||''}`}><Icon name="Link" size={11}/>{i.provider} · {i.syncMode||'live'}{i.lastVerifiedAt?` · verified ${ago(i.lastVerifiedAt)}`:''}</small>}</span></li>)}</ul>
    {s.items.length>show.length&&<button className="link small" onClick={()=>setOpen({...open,[s.key]:true})}>Show all {s.items.length}</button>}
   </div>})}</div>)}
  {!compact&&tab==='history'&&<ol className="timeline">{data.history.map((h,i)=><li key={i}><span className="dot"/><div><b>{h.action}</b>{h.record&&<> · <a href={h.record.url}>{h.record.label}: {h.record.title}</a></>}<small>{h.who} · {ago(h.at)}</small></div></li>)}{!data.history.length&&<li className="muted">No history yet.</li>}</ol>}
  {data.restricted>0&&<p className="muted small"><Icon name="Lock" size={12}/> {data.restricted} connected record{data.restricted===1?' is':'s are'} outside your access and not shown.</p>}
  {linking&&<LinkRecord type={type} id={id} onClose={()=>setLinking(false)} onDone={()=>{setLinking(false);reload()}}/>}
 </section>;
}
function LinkRecord({type,id,onClose,onDone}:{type:string,id:string,onClose:()=>void,onDone:()=>void}){
 const {toast}=useApp();const [q,setQ]=useState('');const [rel,setRel]=useState('related_to');const [busy,setBusy]=useState(false);
 const [results,setResults]=useState<{id:string,type:string,label:string,sourceId:string,title:string,status:string}[]>([]);
 useEffect(()=>{if(q.trim().length<2){setResults([]);return}const t=setTimeout(()=>api<{nodes:typeof results}>(`/api/graph?q=${encodeURIComponent(q)}`).then(r=>setResults(r.nodes)).catch(()=>setResults([])),250);return()=>clearTimeout(t)},[q]);
 return <Modal open onClose={onClose} title="Connect a record" subtitle="Only records you can see are offered. The link is audited and appears for everyone who can see both records.">
  <Field label="This record…"><select value={rel} onChange={e=>setRel(e.target.value)}>{RELS.map(([k,l])=><option key={k} value={k}>{l}</option>)}</select></Field>
  <Field label="Find a record"><input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Search projects, assets, contracts, files…"/></Field>
  <div className="mini-list">{results.map(r=><button key={r.id} className="mini-row" disabled={busy} onClick={async()=>{setBusy(true);try{await api('/api/graph',{action:'relate',fromType:type,fromId:id,toType:r.type,toId:r.sourceId,relationship:rel});toast('Connected');onDone()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}><Chip tone="gray">{r.label}</Chip><span>{r.title}<small>{r.status}</small></span></button>)}{q.length>1&&!results.length&&<p className="muted small">No matching records you can see.</p>}</div>
  <Note>Relationships created by the system (assignments, purchases, receipts, approvals) are added automatically and cannot be removed here.</Note>
 </Modal>;
}
