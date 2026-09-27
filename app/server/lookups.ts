import {all,stmt,batch,uid,now,tenantOf,tenantSettings} from './core';
import {lookupLists} from '../lookups';

type Row={id:string,list:string,value:string,parent:string,sort:number};
// First use: copy each list's legacy comma-separated setting (or its defaults) into rows, once per list.
export async function ensureLookups(u:{tenantId:string,id:string,name?:string}){
 const have=new Set((await all<{list:string}>('SELECT DISTINCT list FROM lookups WHERE tenant_id=?',u.tenantId)).map(r=>r.list));
 const missing=lookupLists.filter(l=>!have.has(l.id)&&!l.parent);if(!missing.length)return;
 const s=tenantSettings(await tenantOf(u));const ts=now();
 const rows=missing.flatMap(l=>{const legacy=l.legacySetting&&typeof s[l.legacySetting]==='string'?String(s[l.legacySetting]).split(',').map(x=>x.trim()).filter(Boolean):[];return [...new Set(legacy.length?legacy:l.defaults)].map((v,i)=>stmt('INSERT OR IGNORE INTO lookups(id,tenant_id,list,value,parent,sort,active,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?,?)',uid(),u.tenantId,l.id,v.slice(0,120),'',i,'system',ts,'system',ts))});
 for(let i=0;i<rows.length;i+=90)await batch(rows.slice(i,i+90));
}
export async function activeLookups(u:{tenantId:string,id:string}){
 await ensureLookups(u);
 const rows=await all<Row>('SELECT id,list,value,parent,sort FROM lookups WHERE tenant_id=? AND active=1 ORDER BY list,sort,value',u.tenantId);
 const out:Record<string,{value:string,parent:string}[]>={};for(const r of rows)(out[r.list]||=[]).push({value:r.value,parent:r.parent});
 // Department cost centres are always offered as cost centres.
 const cc=await all<{cost_centre:string}>("SELECT DISTINCT cost_centre FROM departments WHERE tenant_id=? AND cost_centre<>''",u.tenantId);
 out['cost-centres']=[...(out['cost-centres']||[]),...cc.filter(c=>!(out['cost-centres']||[]).some(x=>x.value===c.cost_centre)).map(c=>({value:c.cost_centre,parent:''}))];
 return out;
}
