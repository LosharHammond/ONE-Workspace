import {env} from 'cloudflare:workers';
import {first,stmt,batch,uid,now,HttpError,auditStatement,tenantOf,tenantSettings} from './core';
import {enqueueStatement,kick} from './jobs';
import {planLimits} from '../modules';
import type {Acl} from '../acl';
import type {Member} from './policy';

// Stores bytes as a company file (used for email attachments saved to Files). Same rules as uploads: the
// workspace storage limit, a workspace-prefixed object key, an access list, audit, and background processing.
const EXT:Record<string,string>={'application/pdf':'pdf','text/plain':'txt','text/csv':'csv','image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx','application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx','audio/mpeg':'mp3','video/mp4':'mp4','message/rfc822':'eml'};
export async function storeFile(u:Member,o:{name:string,mime:string,bytes:Uint8Array,acl:Acl,links?:{type:string,id:string}[],description?:string}){
 if(!env.BUCKET)throw new HttpError(503,'File storage is unavailable.');
 const ext=(o.name.split('.').pop()||'').toLowerCase();const allowed=Object.values(EXT);
 const safeExt=allowed.includes(ext)?ext:EXT[o.mime];if(!safeExt)throw new HttpError(415,'This attachment type cannot be saved to Files.');
 if(o.bytes.length>25*1024*1024)throw new HttpError(413,'Attachments over 25 MB cannot be saved.');
 const t=await tenantOf(u);const l={...(planLimits[t.plan]||planLimits.business),...(tenantSettings(t).limits as object||{})} as {maxStorageMb:number};
 const used=await first<{b:number}>('SELECT coalesce(sum(bytes),0) AS b FROM files WHERE tenant_id=?',u.tenantId);if((used?.b||0)+o.bytes.length>l.maxStorageMb*1048576)throw new HttpError(413,'This workspace has reached its storage limit.');
 const id=uid(),key=`${u.tenantId}/files/${id}/v1-${uid()}.${safeExt}`;
 await env.BUCKET.put(key,o.bytes,{httpMetadata:{contentType:o.mime}});
 await batch([stmt('INSERT INTO files(id,tenant_id,name,mime,bytes,file_key,department,visibility,acl_json,owner_id,description,version,uploaded_by,created_at,updated_at,processing_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)',id,u.tenantId,o.name.slice(0,200),o.mime,o.bytes.length,key,o.acl.departments?.[0]||u.department,o.acl.mode==='company'?'company':o.acl.mode==='private'?'private':'department',JSON.stringify(o.acl),u.id,(o.description||'').slice(0,1000),u.id,now(),now(),'queued'),...(o.links||[]).map(x=>stmt('INSERT OR IGNORE INTO file_links(id,tenant_id,file_id,entity_type,entity_id,created_by,created_at) VALUES(?,?,?,?,?,?,?)',uid(),u.tenantId,id,x.type,x.id,u.id,now())),enqueueStatement(u.tenantId,'file.process',id,{},{key:`file:${id}:v1`}),auditStatement(u,'File saved from a connected service',id,u.department,null,{name:o.name,bytes:o.bytes.length})]);
 kick();return id;
}
