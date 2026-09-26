import {first,all,stmt,uid,now,HttpError} from './core';
import {notify} from './notify';
import type {Member} from './policy';

export const moveTypes=['receipt','issue','transfer','adjust','return'] as const;
export type MoveType=typeof moveTypes[number];
export type Move={itemId:string,type:MoveType,qty:number,from?:string|null,to?:string|null,batch?:string,serial?:string,reference?:string,note?:string,unitCost?:number};

// Builds the statements for one stock movement after checking there is enough stock to take out.
// Receipt/return add to `to`; issue takes from `from`; transfer moves from→to; adjust adds a signed
// quantity at `to` (counts, write-offs).
export async function moveStatements(u:Member,m:Move){
 if(!Number.isFinite(m.qty)||m.qty===0)throw new HttpError(400,'Enter a quantity.');
 if(m.type!=='adjust'&&m.qty<0)throw new HttpError(400,'Quantities must be positive.');
 const need=(loc:string|null|undefined,label:string)=>{if(!loc)throw new HttpError(400,`Choose the ${label} location.`);return loc};
 const s:D1PreparedStatement[]=[];
 const add=(loc:string,q:number)=>s.push(stmt('INSERT INTO stock_levels(tenant_id,item_id,location,qty) VALUES(?,?,?,?) ON CONFLICT(tenant_id,item_id,location) DO UPDATE SET qty=qty+excluded.qty',u.tenantId,m.itemId,loc,q));
 const take=async(loc:string,q:number)=>{const lvl=await first<{qty:number}>('SELECT qty FROM stock_levels WHERE tenant_id=? AND item_id=? AND location=?',u.tenantId,m.itemId,loc);if((lvl?.qty||0)<q-1e-9)throw new HttpError(409,`Only ${lvl?.qty||0} available at ${loc}.`);s.push(stmt('UPDATE stock_levels SET qty=qty-? WHERE tenant_id=? AND item_id=? AND location=?',q,u.tenantId,m.itemId,loc))};
 let from:string|null=null,to:string|null=null;
 if(m.type==='receipt'||m.type==='return'){to=need(m.to,'receiving');add(to,m.qty)}
 else if(m.type==='issue'){from=need(m.from,'issuing');await take(from,m.qty)}
 else if(m.type==='transfer'){from=need(m.from,'source');to=need(m.to,'destination');if(from===to)throw new HttpError(400,'Choose two different locations.');await take(from,m.qty);add(to,m.qty)}
 else{to=need(m.to,'adjusted');if(m.qty<0)await take(to,-m.qty);else add(to,m.qty)}
 s.push(stmt('INSERT INTO stock_moves(id,tenant_id,item_id,type,qty,from_location,to_location,batch,serial,reference,note,unit_cost,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,m.itemId,m.type,m.qty,from,to,m.batch||'',m.serial||'',m.reference||'',m.note||'',m.unitCost||0,u.id,now()));
 return s;
}
// Tells stock managers when an item falls to or below its minimum.
export async function reorderAlert(u:Member,itemId:string,req?:Request){
 const i=await first<{sku:string,name:string,min_stock:number,reorder_qty:number,unit:string,total:number}>('SELECT i.sku,i.name,i.min_stock,i.reorder_qty,i.unit,coalesce((SELECT sum(qty) FROM stock_levels l WHERE l.tenant_id=i.tenant_id AND l.item_id=i.id),0) AS total FROM inventory_items i WHERE i.id=? AND i.tenant_id=?',itemId,u.tenantId);
 if(!i||i.min_stock<=0||i.total>i.min_stock)return;
 const managers=await all<{id:string}>("SELECT m.id FROM members m LEFT JOIN roles r ON r.id=m.role_id AND r.tenant_id=m.tenant_id WHERE m.tenant_id=? AND m.active=1 AND (m.role='admin' OR r.template IN ('storekeeper','purchasing'))",u.tenantId);
 await notify(u,managers.map(m=>m.id),{kind:'inventory',title:`Reorder ${i.sku} · ${i.name}`,body:`${i.total} ${i.unit} left (minimum ${i.min_stock}). Suggested order: ${i.reorder_qty||i.min_stock} ${i.unit}.`,link:`#/inventory/items/${itemId}`},req);
}
