'use client';
import {useApi,dateTime} from './lib';
import {Header,Grid,ErrorNote,Skeleton,Empty,Chip,type Col} from './kit';
// Inventory (first version of the screen): stock items, reorder list and movements.
// Creating items, stock movements and imports are available through /api/inventory; their forms are still to come.
type Item={id:string,sku:string,name:string,category:string,unit:string,min_stock:number,on_hand:number,unit_cost:number,status:string};
export default function Inventory({parts}:{parts:string[]}){
 const view=parts[0]||'items';
 const items=useApi<{items:Item[]}>(view!=='moves'?'/api/inventory':null);
 const moves=useApi<{moves:Record<string,string|number>[]}>(view==='moves'?'/api/inventory?view=moves':null);
 if(view==='moves'){const rows=(moves.data?.moves||[]).map(m=>({...m,id:String(m.id)})) as (Record<string,string|number>&{id:string})[];return <div className="page"><Header icon="ArrowRightLeft" tone="amber" title="Stock movements"/><ErrorNote error={moves.error}/>{!moves.data?<Skeleton/>:<Grid id="inv-moves" rows={rows} exportName="stock-movements" cols={[{key:'createdAt',label:'When',render:m=>dateTime(String(m.createdAt))},{key:'sku',label:'SKU'},{key:'name',label:'Item'},{key:'type',label:'Type'},{key:'qty',label:'Qty',align:'right'},{key:'fromLocation',label:'From'},{key:'toLocation',label:'To'},{key:'reference',label:'Reference'}]} empty={<Empty icon="ArrowRightLeft" title="No movements yet"/>}/>}</div>}
 const rows=(items.data?.items||[]).filter(i=>view!=='reorder'||(i.min_stock>0&&i.on_hand<=i.min_stock));
 const cols:Col<Item>[]=[{key:'sku',label:'SKU',width:120},{key:'name',label:'Item'},{key:'category',label:'Category'},{key:'on_hand',label:'On hand',align:'right',render:i=><>{i.on_hand} {i.unit}</>},{key:'min_stock',label:'Minimum',align:'right'},{key:'status',label:'Stock',render:i=>i.min_stock>0&&i.on_hand<=i.min_stock?<Chip tone="amber">Reorder</Chip>:<Chip tone="green">OK</Chip>}];
 return <div className="page"><Header icon="Package" tone="amber" title={view==='reorder'?'Reorder list':'Stock items'}/><ErrorNote error={items.error}/>{!items.data?<Skeleton/>:<Grid id={'inv-'+view} rows={rows} cols={cols} exportName="inventory" empty={<Empty icon="Package" title="No stock items"/>}/>}</div>;
}
