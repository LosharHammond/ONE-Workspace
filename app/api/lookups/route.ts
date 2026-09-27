import {hasAction} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,idOf,auditStatement} from '../../server/core';
import {lookupLists,lookupListById} from '../../lookups';
import {ensureLookups} from '../../server/lookups';
import type {Member} from '../../server/policy';

// Company pick lists (Company settings › Lists). Everyone in the workspace reads active values (forms need
// them); only Company Admins or roles with Administration › Configure change them. Every change is audited.
type Row={id:string,list:string,value:string,parent:string,description:string,sort:number,active:number};
function canManage(u:Member){return u.role==='admin'||hasAction(u,'settings','configure')}
export const GET=route(async(_req,u)=>{
 await ensureLookups(u);
 const rows=await all<Row>(`SELECT id,list,value,parent,description,sort,active FROM lookups WHERE tenant_id=? ${canManage(u)?'':'AND active=1'} ORDER BY list,sort,value`,u.tenantId);
 const usage=await first<Record<string,number>>('SELECT (SELECT count(*) FROM departments WHERE tenant_id=?1) AS departments,(SELECT count(*) FROM locations WHERE tenant_id=?1) AS locations,(SELECT count(*) FROM vendors WHERE tenant_id=?1) AS vendors',u.tenantId);
 return {lists:lookupLists,values:rows,canManage:canManage(u),counts:usage};
});
export const POST=route(async(req,u)=>{
 if(!canManage(u))throw new HttpError(403,'Only administrators manage company lists.');
 const b=await readBody(req,200000);const action=String(b.action||'');
 const listOf=(v:unknown)=>{const l=lookupListById.get(String(v));if(!l)throw new HttpError(400,'Choose a valid list.');return l};
 if(action==='save'){
  const l=listOf(b.list);const value=str(b.value,'Value',120);const parent=l.parent?str(b.parent,'Parent',120):'';
  if(l.parent&&!await first('SELECT id FROM lookups WHERE tenant_id=? AND list=? AND value=?',u.tenantId,l.parent,parent))throw new HttpError(400,`Choose an existing ${lookupListById.get(l.parent)!.label.toLowerCase().replace(/s$/,'')}.`);
  const description=str(b.description,'Description',300,false);
  const clash=await first<{id:string}>('SELECT id FROM lookups WHERE tenant_id=? AND list=? AND parent=? AND lower(value)=lower(?)',u.tenantId,l.id,parent,value);
  if(b.id){
   const id=idOf(b.id,'Value');const before=await first<Row>('SELECT * FROM lookups WHERE id=? AND tenant_id=?',id,u.tenantId);if(!before)throw new HttpError(404,'Value not found.');
   if(clash&&clash.id!==id)throw new HttpError(409,`“${value}” is already in this list.`);
   const s=[stmt('UPDATE lookups SET value=?,parent=?,description=?,active=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',value,parent,description,b.active===false?0:1,u.name,now(),id,u.tenantId),auditStatement(u,`List value changed (${l.label})`,id,'Administration',{value:before.value,parent:before.parent,active:before.active},{value,parent,active:b.active===false?0:1})];
   // Renaming a parent keeps its children attached.
   const child=lookupLists.find(x=>x.parent===l.id);if(child&&before.value!==value)s.push(stmt('UPDATE lookups SET parent=? WHERE tenant_id=? AND list=? AND parent=?',value,u.tenantId,child.id,before.value));
   await batch(s);return {id};
  }
  if(clash)throw new HttpError(409,`“${value}” is already in this list.`);
  const max=await first<{m:number}>('SELECT coalesce(max(sort),-1) AS m FROM lookups WHERE tenant_id=? AND list=?',u.tenantId,l.id);
  const id=uid();await batch([stmt('INSERT INTO lookups(id,tenant_id,list,value,parent,description,sort,active,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?,?,?)',id,u.tenantId,l.id,value,parent,description,(max?.m??-1)+1,u.name,now(),u.name,now()),auditStatement(u,`List value added (${l.label})`,id,'Administration',null,{value,parent})]);
  return {id};
 }
 if(action==='delete'){
  const id=idOf(b.id,'Value');const r=await first<Row>('SELECT * FROM lookups WHERE id=? AND tenant_id=?',id,u.tenantId);if(!r)throw new HttpError(404,'Value not found.');
  const l=lookupListById.get(r.list);const child=lookupLists.find(x=>x.parent===r.list);
  if(child&&await first('SELECT id FROM lookups WHERE tenant_id=? AND list=? AND parent=?',u.tenantId,child.id,r.value))throw new HttpError(409,`Remove or move the ${child.label.toLowerCase()} under “${r.value}” first, or deactivate it instead.`);
  // Deleting a value never changes records that already use it.
  await batch([stmt('DELETE FROM lookups WHERE id=? AND tenant_id=?',id,u.tenantId),auditStatement(u,`List value deleted (${l?.label||r.list})`,id,'Administration',{value:r.value,parent:r.parent},null)]);return {ok:true};
 }
 if(action==='reorder'){
  const l=listOf(b.list);const ids=Array.isArray(b.ids)?b.ids.map(x=>idOf(x,'Value')).slice(0,500):[];
  await batch([...ids.map((id,i)=>stmt('UPDATE lookups SET sort=? WHERE id=? AND tenant_id=? AND list=?',i,id,u.tenantId,l.id)),auditStatement(u,`List reordered (${l.label})`,l.id,'Administration',null,{count:ids.length})]);return {ok:true};
 }
 if(action==='import'){
  const l=listOf(b.list);if(!Array.isArray(b.rows)||b.rows.length>1000)throw new HttpError(400,'Import up to 1,000 values.');
  const existing=new Set((await all<{value:string,parent:string}>('SELECT value,parent FROM lookups WHERE tenant_id=? AND list=?',u.tenantId,l.id)).map(r=>`${r.parent}\u0000${r.value.toLowerCase()}`));
  const parents=l.parent?new Set((await all<{value:string}>('SELECT value FROM lookups WHERE tenant_id=? AND list=?',u.tenantId,l.parent)).map(r=>r.value)):null;
  const errors:{row:number,reason:string}[]=[];const add:{value:string,parent:string}[]=[];
  (b.rows as Record<string,unknown>[]).forEach((r,i)=>{const value=String(r.value??'').trim().slice(0,120),parent=String(r.parent??'').trim().slice(0,120);if(!value){errors.push({row:i+1,reason:'Value is required'});return}if(parents&&!parents.has(parent)){errors.push({row:i+1,reason:`Unknown parent “${parent}”`});return}const k=`${parent}\u0000${value.toLowerCase()}`;if(existing.has(k))return;existing.add(k);add.push({value,parent})});
  if(b.preview)return {preview:true,add:add.length,errors};
  const ts=now();const s=add.map((a,i)=>stmt('INSERT OR IGNORE INTO lookups(id,tenant_id,list,value,parent,sort,active,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?,?)',uid(),u.tenantId,l.id,a.value,a.parent,1000+i,u.name,ts,u.name,ts));
  s.push(auditStatement(u,`List imported (${l.label})`,l.id,'Administration',null,{added:add.length,errors:errors.length}));
  for(let i=0;i<s.length;i+=90)await batch(s.slice(i,i+90));
  return {added:add.length,errors};
 }
 throw new HttpError(400,'Unknown action.');
});
