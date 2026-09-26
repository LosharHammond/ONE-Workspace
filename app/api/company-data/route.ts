import {hasAction} from '../../access-policy';
import {requireUser,db,json,failure,HttpError} from '../../server/core';
// Raw exports may include HR, pricing and contact data: administrator-only.
export async function GET(req:Request){try{
 const user=await requireUser(req);if(!hasAction(user,'company-data'))throw new HttpError(403,'Company source data requires administrator access.');
 const url=new URL(req.url),batch=url.searchParams.get('batch'),id=url.searchParams.get('id');
 if(id){const row=await db().prepare('SELECT r.*,b.dataset,b.source,b.imported_at FROM source_rows r JOIN import_batches b ON b.id=r.batch_id WHERE r.id=? AND b.tenant_id=?').bind(id,user.tenantId).first();if(!row)throw new HttpError(404,'Source record not found.');const links=await db().prepare('SELECT l.kind,r.id,r.source_key,b.dataset FROM links l JOIN source_rows r ON r.id=CASE WHEN l.from_id=? THEN l.to_id ELSE l.from_id END JOIN import_batches b ON b.id=r.batch_id WHERE (l.from_id=? OR l.to_id=?) AND b.tenant_id=?').bind(id,id,id,user.tenantId).all();return json({row,links:links.results})}
 if(!batch){const batches=await db().prepare('SELECT * FROM import_batches WHERE tenant_id=? ORDER BY dataset,imported_at DESC').bind(user.tenantId).all();return json({batches:batches.results})}
 const q=(url.searchParams.get('q')||'').slice(0,120),page=Math.max(0,Math.min(100000,Number(url.searchParams.get('page'))||0));
 const where='batch_id=(SELECT id FROM import_batches WHERE id=? AND tenant_id=?) AND (?=\'\' OR instr(lower(payload_json),lower(?))>0)';
 const rows=await db().prepare(`SELECT id,source_key,sheet,row_number,payload_json FROM source_rows WHERE ${where} ORDER BY row_number LIMIT 50 OFFSET ?`).bind(batch,user.tenantId,q,q,Math.floor(page)*50).all();
 const total=await db().prepare(`SELECT count(*) AS count FROM source_rows WHERE ${where}`).bind(batch,user.tenantId,q,q).first();
 return json({rows:rows.results,total:total?.count||0,page:Math.floor(page),pageSize:50});
 }catch(e){return failure(e)}}
