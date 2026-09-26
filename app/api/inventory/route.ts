import {hasAction} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,num,oneOf,idOf,auditStatement} from '../../server/core';
import {moveStatements,reorderAlert,moveTypes} from '../../server/stock';
import type {Member} from '../../server/policy';

// Inventory items are workspace-wide; access is controlled by the Inventory permissions.
type Item={id:string,sku:string,name:string,category:string,unit:string,min_stock:number,reorder_qty:number,tracking:string,unit_cost:number,status:string,notes:string};
const need=(u:Member,action:string)=>{if(!hasAction(u,'inventory',action))throw new HttpError(403,action==='view'?'Inventory is not available to your account.':'This inventory action is not part of your role.')};
function itemFields(b:Record<string,unknown>){return {sku:str(b.sku,'SKU',60).toUpperCase(),name:str(b.name,'Item name',160),category:str(b.category,'Category',80,false),unit:str(b.unit||'ea','Unit',20),min_stock:b.minStock===''||b.minStock===undefined?0:num(b.minStock,'Minimum stock',0,1e9),reorder_qty:b.reorderQty===''||b.reorderQty===undefined?0:num(b.reorderQty,'Reorder quantity',0,1e9),tracking:oneOf(b.tracking||'none',['none','batch','serial'] as const,'tracking'),unit_cost:b.unitCost===''||b.unitCost===undefined?0:num(b.unitCost,'Unit cost',0,1e11),status:oneOf(b.status||'Active',['Active','Inactive'] as const,'status'),notes:str(b.notes,'Notes',2000,false)}}

export const GET=route(async(req,u)=>{
 need(u,'view');
 const url=new URL(req.url),id=url.searchParams.get('id');
 if(id){
  const item=await first<Item>('SELECT * FROM inventory_items WHERE id=? AND tenant_id=?',idOf(id,'Item'),u.tenantId);if(!item)throw new HttpError(404,'Item not found.');
  const [levels,moves]=await Promise.all([all('SELECT location,qty FROM stock_levels WHERE tenant_id=? AND item_id=? AND qty<>0 ORDER BY location',u.tenantId,item.id),all('SELECT id,type,qty,from_location AS fromLocation,to_location AS toLocation,batch,serial,reference,note,actor,created_at AS createdAt FROM stock_moves WHERE tenant_id=? AND item_id=? ORDER BY created_at DESC LIMIT 200',u.tenantId,item.id)]);
  return {item,levels,moves,canMove:hasAction(u,'inventory','update'),canEdit:hasAction(u,'inventory','update')};
 }
 if(url.searchParams.get('view')==='moves')return {moves:await all('SELECT m.id,m.type,m.qty,m.from_location AS fromLocation,m.to_location AS toLocation,m.batch,m.serial,m.reference,m.note,m.actor,m.created_at AS createdAt,i.sku,i.name,i.unit FROM stock_moves m JOIN inventory_items i ON i.id=m.item_id AND i.tenant_id=m.tenant_id WHERE m.tenant_id=? ORDER BY m.created_at DESC LIMIT 1000',u.tenantId)};
 const items=await all('SELECT i.*,coalesce((SELECT sum(qty) FROM stock_levels l WHERE l.tenant_id=i.tenant_id AND l.item_id=i.id),0) AS on_hand,(SELECT count(*) FROM stock_levels l WHERE l.tenant_id=i.tenant_id AND l.item_id=i.id AND l.qty<>0) AS locations FROM inventory_items i WHERE i.tenant_id=? ORDER BY i.name',u.tenantId);
 return {items,canCreate:hasAction(u,'inventory','create'),canMove:hasAction(u,'inventory','update'),canImport:hasAction(u,'inventory','import')};
},{module:'inventory'});

export const POST=route(async(req,u)=>{
 const b=await readBody(req,1000000);const action=String(b.action||'');
 if(action==='item'){
  const f=itemFields(b);
  if(b.id){need(u,'update');const id=idOf(b.id,'Item');const before=await first<Item>('SELECT * FROM inventory_items WHERE id=? AND tenant_id=?',id,u.tenantId);if(!before)throw new HttpError(404,'Item not found.');
   if(await first('SELECT id FROM inventory_items WHERE tenant_id=? AND sku=? AND id!=?',u.tenantId,f.sku,id))throw new HttpError(409,'Another item uses this SKU.');
   await batch([stmt('UPDATE inventory_items SET sku=?,name=?,category=?,unit=?,min_stock=?,reorder_qty=?,tracking=?,unit_cost=?,status=?,notes=?,updated_at=? WHERE id=? AND tenant_id=?',f.sku,f.name,f.category,f.unit,f.min_stock,f.reorder_qty,f.tracking,f.unit_cost,f.status,f.notes,now(),id,u.tenantId),auditStatement(u,'Inventory item updated',id,'',before,f)]);return {id}}
  need(u,'create');
  if(await first('SELECT id FROM inventory_items WHERE tenant_id=? AND sku=?',u.tenantId,f.sku))throw new HttpError(409,'This SKU already exists.');
  const id=uid();await batch([stmt('INSERT INTO inventory_items(id,tenant_id,sku,name,category,unit,min_stock,reorder_qty,tracking,unit_cost,status,notes,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,f.sku,f.name,f.category,f.unit,f.min_stock,f.reorder_qty,f.tracking,f.unit_cost,f.status,f.notes,u.id,now(),now()),auditStatement(u,'Inventory item created',id,'',null,f)]);
  const opening=b.openingQty?num(b.openingQty,'Opening quantity',0,1e9):0;
  if(opening>0){await batch([...await moveStatements(u,{itemId:id,type:'receipt',qty:opening,to:str(b.openingLocation,'Location',200),reference:'Opening balance',unitCost:f.unit_cost})])}
  return {id};
 }
 if(action==='move'){
  need(u,'update');
  const item=await first<Item>('SELECT * FROM inventory_items WHERE id=? AND tenant_id=?',idOf(b.itemId,'Item'),u.tenantId);if(!item)throw new HttpError(404,'Item not found.');
  const type=oneOf(b.type,moveTypes,'movement type');
  const qty=num(b.qty,'Quantity',type==='adjust'?-1e9:0.0001,1e9);
  const serial=str(b.serial,'Serial number',120,false),batchNo=str(b.batch,'Batch',60,false);
  if(item.tracking==='serial'&&!serial)throw new HttpError(400,'This item is serial-tracked: enter the serial number.');
  if(item.tracking==='serial'&&Math.abs(qty)!==1)throw new HttpError(400,'Serial-tracked items move one unit at a time.');
  if(item.tracking==='batch'&&!batchNo&&['receipt','return'].includes(type))throw new HttpError(400,'This item is batch-tracked: enter the batch number.');
  const s=await moveStatements(u,{itemId:item.id,type,qty,from:b.from?str(b.from,'From',200):null,to:b.to?str(b.to,'To',200):null,batch:batchNo,serial,reference:str(b.reference,'Reference',120,false),note:str(b.note,'Note',500,false),unitCost:b.unitCost?num(b.unitCost,'Unit cost',0,1e11):item.unit_cost});
  await batch([...s,auditStatement(u,`Stock ${type}: ${qty} ${item.unit}`,item.id,'',null,{from:b.from,to:b.to,reference:b.reference})]);
  if(['issue','transfer','adjust'].includes(type))await reorderAlert(u,item.id,req);
  return {ok:true};
 }
 if(action==='delete'){
  need(u,'delete');
  const id=idOf(b.id,'Item');const i=await first<Item>('SELECT * FROM inventory_items WHERE id=? AND tenant_id=?',id,u.tenantId);if(!i)throw new HttpError(404,'Item not found.');
  const onHand=await first<{q:number}>('SELECT coalesce(sum(qty),0) AS q FROM stock_levels WHERE tenant_id=? AND item_id=?',u.tenantId,id);
  if(onHand?.q)throw new HttpError(409,'Issue or adjust out the remaining stock first, or mark the item inactive.');
  await batch([stmt('DELETE FROM stock_levels WHERE tenant_id=? AND item_id=?',u.tenantId,id),stmt('DELETE FROM inventory_items WHERE id=? AND tenant_id=?',id,u.tenantId),auditStatement(u,'Inventory item deleted',id,'',i,null)]);
  return {ok:true};
 }
 if(action==='import'){
  need(u,'import');
  if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>2000)throw new HttpError(400,'Import between 1 and 2000 rows.');
  const existing=new Map((await all<{id:string,sku:string}>('SELECT id,sku FROM inventory_items WHERE tenant_id=?',u.tenantId)).map(i=>[i.sku,i.id]));
  const errors:{row:number,reason:string}[]=[];const ok:{f:ReturnType<typeof itemFields>,id?:string,qty:number,location:string}[]=[];const seen=new Set<string>();
  (b.rows as Record<string,unknown>[]).forEach((r,i)=>{try{const f=itemFields(r);if(seen.has(f.sku))throw new HttpError(400,'Duplicate SKU in file');seen.add(f.sku);const qty=r.qty===undefined||r.qty===''?0:num(r.qty,'Quantity',0,1e9);const location=String(r.location??'').trim();if(qty&&!location)throw new HttpError(400,'Quantity needs a location');ok.push({f,id:existing.get(f.sku),qty,location})}catch(e){errors.push({row:i+1,reason:e instanceof Error?e.message:'Invalid row'})}});
  if(b.preview)return {preview:true,create:ok.filter(o=>!o.id).length,update:ok.filter(o=>o.id).length,errors};
  const s:D1PreparedStatement[]=[];
  for(const o of ok){const id=o.id||uid();
   if(o.id)s.push(stmt('UPDATE inventory_items SET name=?,category=?,unit=?,min_stock=?,reorder_qty=?,tracking=?,unit_cost=?,updated_at=? WHERE id=? AND tenant_id=?',o.f.name,o.f.category,o.f.unit,o.f.min_stock,o.f.reorder_qty,o.f.tracking,o.f.unit_cost,now(),id,u.tenantId));
   else s.push(stmt('INSERT INTO inventory_items(id,tenant_id,sku,name,category,unit,min_stock,reorder_qty,tracking,unit_cost,status,notes,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,o.f.sku,o.f.name,o.f.category,o.f.unit,o.f.min_stock,o.f.reorder_qty,o.f.tracking,o.f.unit_cost,'Active','',u.id,now(),now()));
   if(o.qty)s.push(stmt('INSERT INTO stock_levels(tenant_id,item_id,location,qty) VALUES(?,?,?,?) ON CONFLICT(tenant_id,item_id,location) DO UPDATE SET qty=qty+excluded.qty',u.tenantId,id,o.location,o.qty),stmt('INSERT INTO stock_moves(id,tenant_id,item_id,type,qty,to_location,reference,unit_cost,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,id,'receipt',o.qty,o.location,'Import',o.f.unit_cost,u.id,now()));
  }
  s.push(auditStatement(u,'Inventory imported',u.tenantId,'',null,{rows:ok.length,errors:errors.length}));
  for(let i=0;i<s.length;i+=90)await batch(s.slice(i,i+90));
  return {created:ok.filter(o=>!o.id).length,updated:ok.filter(o=>o.id).length,errors};
 }
 throw new HttpError(400,'Unknown action.');
},{module:'inventory'});
