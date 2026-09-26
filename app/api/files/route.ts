import {env} from 'cloudflare:workers';
import {hasAction,canActOn} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,oneOf,idOf,auditStatement} from '../../server/core';
import {canSeeFile,canEditFile,type FileRow} from '../../server/entities';
import type {Member} from '../../server/policy';

const MAX=25*1024*1024;
const types:Record<string,string>={pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',csv:'text/csv',txt:'text/plain',md:'text/markdown',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',zip:'application/zip',mp4:'video/mp4',mp3:'audio/mpeg'};
const inline=new Set(['application/pdf','image/png','image/jpeg','image/gif','image/webp','text/plain','video/mp4','audio/mpeg']);
type Folder={id:string,parent_id:string|null,name:string,department:string,visibility:string,created_by:string,created_at:string};
const canSeeFolder=(u:Member,f:Folder)=>canSeeFile(u,{...f,uploaded_by:f.created_by} as unknown as FileRow);
async function loadFile(u:Member,id:string){const f=await first<FileRow>('SELECT * FROM files WHERE id=? AND tenant_id=?',id,u.tenantId);if(!f||!canSeeFile(u,f))throw new HttpError(404,'File not found.');return f}

export const GET=route(async(req,u)=>{
 if(!hasAction(u,'documents'))throw new HttpError(403,'Files are not available to your account.');
 const url=new URL(req.url);
 const dl=url.searchParams.get('download')||url.searchParams.get('preview');
 if(dl){
  const f=await loadFile(u,idOf(dl,'File'));
  if(!canActOn(u,'documents','download',f.department||u.department,f.uploaded_by)&&f.uploaded_by!==u.id)throw new HttpError(403,'Downloading files is not part of your role.');
  const v=url.searchParams.get('v');let key=f.file_key;
  if(v){const ver=await first<{file_key:string}>('SELECT file_key FROM file_versions WHERE tenant_id=? AND file_id=? AND version=?',u.tenantId,f.id,Number(v));if(!ver)throw new HttpError(404,'Version not found.');key=ver.file_key}
  if(!env.BUCKET)throw new HttpError(503,'File storage is unavailable.');
  const obj=await env.BUCKET.get(key);if(!obj)throw new HttpError(404,'File content unavailable.');
  const asInline=url.searchParams.has('preview')&&inline.has(f.mime);
  return new Response(obj.body,{headers:{'Content-Type':f.mime,'Content-Length':String(obj.size),'Content-Disposition':`${asInline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox"}});
 }
 const id=url.searchParams.get('id');
 if(id){const f=await loadFile(u,idOf(id,'File'));const versions=await all('SELECT version,bytes,uploaded_by AS uploadedBy,created_at AS createdAt FROM file_versions WHERE tenant_id=? AND file_id=? ORDER BY version DESC',u.tenantId,f.id);return {file:f,versions,canEdit:canEditFile(u,f)}}
 const [folders,files]=await Promise.all([all<Folder>('SELECT * FROM folders WHERE tenant_id=? ORDER BY name',u.tenantId),all<FileRow>('SELECT id,folder_id,name,mime,bytes,department,visibility,tags,description,version,uploaded_by,created_at,updated_at,file_key FROM files WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 5000',u.tenantId)]);
 return {folders:folders.filter(f=>canSeeFolder(u,f)),files:files.filter(f=>canSeeFile(u,f)).map(({file_key,...f})=>f),canUpload:hasAction(u,'documents','upload')};
});

export const POST=route(async(req,u)=>{
 if((req.headers.get('Content-Type')||'').startsWith('multipart/form-data'))return upload(req,u);
 const b=await readBody(req);const action=String(b.action||'');
 if(action==='folder'){
  if(!hasAction(u,'documents','create'))throw new HttpError(403,'Creating folders is not part of your role.');
  const parentId=b.parentId?idOf(b.parentId,'Folder'):null;if(parentId&&!await first('SELECT id FROM folders WHERE id=? AND tenant_id=?',parentId,u.tenantId))throw new HttpError(400,'Parent folder not found.');
  const id=uid();const department=str(b.department,'Department',160,false)||u.department;
  await batch([stmt('INSERT INTO folders(id,tenant_id,parent_id,name,department,visibility,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)',id,u.tenantId,parentId,str(b.name,'Folder name',120),department,oneOf(b.visibility||'company',['company','department','private'] as const,'visibility'),u.id,now()),auditStatement(u,'Folder created',id,department,null,{name:b.name})]);
  return {id};
 }
 if(action==='delete-folder'){
  const id=idOf(b.id,'Folder');const f=await first<Folder>('SELECT * FROM folders WHERE id=? AND tenant_id=?',id,u.tenantId);if(!f||!canSeeFolder(u,f))throw new HttpError(404,'Folder not found.');
  if(f.created_by!==u.id&&u.role!=='admin')throw new HttpError(403,'Only the folder owner or an administrator can delete it.');
  if(await first('SELECT id FROM files WHERE folder_id=? AND tenant_id=?',id,u.tenantId)||await first('SELECT id FROM folders WHERE parent_id=? AND tenant_id=?',id,u.tenantId))throw new HttpError(409,'Empty the folder first.');
  await batch([stmt('DELETE FROM folders WHERE id=? AND tenant_id=?',id,u.tenantId),auditStatement(u,'Folder deleted',id,f.department,f,null)]);return {ok:true};
 }
 const f=await loadFile(u,idOf(b.id,'File'));
 if(!canEditFile(u,f))throw new HttpError(403,'You cannot change this file.');
 if(action==='update'){
  const folderId=b.folderId===undefined?f.folder_id:b.folderId?idOf(b.folderId,'Folder'):null;
  if(folderId&&!await first('SELECT id FROM folders WHERE id=? AND tenant_id=?',folderId,u.tenantId))throw new HttpError(400,'Folder not found.');
  const v={name:str(b.name??f.name,'File name',200),description:str(b.description??f.description,'Description',1000,false),tags:str(b.tags??f.tags,'Tags',300,false),visibility:oneOf(b.visibility||f.visibility,['company','department','private'] as const,'visibility'),department:str(b.department??f.department,'Department',160,false)};
  await batch([stmt('UPDATE files SET name=?,description=?,tags=?,visibility=?,department=?,folder_id=?,updated_at=? WHERE id=? AND tenant_id=?',v.name,v.description,v.tags,v.visibility,v.department,folderId,now(),f.id,u.tenantId),auditStatement(u,'File details updated',f.id,v.department,{name:f.name,visibility:f.visibility},v)]);return {ok:true};
 }
 if(action==='delete'){
  const versions=await all<{file_key:string}>('SELECT file_key FROM file_versions WHERE tenant_id=? AND file_id=?',u.tenantId,f.id);
  await batch([stmt('DELETE FROM file_versions WHERE tenant_id=? AND file_id=?',u.tenantId,f.id),stmt('DELETE FROM files WHERE id=? AND tenant_id=?',f.id,u.tenantId),auditStatement(u,'File deleted',f.id,f.department,{name:f.name},null)]);
  if(env.BUCKET)await Promise.allSettled([f.file_key,...versions.map(v=>v.file_key)].map(k=>env.BUCKET!.delete(k)));
  return {ok:true};
 }
 throw new HttpError(400,'Unknown action.');
});

async function upload(req:Request,u:Member){
 if(!hasAction(u,'documents','upload'))throw new HttpError(403,'Uploading files is not part of your role.');
 if(!env.BUCKET)throw new HttpError(503,'File storage is unavailable.');
 if(Number(req.headers.get('Content-Length')||0)>MAX+200000)throw new HttpError(413,'Files must be 25 MB or smaller.');
 const fd=await req.formData();const file=fd.get('file');
 if(!(file instanceof File)||!file.size||file.size>MAX)throw new HttpError(400,'Choose a file of up to 25 MB.');
 const ext=(file.name.split('.').pop()||'').toLowerCase();const mime=types[ext];
 if(!mime)throw new HttpError(400,'Upload PDF, Office, CSV, text, image, ZIP, MP3 or MP4 files.');
 const replace=fd.get('replaceId');
 if(typeof replace==='string'&&replace){
  const f=await loadFile(u,idOf(replace,'File'));if(!canEditFile(u,f))throw new HttpError(403,'You cannot add versions to this file.');
  const key=`${u.tenantId}/files/${f.id}/v${f.version+1}-${uid()}.${ext}`;await env.BUCKET.put(key,file.stream(),{httpMetadata:{contentType:mime}});
  const res=await batch([stmt('INSERT INTO file_versions(id,tenant_id,file_id,version,file_key,bytes,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),u.tenantId,f.id,f.version,f.file_key,f.bytes,f.uploaded_by,f.updated_at),stmt('UPDATE files SET file_key=?,bytes=?,mime=?,version=version+1,updated_at=? WHERE id=? AND tenant_id=? AND version=?',key,file.size,mime,now(),f.id,u.tenantId,f.version),auditStatement(u,`New version uploaded (v${f.version+1})`,f.id,f.department,{version:f.version},{version:f.version+1,bytes:file.size})]);
  if(!res[1].meta.changes){await env.BUCKET.delete(key);throw new HttpError(409,'Another version was uploaded at the same time. Refresh and retry.')}
  return {id:f.id,version:f.version+1};
 }
 const folderId=typeof fd.get('folderId')==='string'&&fd.get('folderId')?idOf(fd.get('folderId'),'Folder'):null;
 const folder=folderId?await first<Folder>('SELECT * FROM folders WHERE id=? AND tenant_id=?',folderId,u.tenantId):null;if(folderId&&!folder)throw new HttpError(400,'Folder not found.');
 const id=uid(),key=`${u.tenantId}/files/${id}/v1-${uid()}.${ext}`;
 const department=str(fd.get('department'),'Department',160,false)||folder?.department||u.department;
 const visibility=oneOf(fd.get('visibility')||folder?.visibility||'company',['company','department','private'] as const,'visibility');
 await env.BUCKET.put(key,file.stream(),{httpMetadata:{contentType:mime}});
 try{await batch([stmt('INSERT INTO files(id,tenant_id,folder_id,name,mime,bytes,file_key,department,visibility,tags,description,version,uploaded_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)',id,u.tenantId,folderId,file.name.slice(0,200),mime,file.size,key,department,visibility,str(fd.get('tags'),'Tags',300,false),str(fd.get('description'),'Description',1000,false),u.id,now(),now()),auditStatement(u,'File uploaded',id,department,null,{name:file.name,bytes:file.size})])}
 catch(e){await env.BUCKET.delete(key).catch(()=>{});throw e}
 return {id};
}
