import {canActOn,hasAction} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,num,oneOf,idOf,date,auditStatement,nextNumber,tenantOf,tenantSettings} from '../../server/core';
import type {Member} from '../../server/policy';
import {canSeeAsset,type AssetRow} from '../../server/entities';
import {notify} from '../../server/notify';
import {assetStatuses,assetConditions,assetKinds} from '../../data';

async function load(u:Member,id:string){const a=await first<AssetRow>('SELECT * FROM assets WHERE id=? AND tenant_id=?',id,u.tenantId);if(!a||!canSeeAsset(u,a))throw new HttpError(404,'Asset not found.');return a}
function fields(b:Record<string,unknown>){return {name:str(b.name,'Asset name',160),category:str(b.category,'Category',80,false),kind:oneOf(b.kind||'Physical',assetKinds,'asset type'),brand:str(b.brand,'Brand',80,false),model:str(b.model,'Model',80,false),serial:str(b.serial,'Serial number',120,false),status:oneOf(b.status||'In store',assetStatuses,'status'),condition:oneOf(b.condition||'Good',assetConditions,'condition'),location:str(b.location,'Location',200,false),department:str(b.department,'Department',160,false),purchase_date:date(b.purchaseDate,'Purchase date'),purchase_cost:b.purchaseCost===''||b.purchaseCost===undefined?0:num(b.purchaseCost,'Purchase cost',0,1e11),warranty_until:date(b.warrantyUntil,'Warranty end'),vendor:str(b.vendor,'Vendor',160,false),notes:str(b.notes,'Notes',4000,false)}}

export const GET=route(async(req,u)=>{
 const id=new URL(req.url).searchParams.get('id');
 if(id){
  const a=await load(u,idOf(id,'Asset'));
  const [history,tickets,comments]=await Promise.all([
   all("SELECT a.id,a.action,a.actor,a.after_json AS after,a.created_at AS createdAt FROM audit a WHERE a.tenant_id=? AND a.record_id=? ORDER BY a.created_at DESC LIMIT 60",u.tenantId,a.id),
   all("SELECT id,number,title,status,priority,created_at AS createdAt FROM tickets WHERE tenant_id=? AND asset_id=? ORDER BY created_at DESC LIMIT 30",u.tenantId,a.id),
   all("SELECT id,author_id AS authorId,body,created_at AS createdAt FROM comments WHERE tenant_id=? AND entity_type='asset' AND entity_id=? ORDER BY created_at",u.tenantId,a.id),
  ]);
  return {asset:a,history,tickets,comments,canEdit:canActOn(u,'assets','update',a.department,a.created_by),canAssign:canActOn(u,'assets','assign',a.department,a.created_by)};
 }
 const rows=await all<AssetRow>('SELECT * FROM assets WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 5000',u.tenantId);
 return {assets:rows.filter(a=>canSeeAsset(u,a))};
});

export const POST=route(async(req,u)=>{
 const b=await readBody(req);const action=String(b.action||'');
 if(action==='create'){
  const f=fields(b);const department=f.department||u.department;
  if(!canActOn(u,'assets','create',department,u.id))throw new HttpError(403,'You cannot register assets for this department.');
  const t=await tenantOf(u);const prefix=String(tenantSettings(t).assetPrefix||'AST');
  const code=str(b.code,'Asset code',60,false)||await nextNumber(u.tenantId,prefix,false);
  if(await first('SELECT id FROM assets WHERE tenant_id=? AND code=?',u.tenantId,code))throw new HttpError(409,'This asset code is already in use.');
  const id=uid(),ts=now();
  await batch([stmt('INSERT INTO assets(id,tenant_id,code,name,category,kind,brand,model,serial,status,condition,location,department,purchase_date,purchase_cost,warranty_until,vendor,notes,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,code,f.name,f.category,f.kind,f.brand,f.model,f.serial,f.status,f.condition,f.location,department,f.purchase_date,f.purchase_cost,f.warranty_until,f.vendor,f.notes,u.id,ts,ts),auditStatement(u,'Asset registered',id,department,null,{code,name:f.name})]);
  return {id,code};
 }
 const a=await load(u,idOf(b.id,'Asset'));
 if(action==='update'){
  if(!canActOn(u,'assets','update',a.department,a.created_by))throw new HttpError(403,'You cannot edit this asset.');
  const f=fields(b);if(b.version!==a.version)throw new HttpError(409,'This asset changed. Refresh and review the latest version.');
  const res=await batch([stmt('UPDATE assets SET name=?,category=?,kind=?,brand=?,model=?,serial=?,status=?,condition=?,location=?,department=?,purchase_date=?,purchase_cost=?,warranty_until=?,vendor=?,notes=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=? AND version=?',f.name,f.category,f.kind,f.brand,f.model,f.serial,f.status,f.condition,f.location,f.department||a.department,f.purchase_date,f.purchase_cost,f.warranty_until,f.vendor,f.notes,now(),a.id,u.tenantId,a.version),auditStatement(u,'Asset updated',a.id,a.department,a,f)]);
  if(!res[0].meta.changes)throw new HttpError(409,'Someone else updated this asset. Refresh before trying again.');
  return {ok:true};
 }
 if(action==='assign'){
  if(!canActOn(u,'assets','assign',a.department,a.created_by))throw new HttpError(403,'Assigning assets is not part of your role.');
  const to=b.memberId?idOf(b.memberId,'Person'):null;
  const person=to?await first<{id:string,name:string,department:string,location:string}>('SELECT id,name,department,location FROM members WHERE id=? AND tenant_id=? AND active=1',to,u.tenantId):null;
  if(to&&!person)throw new HttpError(400,'Choose an active person in this workspace.');
  const location=b.location===undefined?(person?.location||a.location):str(b.location,'Location',200,false);
  const note=str(b.note,'Note',500,false);
  await batch([stmt('UPDATE assets SET assigned_to=?,status=?,location=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=?',to,to?'In use':'In store',location,now(),a.id,u.tenantId),auditStatement(u,to?`Assigned to ${person!.name}`:'Returned to store',a.id,a.department,{assignedTo:a.assigned_to,location:a.location},{assignedTo:to,location,note})]);
  if(to)await notify(u,[to],{kind:'asset',title:`${a.code} · ${a.name} is assigned to you`,body:note||`Location: ${location||'not set'}`,link:`#/assets/${a.id}`},req);
  return {ok:true};
 }
 if(action==='delete'){
  if(!hasAction(u,'assets','update')||u.role!=='admin')throw new HttpError(403,'Only administrators delete assets. Mark it Retired instead.');
  await batch([stmt('DELETE FROM assets WHERE id=? AND tenant_id=?',a.id,u.tenantId),stmt("DELETE FROM comments WHERE tenant_id=? AND entity_type='asset' AND entity_id=?",u.tenantId,a.id),auditStatement(u,'Asset deleted',a.id,a.department,a,null)]);
  return {ok:true};
 }
 throw new HttpError(400,'Unknown action.');
});
