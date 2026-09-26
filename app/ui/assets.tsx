'use client';
import {useMemo,useState} from 'react';
import {api,useApi,go,money,dateOnly,ago} from './lib';
import {useApp,Btn,Chip,Header,Grid,Inspector,Modal,Field,DeptSelect,LocationInput,PersonSelect,Who,Thread,Timeline,Tabs,ErrorNote,Skeleton,Empty,KV,Card,Stat,Menu,type Col} from './kit';
import {BarList} from './home';
import {assetStatuses,assetConditions,assetKinds} from '../data';

type Asset={id:string,code:string,name:string,category:string,kind:string,brand:string,model:string,serial:string,status:string,condition:string,location:string,department:string,assigned_to:string|null,purchase_date:string|null,purchase_cost:number,warranty_until:string|null,vendor:string,notes:string,created_at:string,updated_at:string,version:number};
const views=['mine','all','dashboard'];

export default function Assets({parts}:{parts:string[]}){
 const {s,person,can}=useApp();
 const view=views.includes(parts[0])?parts[0]:parts[0]?'all':(can('assets')?'all':'mine');
 const openId=views.includes(parts[0])?parts[1]:parts[0];
 const {data,error,reload}=useApi<{assets:Asset[]}>('/api/assets');
 const rows=useMemo(()=>(data?.assets||[]).filter(a=>view==='mine'?a.assigned_to===s.user.id:true),[data,view,s.user.id]);
 const cur=s.tenant.currency;
 const cols:Col<Asset>[]=[
  {key:'code',label:'Code',width:120,render:a=><span className="mono">{a.code}</span>},
  {key:'name',label:'Asset',render:a=><div className="cell-title"><b>{a.name}</b><small>{[a.brand,a.model].filter(Boolean).join(' ')||a.kind}</small></div>},
  {key:'category',label:'Category',width:140},
  {key:'status',label:'Status',width:120,render:a=><Chip>{a.status}</Chip>},
  {key:'assigned',label:'Assigned to',width:180,render:a=><Who id={a.assigned_to} fallback="—"/>,value:a=>person(a.assigned_to)?.name||''},
  {key:'location',label:'Location',width:200},
  {key:'department',label:'Department',width:140},
  {key:'serial',label:'Serial',width:140,hide:true},
  {key:'purchase_cost',label:'Cost',width:120,align:'right',render:a=>a.purchase_cost?money(a.purchase_cost,cur,0):<span className="muted">—</span>,value:a=>a.purchase_cost},
  {key:'warranty_until',label:'Warranty',width:120,render:a=>a.warranty_until?<span className={Date.parse(a.warranty_until)<Date.now()?'muted':''}>{dateOnly(a.warranty_until)}</span>:<span className="muted">—</span>,hide:true},
  {key:'condition',label:'Condition',hide:true},{key:'vendor',label:'Vendor',hide:true},
 ];
 const creating=parts[1]==='new';
 return <div className="page">
  <Header icon="Boxes" tone="teal" title={view==='mine'?'My assets':view==='dashboard'?'Asset overview':'Asset register'} subtitle={view==='mine'?'Equipment currently assigned to you. Report a problem from any asset.':'Know what you own, where it is and who looks after it.'} actions={can('assets','create')&&<Btn variant="primary" icon="Plus" onClick={()=>go(`assets/${view}/new`)}>Register asset</Btn>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:view==='dashboard'?<AssetDashboard rows={data.assets}/>:
   <Grid id={'assets-'+view} rows={rows} cols={cols} onOpen={a=>go(`assets/${view}/${a.id}`)} activeId={openId} exportName="asset-register"
    empty={<Empty icon="Boxes" title={view==='mine'?'No assets assigned to you':'No assets registered yet'}>{view==='all'&&can('assets','create')?'Register assets one by one, or promote your imported asset register from Admin → Data hub.':undefined}</Empty>}/>}
  {openId&&openId!=='new'&&<AssetPanel id={openId} onClose={()=>go(`assets/${view}`)} onChanged={reload}/>}
  {creating&&<AssetForm onClose={()=>go(`assets/${view}`)} onSaved={id=>{reload();go(`assets/${view}/${id}`)}}/>}
 </div>;
}

function AssetDashboard({rows}:{rows:Asset[]}){
 const {s}=useApp();const cur=s.tenant.currency;const count=(k:(a:Asset)=>string)=>rows.reduce<Record<string,number>>((m,a)=>{const x=k(a)||'Unspecified';m[x]=(m[x]||0)+1;return m},{});
 const soon=rows.filter(a=>a.warranty_until&&Date.parse(a.warranty_until)>Date.now()&&Date.parse(a.warranty_until)<Date.now()+90*86400000).sort((a,b)=>String(a.warranty_until).localeCompare(String(b.warranty_until)));
 const value=rows.reduce((t,a)=>t+(a.purchase_cost||0),0);
 return <><div className="stats"><Stat label="Assets" value={rows.length.toLocaleString()} icon="Boxes" tone="teal"/><Stat label="In use" value={rows.filter(a=>a.status==='In use').length} icon="UserCheck" tone="green"/><Stat label="In maintenance" value={rows.filter(a=>a.status==='Maintenance').length} icon="Wrench" tone="amber"/><Stat label="Recorded value" value={money(value,cur,0)} icon="Banknote" tone="violet"/></div>
 <div className="cards-3"><Card title="By status"><BarList data={count(a=>a.status)} order={[...assetStatuses]}/></Card><Card title="By category"><BarList data={count(a=>a.category)}/></Card><Card title="By location"><BarList data={count(a=>a.location.split('>').slice(0,2).join('>').trim())}/></Card></div>
 <Card title="Warranties ending in 90 days">{!soon.length?<p className="muted small">No warranties end in the next 90 days.</p>:<div className="mini-list">{soon.map(a=><a key={a.id} href={`#/assets/all/${a.id}`}><span className="mono">{a.code}</span><span>{a.name}<small>{a.location}</small></span><b>{dateOnly(a.warranty_until)}</b></a>)}</div>}</Card></>;
}

function AssetPanel({id,onClose,onChanged}:{id:string,onClose:()=>void,onChanged:()=>void}){
 const {s,toast,ask,can}=useApp();const {data,error,reload}=useApi<any>('/api/assets?id='+encodeURIComponent(id));
 const [tab,setTab]=useState('history'),[edit,setEdit]=useState(false),[assign,setAssign]=useState(false);const a:Asset|undefined=data?.asset;
 async function del(){if(await ask({title:`Delete ${a!.code}?`,body:'This permanently removes the asset and its comments. Marking it Retired keeps its history.',confirm:'Delete',danger:true})===false)return;try{await api('/api/assets',{action:'delete',id});toast('Asset deleted');onChanged();onClose()}catch(e){toast((e as Error).message,'error')}}
 return <Inspector open onClose={onClose} width={600} eyebrow={a?.code} title={a?.name||'Loading…'} subtitle={a&&<><Chip>{a.status}</Chip><span className="muted small">{a.kind}{a.category?' · '+a.category:''}</span></>} actions={a&&<Menu trigger={open=><Btn size="sm" variant="ghost" icon="Ellipsis" title="More" onClick={open}/>} items={[{label:'Edit details',icon:'Pencil',onClick:()=>setEdit(true),hidden:!data.canEdit},{label:'Report a problem',icon:'LifeBuoy',onClick:()=>go('tickets/requested/new'),hidden:!can('maintenance','create')},'-',{label:'Delete asset',icon:'Trash2',danger:true,onClick:del,hidden:s.user.role!=='admin'}]}/>}>
  <ErrorNote error={error} onRetry={reload}/>
  {!a?<Skeleton/>:<>
   <div className="assign-card"><div><span className="eyebrow">Assigned to</span>{a.assigned_to?<Who id={a.assigned_to} sub/>:<span className="muted">Nobody · {a.status}</span>}</div>{data.canAssign&&<div className="row-gap">{a.assigned_to&&<Btn size="sm" icon="Undo2" onClick={async()=>{try{await api('/api/assets',{action:'assign',id,memberId:null});toast('Returned to store');reload();onChanged()}catch(e){toast((e as Error).message,'error')}}}>Return</Btn>}<Btn size="sm" variant="primary" icon="ArrowRightLeft" onClick={()=>setAssign(true)}>{a.assigned_to?'Reassign':'Assign'}</Btn></div>}</div>
   <KV items={[['Location',a.location],['Department',a.department],['Brand / model',[a.brand,a.model].filter(Boolean).join(' ')],['Serial number',a.serial&&<span key="s" className="mono">{a.serial}</span>],['Condition',a.condition],['Purchased',a.purchase_date&&dateOnly(a.purchase_date)],['Cost',a.purchase_cost?money(a.purchase_cost,s.tenant.currency):''],['Vendor',a.vendor],['Warranty until',a.warranty_until&&dateOnly(a.warranty_until)],['Last updated',ago(a.updated_at)]]}/>
   {a.notes&&<div className="prose-box"><p>{a.notes}</p></div>}
   <Tabs value={tab} onChange={setTab} items={[{id:'history',label:'History'},{id:'tickets',label:'Tickets',count:data.tickets.length},{id:'comments',label:'Comments',count:data.comments.length}]}/>
   {tab==='history'?<Timeline events={data.history}/>:tab==='tickets'?(data.tickets.length?<div className="mini-list">{data.tickets.map((t:any)=><a key={t.id} href={`#/tickets/all/${t.id}`}><span className="mono">{t.number}</span><span>{t.title}</span><Chip>{t.status}</Chip></a>)}</div>:<p className="muted small">No tickets linked to this asset.</p>):<Thread comments={data.comments} onPost={async body=>{await api('/api/comments',{type:'asset',id,body});await reload()}}/>}
  </>}
  {edit&&a&&<AssetForm asset={a} onClose={()=>setEdit(false)} onSaved={()=>{setEdit(false);reload();onChanged()}}/>}
  {assign&&a&&<AssignDialog asset={a} onClose={()=>setAssign(false)} onDone={()=>{setAssign(false);reload();onChanged()}}/>}
 </Inspector>;
}

function AssignDialog({asset,onClose,onDone}:{asset:Asset,onClose:()=>void,onDone:()=>void}){
 const {toast,person}=useApp();const [to,setTo]=useState<string|null>(null),[location,setLocation]=useState(asset.location),[note,setNote]=useState(''),[busy,setBusy]=useState(false);
 return <Modal open onClose={onClose} title={`Assign ${asset.code}`} subtitle={asset.name} footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!to} onClick={async()=>{setBusy(true);try{await api('/api/assets',{action:'assign',id:asset.id,memberId:to,location,note});toast(`Assigned to ${person(to)?.name}`);onDone()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}>Assign</Btn></>}>
  <div className="form-grid"><Field label="Person" wide><PersonSelect value={to} onChange={id=>{setTo(id);const p=person(id);if(p?.location)setLocation(p.location)}}/></Field><Field label="Location" wide><LocationInput value={location} onChange={setLocation}/></Field><Field label="Hand-over note" wide hint="Condition, accessories included, reason…"><textarea rows={3} value={note} onChange={e=>setNote(e.target.value)}/></Field></div>
 </Modal>;
}

function AssetForm({asset,onClose,onSaved}:{asset?:Asset,onClose:()=>void,onSaved:(id:string)=>void}){
 const {s,toast}=useApp();const [busy,setBusy]=useState(false);
 const cats=String(s.tenant.settings.assetCategories||'Laptop, Desktop, Monitor, Printer, Phone, Network, Server, CCTV, Vehicle, Furniture, Machinery, Tools').split(',').map(x=>x.trim()).filter(Boolean);
 const [v,setV]=useState({code:asset?.code||'',name:asset?.name||'',category:asset?.category||'',kind:asset?.kind||'IT',brand:asset?.brand||'',model:asset?.model||'',serial:asset?.serial||'',status:asset?.status||'In store',condition:asset?.condition||'New',location:asset?.location||'',department:asset?.department||s.user.department,purchaseDate:asset?.purchase_date||'',purchaseCost:asset?.purchase_cost?String(asset.purchase_cost):'',warrantyUntil:asset?.warranty_until||'',vendor:asset?.vendor||'',notes:asset?.notes||''});
 const f=(k:keyof typeof v)=>(e:{target:{value:string}})=>setV({...v,[k]:e.target.value});
 return <Modal open onClose={onClose} wide title={asset?`Edit ${asset.code}`:'Register an asset'} subtitle={asset?undefined:'Leave the code blank to number it automatically.'}>
  <form className="form-grid" onSubmit={async e=>{e.preventDefault();setBusy(true);try{const d=await api<{id:string}>('/api/assets',{action:asset?'update':'create',id:asset?.id,version:asset?.version,...v});toast(asset?'Asset updated':'Asset registered');onSaved(d.id||asset!.id)}catch(err){toast((err as Error).message,'error')}finally{setBusy(false)}}}>
   <Field label="Asset name" wide><input required autoFocus value={v.name} onChange={f('name')} placeholder="e.g. Dell Latitude 5440"/></Field>
   {!asset&&<Field label="Asset code"><input value={v.code} onChange={f('code')} placeholder="Automatic"/></Field>}
   <Field label="Type"><select value={v.kind} onChange={f('kind')}>{assetKinds.map(x=><option key={x}>{x}</option>)}</select></Field>
   <Field label="Category"><input list="asset-cats" value={v.category} onChange={f('category')}/><datalist id="asset-cats">{cats.map(c=><option key={c} value={c}/>)}</datalist></Field>
   <Field label="Brand"><input value={v.brand} onChange={f('brand')}/></Field>
   <Field label="Model"><input value={v.model} onChange={f('model')}/></Field>
   <Field label="Serial number"><input value={v.serial} onChange={f('serial')}/></Field>
   <Field label="Status"><select value={v.status} onChange={f('status')}>{assetStatuses.map(x=><option key={x}>{x}</option>)}</select></Field>
   <Field label="Condition"><select value={v.condition} onChange={f('condition')}>{assetConditions.map(x=><option key={x}>{x}</option>)}</select></Field>
   <Field label="Department"><DeptSelect value={v.department} onChange={x=>setV({...v,department:x})}/></Field>
   <Field label="Location" wide><LocationInput value={v.location} onChange={x=>setV({...v,location:x})}/></Field>
   <Field label="Purchase date"><input type="date" value={v.purchaseDate} onChange={f('purchaseDate')}/></Field>
   <Field label={`Purchase cost (${s.tenant.currency})`}><input type="number" min="0" step="0.01" value={v.purchaseCost} onChange={f('purchaseCost')}/></Field>
   <Field label="Warranty until"><input type="date" value={v.warrantyUntil} onChange={f('warrantyUntil')}/></Field>
   <Field label="Vendor"><input value={v.vendor} onChange={f('vendor')}/></Field>
   <Field label="Notes" wide><textarea rows={3} value={v.notes} onChange={f('notes')}/></Field>
   <div className="form-actions"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit" variant="primary" busy={busy}>{asset?'Save changes':'Register asset'}</Btn></div>
  </form>
 </Modal>;
}
