'use client';
import {useMemo,useState} from 'react';
import {api,useApi,go,money,dateOnly,ago,cx} from './lib';
import {useApp,Btn,Chip,Header,Grid,Inspector,Modal,Field,DeptSelect,LocationInput,PersonSelect,Who,Thread,Timeline,Tabs,ErrorNote,Skeleton,Empty,KV,Card,Stat,Menu,Note,Attachments,QRCode,Icon,type Col} from './kit';
import {BarList} from './home';
import {ImportGeneric} from './people';
import {assetStatuses,assetConditions,assetKinds,bookValue} from '../data';

type Asset={id:string,code:string,name:string,category:string,subcategory:string,kind:string,brand:string,model:string,serial:string,barcode:string,status:string,condition:string,location:string,department:string,cost_centre:string,assigned_to:string|null,due_back:string|null,purchase_date:string|null,purchase_cost:number,useful_life_months:number,salvage_value:number,warranty_until:string|null,vendor:string,notes:string,disposal_date:string|null,disposal_method:string,disposal_value:number,disposal_reason:string,created_at:string,updated_at:string,version:number};
const views=['mine','all','audits','dashboard'];
const gone=(a:Asset)=>['Retired','Disposed','Lost'].includes(a.status);

export default function Assets({parts}:{parts:string[]}){
 const {s,person,can}=useApp();
 const view=views.includes(parts[0])?parts[0]:parts[0]?'all':(can('assets')?'all':'mine');
 if(view==='audits')return <Audits openId={parts[1]}/>;
 const openId=views.includes(parts[0])?parts[1]:parts[0];
 const {data,error,reload}=useApi<{assets:Asset[],canImport:boolean,canCreate:boolean}>('/api/assets');
 const [importing,setImporting]=useState(false);
 const rows=useMemo(()=>(data?.assets||[]).filter(a=>view==='mine'?a.assigned_to===s.user.id:true),[data,view,s.user.id]);
 const cur=s.tenant.currency;
 const cols:Col<Asset>[]=[
  {key:'code',label:'Code',width:120,render:a=><span className="mono">{a.code}</span>},
  {key:'name',label:'Asset',render:a=><div className="cell-title"><b>{a.name}</b><small>{[a.brand,a.model].filter(Boolean).join(' ')||a.kind}</small></div>},
  {key:'category',label:'Category',width:130},{key:'subcategory',label:'Subcategory',hide:true},
  {key:'status',label:'Status',width:120,render:a=><Chip>{a.status}</Chip>},
  {key:'assigned',label:'Assigned to',width:170,render:a=><span>{a.assigned_to?<Who id={a.assigned_to}/>:<span className="muted">—</span>}{a.due_back&&<small className={Date.parse(a.due_back)<Date.now()?'text-red':'muted'}> due {dateOnly(a.due_back)}</small>}</span>,value:a=>person(a.assigned_to)?.name||''},
  {key:'location',label:'Location',width:190},
  {key:'department',label:'Department',width:130},{key:'cost_centre',label:'Cost centre',hide:true},
  {key:'serial',label:'Serial',width:130,hide:true},{key:'barcode',label:'Barcode',hide:true},
  {key:'purchase_cost',label:'Cost',width:110,align:'right',render:a=>a.purchase_cost?money(a.purchase_cost,cur,0):<span className="muted">—</span>,value:a=>a.purchase_cost},
  {key:'book',label:'Book value',width:110,align:'right',hide:true,render:a=>money(bookValue(a.purchase_cost,a.salvage_value,a.useful_life_months,a.purchase_date),cur,0),value:a=>bookValue(a.purchase_cost,a.salvage_value,a.useful_life_months,a.purchase_date)},
  {key:'warranty_until',label:'Warranty',width:110,render:a=>a.warranty_until?<span className={Date.parse(a.warranty_until)<Date.now()?'muted':''}>{dateOnly(a.warranty_until)}</span>:<span className="muted">—</span>,hide:true},
  {key:'condition',label:'Condition',hide:true},{key:'vendor',label:'Vendor',hide:true},
 ];
 const creating=parts[1]==='new';
 return <div className="page">
  <Header icon="Boxes" tone="teal" title={view==='mine'?'My assets':view==='dashboard'?'Asset overview':'Asset register'} subtitle={view==='mine'?'Equipment currently checked out to you. Report a problem from any asset.':'Know what you own, where it is, who has it and what it is worth.'} actions={<>{data?.canImport&&view==='all'&&<Btn icon="FileSpreadsheet" onClick={()=>setImporting(true)}>Import</Btn>}{data?.canCreate&&<Btn variant="primary" icon="Plus" onClick={()=>go(`assets/${view}/new`)}>Register asset</Btn>}</>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:view==='dashboard'?<AssetDashboard rows={data.assets}/>:
   <Grid id={'assets-'+view} rows={rows} cols={cols} onOpen={a=>go(`assets/${view}/${a.id}`)} activeId={openId} exportName="asset-register"
    empty={<Empty icon="Boxes" title={view==='mine'?'No assets assigned to you':'No assets registered yet'}>{view==='all'&&data.canCreate?'Register assets one by one, import a spreadsheet, or promote the imported register from Admin → Data hub.':undefined}</Empty>}/>}
  {openId&&openId!=='new'&&<AssetPanel id={openId} onClose={()=>go(`assets/${view}`)} onChanged={reload}/>}
  {creating&&<AssetForm onClose={()=>go(`assets/${view}`)} onSaved={id=>{reload();go(`assets/${view}/${id}`)}}/>}
  {importing&&<ImportGeneric title="Import assets" hint="Columns: Code, Name, Category, Subcategory, Brand, Model, Serial, Status, Condition, Location, Department, Purchase date, Purchase cost, Warranty until, Vendor. Rows with an existing code update that asset." action="import" url="/api/assets" map={r=>({code:pick(r,'code','assetcode','assettag'),name:pick(r,'name','assetname'),category:pick(r,'category','assetcategory'),subcategory:pick(r,'subcategory'),brand:pick(r,'brand','make'),model:pick(r,'model'),serial:pick(r,'serial','serialnumber','serialno'),status:pick(r,'status')||undefined,condition:pick(r,'condition')||undefined,location:pick(r,'location').replaceAll('>',' > ').replace(/\s+/g,' '),department:pick(r,'department'),purchaseDate:toIso(pick(r,'purchasedate')),purchaseCost:pick(r,'purchasecost','cost','purchaseprice'),warrantyUntil:toIso(pick(r,'warrantyuntil','warrantyexpiry')),vendor:pick(r,'vendor','supplier')})} onClose={()=>setImporting(false)} onDone={reload}/>}
 </div>;
}
const pick=(r:Record<string,string>,...names:string[])=>{for(const n of names){const k=Object.keys(r).find(x=>x.toLowerCase().replace(/[^a-z]/g,'')===n);if(k&&r[k])return r[k]}return ''};
const toIso=(v:string)=>{const m=v.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:v};

function AssetDashboard({rows}:{rows:Asset[]}){
 const {s}=useApp();const cur=s.tenant.currency;const count=(k:(a:Asset)=>string)=>rows.reduce<Record<string,number>>((m,a)=>{const x=k(a)||'Unspecified';m[x]=(m[x]||0)+1;return m},{});
 const live=rows.filter(a=>!gone(a));
 const soon=live.filter(a=>a.warranty_until&&Date.parse(a.warranty_until)>Date.now()&&Date.parse(a.warranty_until)<Date.now()+90*86400000).sort((a,b)=>String(a.warranty_until).localeCompare(String(b.warranty_until)));
 const overdue=live.filter(a=>a.due_back&&Date.parse(a.due_back)<Date.now());
 const value=live.reduce((t,a)=>t+(a.purchase_cost||0),0),book=live.reduce((t,a)=>t+bookValue(a.purchase_cost,a.salvage_value,a.useful_life_months,a.purchase_date),0);
 return <><div className="stats"><Stat label="Assets in service" value={live.length.toLocaleString()} icon="Boxes" tone="teal"/><Stat label="Checked out" value={live.filter(a=>a.assigned_to).length} icon="UserCheck" tone="green" sub={overdue.length?`${overdue.length} overdue for return`:'None overdue'}/><Stat label="In maintenance" value={live.filter(a=>a.status==='Maintenance').length} icon="Wrench" tone="amber"/><Stat label="Purchase value" value={money(value,cur,0)} icon="Banknote" tone="violet" sub={`Book value ${money(book,cur,0)}`}/></div>
 <div className="cards-3"><Card title="By status"><BarList data={count(a=>a.status)} order={[...assetStatuses]}/></Card><Card title="By category"><BarList data={count(a=>a.category)}/></Card><Card title="By location"><BarList data={count(a=>a.location.split('>').slice(0,2).join('>').trim())}/></Card></div>
 <div className="cards-3"><Card title="Warranties ending in 90 days" className="span2">{!soon.length?<p className="muted small">No warranties end in the next 90 days.</p>:<div className="mini-list">{soon.map(a=><a key={a.id} href={`#/assets/all/${a.id}`}><span className="mono">{a.code}</span><span>{a.name}<small>{a.location}</small></span><b>{dateOnly(a.warranty_until)}</b></a>)}</div>}</Card><Card title="Overdue returns">{!overdue.length?<p className="muted small">Nothing overdue.</p>:<div className="mini-list">{overdue.map(a=><a key={a.id} href={`#/assets/all/${a.id}`}><span className="mono">{a.code}</span><span>{a.name}<small>due {dateOnly(a.due_back)}</small></span><Who id={a.assigned_to}/></a>)}</div>}</Card></div></>;
}

function AssetPanel({id,onClose,onChanged}:{id:string,onClose:()=>void,onChanged:()=>void}){
 const {s,toast,ask,can}=useApp();const {data,error,reload}=useApi<any>('/api/assets?id='+encodeURIComponent(id));
 const [tab,setTab]=useState('history'),[dialog,setDialog]=useState<''|'edit'|'checkout'|'transfer'|'dispose'|'label'>('');const a:Asset|undefined=data?.asset;
 const done=()=>{setDialog('');reload();onChanged()};
 async function checkin(){const cond=await ask({title:`Check in ${a!.code}`,body:'Returns the asset to store and records its condition.',confirm:'Check in',input:{label:'Condition on return (New, Good, Fair, Poor, Damaged)',placeholder:a!.condition}});if(cond===false)return;try{await api('/api/assets',{action:'checkin',id,condition:assetConditions.includes(cond as never)?cond:undefined});toast('Checked in');done()}catch(e){toast((e as Error).message,'error')}}
 async function del(){if(await ask({title:`Delete ${a!.code}?`,body:'This permanently removes the asset and its comments. Disposal keeps its history.',confirm:'Delete',danger:true})===false)return;try{await api('/api/assets',{action:'delete',id});toast('Asset deleted');onChanged();onClose()}catch(e){toast((e as Error).message,'error')}}
 const book=a?bookValue(a.purchase_cost,a.salvage_value,a.useful_life_months,a.purchase_date):0;
 return <Inspector open onClose={onClose} width={640} eyebrow={a?.code} title={a?.name||'Loading…'} subtitle={a&&<><Chip>{a.status}</Chip><span className="muted small">{a.kind}{a.category?' · '+a.category:''}{a.subcategory?' / '+a.subcategory:''}</span></>} actions={a&&<Menu trigger={open=><Btn size="sm" variant="ghost" icon="Ellipsis" title="More" onClick={open}/>} items={[{label:'Edit details',icon:'Pencil',onClick:()=>setDialog('edit'),hidden:!data.canEdit},{label:'Print label (QR)',icon:'QrCode',onClick:()=>setDialog('label')},{label:'Transfer',icon:'ArrowRightLeft',onClick:()=>setDialog('transfer'),hidden:!data.canAssign||gone(a)},{label:'Dispose / retire',icon:'Archive',onClick:()=>setDialog('dispose'),hidden:!data.canDispose||gone(a)},{label:'Report a problem',icon:'LifeBuoy',onClick:()=>go('tickets/requested/new'),hidden:!can('maintenance','create')},'-',{label:'Delete asset',icon:'Trash2',danger:true,onClick:del,hidden:s.user.role!=='admin'}]}/>}>
  <ErrorNote error={error} onRetry={reload}/>
  {!a?<Skeleton/>:<>
   {gone(a)?<Note tone="warn">{a.status} on {dateOnly(a.disposal_date)}{a.disposal_method?` by ${a.disposal_method}`:''}{a.disposal_value?` for ${money(a.disposal_value,s.tenant.currency)}`:''}. {a.disposal_reason}</Note>:
   <div className="assign-card"><div><span className="eyebrow">Custody</span>{a.assigned_to?<><Who id={a.assigned_to} sub/>{a.due_back&&<small className={Date.parse(a.due_back)<Date.now()?'text-red':'muted'}>Due back {dateOnly(a.due_back)}</small>}</>:<span className="muted">In store · {a.location||'no location'}</span>}</div>{data.canAssign&&<div className="row-gap">{a.assigned_to&&<Btn size="sm" icon="Undo2" onClick={checkin}>Check in</Btn>}<Btn size="sm" variant="primary" icon="ArrowRightLeft" onClick={()=>setDialog('checkout')}>{a.assigned_to?'Reassign':'Check out'}</Btn></div>}</div>}
   <div className="asset-top"><KV items={[['Location',a.location],['Department',a.department],['Cost centre',a.cost_centre],['Brand / model',[a.brand,a.model].filter(Boolean).join(' ')],['Serial number',a.serial&&<span key="s" className="mono">{a.serial}</span>],['Condition',a.condition],['Purchased',a.purchase_date&&dateOnly(a.purchase_date)],['Cost',a.purchase_cost?money(a.purchase_cost,s.tenant.currency):''],['Book value',a.useful_life_months?`${money(book,s.tenant.currency)} (${a.useful_life_months} months, straight line)`:''],['Vendor',a.vendor],['Warranty until',a.warranty_until&&dateOnly(a.warranty_until)],['Last updated',ago(a.updated_at)]]}/><button className="qr-mini" title="Print label" onClick={()=>setDialog('label')}><QRCode value={a.barcode||a.code} size={92}/><small className="mono">{a.barcode||a.code}</small></button></div>
   {a.notes&&<div className="prose-box"><p>{a.notes}</p></div>}
   <Tabs value={tab} onChange={setTab} items={[{id:'history',label:'History'},{id:'maintenance',label:'Maintenance',count:data.workOrders.length+data.tickets.length},{id:'files',label:'Photos & files',count:data.files.length},{id:'comments',label:'Comments',count:data.comments.length}]}/>
   {tab==='history'&&<Timeline events={data.history}/>}
   {tab==='maintenance'&&(data.workOrders.length||data.tickets.length?<div className="mini-list">{data.workOrders.map((w:any)=><a key={w.id} href={`#/maintenance/orders/${w.id}`}><span className="mono">{w.number}</span><span>{w.title}<small>{w.completedAt?`Completed ${dateOnly(w.completedAt)}`:`Due ${dateOnly(w.dueAt)}`}{w.cost?` · ${money(w.cost,s.tenant.currency)}`:''}</small></span><Chip>{w.status}</Chip></a>)}{data.tickets.map((t:any)=><a key={t.id} href={`#/tickets/all/${t.id}`}><span className="mono">{t.number}</span><span>{t.title}</span><Chip>{t.status}</Chip></a>)}</div>:<p className="muted small">No work orders or tickets for this asset.</p>)}
   {tab==='files'&&<Attachments type="asset" id={id} files={data.files} onChange={reload} canUpload={data.canEdit}/>}
   {tab==='comments'&&<Thread comments={data.comments} onPost={async body=>{await api('/api/comments',{type:'asset',id,body});await reload()}}/>}
  </>}
  {dialog==='edit'&&a&&<AssetForm asset={a} onClose={()=>setDialog('')} onSaved={done}/>}
  {dialog==='checkout'&&a&&<CheckoutDialog asset={a} onClose={()=>setDialog('')} onDone={done}/>}
  {dialog==='transfer'&&a&&<TransferDialog asset={a} onClose={()=>setDialog('')} onDone={done}/>}
  {dialog==='dispose'&&a&&<DisposeDialog asset={a} onClose={()=>setDialog('')} onDone={done}/>}
  {dialog==='label'&&a&&<Modal open onClose={()=>setDialog('')} title="Asset label" footer={<><Btn variant="ghost" onClick={()=>setDialog('')}>Close</Btn><Btn variant="primary" icon="Printer" onClick={()=>window.print()}>Print</Btn></>}><div className="asset-label print-area"><QRCode value={a.barcode||a.code} size={150}/><div><b>{s.tenant.name}</b><span className="mono">{a.barcode||a.code}</span><small>{a.name}</small></div></div><p className="muted small">Scan the code with any phone camera to read the asset code, then search it with Ctrl + K.</p></Modal>}
 </Inspector>;
}

function CheckoutDialog({asset,onClose,onDone}:{asset:Asset,onClose:()=>void,onDone:()=>void}){
 const {toast,person}=useApp();const [to,setTo]=useState<string|null>(null),[location,setLocation]=useState(asset.location),[due,setDue]=useState(''),[note,setNote]=useState(''),[busy,setBusy]=useState(false);
 return <Modal open onClose={onClose} title={`Check out ${asset.code}`} subtitle={asset.name} footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!to} onClick={async()=>{setBusy(true);try{await api('/api/assets',{action:'checkout',id:asset.id,memberId:to,location,dueBack:due||undefined,note});toast(`Checked out to ${person(to)?.name}`);onDone()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}>Check out</Btn></>}>
  <div className="form-grid"><Field label="Person" wide><PersonSelect value={to} onChange={id=>{setTo(id);const p=person(id);if(p?.location)setLocation(p.location)}}/></Field><Field label="Location" wide><LocationInput value={location} onChange={setLocation}/></Field><Field label="Due back" hint="Leave empty for a permanent assignment."><input type="date" value={due} onChange={e=>setDue(e.target.value)}/></Field><Field label="Hand-over note" wide hint="Condition, accessories included, reason…"><textarea rows={3} value={note} onChange={e=>setNote(e.target.value)}/></Field></div>
 </Modal>;
}
function TransferDialog({asset,onClose,onDone}:{asset:Asset,onClose:()=>void,onDone:()=>void}){
 const {toast}=useApp();const [v,setV]=useState({department:asset.department,location:asset.location,costCentre:asset.cost_centre,memberId:asset.assigned_to as string|null,note:''});const [busy,setBusy]=useState(false);
 return <Modal open onClose={onClose} title={`Transfer ${asset.code}`} subtitle="Move the asset between departments, locations or people. The previous values are kept in its history." footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} onClick={async()=>{setBusy(true);try{await api('/api/assets',{action:'transfer',id:asset.id,...v});toast('Asset transferred');onDone()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}>Transfer</Btn></>}>
  <div className="form-grid"><Field label="Department"><DeptSelect value={v.department} onChange={x=>setV({...v,department:x})}/></Field><Field label="Cost centre"><input value={v.costCentre} onChange={e=>setV({...v,costCentre:e.target.value})}/></Field><Field label="Location" wide><LocationInput value={v.location} onChange={x=>setV({...v,location:x})}/></Field><Field label="Custodian" wide><PersonSelect value={v.memberId} onChange={x=>setV({...v,memberId:x})}/></Field><Field label="Reason" wide><input value={v.note} onChange={e=>setV({...v,note:e.target.value})}/></Field></div>
 </Modal>;
}
function DisposeDialog({asset,onClose,onDone}:{asset:Asset,onClose:()=>void,onDone:()=>void}){
 const {s,toast}=useApp();const [v,setV]=useState({status:'Disposed',disposalDate:new Date().toISOString().slice(0,10),disposalMethod:'Sold',disposalValue:'',disposalReason:''});const [busy,setBusy]=useState(false);
 return <Modal open onClose={onClose} title={`Dispose of ${asset.code}`} subtitle={`${asset.name} · book value ${money(bookValue(asset.purchase_cost,asset.salvage_value,asset.useful_life_months,asset.purchase_date),s.tenant.currency)}`} footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="danger" busy={busy} disabled={!v.disposalReason} onClick={async()=>{setBusy(true);try{await api('/api/assets',{action:'dispose',id:asset.id,...v});toast(`Asset ${v.status.toLowerCase()}`);onDone()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}>Confirm</Btn></>}>
  <div className="form-grid"><Field label="Outcome"><select value={v.status} onChange={e=>setV({...v,status:e.target.value})}><option>Disposed</option><option>Retired</option><option>Lost</option></select></Field><Field label="Date"><input type="date" value={v.disposalDate} onChange={e=>setV({...v,disposalDate:e.target.value})}/></Field>{v.status!=='Lost'&&<><Field label="Method"><select value={v.disposalMethod} onChange={e=>setV({...v,disposalMethod:e.target.value})}>{['Sold','Scrapped','Donated','Recycled','Returned to vendor','Written off'].map(x=><option key={x}>{x}</option>)}</select></Field><Field label={`Proceeds (${s.tenant.currency})`}><input type="number" min="0" step="0.01" value={v.disposalValue} onChange={e=>setV({...v,disposalValue:e.target.value})}/></Field></>}<Field label="Reason" wide><textarea rows={3} value={v.disposalReason} onChange={e=>setV({...v,disposalReason:e.target.value})}/></Field></div>
  <Note tone="warn">The asset leaves the active register, its custodian is cleared, and the record is kept for audit.</Note>
 </Modal>;
}

function AssetForm({asset,onClose,onSaved}:{asset?:Asset,onClose:()=>void,onSaved:(id:string)=>void}){
 const {s,toast}=useApp();const [busy,setBusy]=useState(false);
 const cats=String(s.tenant.settings.assetCategories||'Laptop, Desktop, Monitor, Printer, Phone, Network, Server, CCTV, Vehicle, Furniture, Machinery, Tools').split(',').map(x=>x.trim()).filter(Boolean);
 const [v,setV]=useState({code:asset?.code||'',name:asset?.name||'',category:asset?.category||'',subcategory:asset?.subcategory||'',kind:asset?.kind||'IT',brand:asset?.brand||'',model:asset?.model||'',serial:asset?.serial||'',barcode:asset?.barcode||'',status:asset?.status||'In store',condition:asset?.condition||'New',location:asset?.location||'',department:asset?.department||s.user.department,costCentre:asset?.cost_centre||'',purchaseDate:asset?.purchase_date||'',purchaseCost:asset?.purchase_cost?String(asset.purchase_cost):'',usefulLifeMonths:asset?.useful_life_months?String(asset.useful_life_months):'',salvageValue:asset?.salvage_value?String(asset.salvage_value):'',warrantyUntil:asset?.warranty_until||'',vendor:asset?.vendor||'',notes:asset?.notes||''});
 const f=(k:keyof typeof v)=>(e:{target:{value:string}})=>setV({...v,[k]:e.target.value});
 return <Modal open onClose={onClose} wide title={asset?`Edit ${asset.code}`:'Register an asset'} subtitle={asset?undefined:'Leave the code blank to number it automatically; the barcode defaults to the code.'}>
  <form className="form-grid" onSubmit={async e=>{e.preventDefault();setBusy(true);try{const d=await api<{id:string}>('/api/assets',{action:asset?'update':'create',id:asset?.id,version:asset?.version,...v});toast(asset?'Asset updated':'Asset registered');onSaved(d.id||asset!.id)}catch(err){toast((err as Error).message,'error')}finally{setBusy(false)}}}>
   <Field label="Asset name" wide><input required autoFocus value={v.name} onChange={f('name')} placeholder="e.g. Dell Latitude 5440"/></Field>
   {!asset&&<Field label="Asset code"><input value={v.code} onChange={f('code')} placeholder="Automatic"/></Field>}
   <Field label="Barcode / QR value"><input value={v.barcode} onChange={f('barcode')} placeholder="Same as code"/></Field>
   <Field label="Type"><select value={v.kind} onChange={f('kind')}>{assetKinds.map(x=><option key={x}>{x}</option>)}</select></Field>
   <Field label="Category"><input list="asset-cats" value={v.category} onChange={f('category')}/><datalist id="asset-cats">{cats.map(c=><option key={c} value={c}/>)}</datalist></Field>
   <Field label="Subcategory"><input value={v.subcategory} onChange={f('subcategory')}/></Field>
   <Field label="Brand"><input value={v.brand} onChange={f('brand')}/></Field>
   <Field label="Model"><input value={v.model} onChange={f('model')}/></Field>
   <Field label="Serial number"><input value={v.serial} onChange={f('serial')}/></Field>
   <Field label="Status"><select value={v.status} onChange={f('status')}>{assetStatuses.filter(x=>!['Retired','Disposed','Lost'].includes(x)||x===v.status).map(x=><option key={x}>{x}</option>)}</select></Field>
   <Field label="Condition"><select value={v.condition} onChange={f('condition')}>{assetConditions.map(x=><option key={x}>{x}</option>)}</select></Field>
   <Field label="Department"><DeptSelect value={v.department} onChange={x=>setV({...v,department:x})}/></Field>
   <Field label="Cost centre"><input value={v.costCentre} onChange={f('costCentre')}/></Field>
   <Field label="Location" wide><LocationInput value={v.location} onChange={x=>setV({...v,location:x})}/></Field>
   <Field label="Purchase date"><input type="date" value={v.purchaseDate} onChange={f('purchaseDate')}/></Field>
   <Field label={`Purchase cost (${s.tenant.currency})`}><input type="number" min="0" step="0.01" value={v.purchaseCost} onChange={f('purchaseCost')}/></Field>
   <Field label="Useful life (months)" hint="For straight-line depreciation."><input type="number" min="0" value={v.usefulLifeMonths} onChange={f('usefulLifeMonths')}/></Field>
   <Field label={`Salvage value (${s.tenant.currency})`}><input type="number" min="0" step="0.01" value={v.salvageValue} onChange={f('salvageValue')}/></Field>
   <Field label="Warranty until"><input type="date" value={v.warrantyUntil} onChange={f('warrantyUntil')}/></Field>
   <Field label="Vendor"><input value={v.vendor} onChange={f('vendor')}/></Field>
   <Field label="Notes" wide><textarea rows={3} value={v.notes} onChange={f('notes')}/></Field>
   <div className="form-actions"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit" variant="primary" busy={busy}>{asset?'Save changes':'Register asset'}</Btn></div>
  </form>
 </Modal>;
}

// ── Asset audits (stock verification) ───────────────────────────────────────
function Audits({openId}:{openId?:string}){
 const {toast,ask}=useApp();const {data,error,reload}=useApi<{audits:{id:string,name:string,location:string,status:string,created_at:string,checked:number,missing:number}[],canRun:boolean}>('/api/assets?view=audits');
 async function start(){const name=await ask({title:'Start an asset audit',body:'Walk a location and mark each asset found, missing, damaged or in the wrong place.',confirm:'Start',input:{label:'Audit name',placeholder:'e.g. HQ quarterly count',required:true}});if(name===false)return;try{const r=await api<{id:string}>('/api/assets',{action:'audit-create',name});reload();go(`assets/audits/${r.id}`)}catch(e){toast((e as Error).message,'error')}}
 if(openId)return <AuditRun id={openId}/>;
 return <div className="page"><Header icon="ClipboardCheck" tone="teal" title="Asset audits" subtitle="Stock verification: confirm what is physically present against the register." actions={data?.canRun&&<Btn variant="primary" icon="Plus" onClick={start}>Start audit</Btn>}/><ErrorNote error={error} onRetry={reload}/>
  {!data?<Skeleton/>:<Grid id="asset-audits" rows={data.audits} onOpen={a=>go(`assets/audits/${a.id}`)} exportName="asset-audits" cols={[{key:'name',label:'Audit'},{key:'location',label:'Location',render:a=>a.location||<span className="muted">All locations</span>},{key:'status',label:'Status',width:100,render:a=><Chip tone={a.status==='Open'?'amber':'gray'}>{a.status}</Chip>},{key:'checked',label:'Checked',width:90,align:'right'},{key:'missing',label:'Missing',width:90,align:'right',render:a=>a.missing?<span className="text-red">{a.missing}</span>:'0'},{key:'created_at',label:'Started',width:120,render:a=>dateOnly(a.created_at)}]} empty={<Empty icon="ClipboardCheck" title="No audits yet"/>}/>}
 </div>;
}
function AuditRun({id}:{id:string}){
 const {toast}=useApp();const {data,error,reload}=useApi<{audit:{id:string,name:string,location:string,status:string},assets:{id:string,code:string,name:string,location:string,assigned_to:string|null,status:string}[],items:{assetId:string,result:string,note:string}[]}>('/api/assets?view=audits&audit='+encodeURIComponent(id));
 const [q,setQ]=useState('');
 if(error)return <div className="page"><ErrorNote error={error} onRetry={reload}/></div>;
 if(!data)return <div className="page"><Skeleton/></div>;
 const result=(aid:string)=>data.items.find(i=>i.assetId===aid)?.result;
 const open=data.audit.status==='Open';
 async function mark(assetId:string,r:string){try{await api('/api/assets',{action:'audit-check',auditId:id,assetId,result:r});reload()}catch(e){toast((e as Error).message,'error')}}
 const list=data.assets.filter(a=>`${a.code} ${a.name}`.toLowerCase().includes(q.toLowerCase()));
 const done=data.items.length;
 return <div className="page"><div className="doc-top"><Btn variant="ghost" icon="ArrowLeft" onClick={()=>go('assets/audits')}>All audits</Btn></div>
  <Header icon="ClipboardCheck" tone="teal" title={data.audit.name} subtitle={`${done} of ${data.assets.length} assets checked · ${data.items.filter(i=>i.result==='Missing').length} missing`} actions={open&&<Btn variant="primary" icon="Check" onClick={async()=>{try{await api('/api/assets',{action:'audit-close',auditId:id});toast('Audit closed');reload()}catch(e){toast((e as Error).message,'error')}}}>Close audit</Btn>}/>
  <div className="filter-row"><div className="grid-search big"><Icon name="ScanLine" size={17}/><input autoFocus placeholder="Scan or type an asset code" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&open){const hit=data.assets.find(a=>a.code.toLowerCase()===q.trim().toLowerCase());if(hit){mark(hit.id,'Found');setQ('');toast(`${hit.code} found`)}}}}/></div></div>
  <div className="audit-list">{list.map(a=>{const r=result(a.id);return <div key={a.id} className={cx('audit-row',r&&`res-${r.toLowerCase().replace(' ','-')}`)}><span className="mono">{a.code}</span><span className="grow">{a.name}<small className="muted"> {a.location}</small></span>{r&&<Chip tone={r==='Found'?'green':r==='Missing'?'red':'amber'}>{r}</Chip>}{open&&<div className="row-gap">{['Found','Missing','Damaged','Wrong location'].map(x=><Btn key={x} size="sm" variant={r===x?'subtle':'ghost'} onClick={()=>mark(a.id,x)}>{x}</Btn>)}</div>}</div>})}{!list.length&&<Empty icon="Boxes" title="No matching assets"/>}</div>
 </div>;
}
