'use client';
import {useEffect,useMemo,useState} from 'react';
import {api,useApi,cx,downloadCsv} from './lib';
import {useApp,Btn,Chip,Header,Modal,Field,ErrorNote,Skeleton,Empty,Card,Icon,Note} from './kit';
import {ImportGeneric} from './people';

// Company settings › Lists: every pick list staff choose from in forms, maintained in one place.
type ListDef={id:string,label:string,group:string,description:string,parent?:string};
type Value={id:string,list:string,value:string,parent:string,description:string,sort:number,active:number};
type Data={lists:ListDef[],values:Value[],canManage:boolean,counts:{departments:number,locations:number,vendors:number}};
const managed=[{id:'departments',label:'Departments',icon:'Building2',href:'people/departments',key:'departments'},{id:'locations',label:'Locations',icon:'MapPin',href:'people/locations',key:'locations'},{id:'vendors',label:'Vendors',icon:'Store',href:'purchasing/vendors',key:'vendors'}] as const;
export default function Lists({listId}:{listId?:string}){
 const {toast,ask,refresh}=useApp();const {data,error,reload}=useApi<Data>('/api/lookups');
 const [edit,setEdit]=useState<Partial<Value>|null>(null),[importing,setImporting]=useState(false),[q,setQ]=useState(''),[parentFilter,setParentFilter]=useState('');
 const current=data?.lists.find(l=>l.id===listId)||data?.lists[0];
 useEffect(()=>{setParentFilter('');setQ('')},[listId]);
 const values=useMemo(()=>(data?.values||[]).filter(v=>v.list===current?.id).filter(v=>!parentFilter||v.parent===parentFilter).filter(v=>!q||v.value.toLowerCase().includes(q.toLowerCase())),[data,current,parentFilter,q]);
 const parents=useMemo(()=>current?.parent?(data?.values||[]).filter(v=>v.list===current.parent&&v.active).map(v=>v.value):[],[data,current]);
 if(error)return <div className="page"><ErrorNote error={error} onRetry={reload}/></div>;
 if(!data||!current)return <div className="page"><Skeleton rows={8}/></div>;
 const done=async(msg:string)=>{toast(msg);await reload();refresh()};
 const groups=[...new Set(data.lists.map(l=>l.group))];
 async function move(v:Value,dir:-1|1){const same=(data!.values).filter(x=>x.list===v.list&&x.parent===v.parent).sort((a,b)=>a.sort-b.sort||a.value.localeCompare(b.value));const i=same.findIndex(x=>x.id===v.id),j=i+dir;if(j<0||j>=same.length)return;[same[i],same[j]]=[same[j],same[i]];try{await api('/api/lookups',{action:'reorder',list:v.list,ids:same.map(x=>x.id)});done('Order saved')}catch(e){toast((e as Error).message,'error')}}
 return <div className="page">
  <Header icon="ListChecks" tone="gray" title="Lists" subtitle="Everything staff pick from in forms: set it up once here and it appears as a choice everywhere. Existing records keep their values if you rename or remove an option."/>
  <div className="lists-layout">
   <nav className="lists-nav" aria-label="Lists">
    <p className="rail-section">Managed records</p>
    {managed.map(m=><a key={m.id} className="rail-link" href={`#/${m.href}`}><Icon name={m.icon} size={16}/><span>{m.label}</span><b>{data.counts[m.key]}</b></a>)}
    {groups.map(g=><div key={g}><p className="rail-section">{g}</p>{data.lists.filter(l=>l.group===g).map(l=><a key={l.id} href={`#/admin/lists/${l.id}`} className={cx('rail-link',l.id===current.id&&'on')} aria-current={l.id===current.id?'page':undefined}><Icon name="List" size={16}/><span>{l.label}</span><b>{data.values.filter(v=>v.list===l.id&&v.active).length}</b></a>)}</div>)}
   </nav>
   <Card title={current.label} actions={data.canManage&&<><Btn icon="Upload" onClick={()=>setImporting(true)}>Import</Btn><Btn icon="Download" onClick={()=>downloadCsv(current.id,[['value',...(current.parent?['parent']:[]),'description','active'],...values.map(v=>[v.value,...(current.parent?[v.parent]:[]),v.description,v.active?'yes':'no'])])}>Export</Btn><Btn variant="primary" icon="Plus" disabled={!!current.parent&&!parents.length} onClick={()=>setEdit({list:current.id,value:'',parent:parentFilter||parents[0]||'',description:'',active:1})}>Add</Btn></>}>
    <p className="muted small">{current.description}</p>
    <div className="row-gap"><input className="grid-search" placeholder="Filter…" aria-label="Filter values" value={q} onChange={e=>setQ(e.target.value)}/>{current.parent&&<select aria-label="Parent" value={parentFilter} onChange={e=>setParentFilter(e.target.value)}><option value="">All {data.lists.find(l=>l.id===current.parent)?.label.toLowerCase()}</option>{parents.map(p=><option key={p}>{p}</option>)}</select>}</div>
    {current.parent&&!parents.length&&<Note>Add {data.lists.find(l=>l.id===current.parent)?.label.toLowerCase()} first; each value here sits under one of them.</Note>}
    {!values.length?<Empty icon="List" title="No values yet">{data.canManage?'Add the options staff should choose from.':'An administrator has not set this list up yet.'}</Empty>:
    <table className="plain lists-table"><thead><tr><th>Value</th>{current.parent&&<th>Under</th>}<th>Description</th><th>Status</th>{data.canManage&&<th/>}</tr></thead><tbody>{values.sort((a,b)=>a.parent.localeCompare(b.parent)||a.sort-b.sort||a.value.localeCompare(b.value)).map(v=><tr key={v.id} className={cx(!v.active&&'muted')}><td><b>{v.value}</b></td>{current.parent&&<td>{v.parent}</td>}<td className="small">{v.description}</td><td>{v.active?<Chip tone="green">Active</Chip>:<Chip>Inactive</Chip>}</td>{data.canManage&&<td className="row-gap nowrap"><Btn size="sm" variant="ghost" icon="ArrowUp" title="Move up" onClick={()=>move(v,-1)}/><Btn size="sm" variant="ghost" icon="ArrowDown" title="Move down" onClick={()=>move(v,1)}/><Btn size="sm" variant="ghost" icon="Pencil" title="Edit" onClick={()=>setEdit(v)}/><Btn size="sm" variant="ghost" icon="Trash2" title="Delete" onClick={async()=>{if(await ask({title:`Delete “${v.value}”?`,body:'Records that already use it keep the value. Deactivate instead to hide it from forms but keep it in reports.',confirm:'Delete',danger:true})===false)return;try{await api('/api/lookups',{action:'delete',id:v.id});done('Deleted')}catch(e){toast((e as Error).message,'error')}}}/></td>}</tr>)}</tbody></table>}
   </Card>
  </div>
  {edit&&<Modal open onClose={()=>setEdit(null)} title={edit.id?'Edit value':`Add to ${current.label}`} footer={<><Btn variant="ghost" onClick={()=>setEdit(null)}>Cancel</Btn><Btn variant="primary" disabled={!edit.value?.trim()} onClick={async()=>{try{await api('/api/lookups',{action:'save',id:edit.id,list:current.id,value:edit.value,parent:edit.parent,description:edit.description,active:edit.active!==0});setEdit(null);done('Saved')}catch(e){toast((e as Error).message,'error')}}}>Save</Btn></>}>
   <div className="form-grid">
    <Field label="Value"><input autoFocus value={edit.value||''} onChange={e=>setEdit({...edit,value:e.target.value})}/></Field>
    {current.parent&&<Field label={`Under ${data.lists.find(l=>l.id===current.parent)?.label.toLowerCase().replace(/s$/,'')}`}><select value={edit.parent||''} onChange={e=>setEdit({...edit,parent:e.target.value})}>{parents.map(p=><option key={p}>{p}</option>)}</select></Field>}
    <Field label="Description" wide><input value={edit.description||''} onChange={e=>setEdit({...edit,description:e.target.value})}/></Field>
    {edit.id&&<label className="check wide"><input type="checkbox" checked={edit.active!==0} onChange={e=>setEdit({...edit,active:e.target.checked?1:0})}/>Active (shown in forms)</label>}
   </div>
  </Modal>}
  {importing&&<ImportGeneric title={`Import ${current.label.toLowerCase()}`} hint={`CSV or Excel with a “value” column${current.parent?' and a “parent” column':''}. Existing values are skipped.`} action="import" url="/api/lookups" extra={{list:current.id}} map={r=>({value:r.value||r.name||Object.values(r)[0],parent:r.parent||''})} onClose={()=>setImporting(false)} onDone={()=>{setImporting(false);done('Imported')}}/>}
 </div>;
}
