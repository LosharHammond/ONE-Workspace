'use client';
import {useState} from 'react';
import {api,useApi,go,money,dateTime} from './lib';
import {useApp,Btn,Chip,Header,Grid,Inspector,Modal,Field,LocationInput,ErrorNote,Skeleton,Empty,KV,Stat,Note,Who,type Col,LookupSelect} from './kit';
import {ImportGeneric} from './people';

type Item={id:string,sku:string,name:string,category:string,unit:string,min_stock:number,reorder_qty:number,tracking:string,unit_cost:number,status:string,notes:string,on_hand:number,locations:number};
type Move={id:string,type:string,qty:number,fromLocation:string|null,toLocation:string|null,batch:string,serial:string,reference:string,note:string,actor:string,createdAt:string,sku?:string,name?:string,unit?:string};
const low=(i:Item)=>i.min_stock>0&&i.on_hand<=i.min_stock;
const typeLabel:Record<string,string>={receipt:'Receipt',issue:'Issue',transfer:'Transfer',adjust:'Adjustment',return:'Return'};

export default function Inventory({parts}:{parts:string[]}){
 const view=['items','reorder','moves'].includes(parts[0])?parts[0]:'items';
 if(view==='moves')return <Moves/>;
 return <Items view={view} openId={parts[1]}/>;
}
function Items({view,openId}:{view:string,openId?:string}){
 const {s}=useApp();const {data,error,reload}=useApi<{items:Item[],canCreate:boolean,canMove:boolean,canImport:boolean}>('/api/inventory');const [importing,setImporting]=useState(false);
 const all=data?.items||[];const rows=view==='reorder'?all.filter(low):all;const cur=s.tenant.currency;
 const cols:Col<Item>[]=[
  {key:'sku',label:'SKU',width:120,render:i=><span className="mono">{i.sku}</span>},
  {key:'name',label:'Item',render:i=><div className="cell-title"><b>{i.name}</b><small>{i.category}{i.tracking!=='none'?` · ${i.tracking} tracked`:''}</small></div>},
  {key:'on_hand',label:'On hand',width:120,align:'right',render:i=><b className={low(i)?'text-red':''}>{i.on_hand.toLocaleString()} {i.unit}</b>,value:i=>i.on_hand},
  {key:'min_stock',label:'Minimum',width:100,align:'right'},
  {key:'reorder_qty',label:'Reorder qty',width:110,align:'right',hide:view!=='reorder'},
  {key:'locations',label:'Stores',width:80,align:'right'},
  {key:'value',label:'Value',width:120,align:'right',render:i=>money(i.on_hand*i.unit_cost,cur,0),value:i=>i.on_hand*i.unit_cost},
  {key:'stock',label:'Stock',width:100,render:i=>i.status!=='Active'?<Chip tone="gray">Inactive</Chip>:low(i)?<Chip tone="amber">Reorder</Chip>:i.on_hand<=0?<Chip tone="red">Out</Chip>:<Chip tone="green">OK</Chip>,value:i=>low(i)?'Reorder':'OK'},
  {key:'category',label:'Category',hide:true},{key:'unit_cost',label:'Unit cost',hide:true,align:'right'},
 ];
 const value=all.reduce((t,i)=>t+i.on_hand*i.unit_cost,0);
 return <div className="page">
  <Header icon="Package" tone="amber" title={view==='reorder'?'Reorder list':'Stock items'} subtitle={view==='reorder'?'Items at or below their minimum stock. Raise a requisition to replenish them.':'Stock levels across stores and warehouses, with every movement recorded.'} actions={<>{data?.canImport&&<Btn icon="FileSpreadsheet" onClick={()=>setImporting(true)}>Import</Btn>}{data?.canCreate&&<Btn variant="primary" icon="Plus" onClick={()=>go(`inventory/${view}/new`)}>New item</Btn>}</>}/>
  <ErrorNote error={error} onRetry={reload}/>
  {data&&view==='items'&&<div className="stats compact"><Stat label="Items" value={all.length}/><Stat label="Stock value" value={money(value,cur,0)}/><Stat label="Needing reorder" value={all.filter(low).length}/></div>}
  {!data?<Skeleton/>:<Grid id={'inv-'+view} rows={rows} cols={cols} activeId={openId} onOpen={i=>go(`inventory/${view}/${i.id}`)} exportName={view==='reorder'?'reorder-list':'inventory'} empty={<Empty icon="Package" title={view==='reorder'?'Nothing needs reordering':'No stock items yet'}>{view==='items'&&data.canCreate?'Add items one by one or import a spreadsheet.':undefined}</Empty>}/>}
  {openId==='new'&&<ItemForm onClose={()=>go(`inventory/${view}`)} onSaved={id=>{reload();go(`inventory/${view}/${id}`)}}/>}
  {openId&&openId!=='new'&&<ItemPanel id={openId} onClose={()=>go(`inventory/${view}`)} onChanged={reload}/>}
  {importing&&<ImportGeneric title="Import stock items" hint="Columns: SKU, Name, Category, Unit, Minimum stock, Reorder qty, Unit cost, Tracking (none/batch/serial), Qty, Location. Existing SKUs are updated; Qty adds opening stock at Location." action="import" url="/api/inventory" map={r=>({sku:p(r,'sku','itemcode','code'),name:p(r,'name','item','itemname'),category:p(r,'category'),unit:p(r,'unit','uom')||'ea',minStock:p(r,'minimumstock','minstock','minimum'),reorderQty:p(r,'reorderqty','reorderquantity'),unitCost:p(r,'unitcost','cost'),tracking:p(r,'tracking').toLowerCase()||'none',qty:p(r,'qty','quantity','availablestock'),location:p(r,'location','store')})} onClose={()=>setImporting(false)} onDone={reload}/>}
 </div>;
}
const p=(r:Record<string,string>,...names:string[])=>{for(const n of names){const k=Object.keys(r).find(x=>x.toLowerCase().replace(/[^a-z]/g,'')===n);if(k&&r[k])return r[k]}return ''};

function ItemPanel({id,onClose,onChanged}:{id:string,onClose:()=>void,onChanged:()=>void}){
 const {s,toast,ask}=useApp();const {data,error,reload}=useApi<{item:Item,levels:{location:string,qty:number}[],moves:Move[],canMove:boolean,canEdit:boolean}>('/api/inventory?id='+encodeURIComponent(id));
 const [move,setMove]=useState<string>(''),[edit,setEdit]=useState(false);const i=data?.item;
 const total=(data?.levels||[]).reduce((t,l)=>t+l.qty,0);
 return <Inspector open onClose={onClose} width={620} eyebrow={i?.sku} title={i?.name||'Loading…'} subtitle={i&&<><Chip tone={i.min_stock>0&&total<=i.min_stock?'amber':'green'}>{total.toLocaleString()} {i.unit} on hand</Chip><span className="muted small">{i.category}</span></>} actions={data?.canEdit&&<><Btn size="sm" variant="ghost" icon="Pencil" title="Edit item" onClick={()=>setEdit(true)}/><Btn size="sm" variant="ghost" icon="Trash2" title="Delete item" onClick={async()=>{if(await ask({title:`Delete ${i!.sku}?`,body:'Only items with no stock can be deleted.',confirm:'Delete',danger:true})===false)return;try{await api('/api/inventory',{action:'delete',id});toast('Item deleted');onChanged();onClose()}catch(e){toast((e as Error).message,'error')}}}/></>}>
  <ErrorNote error={error} onRetry={reload}/>
  {!i?<Skeleton/>:<>
   {data.canMove&&<div className="action-strip">{['receipt','issue','transfer','adjust','return'].map(t=><Btn key={t} size="sm" icon={t==='receipt'?'PackagePlus':t==='issue'?'PackageMinus':t==='transfer'?'ArrowRightLeft':t==='adjust'?'SlidersHorizontal':'Undo2'} onClick={()=>setMove(t)}>{typeLabel[t]}</Btn>)}</div>}
   <KV items={[['Unit',i.unit],['Minimum stock',String(i.min_stock)],['Reorder quantity',String(i.reorder_qty)],['Unit cost',money(i.unit_cost,s.tenant.currency)],['Stock value',money(total*i.unit_cost,s.tenant.currency)],['Tracking',i.tracking==='none'?'Quantity only':`${i.tracking} numbers`],['Status',i.status],['Notes',i.notes]]}/>
   <h4 className="section-title">Stock by location</h4>
   {!data.levels.length?<p className="muted small">No stock held.</p>:<div className="mini-list">{data.levels.map(l=><div key={l.location} className="mini-row"><span>{l.location}</span><b>{l.qty.toLocaleString()} {i.unit}</b></div>)}</div>}
   <h4 className="section-title">Movements</h4>
   <MoveList moves={data.moves} unit={i.unit}/>
  </>}
  {move&&i&&<MoveDialog item={i} type={move} levels={data!.levels} onClose={()=>setMove('')} onDone={()=>{setMove('');reload();onChanged()}}/>}
  {edit&&i&&<ItemForm item={i} onClose={()=>setEdit(false)} onSaved={()=>{setEdit(false);reload();onChanged()}}/>}
 </Inspector>;
}
function MoveList({moves,unit}:{moves:Move[],unit:string}){if(!moves.length)return <p className="muted small">No movements yet.</p>;return <div className="mini-list">{moves.map(m=><div key={m.id} className="mini-row"><Chip tone={m.type==='issue'?'orange':m.type==='receipt'||m.type==='return'?'green':'blue'}>{typeLabel[m.type]}</Chip><span>{m.qty>0&&m.type!=='issue'?'+':m.type==='issue'?'−':''}{Math.abs(m.qty)} {unit}<small>{[m.fromLocation&&`from ${m.fromLocation}`,m.toLocation&&`to ${m.toLocation}`,m.reference,m.batch&&`batch ${m.batch}`,m.serial&&`S/N ${m.serial}`].filter(Boolean).join(' · ')}</small></span><small className="muted">{dateTime(m.createdAt)}</small><Who id={m.actor} fallback="System"/></div>)}</div>}

function MoveDialog({item,type,levels,onClose,onDone}:{item:Item,type:string,levels:{location:string,qty:number}[],onClose:()=>void,onDone:()=>void}){
 const {toast}=useApp();const [v,setV]=useState({qty:type==='adjust'?'':'1',from:levels[0]?.location||'',to:'',batch:'',serial:'',reference:'',note:'',unitCost:''});const [busy,setBusy]=useState(false);
 const needFrom=['issue','transfer'].includes(type),needTo=['receipt','return','transfer','adjust'].includes(type);
 return <Modal open onClose={onClose} title={`${typeLabel[type]} · ${item.sku}`} subtitle={item.name} footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" busy={busy} disabled={!v.qty} onClick={async()=>{setBusy(true);try{await api('/api/inventory',{action:'move',itemId:item.id,type,...v,from:needFrom?v.from:undefined,to:needTo?v.to:undefined});toast(`${typeLabel[type]} recorded`);onDone()}catch(e){toast((e as Error).message,'error')}finally{setBusy(false)}}}>Record {typeLabel[type].toLowerCase()}</Btn></>}>
  <div className="form-grid">
   <Field label={type==='adjust'?`Change in quantity (${item.unit})`:`Quantity (${item.unit})`} hint={type==='adjust'?'Use a negative number to write stock off, e.g. -3.':undefined}><input autoFocus type="number" step="any" value={v.qty} onChange={e=>setV({...v,qty:e.target.value})}/></Field>
   {needFrom&&<Field label="From store"><select value={v.from} onChange={e=>setV({...v,from:e.target.value})}>{levels.map(l=><option key={l.location} value={l.location}>{l.location} ({l.qty} {item.unit})</option>)}</select></Field>}
   {needTo&&<Field label={type==='adjust'?'Store':type==='transfer'?'To store':'Into store'} wide={!needFrom}><LocationInput value={v.to} onChange={x=>setV({...v,to:x})} placeholder="Head Office > Main Store"/></Field>}
   {item.tracking==='batch'&&<Field label="Batch number"><input value={v.batch} onChange={e=>setV({...v,batch:e.target.value})}/></Field>}
   {item.tracking==='serial'&&<Field label="Serial number"><input value={v.serial} onChange={e=>setV({...v,serial:e.target.value})}/></Field>}
   {type==='receipt'&&<Field label="Unit cost"><input type="number" min="0" step="0.01" value={v.unitCost} placeholder={String(item.unit_cost)} onChange={e=>setV({...v,unitCost:e.target.value})}/></Field>}
   <Field label="Reference"><input value={v.reference} onChange={e=>setV({...v,reference:e.target.value})} placeholder="PO, work order, ticket…"/></Field>
   <Field label="Note" wide><input value={v.note} onChange={e=>setV({...v,note:e.target.value})}/></Field>
  </div>
  {item.tracking==='serial'&&<Note>Serial-tracked items move one unit at a time.</Note>}
 </Modal>;
}
function ItemForm({item,onClose,onSaved}:{item?:Item,onClose:()=>void,onSaved:(id:string)=>void}){
 const {s,toast}=useApp();const [busy,setBusy]=useState(false);
 const [v,setV]=useState({sku:item?.sku||'',name:item?.name||'',category:item?.category||'',unit:item?.unit||'ea',minStock:String(item?.min_stock??''),reorderQty:String(item?.reorder_qty??''),unitCost:String(item?.unit_cost??''),tracking:item?.tracking||'none',status:item?.status||'Active',notes:item?.notes||'',openingQty:'',openingLocation:''});
 const f=(k:keyof typeof v)=>(e:{target:{value:string}})=>setV({...v,[k]:e.target.value});
 return <Modal open wide onClose={onClose} title={item?`Edit ${item.sku}`:'New stock item'}><form className="form-grid" onSubmit={async e=>{e.preventDefault();setBusy(true);try{const r=await api<{id:string}>('/api/inventory',{action:'item',id:item?.id,...v});toast(item?'Item updated':'Item created');onSaved(r.id)}catch(err){toast((err as Error).message,'error')}finally{setBusy(false)}}}>
  <Field label="SKU"><input required autoFocus value={v.sku} onChange={f('sku')}/></Field><Field label="Name"><input required value={v.name} onChange={f('name')}/></Field>
  <Field label="Category"><LookupSelect list="inventory-categories" label="Inventory categories" value={v.category} onChange={x=>setV({...v,category:x})}/></Field><Field label="Unit"><LookupSelect list="units" label="Units of measure" value={v.unit} onChange={x=>setV({...v,unit:x})}/></Field>
  <Field label="Minimum stock" hint="Reorder alert at or below this."><input type="number" min="0" step="any" value={v.minStock} onChange={f('minStock')}/></Field><Field label="Reorder quantity"><input type="number" min="0" step="any" value={v.reorderQty} onChange={f('reorderQty')}/></Field>
  <Field label={`Unit cost (${s.tenant.currency})`}><input type="number" min="0" step="0.01" value={v.unitCost} onChange={f('unitCost')}/></Field><Field label="Tracking"><select value={v.tracking} onChange={f('tracking')}><option value="none">Quantity only</option><option value="batch">Batch numbers</option><option value="serial">Serial numbers</option></select></Field>
  {item&&<Field label="Status"><select value={v.status} onChange={f('status')}><option>Active</option><option>Inactive</option></select></Field>}
  {!item&&<><Field label="Opening quantity"><input type="number" min="0" step="any" value={v.openingQty} onChange={f('openingQty')}/></Field><Field label="Opening store"><LocationInput value={v.openingLocation} onChange={x=>setV({...v,openingLocation:x})}/></Field></>}
  <Field label="Notes" wide><textarea rows={2} value={v.notes} onChange={f('notes')}/></Field>
  <div className="form-actions"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn type="submit" variant="primary" busy={busy}>{item?'Save':'Create item'}</Btn></div>
 </form></Modal>;
}
function Moves(){
 const {data,error,reload}=useApi<{moves:Move[]}>('/api/inventory?view=moves');
 const cols:Col<Move>[]=[{key:'createdAt',label:'When',width:150,render:m=>dateTime(m.createdAt)},{key:'type',label:'Type',width:110,render:m=><Chip tone={m.type==='issue'?'orange':m.type==='receipt'||m.type==='return'?'green':'blue'}>{typeLabel[m.type]}</Chip>,value:m=>m.type},{key:'sku',label:'SKU',width:110},{key:'name',label:'Item'},{key:'qty',label:'Qty',width:90,align:'right'},{key:'fromLocation',label:'From'},{key:'toLocation',label:'To'},{key:'reference',label:'Reference'},{key:'batch',label:'Batch',hide:true},{key:'serial',label:'Serial',hide:true},{key:'actor',label:'By',width:150,render:m=><Who id={m.actor} fallback="System"/>}];
 return <div className="page"><Header icon="ArrowRightLeft" tone="amber" title="Stock movements" subtitle="The inventory audit trail: every receipt, issue, transfer, adjustment and return."/><ErrorNote error={error} onRetry={reload}/>{!data?<Skeleton/>:<Grid id="inv-moves" rows={data.moves} cols={cols} exportName="stock-movements" dense empty={<Empty icon="ArrowRightLeft" title="No movements yet"/>}/>}</div>;
}
