import {hasAction} from '../../access-policy';
import {workKindById,workKinds} from '../../work-records';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,oneOf,idOf,date,auditStatement,parseJson,nextNumber,tenantOf} from '../../server/core';
import {canSeeWork,canEditWork,loadWork,type WorkRow} from '../../server/work';
import {findNode} from '../../server/graph';
import type {Member} from '../../server/policy';

// Goals, objectives, initiatives, customers, contracts, services, meetings and decisions. Each save is audited,
// which (through the audit outbox) projects the record and its relationships into the Work Graph.
const summary=(r:WorkRow)=>({id:r.id,kind:r.kind,number:r.number,title:r.title,status:r.status,ownerId:r.owner_id,department:r.department,parentId:r.parent_id,startDate:r.start_date,endDate:r.end_date,amount:r.amount,currency:r.currency,progress:r.progress,visibility:r.visibility,updatedAt:r.updated_at});
export const GET=route(async(req,u)=>{
 if(!hasAction(u,'business'))throw new HttpError(403,'Goals & customers are not available to you.');
 const q=new URL(req.url).searchParams;const id=q.get('id');
 if(id){
  const r=await loadWork(u,idOf(id,'Record'));
  const [parent,children,history]=await Promise.all([
   r.parent_id?first<WorkRow>('SELECT * FROM work_records WHERE id=? AND tenant_id=?',r.parent_id,u.tenantId):null,
   all<WorkRow>('SELECT * FROM work_records WHERE tenant_id=? AND parent_id=? AND deleted_at IS NULL ORDER BY created_at',u.tenantId,r.id),
   all('SELECT a.action,a.created_at AS createdAt,m.name AS who FROM audit a LEFT JOIN members m ON m.id=a.actor AND m.tenant_id=a.tenant_id WHERE a.tenant_id=? AND a.record_id=? ORDER BY a.created_at DESC LIMIT 60',u.tenantId,r.id),
  ]);
  return {record:{...summary(r),description:r.description,location:r.location,data:parseJson(r.data_json,{})},parent:parent&&canSeeWork(u,parent)?summary(parent):null,children:children.filter(c=>canSeeWork(u,c)).map(summary),history,canEdit:canEditWork(u,r)};
 }
 const kind=q.get('kind');const k=kind?workKindById.get(kind):null;if(kind&&!k)throw new HttpError(400,'Unknown record type.');
 const rows=await all<WorkRow>(`SELECT * FROM work_records WHERE tenant_id=? AND deleted_at IS NULL${k?' AND kind=?':''} ORDER BY updated_at DESC LIMIT 2000`,u.tenantId,...(k?[k.id]:[]));
 const text=(q.get('q')||'').toLowerCase();
 const visible=rows.filter(r=>canSeeWork(u,r)&&(!q.get('status')||r.status===q.get('status'))&&(!q.get('parent')||r.parent_id===q.get('parent'))&&(!text||`${r.number} ${r.title} ${r.description}`.toLowerCase().includes(text))&&(q.get('mine')!=='1'||r.owner_id===u.id));
 const counts=Object.fromEntries(workKinds.map(x=>[x.id,rows.filter(r=>r.kind===x.id&&canSeeWork(u,r)).length]));
 return {records:visible.map(summary),counts,canCreate:hasAction(u,'business','create')};
},{module:'business'});

async function cleanData(u:Member,kindId:string,input:unknown){
 const k=workKindById.get(kindId)!;const src=(input&&typeof input==='object'?input:{}) as Record<string,unknown>;const out:Record<string,unknown>={};
 for(const f of k.fields){const v=src[f.key];if(v===undefined||v===null||v==='')continue;
  switch(f.type){
   case 'text':case 'email':case 'url':out[f.key]=str(v,f.label,f.type==='url'?500:300,false);if(f.type==='email'&&out[f.key]&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(out[f.key])))throw new HttpError(400,`${f.label} is not a valid email address.`);if(f.type==='url'&&out[f.key]&&!/^https?:\/\//.test(String(out[f.key])))throw new HttpError(400,`${f.label} must start with http:// or https://.`);break;
   case 'textarea':out[f.key]=str(v,f.label,8000,false);break;
   case 'number':case 'currency':{const n=Number(v);if(!Number.isFinite(n))throw new HttpError(400,`${f.label} must be a number.`);out[f.key]=n;break}
   case 'date':out[f.key]=date(v,f.label);break;case 'datetime':out[f.key]=str(v,f.label,40);break;
   case 'select':out[f.key]=oneOf(v,f.options as readonly string[],f.label.toLowerCase());break;
   case 'person':{const m=await first('SELECT id FROM members WHERE id=? AND tenant_id=? AND active=1',idOf(v,f.label),u.tenantId);if(!m)throw new HttpError(400,`${f.label} must be an active person in this company.`);out[f.key]=String(v);break}
   case 'people':{const ids=(Array.isArray(v)?v:[]).map(x=>idOf(x,f.label)).slice(0,200);if(ids.length){const ok=new Set((await all<{id:string}>(`SELECT id FROM members WHERE tenant_id=? AND id IN (${ids.map(()=>'?').join(',')})`,u.tenantId,...ids)).map(r=>r.id));if(ids.some(i=>!ok.has(i)))throw new HttpError(400,`${f.label}: everyone must belong to this company.`)}out[f.key]=[...new Set(ids)];break}
   case 'refs':{const ids=[...new Set((Array.isArray(v)?v:[]).map(x=>idOf(x,f.label)))].slice(0,100);
    // Linking requires being able to see the target: hidden records cannot be connected (or discovered) this way.
    for(const x of ids)await findNode(u,f.refType!,x).catch(()=>{throw new HttpError(400,`${f.label}: a linked record was not found.`)});out[f.key]=ids;break}
  }
 }
 return out;
}
export const POST=route(async(req,u)=>{
 const b=await readBody(req,200000);const action=String(b.action||'');
 if(action==='save'){
  const cur=b.id?await loadWork(u,idOf(b.id,'Record')):null;
  if(cur&&!canEditWork(u,cur))throw new HttpError(403,'You cannot edit this record.');
  if(!cur&&!hasAction(u,'business','create'))throw new HttpError(403,'Creating records is not available to you.');
  const kind=cur?cur.kind:oneOf(b.kind,workKinds.map(k=>k.id),'record type');const k=workKindById.get(kind)!;
  const title=str(b.title??cur?.title,'Title',200);const status=b.status!==undefined?oneOf(b.status,k.statuses,'status'):cur?.status||k.statuses[0];
  let parentId:string|null=b.parentId!==undefined?(b.parentId?idOf(b.parentId,k.parent?.label||'Parent'):null):cur?.parent_id||null;
  if(parentId){if(!k.parent)parentId=null;else{const p=await first<WorkRow>('SELECT * FROM work_records WHERE id=? AND tenant_id=? AND kind=? AND deleted_at IS NULL',parentId,u.tenantId,k.parent.kind);if(!p||!canSeeWork(u,p))throw new HttpError(400,`${k.parent.label} not found.`)}}
  const ownerId=b.ownerId!==undefined?(b.ownerId?idOf(b.ownerId,'Owner'):null):cur?.owner_id??u.id;
  if(ownerId&&!await first('SELECT id FROM members WHERE id=? AND tenant_id=? AND active=1',ownerId,u.tenantId))throw new HttpError(400,'The owner must be an active person in this company.');
  const v={title,description:str(b.description??cur?.description,'Description',8000,false),status,ownerId,department:str(b.department??cur?.department??u.department,'Department',160,false),location:str(b.location??cur?.location,'Location',200,false),parentId,
   startDate:b.startDate!==undefined?(b.startDate?String(str(b.startDate,'Start',40)):null):cur?.start_date??null,endDate:b.endDate!==undefined?(b.endDate?String(str(b.endDate,'End',40)):null):cur?.end_date??null,
   amount:b.amount!==undefined&&b.amount!==''&&b.amount!==null?Number(b.amount):b.amount===''||b.amount===null?null:cur?.amount??null,currency:str(b.currency??cur?.currency??(await tenantOf(u)).currency,'Currency',8,false),
   progress:Math.max(0,Math.min(100,Math.round(Number(b.progress??cur?.progress??0)||0))),visibility:oneOf(b.visibility??cur?.visibility??'company',['company','department','private'] as const,'visibility'),
   data:b.data!==undefined?await cleanData(u,kind,b.data):parseJson(cur?.data_json,{})};
  if(v.amount!==null&&!Number.isFinite(v.amount))throw new HttpError(400,`${k.hasAmount||'Amount'} must be a number.`);
  if(v.startDate&&v.endDate&&v.endDate<v.startDate)throw new HttpError(400,'The end must be after the start.');
  const ts=now();
  if(cur){await batch([stmt('UPDATE work_records SET title=?,description=?,status=?,owner_id=?,department=?,location=?,parent_id=?,start_date=?,end_date=?,amount=?,currency=?,progress=?,visibility=?,data_json=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',v.title,v.description,v.status,v.ownerId,v.department,v.location,v.parentId,v.startDate,v.endDate,v.amount,v.currency,v.progress,v.visibility,JSON.stringify(v.data),u.id,ts,cur.id,u.tenantId),auditStatement(u,`${k.label} updated`,cur.id,v.department,{title:cur.title,status:cur.status},{title:v.title,status:v.status})]);return {id:cur.id}}
  const id=uid();const number=await nextNumber(u.tenantId,k.numberPrefix,true,['work_records','number']);
  await batch([stmt('INSERT INTO work_records(id,tenant_id,kind,number,title,description,status,owner_id,department,location,parent_id,start_date,end_date,amount,currency,progress,data_json,visibility,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,kind,number,v.title,v.description,v.status,v.ownerId,v.department,v.location,v.parentId,v.startDate,v.endDate,v.amount,v.currency,v.progress,JSON.stringify(v.data),v.visibility,u.id,ts,u.id,ts),auditStatement(u,`${k.label} created`,id,v.department,null,{number,title:v.title})]);
  return {id,number};
 }
 // Deleted records are hidden from everyone; their owner or an administrator can still restore them.
 const r=action==='restore'?await first<WorkRow>('SELECT * FROM work_records WHERE id=? AND tenant_id=?',idOf(b.id,'Record'),u.tenantId).then(x=>{if(!x)throw new HttpError(404,'Record not found.');return x}):await loadWork(u,idOf(b.id,'Record'));
 if(action==='delete'||action==='restore'){if(!canEditWork(u,r))throw new HttpError(403,'You cannot change this record.');await batch([stmt('UPDATE work_records SET deleted_at=?,updated_at=? WHERE id=? AND tenant_id=?',action==='delete'?now():null,now(),r.id,u.tenantId),auditStatement(u,`${workKindById.get(r.kind)?.label} ${action==='delete'?'deleted':'restored'}`,r.id,r.department,{title:r.title},null)]);return {ok:true}}
 throw new HttpError(400,'Unknown action.');
},{module:'business'});
