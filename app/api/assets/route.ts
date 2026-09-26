import {canActOn,hasAction} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,num,oneOf,idOf,date,auditStatement} from '../../server/core';
import type {Member} from '../../server/policy';
import {canSeeAsset,newAssetCode,type AssetRow} from '../../server/entities';
import {notify} from '../../server/notify';
import {assetStatuses,assetConditions,assetKinds} from '../../data';

async function load(u:Member,id:string){const a=await first<AssetRow>('SELECT * FROM assets WHERE id=? AND tenant_id=?',id,u.tenantId);if(!a||!canSeeAsset(u,a))throw new HttpError(404,'Asset not found.');return a}
const money=(v:unknown,label:string)=>v===''||v===undefined||v===null?0:num(v,label,0,1e11);
// Only these fields are ever written from a request (no mass assignment).
function fields(b:Record<string,unknown>){return {name:str(b.name,'Asset name',160),category:str(b.category,'Category',80,false),subcategory:str(b.subcategory,'Subcategory',80,false),kind:oneOf(b.kind||'Physical',assetKinds,'asset type'),brand:str(b.brand,'Brand',80,false),model:str(b.model,'Model',80,false),serial:str(b.serial,'Serial number',120,false),barcode:str(b.barcode,'Barcode',120,false),status:oneOf(b.status||'In store',assetStatuses,'status'),condition:oneOf(b.condition||'Good',assetConditions,'condition'),location:str(b.location,'Location',200,false),department:str(b.department,'Department',160,false),cost_centre:str(b.costCentre,'Cost centre',40,false),purchase_date:date(b.purchaseDate,'Purchase date'),purchase_cost:money(b.purchaseCost,'Purchase cost'),useful_life_months:b.usefulLifeMonths?Math.round(num(b.usefulLifeMonths,'Useful life',0,1200)):0,salvage_value:money(b.salvageValue,'Salvage value'),warranty_until:date(b.warrantyUntil,'Warranty end'),vendor:str(b.vendor,'Vendor',160,false),notes:str(b.notes,'Notes',4000,false)}}
type Fields=ReturnType<typeof fields>;
const insertAsset=(u:Member,id:string,code:string,f:Fields,department:string,sourceId?:string|null)=>stmt('INSERT INTO assets(id,tenant_id,code,name,category,subcategory,kind,brand,model,serial,barcode,status,condition,location,department,cost_centre,purchase_date,purchase_cost,useful_life_months,salvage_value,warranty_until,vendor,notes,source_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,code,f.name,f.category,f.subcategory,f.kind,f.brand,f.model,f.serial,f.barcode||code,f.status,f.condition,f.location,department,f.cost_centre,f.purchase_date,f.purchase_cost,f.useful_life_months,f.salvage_value,f.warranty_until,f.vendor,f.notes,sourceId||null,u.id,now(),now());

export const GET=route(async(req,u)=>{
 const url=new URL(req.url),id=url.searchParams.get('id'),view=url.searchParams.get('view');
 if(view==='audits'){
  if(!hasAction(u,'assets'))throw new HttpError(403,'Assets are not available to your account.');
  const auditId=url.searchParams.get('audit');
  if(auditId){
   const audit=await first('SELECT * FROM asset_audits WHERE id=? AND tenant_id=?',idOf(auditId,'Audit'),u.tenantId);if(!audit)throw new HttpError(404,'Audit not found.');
   const loc=String((audit as {location:string}).location||'');
   const assets=(await all<AssetRow>("SELECT * FROM assets WHERE tenant_id=? AND status NOT IN ('Retired','Disposed') AND (?='' OR location=? OR location LIKE ?) ORDER BY code",u.tenantId,loc,loc,loc+' > %')).filter(a=>canSeeAsset(u,a));
   const items=await all('SELECT asset_id AS assetId,result,note,checked_by AS checkedBy,checked_at AS checkedAt FROM asset_audit_items WHERE audit_id=? AND tenant_id=?',(audit as {id:string}).id,u.tenantId);
   return {audit,assets:assets.map(a=>({id:a.id,code:a.code,name:a.name,location:a.location,assigned_to:a.assigned_to,status:a.status})),items};
  }
  return {audits:await all("SELECT a.*,(SELECT count(*) FROM asset_audit_items i WHERE i.audit_id=a.id) AS checked,(SELECT count(*) FROM asset_audit_items i WHERE i.audit_id=a.id AND i.result='Missing') AS missing FROM asset_audits a WHERE a.tenant_id=? ORDER BY a.created_at DESC LIMIT 100",u.tenantId),canRun:hasAction(u,'assets','update')};
 }
 if(id){
  const a=await load(u,idOf(id,'Asset'));
  const [history,tickets,comments,files,workOrders]=await Promise.all([
   all("SELECT a.id,a.action,a.actor,a.after_json AS after,a.created_at AS createdAt FROM audit a WHERE a.tenant_id=? AND a.record_id=? ORDER BY a.created_at DESC LIMIT 100",u.tenantId,a.id),
   all("SELECT id,number,title,status,priority,created_at AS createdAt FROM tickets WHERE tenant_id=? AND asset_id=? ORDER BY created_at DESC LIMIT 30",u.tenantId,a.id),
   all("SELECT id,author_id AS authorId,body,created_at AS createdAt FROM comments WHERE tenant_id=? AND entity_type='asset' AND entity_id=? ORDER BY created_at",u.tenantId,a.id),
   all("SELECT id,name,mime,bytes,uploaded_by AS uploadedBy,created_at AS createdAt FROM files WHERE tenant_id=? AND entity_type='asset' AND entity_id=? ORDER BY created_at DESC",u.tenantId,a.id),
   all("SELECT id,number,title,status,due_at AS dueAt,completed_at AS completedAt,parts_cost+labor_cost AS cost FROM work_orders WHERE tenant_id=? AND asset_id=? ORDER BY created_at DESC LIMIT 50",u.tenantId,a.id),
  ]);
  return {asset:a,history,tickets,comments,files,workOrders,canEdit:canActOn(u,'assets','update',a.department,a.created_by),canAssign:canActOn(u,'assets','assign',a.department,a.created_by),canDispose:canActOn(u,'assets','delete',a.department,a.created_by)};
 }
 const rows=await all<AssetRow>('SELECT * FROM assets WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 10000',u.tenantId);
 return {assets:rows.filter(a=>canSeeAsset(u,a)),canImport:hasAction(u,'assets','import'),canCreate:hasAction(u,'assets','create')};
},{module:'assets'});

export const POST=route(async(req,u)=>{
 const b=await readBody(req,2000000);const action=String(b.action||'');
 if(action==='create'){
  const f=fields(b);const department=f.department||u.department;
  if(!canActOn(u,'assets','create',department,u.id))throw new HttpError(403,'You cannot register assets for this department.');
  const code=str(b.code,'Asset code',60,false)||await newAssetCode(u);
  if(await first('SELECT id FROM assets WHERE tenant_id=? AND code=?',u.tenantId,code))throw new HttpError(409,'This asset code is already in use.');
  const id=uid();
  await batch([insertAsset(u,id,code,f,department),auditStatement(u,'Asset registered',id,department,null,{code,name:f.name})]);
  return {id,code};
 }
 if(action==='import')return importAssets(u,b);
 if(action==='audit-create'){
  if(!hasAction(u,'assets','update'))throw new HttpError(403,'Running asset audits is not part of your role.');
  const id=uid();await batch([stmt('INSERT INTO asset_audits(id,tenant_id,name,location,status,created_by,created_at) VALUES(?,?,?,?,?,?,?)',id,u.tenantId,str(b.name,'Audit name',120),str(b.location,'Location',200,false),'Open',u.id,now()),auditStatement(u,'Asset audit started',id,'',null,{name:b.name,location:b.location})]);return {id};
 }
 if(action==='audit-check'||action==='audit-close'){
  if(!hasAction(u,'assets','update'))throw new HttpError(403,'Running asset audits is not part of your role.');
  const audit=await first<{id:string,status:string,name:string}>('SELECT id,status,name FROM asset_audits WHERE id=? AND tenant_id=?',idOf(b.auditId,'Audit'),u.tenantId);if(!audit)throw new HttpError(404,'Audit not found.');
  if(audit.status!=='Open')throw new HttpError(409,'This audit is closed.');
  if(action==='audit-close'){await batch([stmt("UPDATE asset_audits SET status='Closed',closed_at=? WHERE id=? AND tenant_id=?",now(),audit.id,u.tenantId),auditStatement(u,'Asset audit closed',audit.id,'',null,{name:audit.name})]);return {ok:true}}
  const a=await load(u,idOf(b.assetId,'Asset'));const result=oneOf(b.result,['Found','Missing','Damaged','Wrong location'] as const,'result');
  await batch([stmt('INSERT INTO asset_audit_items(audit_id,tenant_id,asset_id,result,note,checked_by,checked_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(audit_id,asset_id) DO UPDATE SET result=excluded.result,note=excluded.note,checked_by=excluded.checked_by,checked_at=excluded.checked_at',audit.id,u.tenantId,a.id,result,str(b.note,'Note',300,false),u.id,now()),auditStatement(u,`Audit check: ${result}`,a.id,a.department,null,{audit:audit.name})]);
  return {ok:true};
 }
 const a=await load(u,idOf(b.id,'Asset'));
 switch(action){
  case 'update':{
   if(!canActOn(u,'assets','update',a.department,a.created_by))throw new HttpError(403,'You cannot edit this asset.');
   const f=fields(b);if(b.version!==a.version)throw new HttpError(409,'This asset changed. Refresh and review the latest version.');
   const res=await batch([stmt('UPDATE assets SET name=?,category=?,subcategory=?,kind=?,brand=?,model=?,serial=?,barcode=?,status=?,condition=?,location=?,department=?,cost_centre=?,purchase_date=?,purchase_cost=?,useful_life_months=?,salvage_value=?,warranty_until=?,vendor=?,notes=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=? AND version=?',f.name,f.category,f.subcategory,f.kind,f.brand,f.model,f.serial,f.barcode||a.code,f.status,f.condition,f.location,f.department||a.department,f.cost_centre,f.purchase_date,f.purchase_cost,f.useful_life_months,f.salvage_value,f.warranty_until,f.vendor,f.notes,now(),a.id,u.tenantId,a.version),auditStatement(u,'Asset updated',a.id,a.department,a,f)]);
   if(!res[0].meta.changes)throw new HttpError(409,'Someone else updated this asset. Refresh before trying again.');
   return {ok:true};
  }
  // Check-out to a person (optionally until a due-back date) and check-in back to store.
  case 'assign':case 'checkout':case 'checkin':{
   if(!canActOn(u,'assets','assign',a.department,a.created_by))throw new HttpError(403,'Assigning assets is not part of your role.');
   if(['Retired','Disposed','Lost'].includes(a.status))throw new HttpError(409,`This asset is ${a.status.toLowerCase()}.`);
   const to=action==='checkin'?null:b.memberId?idOf(b.memberId,'Person'):null;
   if(action==='checkout'&&!to)throw new HttpError(400,'Choose who is taking the asset.');
   const person=to?await first<{id:string,name:string,location:string}>('SELECT id,name,location FROM members WHERE id=? AND tenant_id=? AND active=1',to,u.tenantId):null;
   if(to&&!person)throw new HttpError(400,'Choose an active person in this workspace.');
   const location=b.location===undefined?(person?.location||a.location):str(b.location,'Location',200,false);
   const note=str(b.note,'Note',500,false),dueBack=to?date(b.dueBack,'Due back'):null;
   const condition=b.condition?oneOf(b.condition,assetConditions,'condition'):a.condition;
   await batch([stmt('UPDATE assets SET assigned_to=?,status=?,location=?,due_back=?,condition=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=?',to,to?'In use':'In store',location,dueBack,condition,now(),a.id,u.tenantId),auditStatement(u,to?`Checked out to ${person!.name}`:'Checked in to store',a.id,a.department,{assignedTo:a.assigned_to,location:a.location,condition:a.condition},{assignedTo:to,location,dueBack,condition,note})]);
   if(to)await notify(u,[to],{kind:'asset',title:`${a.code} · ${a.name} is assigned to you`,body:[note,dueBack?`Due back ${dueBack}`:'',`Location: ${location||'not set'}`].filter(Boolean).join('\n'),link:`#/assets/${a.id}`},req);
   return {ok:true};
  }
  case 'transfer':{
   if(!canActOn(u,'assets','assign',a.department,a.created_by))throw new HttpError(403,'Transferring assets is not part of your role.');
   const department=str(b.department,'Department',160,false)||a.department,location=str(b.location,'Location',200,false)||a.location,costCentre=b.costCentre===undefined?(a as unknown as {cost_centre:string}).cost_centre:str(b.costCentre,'Cost centre',40,false);
   const to=b.memberId===undefined?a.assigned_to:b.memberId?idOf(b.memberId,'Person'):null;
   if(to&&!await first('SELECT id FROM members WHERE id=? AND tenant_id=? AND active=1',to,u.tenantId))throw new HttpError(400,'Choose an active person in this workspace.');
   await batch([stmt('UPDATE assets SET department=?,location=?,cost_centre=?,assigned_to=?,status=CASE WHEN ? IS NULL THEN status ELSE \'In use\' END,updated_at=?,version=version+1 WHERE id=? AND tenant_id=?',department,location,costCentre,to,to,now(),a.id,u.tenantId),auditStatement(u,'Asset transferred',a.id,department,{department:a.department,location:a.location,assignedTo:a.assigned_to},{department,location,costCentre,assignedTo:to,note:str(b.note,'Note',500,false)})]);
   return {ok:true};
  }
  // Retirement / disposal. Requires the Delete permission and records method, value and reason.
  case 'dispose':{
   if(!canActOn(u,'assets','delete',a.department,a.created_by))throw new HttpError(403,'Disposing of assets needs the Delete permission on assets.');
   const status=oneOf(b.status||'Disposed',['Retired','Disposed','Lost'] as const,'status');
   const v={disposal_date:date(b.disposalDate,'Disposal date',true),disposal_method:str(b.disposalMethod,'Method',80,status!=='Lost'),disposal_value:money(b.disposalValue,'Disposal value'),disposal_reason:str(b.disposalReason,'Reason',500)};
   await batch([stmt('UPDATE assets SET status=?,assigned_to=NULL,disposal_date=?,disposal_method=?,disposal_value=?,disposal_reason=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=?',status,v.disposal_date,v.disposal_method,v.disposal_value,v.disposal_reason,now(),a.id,u.tenantId),auditStatement(u,`Asset ${status.toLowerCase()}`,a.id,a.department,{status:a.status},{status,...v})]);
   return {ok:true};
  }
  case 'delete':{
   if(u.role!=='admin'||!hasAction(u,'assets','delete'))throw new HttpError(403,'Only administrators delete assets. Dispose of it instead to keep its history.');
   await batch([stmt('DELETE FROM assets WHERE id=? AND tenant_id=?',a.id,u.tenantId),stmt("DELETE FROM comments WHERE tenant_id=? AND entity_type='asset' AND entity_id=?",u.tenantId,a.id),auditStatement(u,'Asset deleted',a.id,a.department,a,null)]);
   return {ok:true};
  }
 }
 throw new HttpError(400,'Unknown action.');
},{module:'assets'});

// CSV import with a validation preview. Rows are matched to existing assets by code.
async function importAssets(u:Member,b:Record<string,unknown>){
 if(!hasAction(u,'assets','import'))throw new HttpError(403,'Importing assets is not part of your role.');
 if(!Array.isArray(b.rows)||!b.rows.length||b.rows.length>2000)throw new HttpError(400,'Import between 1 and 2000 rows.');
 const existing=new Map((await all<{id:string,code:string}>('SELECT id,code FROM assets WHERE tenant_id=?',u.tenantId)).map(a=>[a.code.toLowerCase(),a.id]));
 const errors:{row:number,reason:string}[]=[];const ok:{f:Fields,code:string,id?:string}[]=[];const seen=new Set<string>();
 (b.rows as Record<string,unknown>[]).forEach((r,i)=>{try{
  const f=fields({...r,status:r.status||'In store',condition:r.condition||'Good',kind:r.kind||'Physical'});const code=String(r.code??'').trim();
  if(code&&seen.has(code.toLowerCase()))throw new HttpError(400,'Duplicate code in file');if(code)seen.add(code.toLowerCase());
  if(!canActOn(u,'assets','create',f.department||u.department,u.id))throw new HttpError(403,'No permission for this department');
  ok.push({f,code,id:code?existing.get(code.toLowerCase()):undefined});
 }catch(e){errors.push({row:i+1,reason:e instanceof Error?e.message:'Invalid row'})}});
 if(b.preview)return {preview:true,create:ok.filter(o=>!o.id).length,update:ok.filter(o=>o.id).length,errors};
 const s:D1PreparedStatement[]=[];
 for(const o of ok){
  if(o.id)s.push(stmt('UPDATE assets SET name=?,category=?,subcategory=?,brand=?,model=?,serial=?,status=?,condition=?,location=?,department=?,purchase_date=?,purchase_cost=?,warranty_until=?,vendor=?,updated_at=?,version=version+1 WHERE id=? AND tenant_id=?',o.f.name,o.f.category,o.f.subcategory,o.f.brand,o.f.model,o.f.serial,o.f.status,o.f.condition,o.f.location,o.f.department||u.department,o.f.purchase_date,o.f.purchase_cost,o.f.warranty_until,o.f.vendor,now(),o.id,u.tenantId));
  else{const code=o.code||await newAssetCode(u);s.push(insertAsset(u,uid(),code,o.f,o.f.department||u.department))}
 }
 s.push(auditStatement(u,'Assets imported',u.tenantId,u.department,null,{rows:ok.length,errors:errors.length}));
 for(let i=0;i<s.length;i+=90)await batch(s.slice(i,i+90));
 return {created:ok.filter(o=>!o.id).length,updated:ok.filter(o=>o.id).length,errors};
}
