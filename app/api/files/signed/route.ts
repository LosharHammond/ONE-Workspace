import {env} from 'cloudflare:workers';
import {first,failure,HttpError,currentUser,stmt,uid,now,clientIp} from '../../../server/core';
import {verifyFileLink} from '../../../server/signed';
// Short-lived signed file links (issued by /api/files after the normal access check). If the browser has a
// session, it must be the same person the link was issued to. Deleted files and replaced versions stop working.
export async function GET(req:Request){try{
 const url=new URL(req.url);const l=await verifyFileLink(url.searchParams.get('t')||'',url.searchParams.get('s')||'');
 const u=await currentUser(req).catch(()=>null);if(u&&u.id!==l.memberId)throw new HttpError(403,'This link was issued to someone else.');
 const f=await first<{id:string,name:string,mime:string,file_key:string,version:number,deleted_at:string|null}>('SELECT id,name,mime,file_key,version,deleted_at FROM files WHERE id=? AND tenant_id=?',l.fileId,l.tenantId);
 if(!f||f.deleted_at||f.version!==l.version||!f.file_key.startsWith(`${l.tenantId}/`))throw new HttpError(404,'File not found.');
 if(!env.BUCKET)throw new HttpError(503,'File storage is unavailable.');const obj=await env.BUCKET.get(f.file_key);if(!obj)throw new HttpError(404,'File content unavailable.');
 await stmt('INSERT INTO file_events(id,tenant_id,file_id,member_id,action,ip,created_at) VALUES(?,?,?,?,?,?,?)',uid(),l.tenantId,f.id,l.memberId,'download-link',clientIp(req),now()).run();
 const inline=l.disposition==='inline';
 return new Response(obj.body,{headers:{'Content-Type':inline?f.mime:'application/octet-stream','Content-Disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; img-src 'self'; media-src 'self'; sandbox",'Referrer-Policy':'no-referrer'}});
}catch(e){return failure(e)}}
