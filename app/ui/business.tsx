'use client';
import {useEffect,useState} from 'react';
import {api,useApi,go,ago,cx} from './lib';
import {useApp,Btn,Chip,Header,Field,ErrorNote,Skeleton,Empty,Icon,Modal,PersonSelect,DeptSelect,Card,TagPicker,useGroups} from './kit';
import {ConnectedContext} from './context';
import {workKinds,workKindById,type WorkKind,type WorkField} from '../work-records';

// Goals & customers: strategy, commercial and governance records. Each one is a Work Graph node, so its
// page is mostly connected context: what it contributes to, who owns it, what was bought, decided and delivered.
type Rec={id:string,kind:string,number:string,title:string,status:string,ownerId:string|null,department:string,parentId:string|null,startDate:string|null,endDate:string|null,amount:number|null,currency:string,progress:number,visibility:string,updatedAt:string};
type Detail={record:Rec&{description:string,location:string,data:Record<string,unknown>},parent:Rec|null,children:Rec[],history:{action:string,createdAt:string,who:string}[],canEdit:boolean};
const tone=(s:string)=>/achieved|active|decided|held|completed|on track/i.test(s)?'green':/risk|expiring|negotiation|proposed|hold/i.test(s)?'amber':/missed|off track|expired|terminated|cancelled|reversed/i.test(s)?'red':'gray';
// Strategy kinds live in the Strategy app; decisions and meetings also appear in Knowledge.
export const STRATEGY_KIND_IDS=['strategy','theme','goal','objective','key_result','initiative','programme'];
export const businessViews=workKinds.filter(k=>!STRATEGY_KIND_IDS.includes(k.id)).map(k=>({id:k.id,label:k.plural,icon:k.icon,section:k.group}));
export const recordPath=(kind:string,id:string)=>STRATEGY_KIND_IDS.includes(kind)?`strategy/item/${id}`:kind==='decision'?`knowledge/decisions/${id}`:`business/${kind}/${id}`;

export default function Business({parts}:{parts:string[]}){
 const kind=workKindById.get(parts[0]||'customer')||workKindById.get('customer')!;
 if(STRATEGY_KIND_IDS.includes(kind.id)&&parts[1]&&parts[1]!=='new'&&parts[2]!=='edit'){go(`strategy/item/${parts[1]}`);return null}
 if(parts[1]==='new')return <Editor kind={kind}/>;
 if(parts[1])return <RecordPage kind={kind} id={parts[1]} edit={parts[2]==='edit'}/>;
 return <List kind={kind}/>;
}
function List({kind}:{kind:WorkKind}){
 const {person}=useApp();const [q,setQ]=useState('');const [status,setStatus]=useState('');
 const {data,error,reload}=useApi<{records:Rec[],counts:Record<string,number>,canCreate:boolean}>(`/api/business?kind=${kind.id}`);
 const rows=(data?.records||[]).filter(r=>(!status||r.status===status)&&(!q||`${r.number} ${r.title}`.toLowerCase().includes(q.toLowerCase())));
 const strategy=kind.group==='Strategy';
 return <div className="page">
  <Header icon={kind.icon} tone="violet" title={kind.plural} subtitle={kind.group==='Strategy'?'Goals break down into objectives and initiatives; projects contribute to them. Progress and spend come from the connected work.':kind.group==='Customers'?'Customers, their contracts and the services you deliver, connected to projects, vendors, assets and tickets.':'Meetings and the decisions taken in them, connected to projects, customers and resulting tasks.'} actions={data?.canCreate&&<Btn variant="primary" icon="Plus" onClick={()=>go(`business/${kind.id}/new`)}>New {kind.label.toLowerCase()}</Btn>}/>
  <div className="toolbar"><input className="search" placeholder={`Search ${kind.plural.toLowerCase()}…`} value={q} onChange={e=>setQ(e.target.value)} aria-label="Search"/><select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option>{kind.statuses.map(s=><option key={s}>{s}</option>)}</select></div>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton rows={6}/>:!rows.length?<Empty icon={kind.icon} title={`No ${kind.plural.toLowerCase()} yet`} action={data.canCreate&&<Btn variant="primary" icon="Plus" onClick={()=>go(`business/${kind.id}/new`)}>New {kind.label.toLowerCase()}</Btn>}/>:
   strategy&&kind.id==='goal'?<StrategyTree goals={rows}/>:
   <div className="table-wrap"><table className="grid-table"><thead><tr><th>Number</th><th>Title</th><th>Status</th><th>Owner</th>{kind.hasAmount&&<th>{kind.hasAmount}</th>}{kind.hasDates&&<th>{kind.hasDates[1]}</th>}<th>Updated</th></tr></thead><tbody>{rows.map(r=><tr key={r.id} onClick={()=>go(`business/${kind.id}/${r.id}`)}><td>{r.number}</td><td><b>{r.title}</b></td><td><Chip tone={tone(r.status)}>{r.status}</Chip></td><td>{person(r.ownerId)?.name||'—'}</td>{kind.hasAmount&&<td className="num">{r.amount!==null?`${r.currency} ${r.amount.toLocaleString()}`:'—'}</td>}{kind.hasDates&&<td>{r.endDate||'—'}</td>}<td className="muted">{ago(r.updatedAt)}</td></tr>)}</tbody></table></div>}
 </div>;
}
// Goals with their objectives and initiatives underneath (each level loaded from the same API).
function StrategyTree({goals}:{goals:Rec[]}){
 const {data:obj}=useApi<{records:Rec[]}>('/api/business?kind=objective');const {data:ini}=useApi<{records:Rec[]}>('/api/business?kind=initiative');
 return <div className="strategy-tree">{goals.map(g=><Card key={g.id} title={<a href={`#/business/goal/${g.id}`}>{g.number} · {g.title}</a>} actions={<Chip tone={tone(g.status)}>{g.status}</Chip>}>
  <div className="progress" aria-label={`${g.progress}%`}><span style={{width:`${g.progress}%`}}/></div>
  {(obj?.records||[]).filter(o=>o.parentId===g.id).map(o=><div key={o.id} className="tree-node"><Icon name="Crosshair" size={14}/><a href={`#/business/objective/${o.id}`}>{o.title}</a><Chip tone={tone(o.status)}>{o.status}</Chip>
   <div className="tree-children">{(ini?.records||[]).filter(i=>i.parentId===o.id).map(i=><div key={i.id} className="tree-node"><Icon name="Rocket" size={13}/><a href={`#/business/initiative/${i.id}`}>{i.title}</a><Chip tone={tone(i.status)}>{i.status}</Chip></div>)}</div></div>)}
 </Card>)}</div>;
}
function RecordPage({kind,id,edit}:{kind:WorkKind,id:string,edit:boolean}){
 const {toast,ask,person}=useApp();const {data,error,reload}=useApi<Detail>(`/api/business?id=${encodeURIComponent(id)}`);
 if(edit)return <Editor kind={kind} id={id}/>;
 if(error)return <div className="page"><ErrorNote error={error} onRetry={reload}/></div>;
 if(!data)return <div className="page"><Skeleton rows={8}/></div>;
 const r=data.record;const d=r.data||{};const child=workKinds.find(k=>k.parent?.kind===kind.id);
 return <div className="page">
  <Header icon={kind.icon} tone="violet" title={<>{r.title} <small className="muted">{r.number}</small></>} subtitle={<span className="row-gap"><Chip tone={tone(r.status)}>{r.status}</Chip><span>{kind.label}</span>{person(r.ownerId)&&<span>Owner: {person(r.ownerId)?.name}</span>}{r.department&&<span>{r.department}</span>}</span>} actions={data.canEdit&&<><Btn icon="Pencil" onClick={()=>go(`business/${kind.id}/${id}/edit`)}>Edit</Btn>{child&&<Btn icon="Plus" onClick={()=>go(`business/${child.id}/new?parent=${id}`)}>Add {child.label.toLowerCase()}</Btn>}<Btn variant="ghost" icon="Trash2" title="Delete" onClick={async()=>{if(await ask({title:`Delete ${r.title}?`,confirm:'Delete',danger:true})===false)return;try{await api('/api/business',{action:'delete',id});toast('Deleted');go(`business/${kind.id}`)}catch(e){toast((e as Error).message,'error')}}}/></>}/>
  <div className="split-2">
   <div className="stack">
    <ConnectedContext type={kind.id} id={id} title={`What ${r.title} is connected to`}/>
   </div>
   <div className="stack">
    <Card title="Details">
     {r.description&&<p className="prewrap">{r.description}</p>}
     <dl className="kv">{data.parent&&<div><dt>{kind.parent?.label}</dt><dd><a href={`#/business/${data.parent.kind}/${data.parent.id}`}>{data.parent.title}</a></dd></div>}
      {kind.hasDates&&<div><dt>{kind.hasDates[0]} → {kind.hasDates[1]}</dt><dd>{r.startDate||'—'} → {r.endDate||'—'}</dd></div>}
      {kind.hasAmount&&r.amount!==null&&<div><dt>{kind.hasAmount}</dt><dd>{r.currency} {r.amount.toLocaleString()}</dd></div>}
      {['goal','objective','initiative'].includes(kind.id)&&<div><dt>Progress</dt><dd>{r.progress}%</dd></div>}
      {kind.fields.filter(f=>f.type!=='refs'&&d[f.key]!==undefined&&d[f.key]!=='').map(f=><div key={f.key}><dt>{f.label}</dt><dd className="prewrap">{f.type==='people'?(d[f.key] as string[]).map(x=>person(x)?.name).filter(Boolean).join(', '):f.type==='person'?person(String(d[f.key]))?.name:f.type==='url'?<a href={String(d[f.key])} target="_blank" rel="noreferrer">{String(d[f.key])}</a>:String(d[f.key])}</dd></div>)}
      <div><dt>Visible to</dt><dd>{r.visibility==='company'?'Everyone with access':r.visibility==='department'?`${r.department||'Department'} only`:'Owner and administrators'}</dd></div>
     </dl>
    </Card>
    {child&&<Card title={child.plural}>{data.children.length?data.children.map(c=><a key={c.id} className="mini-row" href={`#/business/${c.kind}/${c.id}`}><Icon name={child.icon} size={14}/><span>{c.title}<small>{c.status}</small></span></a>):<p className="muted small">None yet.</p>}</Card>}
    <Card title="History"><ol className="timeline">{data.history.map((h,i)=><li key={i}><span className="dot"/><div><b>{h.action}</b><small>{h.who||'System'} · {ago(h.createdAt)}</small></div></li>)}</ol></Card>
   </div>
  </div>
 </div>;
}
export function WorkEditor({kind,id,onSaved}:{kind:WorkKind,id?:string,onSaved?:(id:string)=>void}){return <Editor kind={kind} id={id} onSaved={onSaved}/>}
function Editor({kind,id,onSaved}:{kind:WorkKind,id?:string,onSaved?:(id:string)=>void}){
 const {toast,s}=useApp();const existing=useApi<Detail>(id?`/api/business?id=${encodeURIComponent(id)}`:null);
 const parentKinds=kind.parents?kind.parents.map(p=>p.kind):kind.parent?[kind.parent.kind]:[];
 const parents=useApi<{records:Rec[]}>(parentKinds.length?`/api/business?${parentKinds.length===1?`kind=${parentKinds[0]}`:''}`:null);const groups=useGroups();
 const parentOptions=(parents.data?.records||[]).filter(p=>parentKinds.includes(p.kind)&&p.id!==id);
 const [v,setV]=useState<{title:string,description:string,status:string,ownerId:string|null,department:string,parentId:string,startDate:string,endDate:string,amount:string,progress:string,visibility:string,data:Record<string,unknown>,acl:{people:string[],groups:string[],roles:string[]},version?:number}>({title:'',description:'',status:kind.statuses[0],ownerId:s.user.id,department:s.user.department,parentId:new URLSearchParams(location.hash.split('?')[1]||'').get('parent')||'',startDate:'',endDate:'',amount:'',progress:'0',visibility:'company',data:{},acl:{people:[],groups:[],roles:[]}});
 const [loaded,setLoaded]=useState(!id);const [busy,setBusy]=useState(false);
 useEffect(()=>{const r=existing.data?.record;if(!r||loaded)return;const x=r as Rec&{acl?:{people?:string[],groups?:string[],roles?:string[]},version?:number};setV({title:r.title,description:r.description,status:r.status,ownerId:r.ownerId,department:r.department,parentId:r.parentId||'',startDate:r.startDate||'',endDate:r.endDate||'',amount:r.amount===null?'':String(r.amount),progress:String(r.progress),visibility:r.visibility,data:r.data||{},acl:{people:x.acl?.people||[],groups:x.acl?.groups||[],roles:x.acl?.roles||[]},version:x.version});setLoaded(true)},[existing.data,loaded]);
 const setData=(k:string,x:unknown)=>setV(o=>({...o,data:{...o.data,[k]:x}}));
 async function save(){setBusy(true);try{const r=await api<{id:string}>('/api/business',{action:'save',id,kind:kind.id,...v,parentId:v.parentId||null,amount:v.amount===''?null:Number(v.amount),progress:Number(v.progress)});toast('Saved');if(onSaved)onSaved(r.id);else go(recordPath(kind.id,r.id))}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}
 if(!loaded)return <div className="page"><Skeleton rows={8}/></div>;
 return <div className="page"><Header icon={kind.icon} tone="violet" title={id?`Edit ${kind.label.toLowerCase()}`:`New ${kind.label.toLowerCase()}`} actions={<><Btn variant="ghost" onClick={()=>history.back()}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!v.title.trim()} onClick={save}>Save</Btn></>}/>
  <Card><div className="form-grid">
   <Field label="Title" wide><input autoFocus value={v.title} onChange={e=>setV({...v,title:e.target.value})}/></Field>
   <Field label="Description" wide><textarea rows={3} value={v.description} onChange={e=>setV({...v,description:e.target.value})}/></Field>
   <Field label="Status"><select value={v.status} onChange={e=>setV({...v,status:e.target.value})}>{kind.statuses.map(x=><option key={x}>{x}</option>)}</select></Field>
   {parentKinds.length>0&&<Field label={kind.parent?.label||'Parent'}><select value={v.parentId} onChange={e=>setV({...v,parentId:e.target.value})}><option value="">None</option>{parentOptions.map(p=><option key={p.id} value={p.id}>{p.number} · {p.title}</option>)}</select></Field>}
   <Field label="Owner"><PersonSelect value={v.ownerId} onChange={x=>setV({...v,ownerId:x})}/></Field>
   <Field label="Department"><DeptSelect value={v.department} any="" onChange={x=>setV({...v,department:x})}/></Field>
   {kind.hasDates&&<><Field label={kind.hasDates[0]}><input type={kind.id==='meeting'?'datetime-local':'date'} value={v.startDate} onChange={e=>setV({...v,startDate:e.target.value})}/></Field><Field label={kind.hasDates[1]}><input type={kind.id==='meeting'?'datetime-local':'date'} value={v.endDate} onChange={e=>setV({...v,endDate:e.target.value})}/></Field></>}
   {kind.hasAmount&&<Field label={`${kind.hasAmount} (${s.tenant.currency})`}><input type="number" min="0" step="0.01" value={v.amount} onChange={e=>setV({...v,amount:e.target.value})}/></Field>}
   {['goal','initiative','programme'].includes(kind.id)&&<Field label="Manual progress %" hint="Used only when progress is calculated manually; otherwise it is rolled up from contributing records."><input type="number" min="0" max="100" value={v.progress} onChange={e=>setV({...v,progress:e.target.value})}/></Field>}
   <Field label="Who can see it"><select value={v.visibility} onChange={e=>setV({...v,visibility:e.target.value})}><option value="company">Everyone with access</option><option value="department">The department only</option><option value="private">Only the owner and administrators</option><option value="leadership">Leadership (administrators and managers, or chosen roles)</option><option value="groups">Selected groups</option><option value="confidential">Confidential: named people only</option><option value="partners">Named people incl. external partners</option></select></Field>
   {['leadership','groups','confidential','partners'].includes(v.visibility)&&<><Field label="People with access" wide><TagPicker values={v.acl.people.map(x=>s.people.find(p=>p.id===x)?.name||x)} options={s.people.map(p=>p.name)} onChange={names=>setV({...v,acl:{...v.acl,people:names.map(n=>s.people.find(p=>p.name===n)?.id||n)}})} placeholder="Add people"/></Field>{v.visibility==='groups'&&<Field label="Groups" wide><TagPicker values={v.acl.groups.map(x=>groups.find(g=>g.id===x)?.name||x)} options={groups.map(g=>g.name)} onChange={names=>setV({...v,acl:{...v.acl,groups:names.map(n=>groups.find(g=>g.name===n)?.id||n)}})} placeholder="Choose groups"/></Field>}{v.visibility==='leadership'&&<Field label="Roles (optional)"><TagPicker values={v.acl.roles} options={['admin','manager',...s.roles.map(r=>r.id)]} onChange={x=>setV({...v,acl:{...v.acl,roles:x}})} placeholder="Managers"/></Field>}</>}
   {kind.fields.map(f=><WorkFieldInput key={f.key} f={f} value={v.data[f.key]} onChange={x=>setData(f.key,x)}/>)}
  </div></Card>
 </div>;
}
function WorkFieldInput({f,value,onChange}:{f:WorkField,value:unknown,onChange:(v:unknown)=>void}){
 const {person}=useApp();
 if(f.type==='textarea')return <Field label={f.label} hint={f.help} wide><textarea rows={3} value={String(value??'')} onChange={e=>onChange(e.target.value)}/></Field>;
 if(f.type==='select')return <Field label={f.label}><select value={String(value??'')} onChange={e=>onChange(e.target.value)}><option value="">—</option>{f.options!.map(o=><option key={o}>{o}</option>)}</select></Field>;
 if(f.type==='person')return <Field label={f.label}><PersonSelect value={(value as string)||null} onChange={x=>onChange(x)}/></Field>;
 if(f.type==='people'){const list=(value as string[]|undefined)||[];return <Field label={f.label} wide><div className="row-gap">{list.map(x=><span key={x} className="chip chip-gray">{person(x)?.name||x}<button className="icon-btn" aria-label="Remove" onClick={()=>onChange(list.filter(y=>y!==x))}><Icon name="X" size={12}/></button></span>)}</div><PersonSelect value={null} placeholder="Add a person…" onChange={x=>{if(x&&!list.includes(x))onChange([...list,x])}}/></Field>}
 if(f.type==='refs')return <RefsInput f={f} value={(value as string[]|undefined)||[]} onChange={onChange}/>;
 return <Field label={f.label} hint={f.help}><input type={f.type==='number'||f.type==='currency'?'number':f.type==='date'?'date':f.type==='email'?'email':f.type==='url'?'url':'text'} value={String(value??'')} onChange={e=>onChange(e.target.value)}/></Field>;
}
// Links to other records, chosen from the Work Graph (only records the person can see are offered).
function RefsInput({f,value,onChange}:{f:WorkField,value:string[],onChange:(v:string[])=>void}){
 const [q,setQ]=useState('');const [res,setRes]=useState<{sourceId:string,title:string}[]>([]);const [titles,setTitles]=useState<Record<string,string>>({});
 useEffect(()=>{if(q.trim().length<2){setRes([]);return}const t=setTimeout(()=>api<{nodes:{sourceId:string,title:string}[]}>(`/api/graph?q=${encodeURIComponent(q)}&types=${f.refType}`).then(r=>setRes(r.nodes)).catch(()=>setRes([])),250);return()=>clearTimeout(t)},[q,f.refType]);
 return <Field label={f.label} hint={f.help} wide><div className="row-gap">{value.map(x=><span key={x} className="chip chip-gray">{titles[x]||'Linked record'}<button className="icon-btn" aria-label="Remove link" onClick={()=>onChange(value.filter(y=>y!==x))}><Icon name="X" size={12}/></button></span>)}</div>
  <input value={q} onChange={e=>setQ(e.target.value)} placeholder={`Search ${f.refType}s to link…`} aria-label={f.label}/>
  {res.length>0&&<div className="mini-list">{res.slice(0,8).map(r=><button key={r.sourceId} type="button" className={cx('mini-row')} onClick={()=>{if(!value.includes(r.sourceId))onChange([...value,r.sourceId]);setTitles({...titles,[r.sourceId]:r.title});setQ('')}}><Icon name="Plus" size={13}/><span>{r.title}</span></button>)}</div>}
 </Field>;
}
