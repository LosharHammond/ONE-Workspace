import {hasAction} from '../../access-policy';
import {route,readBody,HttpError,first,stmt,batch,uid,now,str,idOf,oneOf,auditStatement,parseJson} from '../../server/core';
import {visibleEntity} from '../../server/entities';
import {test,type StudioField} from '../../studio-def';

// Custom fields and stages that Workspace Studio adds to built-in modules (tickets, assets, projects…).
// Reading needs the same visibility as the record itself; changing values needs update rights on its module.
const TYPES=['ticket','asset','project','task','PR','PO','vendor','person','work_order'] as const;
const PAGE:Record<string,string>={ticket:'maintenance',asset:'assets',project:'projects',task:'tasks',PR:'requests',PO:'procurement',vendor:'procurement',person:'people',work_order:'schedules'};
type U=Parameters<typeof visibleEntity>[0];
async function check(u:U,type:string,id:string){
 if(type==='vendor'){if(!hasAction(u,'procurement')&&!hasAction(u,'requests'))throw new HttpError(404,'Item not found.');if(!await first('SELECT id FROM vendors WHERE id=? AND tenant_id=?',id,u.tenantId))throw new HttpError(404,'Item not found.');return}
 if(type==='person'){if(!await first('SELECT id FROM members WHERE id=? AND tenant_id=?',id,u.tenantId))throw new HttpError(404,'Item not found.');return}
 await visibleEntity(u,type,id);
}
function clean(fields:StudioField[],input:Record<string,unknown>){
 const out:Record<string,unknown>={};
 for(const f of fields){
  if(f.showIf&&!test(f.showIf,{...input}))continue;
  let v=input[f.key];if(v===undefined||v===null||v===''){if(f.required)throw new HttpError(400,`“${f.label}” is required.`);continue}
  switch(f.type){
   case 'number':case 'currency':case 'percent':case 'rating':{const n=Number(v);if(!Number.isFinite(n))throw new HttpError(400,`“${f.label}” must be a number.`);if(f.min!==undefined&&n<f.min||f.max!==undefined&&n>f.max)throw new HttpError(400,`“${f.label}” is out of range.`);v=n;break}
   case 'checkbox':v=v===true||v==='true';break;
   case 'date':if(!/^\d{4}-\d{2}-\d{2}$/.test(String(v)))throw new HttpError(400,`“${f.label}” must be a date.`);break;
   case 'datetime':if(Number.isNaN(Date.parse(String(v))))throw new HttpError(400,`“${f.label}” must be a date and time.`);break;
   case 'email':if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v)))throw new HttpError(400,`“${f.label}” must be an email address.`);break;
   case 'select':case 'radio':if(!(f.options||[]).includes(String(v)))throw new HttpError(400,`Choose a valid option for “${f.label}”.`);break;
   case 'multiselect':{if(!Array.isArray(v)||v.some(x=>!(f.options||[]).includes(String(x))))throw new HttpError(400,`Choose valid options for “${f.label}”.`);break}
   default:v=String(v).slice(0,f.type==='richtext'?20000:2000);if(f.pattern&&!new RegExp(f.pattern).test(String(v)))throw new HttpError(400,`“${f.label}” is not in the expected format.`);
  }
  out[f.key]=v;
 }
 return out;
}
export const GET=route(async(req,u)=>{
 const q=new URL(req.url).searchParams;const type=oneOf(q.get('type'),TYPES,'record type'),id=idOf(q.get('id'),'Record');
 await check(u,type,id);
 const ext=await first<{fields_json:string,stages_json:string,version:number}>('SELECT fields_json,stages_json,version FROM module_extensions WHERE tenant_id=? AND entity_type=?',u.tenantId,type);
 if(!ext)return {fields:[],stages:[],values:{},stage:'',canEdit:false};
 const row=await first<{data_json:string,stage:string,updated_at:string,updated_by:string}>('SELECT data_json,stage,updated_at,updated_by FROM record_extensions WHERE tenant_id=? AND entity_type=? AND entity_id=?',u.tenantId,type,id);
 const fields=parseJson<StudioField[]>(ext.fields_json,[]).filter(f=>!f.readRoles?.length||u.role==='admin'||f.readRoles.includes(u.role)||f.readRoles.includes(u.roleId||''));
 const values=parseJson<Record<string,unknown>>(row?.data_json,{});
 return {fields,stages:parseJson<string[]>(ext.stages_json,[]),values:Object.fromEntries(fields.map(f=>[f.key,values[f.key]])),stage:row?.stage||'',updatedAt:row?.updated_at||null,canEdit:u.role==='admin'||hasAction(u,PAGE[type],'update')};
});
export const POST=route(async(req,u)=>{
 const b=await readBody(req,100000);const type=oneOf(b.type,TYPES,'record type'),id=idOf(b.id,'Record');
 await check(u,type,id);
 if(u.role!=='admin'&&!hasAction(u,PAGE[type],'update'))throw new HttpError(403,'You cannot change this record.');
 const ext=await first<{fields_json:string,stages_json:string}>('SELECT fields_json,stages_json FROM module_extensions WHERE tenant_id=? AND entity_type=?',u.tenantId,type);if(!ext)throw new HttpError(404,'This module has no custom fields.');
 const all=parseJson<StudioField[]>(ext.fields_json,[]);const writable=all.filter(f=>!f.writeRoles?.length||u.role==='admin'||f.writeRoles.includes(u.role)||f.writeRoles.includes(u.roleId||''));
 const old=await first<{data_json:string,stage:string}>('SELECT data_json,stage FROM record_extensions WHERE tenant_id=? AND entity_type=? AND entity_id=?',u.tenantId,type,id);
 const prev=parseJson<Record<string,unknown>>(old?.data_json,{});const input=(b.values&&typeof b.values==='object'?b.values:{}) as Record<string,unknown>;
 const cleaned=clean(writable,{...prev,...input});const data={...prev};for(const f of writable){if(f.key in cleaned)data[f.key]=cleaned[f.key];else delete data[f.key]}
 const stages=parseJson<string[]>(ext.stages_json,[]);const stage=b.stage!==undefined?str(b.stage,'Stage',60,false):old?.stage||'';if(stage&&!stages.includes(stage))throw new HttpError(400,'Choose a valid stage.');
 await batch([stmt('INSERT INTO record_extensions(id,tenant_id,entity_type,entity_id,stage,data_json,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,entity_type,entity_id) DO UPDATE SET stage=excluded.stage,data_json=excluded.data_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at',uid(),u.tenantId,type,id,stage,JSON.stringify(data),u.id,now()),auditStatement(u,stage!==(old?.stage||'')?`Custom stage changed to ${stage||'none'}`:'Custom fields updated',id,'Workspace Studio',{stage:old?.stage||'',data:prev},{stage,data})]);
 return {ok:true,values:data,stage};
});
