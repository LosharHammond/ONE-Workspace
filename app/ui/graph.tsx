'use client';
import {useEffect,useMemo,useState} from 'react';
import {go,useApi} from './lib';
import {Btn,Chip,Empty,ErrorNote,Header,Icon,Skeleton,useApp} from './kit';

type GraphNode={id:string,type:string,label:string,sourceId:string,title:string,summary:string,status:string,department:string,location:string,module:string,url:string};
type GraphEdge={id:string,src:string,dst:string,type:string,label:string,inverseLabel:string,origin:string};
type GraphResult={nodes:GraphNode[],query:string,indexing?:{active:boolean,stage:string},operations?:{pendingEvents:number,failedEvents:number,deferredEvents:number}};
type GraphContext={graph:{root:GraphNode,nodes:GraphNode[],edges:GraphEdge[],restricted:number},path?:{found:boolean,sentence:string}};
const types=[['','All types'],['project','Projects'],['task','Tasks'],['ticket','Tickets'],['asset','Assets'],['person','People'],['file','Files'],['PR','Requisitions'],['PO','Purchase orders']];

// Shared 360 panel for source-record screens. The graph API rechecks every endpoint against the viewer's
// current source-module permissions; the panel never renders the graph's cached data as an authority.
export function GraphContextPanel({type,id,title}:{type:'project'|'asset',id:string,title:string}){
 const {can}=useApp();const allowed=can('graph');const depth=type==='asset'?2:1;const url=allowed?`/api/graph?id=${encodeURIComponent(id)}&type=${type}&depth=${depth}`:null;
 const {data,error,loading,reload}=useApi<GraphContext>(url);const graph=data?.graph;
 if(!allowed)return null;
 const related=(nodeId:string)=>graph?.nodes.find(n=>n.id===nodeId);
 const edges=graph?.edges.slice(0,60)||[];const directIds=new Set(edges.filter(e=>e.src===graph?.root.id||e.dst===graph?.root.id).map(e=>e.src===graph?.root.id?e.dst:e.src));
 return <section className="graph-context graph-record-context" aria-label={title}>
  <div className="graph-section-head"><div><h2>{title}</h2><small>{graph?`${graph.nodes.length-1} connected records · only records you can open`: 'Authorized relationships from linked records'}</small></div><div className="row-gap"><Btn size="sm" variant="ghost" icon="RefreshCw" title="Refresh related context" onClick={reload}/><Btn size="sm" variant="ghost" icon="Network" onClick={()=>go('graph')}>Open graph</Btn></div></div>
  {error?<ErrorNote error={error} onRetry={reload}/>:loading||!graph?<Skeleton rows={3}/>:!edges.length?<Empty icon="Network" title="No related records visible">Linked context appears here when source records are available and your permissions allow access.</Empty>:<div className="graph-edges">{edges.map(e=>{const direct=e.src===graph.root.id||e.dst===graph.root.id;const midId=direct?(e.src===graph.root.id?e.dst:e.src):directIds.has(e.src)?e.src:e.dst;const farId=direct?null:(midId===e.src?e.dst:e.src);const other=direct?related(midId):related(farId||'');const middle=direct?null:related(midId);if(!other||(!direct&&!middle))return null;const label=direct?(e.src===graph.root.id?e.label:e.inverseLabel):e.label;const titleText=direct?other.title:`${graph.root.title} → ${middle!.title} → ${other.title}`;const subText=direct?[other.label,other.status,other.department].filter(Boolean).join(' · '):`${middle!.label} · ${label} · ${other.label}`;return <a className={`graph-edge ${direct?'':'graph-edge-indirect'}`} key={e.id} href={other.url||undefined}><span className="graph-edge-mark"><Icon name={direct?'CornerDownRight':'Network'} size={15}/></span><span><small>{direct?label:'Connected through'}</small><b>{titleText}</b><em>{subText}</em></span><Icon name="ChevronRight" size={16}/></a>})}{graph.edges.length>edges.length&&<p className="muted small">Showing the first {edges.length} relationships.</p>}</div>}
  {!!graph?.restricted&&<div className="note note-info"><Icon name="Lock" size={16}/><span>{graph.restricted} linked record(s) were omitted because they are outside your access.</span></div>}
 </section>;
}

export default function WorkGraph(){
 const [draft,setDraft]=useState(''),[query,setQuery]=useState(''),[type,setType]=useState(''),[selected,setSelected]=useState<GraphNode|null>(null),[depth,setDepth]=useState(2);
 const listUrl=useMemo(()=>`/api/graph?q=${encodeURIComponent(query)}${type?`&types=${encodeURIComponent(type)}`:''}`,[query,type]);
 const list=useApi<GraphResult>(listUrl);const listData=list.data;const reloadList=list.reload;const indexingActive=listData?.indexing?.active;
 useEffect(()=>{if(!indexingActive)return;const timer=window.setInterval(()=>reloadList(),2500);return()=>window.clearInterval(timer)},[indexingActive,reloadList]);
 const contextUrl=selected?`/api/graph?id=${encodeURIComponent(selected.sourceId)}&type=${encodeURIComponent(selected.type)}&depth=${depth}`:null;
 const detail=useApi<GraphContext>(contextUrl);
 const choose=(n:GraphNode)=>setSelected(n);
 const records=listData?.nodes||[],graph=detail.data?.graph;
 const related=(id:string)=>graph?.nodes.find(n=>n.id===id);
 return <div className="page graph-page">
  <Header icon="Network" tone="violet" title="One Work Graph" subtitle="Explore the people, work and records connected across your company—only within your access." actions={<Btn icon="RefreshCw" onClick={()=>{reloadList();detail.reload()}}>Refresh</Btn>}/>
  <div className="graph-tools">
   <form className="graph-search" onSubmit={e=>{e.preventDefault();setQuery(draft.trim());setSelected(null)}}><Icon name="Search" size={17}/><input aria-label="Search the Work Graph" placeholder="Search projects, people, tickets, assets…" value={draft} onChange={e=>setDraft(e.target.value)}/><Btn type="submit" variant="primary" icon="Search">Search</Btn></form>
   <label className="graph-filter"><span>Record type</span><select value={type} onChange={e=>{setType(e.target.value);setSelected(null)}}>{types.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
  </div>
  <ErrorNote error={list.error||detail.error} onRetry={()=>{reloadList();detail.reload()}}/>
  {!!listData?.operations?.deferredEvents&&<div className="note note-warn"><Icon name="Clock" size={16}/><span>{listData.operations.deferredEvents} event(s) are waiting on configured Studio automations. The records and graph projection are saved, but automation execution is not enabled yet.</span></div>}
  {!!listData?.operations?.failedEvents&&<div className="note note-error"><Icon name="CircleAlert" size={16}/><span>{listData.operations.failedEvents} background event(s) failed and need operator review.</span></div>}
  <div className="graph-layout">
   <section className="graph-browser"><div className="graph-section-head"><div><h2>{query?`Results for “${query}”`:'Recently connected records'}</h2><small>{listData?`${records.length} visible records${listData.indexing?.active?' · indexing existing work':''}`:'Checking your authorized records'}</small></div><button className="btn btn-sm" onClick={()=>{setDraft('');setQuery('');setSelected(null)}}>Clear</button></div>
    {!listData?<Skeleton rows={5}/>:!records.length&&listData.indexing?.active?<div className="graph-indexing" role="status"><span className="spinner"/><div><b>Preparing your Work Graph</b><small>Connecting existing company records. This continues safely in the background.</small></div></div>:!records.length?<Empty icon="SearchX" title={query?'No matching records':'No graph records yet'}>{query?'Try a shorter search or another record type.':'As people create and link company records, the authorized relationships will appear here.'}</Empty>:<div className="graph-results">{records.map(n=><button type="button" className={`graph-result ${selected?.id===n.id?'selected':''}`} key={n.id} onClick={()=>choose(n)}><span className="graph-result-icon"><Icon name={n.type==='project'?'FolderKanban':n.type==='person'?'User':n.type==='ticket'?'LifeBuoy':n.type==='asset'?'Boxes':n.type==='file'?'File':'Workflow'} size={17}/></span><span className="graph-result-main"><b>{n.title}</b><small>{n.label}{n.department?` · ${n.department}`:''}{n.status?` · ${n.status}`:''}</small></span><Icon name="ChevronRight" size={16}/></button>)}</div>}
   </section>
   <section className="graph-context"><div className="graph-section-head"><div><h2>Record context</h2><small>{graph?`${graph.nodes.length-1} connected records`: 'Select a record to explore its relationships'}</small></div>{graph&&<label className="graph-depth"><span>Depth</span><select value={depth} onChange={e=>setDepth(Number(e.target.value))}><option value={1}>1 step</option><option value={2}>2 steps</option><option value={3}>3 steps</option></select></label>}</div>
    {!selected?<Empty icon="Network" title="Choose a record">Its authorized relationships and source links will appear here.</Empty>:!graph?<Skeleton rows={4}/>:<>
     <div className="graph-root"><span className="eyebrow">Selected {graph.root.label}</span><h3>{graph.root.title}</h3><div className="row-gap">{graph.root.status&&<Chip>{graph.root.status}</Chip>}{graph.root.department&&<span className="muted small">{graph.root.department}</span>}{graph.root.location&&<span className="muted small">{graph.root.location}</span>}</div>{graph.root.url&&<a className="link small" href={graph.root.url}>Open source record <Icon name="ArrowUp" size={14}/></a>}</div>
     {!graph.edges.length?<Empty icon="Network" title="No visible relationships yet">Related records are shown only when your current permissions allow you to open them.</Empty>:<div className="graph-edges">{graph.edges.map(e=>{const from=related(e.src),to=related(e.dst);if(!from||!to)return null;const direct=e.src===graph.root.id||e.dst===graph.root.id;const other=direct?(e.src===graph.root.id?to:from):null;const relation=direct?(e.src===graph.root.id?e.label:e.inverseLabel):e.label;return <button type="button" className={`graph-edge ${direct?'':'graph-edge-indirect'}`} key={e.id} onClick={()=>other&&choose(other)} disabled={!other}><span className="graph-edge-mark"><Icon name={direct?'CornerDownRight':'Network'} size={15}/></span><span><small>{relation}</small><b>{direct?other!.title:`${from.title} → ${to.title}`}</b><em>{direct?`${other!.label}${other!.status?` · ${other!.status}`:''}`:'Connected records'}</em></span>{direct&&<Icon name="ChevronRight" size={16}/>}</button>})}</div>}
     {!!graph.restricted&&<div className="note note-info"><Icon name="Lock" size={16}/><span>{graph.restricted} connected record(s) omitted because they are outside your access.</span></div>}
    </>}
   </section>
  </div>
 </div>
}
