import {env} from 'cloudflare:workers';
import {hasAction,canActOn} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,oneOf,idOf,auditStatement,clientIp,tenantOf,tenantSettings,parseJson} from '../../server/core';
import {canSeeFile,canEditFile,fileAcl,visibleEntity,type FileRow} from '../../server/entities';
import {aclOf,canView,canManage,validateAcl,defaultAcl} from '../../server/acl';
import {entityVisible,LINK_TYPES,loadSpace} from '../../server/collab';
import {enqueueStatement,kick,jobFor,retryJob,processDueJobs} from '../../server/jobs';
import {signFileLink} from '../../server/signed';
import {notify} from '../../server/notify';
import {planLimits} from '../../modules';
import type {Acl} from '../../acl';
import type {Member} from '../../server/policy';


// Files: company-scoped storage (R2 keys are prefixed with the workspace id), content access control, versions,
// recycle bin, legal hold, links to other records, favorites, access history, resumable uploads, signed links,
// and asynchronous processing (text, OCR, transcripts, captions, summaries).
const SIMPLE_MAX=25*1024*1024,LARGE_MAX=2*1024*1024*1024;
const types:Record<string,string>={pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',docm:'application/vnd.ms-word.document.macroEnabled.12',xlsm:'application/vnd.ms-excel.sheet.macroEnabled.12',csv:'text/csv',txt:'text/plain',md:'text/markdown',json:'application/json',html:'text/html',htm:'text/html',eml:'message/rfc822',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',zip:'application/zip',mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg'};
// Only formats that cannot run script are ever shown inline (HTML and SVG are always downloaded).
const inline=new Set(['application/pdf','image/png','image/jpeg','image/gif','image/webp','text/plain','video/mp4','video/webm','audio/mpeg','audio/mp4','audio/wav','audio/ogg']);
type Folder={id:string,parent_id:string|null,name:string,department:string,visibility:string,acl_json:string|null,space_id:string|null,created_by:string,created_at:string,deleted_at:string|null};
type F=FileRow&{archived_at?:string|null,entity_type:string|null,entity_id:string|null,custom_json:string,legal_hold:number,pinned:number,processing_status:string,processing_error:string};
const canSeeFolder=(u:Member,f:Folder)=>!f.deleted_at&&(u.role==='admin'||f.created_by===u.id||canView(u,aclOf(f.acl_json,{visibility:f.visibility,department:f.department}),f.created_by));
async function loadFile(u:Member,id:string,opts:{deleted?:boolean}={}){
 const f=await first<F>('SELECT * FROM files WHERE id=? AND tenant_id=?',id,u.tenantId);if(!f)throw new HttpError(404,'File not found.');
 if(f.deleted_at){if(opts.deleted&&(u.role==='admin'||(f.owner_id||f.uploaded_by)===u.id))return f;throw new HttpError(404,'File not found.')}
 // Record attachments follow the visibility of their record.
 if(f.entity_type&&f.entity_id){await visibleEntity(u,f.entity_type,f.entity_id);return f}
 if(!canSeeFile(u,f))throw new HttpError(404,'File not found.');return f;
}
const event=(u:Member,fileId:string,action:string,req:Request)=>stmt('INSERT INTO file_events(id,tenant_id,file_id,member_id,action,ip,created_at) VALUES(?,?,?,?,?,?,?)',uid(),u.tenantId,fileId,u.id,action,clientIp(req),now());
const canDownload=(u:Member,f:F)=>u.role==='admin'||(f.owner_id||f.uploaded_by)===u.id||canActOn(u,'documents','download',f.department||u.department,f.uploaded_by)||hasAction(u,'documents','download');
async function limits(u:Member){const t=await tenantOf(u);const s=tenantSettings(t);return {limits:{...(planLimits[t.plan]||planLimits.business),...(s.limits as object||{})} as {maxStorageMb:number},settings:s}}
async function storageCheck(u:Member,bytes:number){const {limits:l}=await limits(u);const used=await first<{b:number}>('SELECT coalesce(sum(bytes),0) AS b FROM files WHERE tenant_id=?',u.tenantId);if((used?.b||0)+bytes>l.maxStorageMb*1048576)throw new HttpError(413,`This workspace has reached its ${l.maxStorageMb.toLocaleString()} MB storage limit.`)}
const summaryOf=(f:F)=>{const {file_key,custom_json,...rest}=f;void file_key;const c=parseJson<Record<string,unknown>>(custom_json,{});return {...rest,acl:fileAcl(f),pendingAcl:c.pendingAcl||null,custom:c.fields||{}}};
async function notifyAdminsOfApproval(u:Member,f:{id:string,name:string},req:Request){const admins=(await all<{id:string}>("SELECT id FROM members WHERE tenant_id=? AND role='admin' AND active=1",u.tenantId)).map(a=>a.id);await notify(u,admins,{kind:'approval',title:`${u.name} asks to share “${f.name}” with everyone`,body:'Company-wide sharing needs an administrator’s approval.',link:`#/files/root/${f.id}`},req)}

export const GET=route(async(req,u)=>{
 if(!hasAction(u,'documents'))throw new HttpError(403,'Files are not available to your account.');
 const url=new URL(req.url);const q=(k:string)=>url.searchParams.get(k);
 const dl=q('download')||q('preview');
 if(dl){
  const f=await loadFile(u,idOf(dl,'File'));
  if(!canDownload(u,f))throw new HttpError(403,'Downloading files is not part of your role.');
  const v=q('v');let key=f.file_key;
  if(v){const ver=await first<{file_key:string}>('SELECT file_key FROM file_versions WHERE tenant_id=? AND file_id=? AND version=?',u.tenantId,f.id,Number(v));if(!ver)throw new HttpError(404,'Version not found.');key=ver.file_key}
  if(!key.startsWith(`${u.tenantId}/`))throw new HttpError(404,'File not found.');
  if(!env.BUCKET)throw new HttpError(503,'File storage is unavailable.');
  const obj=await env.BUCKET.get(key);if(!obj)throw new HttpError(404,'File content unavailable.');
  const asInline=q('preview')!==null&&inline.has(f.mime);
  await event(u,f.id,asInline?'view':'download',req).run();
  return new Response(obj.body,{headers:{'Content-Type':asInline?f.mime:'application/octet-stream','Content-Length':String(obj.size),'Content-Disposition':`${asInline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox"}});
 }
 // Generated content (text, transcript, captions, summary) inherits the file's access check.
 if(q('artifact')){
  const f=await loadFile(u,idOf(q('artifact'),'File'));const kind=oneOf(q('kind'),['text','transcript','transcript_edit','vtt','srt','summary'] as const,'artifact');
  const a=await first<{content:string,meta_json:string,created_at:string,file_version:number}>('SELECT content,meta_json,created_at,file_version FROM file_artifacts WHERE tenant_id=? AND file_id=? AND kind=? ORDER BY created_at DESC LIMIT 1',u.tenantId,f.id,kind);
  if(!a)throw new HttpError(404,'Not generated yet.');
  if((kind==='vtt'||kind==='srt')&&q('download')!==null){if(!canDownload(u,f))throw new HttpError(403,'Downloading files is not part of your role.');await event(u,f.id,'download',req).run();return new Response(a.content,{headers:{'Content-Type':kind==='vtt'?'text/vtt; charset=utf-8':'application/x-subrip; charset=utf-8','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(f.name.replace(/\.[^.]+$/,'')+'.'+kind)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}
  return {kind,content:a.content,meta:parseJson(a.meta_json,{}),createdAt:a.created_at,version:a.file_version};
 }
 const id=q('id');
 if(id){
  const f=await loadFile(u,idOf(id,'File'),{deleted:true});const manage=canEditFile(u,f);
  const [versions,links,artifacts,job,fav,events]=await Promise.all([
   all('SELECT version,bytes,uploaded_by AS uploadedBy,created_at AS createdAt FROM file_versions WHERE tenant_id=? AND file_id=? ORDER BY version DESC',u.tenantId,f.id),
   all('SELECT entity_type AS entityType,entity_id AS entityId FROM file_links WHERE tenant_id=? AND file_id=?',u.tenantId,f.id),
   all('SELECT kind,created_at AS createdAt,file_version AS version FROM file_artifacts WHERE tenant_id=? AND file_id=? ORDER BY created_at DESC',u.tenantId,f.id),
   jobFor(u.tenantId,'file.process',f.id),
   first('SELECT id FROM file_favorites WHERE tenant_id=? AND member_id=? AND file_id=?',u.tenantId,u.id,f.id),
   manage?all('SELECT e.action,e.created_at AS createdAt,e.ip,m.name AS who FROM file_events e LEFT JOIN members m ON m.id=e.member_id WHERE e.tenant_id=? AND e.file_id=? ORDER BY e.created_at DESC LIMIT 100',u.tenantId,f.id):[],
  ]);
  const history=manage?await all('SELECT a.action,a.created_at AS createdAt,m.name AS who FROM audit a LEFT JOIN members m ON m.id=a.actor WHERE a.tenant_id=? AND a.record_id=? ORDER BY a.created_at DESC LIMIT 100',u.tenantId,f.id):[];
  await event(u,f.id,'view',req).run();
  return {file:summaryOf(f),versions,links,artifacts:[...new Map(artifacts.map((a:any)=>[a.kind,a])).values()],job:job?{status:job.status,stage:job.stage,attempts:job.attempts,error:job.last_error,id:job.id}:null,favorite:!!fav,events,history,canEdit:manage,canDownload:canDownload(u,f),isAdmin:u.role==='admin'};
 }
 if(q('usage')!==null){
  if(u.role!=='admin')throw new HttpError(403,'Only administrators see storage usage.');
  const {limits:l,settings}=await limits(u);
  const [byDept,byStatus,queue,bin,totals]=await Promise.all([
   all('SELECT department,count(*) AS files,coalesce(sum(bytes),0) AS bytes FROM files WHERE tenant_id=? GROUP BY department ORDER BY bytes DESC',u.tenantId),
   all('SELECT processing_status AS status,count(*) AS files FROM files WHERE tenant_id=? AND deleted_at IS NULL GROUP BY processing_status',u.tenantId),
   all("SELECT status,count(*) AS jobs FROM jobs WHERE tenant_id=? AND kind='file.process' GROUP BY status",u.tenantId),
   first<{n:number,b:number}>('SELECT count(*) AS n,coalesce(sum(bytes),0) AS b FROM files WHERE tenant_id=? AND deleted_at IS NOT NULL',u.tenantId),
   first<{n:number,b:number}>('SELECT count(*) AS n,coalesce(sum(bytes),0) AS b FROM files WHERE tenant_id=?',u.tenantId),
  ]);
  return {limitMb:l.maxStorageMb,totals,byDept,byStatus,queue,bin,policy:{retentionDays:Number(settings.fileRetentionDays??30),legalHoldEnabled:!!settings.legalHoldEnabled,companyWidePublishing:settings.companyWidePublishing||'everyone'}};
 }
 const view=q('view')||'all';
 if(view==='recycle'){
  const rows=await all<F>('SELECT * FROM files WHERE tenant_id=? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 1000',u.tenantId);
  return {files:rows.filter(f=>u.role==='admin'||(f.owner_id||f.uploaded_by)===u.id).map(summaryOf),folders:[],canUpload:false};
 }
 const [folders,files,favs]=await Promise.all([
  all<Folder>('SELECT * FROM folders WHERE tenant_id=? AND deleted_at IS NULL ORDER BY name',u.tenantId),
  all<F>('SELECT * FROM files WHERE tenant_id=? AND entity_type IS NULL AND deleted_at IS NULL ORDER BY pinned DESC,updated_at DESC LIMIT 5000',u.tenantId),
  all<{file_id:string}>('SELECT file_id FROM file_favorites WHERE tenant_id=? AND member_id=?',u.tenantId,u.id),
 ]);
 const fav=new Set(favs.map(x=>x.file_id));
 let visible=files.filter(f=>canSeeFile(u,f)&&(view==='archived'?!!f.archived_at:!f.archived_at));
 const space=q('space');
 if(space){const sp=await loadSpace(u,idOf(space,'Space'));visible=visible.filter(f=>f.space_id===sp.id||(!f.space_id&&sp.kind==='department'&&f.department.toLowerCase()===sp.department.toLowerCase()))}
 if(view==='mine')visible=visible.filter(f=>(f.owner_id||f.uploaded_by)===u.id);
 if(view==='favorites')visible=visible.filter(f=>fav.has(f.id));
 if(view==='recent'){const seen=await all<{file_id:string}>('SELECT file_id,max(created_at) AS at FROM file_events WHERE tenant_id=? AND member_id=? GROUP BY file_id ORDER BY at DESC LIMIT 50',u.tenantId,u.id);const order=new Map(seen.map((s,i)=>[s.file_id,i]));visible=visible.filter(f=>order.has(f.id)||f.uploaded_by===u.id).sort((a,b)=>(order.get(a.id)??999)-(order.get(b.id)??999)||b.updated_at.localeCompare(a.updated_at)).slice(0,50)}
 if(view==='shared')visible=visible.filter(f=>(f.owner_id||f.uploaded_by)!==u.id&&['people','groups','roles','departments'].includes(fileAcl(f).mode));
 if(view==='department')visible=visible.filter(f=>['department','departments'].includes(fileAcl(f).mode));
 if(view==='company')visible=visible.filter(f=>fileAcl(f).mode==='company');
 if(view==='project')visible=visible.filter(f=>fileAcl(f).mode==='project');
 return {folders:folders.filter(f=>canSeeFolder(u,f)&&(!space||f.space_id===space||(!f.space_id&&!space))),files:visible.map(f=>({...summaryOf(f),favorite:fav.has(f.id)})),canUpload:hasAction(u,'documents','upload'),defaultAcl:defaultAcl(u)};
},{module:'files'});

export const POST=route(async(req,u)=>{
 const ct=req.headers.get('Content-Type')||'';
 if(ct.startsWith('multipart/form-data'))return upload(req,u);
 if(ct.startsWith('application/octet-stream'))return uploadPart(req,u);
 const b=await readBody(req,200000);const action=String(b.action||'');
 const {settings}=await limits(u);
 // ── Folders ──
 if(action==='folder'){
  if(!hasAction(u,'documents','create'))throw new HttpError(403,'Creating folders is not part of your role.');
  const parentId=b.parentId?idOf(b.parentId,'Folder'):null;if(parentId&&!await first('SELECT id FROM folders WHERE id=? AND tenant_id=? AND deleted_at IS NULL',parentId,u.tenantId))throw new HttpError(400,'Parent folder not found.');
  const {acl}=await validateAcl(u,b.acl);const id=uid();const spaceId=b.spaceId?idOf(b.spaceId,'Space'):null;
  await batch([stmt('INSERT INTO folders(id,tenant_id,parent_id,name,department,visibility,acl_json,space_id,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,parentId,str(b.name,'Folder name',120),acl.departments?.[0]||u.department,acl.mode==='company'?'company':acl.mode==='private'?'private':'department',JSON.stringify(acl),spaceId,u.id,now()),auditStatement(u,'Folder created',id,u.department,null,{name:b.name,acl})]);
  return {id};
 }
 if(action==='rename-folder'||action==='move-folder'||action==='delete-folder'){
  const id=idOf(b.id,'Folder');const f=await first<Folder>('SELECT * FROM folders WHERE id=? AND tenant_id=? AND deleted_at IS NULL',id,u.tenantId);if(!f||!canSeeFolder(u,f))throw new HttpError(404,'Folder not found.');
  if(f.created_by!==u.id&&u.role!=='admin')throw new HttpError(403,'Only the folder owner or an administrator can change it.');
  if(action==='rename-folder'){await batch([stmt('UPDATE folders SET name=? WHERE id=? AND tenant_id=?',str(b.name,'Folder name',120),id,u.tenantId),auditStatement(u,'Folder renamed',id,f.department,{name:f.name},{name:b.name})]);return {ok:true}}
  if(action==='move-folder'){const to=b.parentId?idOf(b.parentId,'Folder'):null;for(let cur=to,i=0;cur&&i<50;i++){if(cur===id)throw new HttpError(400,'A folder cannot move inside itself.');cur=(await first<{parent_id:string|null}>('SELECT parent_id FROM folders WHERE id=? AND tenant_id=?',cur,u.tenantId))?.parent_id||null}await batch([stmt('UPDATE folders SET parent_id=? WHERE id=? AND tenant_id=?',to,id,u.tenantId),auditStatement(u,'Folder moved',id,f.department,{parent:f.parent_id},{parent:to})]);return {ok:true}}
  if(await first('SELECT id FROM files WHERE folder_id=? AND tenant_id=? AND deleted_at IS NULL',id,u.tenantId)||await first('SELECT id FROM folders WHERE parent_id=? AND tenant_id=? AND deleted_at IS NULL',id,u.tenantId))throw new HttpError(409,'Empty the folder first.');
  await batch([stmt('UPDATE folders SET deleted_at=? WHERE id=? AND tenant_id=?',now(),id,u.tenantId),auditStatement(u,'Folder deleted',id,f.department,f,null)]);return {ok:true};
 }
 // ── Policies (Company Admins) ──
 if(action==='policy'){
  if(u.role!=='admin')throw new HttpError(403,'Only administrators change file policies.');
  const t=await tenantOf(u);const s=tenantSettings(t);
  const next={...s,fileRetentionDays:Math.max(1,Math.min(3650,Math.round(Number(b.retentionDays??s.fileRetentionDays??30)))),legalHoldEnabled:b.legalHoldEnabled===undefined?!!s.legalHoldEnabled:!!b.legalHoldEnabled,companyWidePublishing:oneOf(b.companyWidePublishing||s.companyWidePublishing||'everyone',['everyone','admins'] as const,'publishing policy')};
  await batch([stmt('UPDATE tenants SET settings_json=? WHERE id=?',JSON.stringify(next),u.tenantId),auditStatement(u,'File policies changed',u.tenantId,'Administration',{retentionDays:s.fileRetentionDays,legalHoldEnabled:s.legalHoldEnabled,companyWidePublishing:s.companyWidePublishing},{retentionDays:next.fileRetentionDays,legalHoldEnabled:next.legalHoldEnabled,companyWidePublishing:next.companyWidePublishing})]);
  return {ok:true};
 }
 if(action==='process-queue'){if(u.role!=='admin')throw new HttpError(403,'Only administrators run the processing queue.');return {processed:await processDueJobs(5,u.tenantId)}}
 // ── Resumable uploads (R2 multipart) ──
 if(action==='upload-init'){
  if(!hasAction(u,'documents','upload'))throw new HttpError(403,'Uploading files is not part of your role.');
  if(!env.BUCKET)throw new HttpError(503,'File storage is unavailable.');
  const name=str(b.name,'File name',200);const ext=(name.split('.').pop()||'').toLowerCase();const mime=types[ext];if(!mime)throw new HttpError(415,'This file type is not allowed.');
  const size=Number(b.size);if(!Number.isFinite(size)||size<=0||size>LARGE_MAX)throw new HttpError(413,'Files can be up to 2 GB.');await storageCheck(u,size);
  const {acl,needsApproval}=await validateAcl(u,b.acl);const id=uid(),key=`${u.tenantId}/files/${id}/v1-${uid()}.${ext}`;
  const mp=await env.BUCKET.createMultipartUpload(key,{httpMetadata:{contentType:mime}});
  await stmt('INSERT INTO uploads(id,tenant_id,member_id,r2_upload_id,file_key,name,mime,bytes,meta_json,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',id,u.tenantId,u.id,mp.uploadId,key,name,mime,size,JSON.stringify({acl,needsApproval,folderId:b.folderId||null,spaceId:b.spaceId||null,tags:str(b.tags,'Tags',300,false),description:str(b.description,'Description',1000,false),links:Array.isArray(b.links)?b.links.slice(0,10):[]}),'open',now(),new Date(Date.now()+7*86400000).toISOString()).run();
  return {uploadId:id,partSize:8*1024*1024};
 }
 if(action==='upload-status'||action==='upload-complete'||action==='upload-abort'){
  const up=await first<{id:string,r2_upload_id:string,file_key:string,name:string,mime:string,bytes:number,parts_json:string,meta_json:string,status:string}>('SELECT * FROM uploads WHERE id=? AND tenant_id=? AND member_id=?',idOf(b.uploadId,'Upload'),u.tenantId,u.id);
  if(!up||up.status!=='open')throw new HttpError(404,'Upload not found or already finished.');
  const parts=parseJson<{partNumber:number,etag:string}[]>(up.parts_json,[]);
  if(action==='upload-status')return {parts:parts.map(p=>p.partNumber)};
  const mp=env.BUCKET!.resumeMultipartUpload(up.file_key,up.r2_upload_id);
  if(action==='upload-abort'){await mp.abort().catch(()=>{});await stmt("UPDATE uploads SET status='aborted' WHERE id=?",up.id).run();return {ok:true}}
  await mp.complete(parts.sort((a,b)=>a.partNumber-b.partNumber));
  const meta=parseJson<{acl:Acl,needsApproval:boolean,folderId:string|null,spaceId:string|null,tags:string,description:string,links:{type:string,id:string}[]}>(up.meta_json,{} as never);
  return createFileRow(u,req,{id:up.id,key:up.file_key,name:up.name,mime:up.mime,bytes:up.bytes,...meta,after:[stmt("UPDATE uploads SET status='done' WHERE id=?",up.id)]});
 }
 // ── Bulk operations ──
 if(action==='bulk'){
  const ids=(Array.isArray(b.ids)?b.ids:[]).map(x=>idOf(x,'File')).slice(0,200);const op=oneOf(b.op,['move','access','delete','restore','links','archive','unarchive'] as const,'bulk operation');
  const results:{id:string,ok:boolean,error?:string,url?:string}[]=[];
  for(const id of ids){try{const r=await single(u,req,{...b,action:op==='links'?'link-url':op,id},settings);results.push({id,ok:true,url:(r as {url?:string}).url})}catch(e){results.push({id,ok:false,error:e instanceof HttpError?e.message:'Failed'})}}
  return {results};
 }
 return single(u,req,b,settings);
},{module:'files'});

async function single(u:Member,req:Request,b:Record<string,unknown>,settings:Record<string,unknown>){
 const action=String(b.action||'');
 const f=await loadFile(u,idOf(b.id,'File'),{deleted:['restore','purge'].includes(action)});
 const acl=fileAcl(f);const owner=f.owner_id||f.uploaded_by;
 // Viewer actions.
 if(action==='favorite'){await stmt(b.on===false?'DELETE FROM file_favorites WHERE tenant_id=? AND member_id=? AND file_id=?':'INSERT OR IGNORE INTO file_favorites(tenant_id,member_id,file_id,id,created_at) VALUES(?,?,?,?,?)',...(b.on===false?[u.tenantId,u.id,f.id]:[u.tenantId,u.id,f.id,uid(),now()])).run();return {ok:true}}
 if(action==='link-url'){if(!canDownload(u,f))throw new HttpError(403,'Downloading files is not part of your role.');const url=await signFileLink({tenantId:u.tenantId,fileId:f.id,version:f.version,memberId:u.id,disposition:b.inline&&inline.has(f.mime)?'inline':'attachment'});await event(u,f.id,'share-link',req).run();return {url,expiresIn:300}}
 if(action==='reprocess'){if(!canManage(u,acl,owner))throw new HttpError(403,'You cannot reprocess this file.');const job=await jobFor(u.tenantId,'file.process',f.id);if(job&&['dead','done','retrying'].includes(job.status))await retryJob(u.tenantId,job.id);else await enqueueStatement(u.tenantId,'file.process',f.id,{},{key:`file:${f.id}:v${f.version}:${Date.now()}`}).run();await stmt("UPDATE files SET processing_status='queued',processing_error='' WHERE id=? AND tenant_id=?",f.id,u.tenantId).run();kick();return {ok:true}}
 if(action==='transcript-edit'){
  if(!canManage(u,acl,owner))throw new HttpError(403,'You cannot edit this transcript.');
  const segs=Array.isArray(b.segments)?b.segments.slice(0,5000).map((s:any)=>({start:Number(s.start)||0,end:Number(s.end)||0,text:str(s.text,'Transcript line',2000,false),speaker:str(s.speaker,'Speaker',60,false)})):null;if(!segs)throw new HttpError(400,'Send the edited transcript.');
  // The machine transcript is kept; each edit is stored as a new version.
  await batch([stmt('INSERT INTO file_artifacts(id,tenant_id,file_id,file_version,kind,content,meta_json,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,f.id,f.version,'transcript_edit',JSON.stringify(segs),JSON.stringify({editedBy:u.name}),u.id,now()),auditStatement(u,'Transcript edited',f.id,f.department,null,{segments:segs.length})]);return {ok:true};
 }
 if(!canEditFile(u,f)&&!(action==='restore'&&owner===u.id))throw new HttpError(403,'You cannot change this file.');
 switch(action){
  case 'update':case 'move':{
   const folderId=b.folderId===undefined?f.folder_id:b.folderId?idOf(b.folderId,'Folder'):null;
   if(folderId&&!await first('SELECT id FROM folders WHERE id=? AND tenant_id=? AND deleted_at IS NULL',folderId,u.tenantId))throw new HttpError(400,'Folder not found.');
   const custom=parseJson<Record<string,unknown>>(f.custom_json,{});const fields=b.custom&&typeof b.custom==='object'?Object.fromEntries(Object.entries(b.custom as Record<string,unknown>).slice(0,30).map(([k,v])=>[k.slice(0,40),str(v,'Custom field',300,false)])):custom.fields;
   const v={name:str(b.name??f.name,'File name',200),description:str(b.description??f.description,'Description',1000,false),tags:str(b.tags??f.tags,'Tags',300,false),category:str(b.category??f.category,'Category',60,false)};
   await batch([stmt('UPDATE files SET name=?,description=?,tags=?,category=?,folder_id=?,custom_json=?,updated_at=? WHERE id=? AND tenant_id=?',v.name,v.description,v.tags,v.category,folderId,JSON.stringify({...custom,fields}),now(),f.id,u.tenantId),auditStatement(u,action==='move'?'File moved':'File details updated',f.id,f.department,{name:f.name,folder:f.folder_id},{...v,folder:folderId}),event(u,f.id,'modify',req)]);return {ok:true};
  }
  case 'access':{
   const {acl:next,needsApproval}=await validateAcl(u,b.acl);const custom=parseJson<Record<string,unknown>>(f.custom_json,{});
   if(needsApproval){await batch([stmt('UPDATE files SET custom_json=? WHERE id=? AND tenant_id=?',JSON.stringify({...custom,pendingAcl:next,pendingBy:u.id}),f.id,u.tenantId),auditStatement(u,'Company-wide sharing requested',f.id,f.department,acl,next)]);await notifyAdminsOfApproval(u,f,req);return {ok:true,pendingApproval:true}}
   await batch([stmt('UPDATE files SET acl_json=?,visibility=?,department=?,custom_json=?,updated_at=? WHERE id=? AND tenant_id=?',JSON.stringify(next),next.mode==='company'?'company':next.mode==='private'?'private':'department',next.departments?.[0]||f.department,JSON.stringify({...custom,pendingAcl:undefined}),now(),f.id,u.tenantId),auditStatement(u,'File visibility changed',f.id,f.department,acl,next),event(u,f.id,'share',req)]);return {ok:true};
  }
  case 'approve-access':case 'reject-access':{
   if(u.role!=='admin')throw new HttpError(403,'Only administrators approve company-wide sharing.');const custom=parseJson<{pendingAcl?:Acl,pendingBy?:string}>(f.custom_json,{});if(!custom.pendingAcl)throw new HttpError(409,'Nothing is waiting for approval.');
   const next=action==='approve-access'?custom.pendingAcl:acl;
   await batch([stmt('UPDATE files SET acl_json=?,visibility=?,custom_json=? WHERE id=? AND tenant_id=?',JSON.stringify(next),next.mode==='company'?'company':f.visibility,JSON.stringify({...custom,pendingAcl:undefined,pendingBy:undefined}),f.id,u.tenantId),auditStatement(u,action==='approve-access'?'Company-wide sharing approved':'Company-wide sharing rejected',f.id,f.department,acl,next)]);
   await notify(u,[custom.pendingBy],{kind:'approval',title:`Sharing “${f.name}” with everyone was ${action==='approve-access'?'approved':'declined'}`,link:`#/files/root/${f.id}`},req);return {ok:true};
  }
  case 'owner':{if(u.role!=='admin')throw new HttpError(403,'Only administrators change ownership.');const to=idOf(b.ownerId,'Person');if(!await first('SELECT id FROM members WHERE id=? AND tenant_id=? AND active=1',to,u.tenantId))throw new HttpError(400,'Choose an active person.');await batch([stmt('UPDATE files SET owner_id=? WHERE id=? AND tenant_id=?',to,f.id,u.tenantId),auditStatement(u,'File owner changed',f.id,f.department,{owner},{owner:to})]);return {ok:true}}
  // Archive keeps the file (and its access) but moves it out of everyday lists; it stays searchable to those who can see it.
  case 'archive':case 'unarchive':{if(!canEditFile(u,f))throw new HttpError(403,'You cannot archive this file.');await batch([stmt('UPDATE files SET archived_at=?,archived_by=? WHERE id=? AND tenant_id=?',action==='archive'?now():null,action==='archive'?u.id:null,f.id,u.tenantId),auditStatement(u,action==='archive'?'File archived':'File unarchived',f.id,f.department,null,null),event(u,f.id,action,req)]);return {ok:true}}
  case 'pin':{await batch([stmt('UPDATE files SET pinned=? WHERE id=? AND tenant_id=?',b.on===false?0:1,f.id,u.tenantId),auditStatement(u,b.on===false?'File unpinned':'File pinned',f.id,f.department,null,null)]);return {ok:true}}
  case 'legal-hold':{if(u.role!=='admin')throw new HttpError(403,'Only administrators place legal holds.');if(!settings.legalHoldEnabled)throw new HttpError(409,'Legal hold is not enabled for this company.');await batch([stmt('UPDATE files SET legal_hold=? WHERE id=? AND tenant_id=?',b.on===false?0:1,f.id,u.tenantId),auditStatement(u,b.on===false?'Legal hold released':'Legal hold placed',f.id,f.department,null,{reason:str(b.reason,'Reason',300,false)})]);return {ok:true}}
  case 'copy':{
   if(!env.BUCKET)throw new HttpError(503,'File storage is unavailable.');await storageCheck(u,f.bytes);const obj=await env.BUCKET.get(f.file_key);if(!obj)throw new HttpError(404,'File content unavailable.');
   const nid=uid(),ext=(f.name.split('.').pop()||'bin').toLowerCase(),key=`${u.tenantId}/files/${nid}/v1-${uid()}.${ext}`;await env.BUCKET.put(key,obj.body,{httpMetadata:{contentType:f.mime}});
   await batch([stmt('INSERT INTO files(id,tenant_id,folder_id,name,mime,bytes,file_key,department,visibility,acl_json,space_id,owner_id,tags,description,category,version,uploaded_by,created_at,updated_at,processing_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)',nid,u.tenantId,b.folderId?idOf(b.folderId,'Folder'):f.folder_id,`Copy of ${f.name}`.slice(0,200),f.mime,f.bytes,key,f.department,f.visibility,f.acl_json||JSON.stringify(acl),f.space_id||null,u.id,f.tags,f.description,f.category||'',u.id,now(),now(),'queued'),enqueueStatement(u.tenantId,'file.process',nid,{},{key:`file:${nid}:v1`}),auditStatement(u,'File copied',nid,f.department,null,{from:f.id})]);kick();return {id:nid};
  }
  case 'restore-version':{
   if(!env.BUCKET)throw new HttpError(503,'File storage is unavailable.');const v=Number(b.version);const old=await first<{file_key:string,bytes:number}>('SELECT file_key,bytes FROM file_versions WHERE tenant_id=? AND file_id=? AND version=?',u.tenantId,f.id,v);if(!old)throw new HttpError(404,'Version not found.');
   const obj=await env.BUCKET.get(old.file_key);if(!obj)throw new HttpError(404,'That version’s content is unavailable.');const ext=(f.name.split('.').pop()||'bin').toLowerCase();const key=`${u.tenantId}/files/${f.id}/v${f.version+1}-${uid()}.${ext}`;await env.BUCKET.put(key,obj.body,{httpMetadata:{contentType:f.mime}});
   const res=await batch([stmt('INSERT INTO file_versions(id,tenant_id,file_id,version,file_key,bytes,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),u.tenantId,f.id,f.version,f.file_key,f.bytes,f.uploaded_by,f.updated_at),stmt("UPDATE files SET file_key=?,bytes=?,version=version+1,updated_at=?,processing_status='queued' WHERE id=? AND tenant_id=? AND version=?",key,old.bytes,now(),f.id,u.tenantId,f.version),enqueueStatement(u.tenantId,'file.process',f.id,{},{key:`file:${f.id}:v${f.version+1}`}),auditStatement(u,`Version ${v} restored as version ${f.version+1}`,f.id,f.department,{version:f.version},{version:f.version+1,from:v})]);
   if(!res[1].meta.changes){await env.BUCKET.delete(key);throw new HttpError(409,'The file changed meanwhile. Refresh and retry.')}kick();return {version:f.version+1};
  }
  case 'link':case 'unlink':{
   const type=oneOf(b.entityType,LINK_TYPES,'record type');const eid=idOf(b.entityId,'Record');
   if(action==='link'){await entityVisible(u,type,eid);await batch([stmt('INSERT OR IGNORE INTO file_links(id,tenant_id,file_id,entity_type,entity_id,created_by,created_at) VALUES(?,?,?,?,?,?,?)',uid(),u.tenantId,f.id,type,eid,u.id,now()),auditStatement(u,'File linked',f.id,f.department,null,{type,id:eid})])}
   else await batch([stmt('DELETE FROM file_links WHERE tenant_id=? AND file_id=? AND entity_type=? AND entity_id=?',u.tenantId,f.id,type,eid),auditStatement(u,'File unlinked',f.id,f.department,{type,id:eid},null)]);
   return {ok:true};
  }
  case 'delete':{
   if(f.legal_hold)throw new HttpError(409,'This file is under legal hold and cannot be deleted.');
   await batch([stmt('UPDATE files SET deleted_at=?,deleted_by=? WHERE id=? AND tenant_id=?',now(),u.id,f.id,u.tenantId),auditStatement(u,'File moved to the recycle bin',f.id,f.department,{name:f.name},null),event(u,f.id,'delete',req)]);return {ok:true};
  }
  case 'restore':{if(!f.deleted_at)return {ok:true};await batch([stmt('UPDATE files SET deleted_at=NULL,deleted_by=NULL WHERE id=? AND tenant_id=?',f.id,u.tenantId),auditStatement(u,'File restored from the recycle bin',f.id,f.department,null,{name:f.name}),event(u,f.id,'restore',req)]);return {ok:true}}
  case 'purge':{
   // Permanent deletion: administrators only, from the recycle bin, never under legal hold, with typed confirmation.
   if(u.role!=='admin')throw new HttpError(403,'Only administrators permanently delete files.');
   if(!f.deleted_at)throw new HttpError(409,'Move the file to the recycle bin first.');if(f.legal_hold)throw new HttpError(409,'This file is under legal hold.');
   if(String(b.confirm||'')!==f.name)throw new HttpError(400,`Type the file name “${f.name}” to confirm.`);
   const versions=await all<{file_key:string}>('SELECT file_key FROM file_versions WHERE tenant_id=? AND file_id=?',u.tenantId,f.id);
   await batch([stmt('DELETE FROM file_versions WHERE tenant_id=? AND file_id=?',u.tenantId,f.id),stmt('DELETE FROM file_artifacts WHERE tenant_id=? AND file_id=?',u.tenantId,f.id),stmt('DELETE FROM file_links WHERE tenant_id=? AND file_id=?',u.tenantId,f.id),stmt('DELETE FROM file_favorites WHERE tenant_id=? AND file_id=?',u.tenantId,f.id),stmt('DELETE FROM knowledge_chunks WHERE tenant_id=? AND source_type=? AND source_id=?',u.tenantId,'file',f.id),stmt('DELETE FROM knowledge_documents WHERE tenant_id=? AND source_type=? AND source_id=?',u.tenantId,'file',f.id),stmt('DELETE FROM files WHERE id=? AND tenant_id=?',f.id,u.tenantId),auditStatement(u,'File permanently deleted',f.id,f.department,{name:f.name,bytes:f.bytes,versions:versions.length+1},null)]);
   if(env.BUCKET)await Promise.allSettled([f.file_key,...versions.map(v=>v.file_key)].filter(k=>k.startsWith(`${u.tenantId}/`)).map(k=>env.BUCKET!.delete(k)));
   return {ok:true};
  }
 }
 throw new HttpError(400,'Unknown action.');
}

async function createFileRow(u:Member,req:Request,o:{id:string,key:string,name:string,mime:string,bytes:number,acl:Acl,needsApproval:boolean,folderId:string|null,spaceId:string|null,tags:string,description:string,links:{type:string,id:string}[],after?:D1PreparedStatement[],entityType?:string|null,entityId?:string|null}){
 // Company-wide sharing by staff under a restricted policy starts at their department and waits for approval.
 const effective:Acl=o.needsApproval?(defaultAcl(u)):o.acl;
 const links=[];for(const l of (o.links||[]).slice(0,10)){const type=oneOf(l.type,LINK_TYPES,'record type');const eid=idOf(l.id,'Record');await entityVisible(u,type,eid);links.push({type,eid})}
 await batch([
  stmt('INSERT INTO files(id,tenant_id,folder_id,name,mime,bytes,file_key,department,visibility,acl_json,space_id,owner_id,tags,description,custom_json,version,uploaded_by,created_at,updated_at,entity_type,entity_id,processing_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?)',o.id,u.tenantId,o.entityType?null:o.folderId,o.name.slice(0,200),o.mime,o.bytes,o.key,effective.departments?.[0]||u.department,effective.mode==='company'?'company':effective.mode==='private'?'private':'department',JSON.stringify(effective),o.spaceId,u.id,o.tags,o.description,JSON.stringify(o.needsApproval?{pendingAcl:o.acl,pendingBy:u.id}:{}),u.id,now(),now(),o.entityType||null,o.entityId||null,'queued'),
  ...links.map(l=>stmt('INSERT OR IGNORE INTO file_links(id,tenant_id,file_id,entity_type,entity_id,created_by,created_at) VALUES(?,?,?,?,?,?,?)',uid(),u.tenantId,o.id,l.type,l.eid,u.id,now())),
  enqueueStatement(u.tenantId,'file.process',o.id,{},{key:`file:${o.id}:v1`}),
  auditStatement(u,'File uploaded',o.id,effective.departments?.[0]||u.department,null,{name:o.name,bytes:o.bytes,acl:effective,requestedAcl:o.needsApproval?o.acl:undefined}),
  ...(o.after||[]),
 ]);
 if(o.needsApproval)await notifyAdminsOfApproval(u,{id:o.id,name:o.name},req);
 kick();
 return {id:o.id,acl:effective,pendingApproval:o.needsApproval};
}
async function upload(req:Request,u:Member){
 if(!hasAction(u,'documents','upload'))throw new HttpError(403,'Uploading files is not part of your role.');
 if(!env.BUCKET)throw new HttpError(503,'File storage is unavailable.');
 if(Number(req.headers.get('Content-Length')||0)>SIMPLE_MAX+200000)throw new HttpError(413,'Files over 25 MB use resumable upload.');
 const fd=await req.formData();const file=fd.get('file');
 if(!(file instanceof File)||!file.size||file.size>SIMPLE_MAX)throw new HttpError(400,'Choose a file of up to 25 MB, or use resumable upload for larger files.');
 const ext=(file.name.split('.').pop()||'').toLowerCase();const mime=types[ext];
 if(!mime)throw new HttpError(415,'This file type is not allowed.');
 await storageCheck(u,file.size);
 const entityType=typeof fd.get('entityType')==='string'&&fd.get('entityType')?oneOf(fd.get('entityType'),['ticket','asset','PR','PO','page','work_order'] as const,'attachment target'):null;
 const entityId=entityType?idOf(fd.get('entityId'),'Record'):null;
 if(entityType&&entityId)await visibleEntity(u,entityType,entityId);
 const replace=fd.get('replaceId');
 if(typeof replace==='string'&&replace){
  const f=await loadFile(u,idOf(replace,'File'));if(!canEditFile(u,f))throw new HttpError(403,'You cannot add versions to this file.');
  const key=`${u.tenantId}/files/${f.id}/v${f.version+1}-${uid()}.${ext}`;await env.BUCKET.put(key,file.stream(),{httpMetadata:{contentType:mime}});
  const res=await batch([stmt('INSERT INTO file_versions(id,tenant_id,file_id,version,file_key,bytes,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),u.tenantId,f.id,f.version,f.file_key,f.bytes,f.uploaded_by,f.updated_at),stmt("UPDATE files SET file_key=?,bytes=?,mime=?,version=version+1,updated_at=?,processing_status='queued',processing_error='' WHERE id=? AND tenant_id=? AND version=?",key,file.size,mime,now(),f.id,u.tenantId,f.version),enqueueStatement(u.tenantId,'file.process',f.id,{},{key:`file:${f.id}:v${f.version+1}`}),auditStatement(u,`New version uploaded (v${f.version+1})`,f.id,f.department,{version:f.version},{version:f.version+1,bytes:file.size}),event(u,f.id,'modify',req)]);
  if(!res[1].meta.changes){await env.BUCKET.delete(key);throw new HttpError(409,'Another version was uploaded at the same time. Refresh and retry.')}
  kick();return {id:f.id,version:f.version+1};
 }
 const folderId=typeof fd.get('folderId')==='string'&&fd.get('folderId')?idOf(fd.get('folderId'),'Folder'):null;
 if(folderId&&!await first('SELECT id FROM folders WHERE id=? AND tenant_id=? AND deleted_at IS NULL',folderId,u.tenantId))throw new HttpError(400,'Folder not found.');
 const spaceId=typeof fd.get('spaceId')==='string'&&fd.get('spaceId')?idOf(fd.get('spaceId'),'Space'):null;
 // Audience: sent as JSON; defaults to the uploader's department (or private without a department).
 const aclInput=typeof fd.get('acl')==='string'&&fd.get('acl')?parseJson(String(fd.get('acl')),null):undefined;
 const {acl,needsApproval}=entityType?{acl:defaultAcl(u),needsApproval:false}:await validateAcl(u,aclInput??undefined);
 const links=typeof fd.get('links')==='string'?parseJson<{type:string,id:string}[]>(String(fd.get('links')),[]):[];
 const id=uid(),key=`${u.tenantId}/files/${id}/v1-${uid()}.${ext}`;
 await env.BUCKET.put(key,file.stream(),{httpMetadata:{contentType:mime}});
 try{return await createFileRow(u,req,{id,key,name:file.name,mime,bytes:file.size,acl,needsApproval,folderId,spaceId,tags:str(fd.get('tags'),'Tags',300,false),description:str(fd.get('description'),'Description',1000,false),links,entityType,entityId})}
 catch(e){await env.BUCKET.delete(key).catch(()=>{});throw e}
}
// Resumable upload part: PUT-style binary body with ?upload=<id>&part=<n>.
async function uploadPart(req:Request,u:Member){
 const url=new URL(req.url);const up=await first<{id:string,r2_upload_id:string,file_key:string,parts_json:string,status:string}>('SELECT * FROM uploads WHERE id=? AND tenant_id=? AND member_id=?',idOf(url.searchParams.get('upload'),'Upload'),u.tenantId,u.id);
 if(!up||up.status!=='open')throw new HttpError(404,'Upload not found or already finished.');
 const n=Number(url.searchParams.get('part'));if(!Number.isInteger(n)||n<1||n>10000)throw new HttpError(400,'Invalid part number.');
 if(Number(req.headers.get('Content-Length')||0)>9*1024*1024)throw new HttpError(413,'Parts are limited to 9 MB.');
 const mp=env.BUCKET!.resumeMultipartUpload(up.file_key,up.r2_upload_id);
 const part=await mp.uploadPart(n,await req.arrayBuffer());
 // Record the part; a retried part replaces the earlier attempt.
 const parts=parseJson<{partNumber:number,etag:string}[]>(up.parts_json,[]).filter(p=>p.partNumber!==n);parts.push({partNumber:part.partNumber,etag:part.etag});
 await stmt('UPDATE uploads SET parts_json=? WHERE id=?',JSON.stringify(parts),up.id).run();
 return {part:n};
}
