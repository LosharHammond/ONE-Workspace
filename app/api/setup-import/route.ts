import {env} from 'cloudflare:workers';
import {db,json,failure,HttpError,hash} from '../../server/core';
import {equal} from '../../server/passwords';
// Source-archive tables only. People are created through invitations, never with imported password hashes.
const tables:Record<string,string[]>={import_batches:['id','source','dataset','filename','sha256','imported_at','row_count','headers_json'],source_rows:['id','batch_id','source_key','sheet','row_number','payload_json'],links:['from_id','to_id','kind'],quality_issues:['id','batch_id','kind','detail_json']};
export async function POST(req:Request){try{
 if(!env.DATA_IMPORT_TOKEN||!equal(await hash(req.headers.get('Authorization')||''),await hash('Bearer '+env.DATA_IMPORT_TOKEN)))throw new HttpError(404,'Not found.');
 if(await db().prepare("SELECT id FROM audit WHERE id='initial-import-closed'").first())throw new HttpError(403,'Initial import is closed.');
 const raw=await req.text();if(raw.length>1000000)throw new HttpError(413,'Import chunk is too large.');const body=JSON.parse(raw) as {close?:boolean,table?:string,rows?:unknown[][]};
 if(body.close){await db().prepare("INSERT INTO audit(id,action,actor,record_id,department,created_at) VALUES('initial-import-closed','Initial company data imported','setup','setup','',?)").bind(new Date().toISOString()).run();return json({closed:true})}
 const columns=tables[body.table||''];if(!columns||!Array.isArray(body.rows)||body.rows.length>50||body.rows.some(r=>!Array.isArray(r)||r.length!==columns.length||r.some(v=>v!==null&&typeof v!=='string'&&typeof v!=='number')))throw new HttpError(400,'Invalid import chunk.');
 const statements=body.rows.map(row=>db().prepare(`INSERT OR IGNORE INTO ${body.table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).bind(...row));if(statements.length)await db().batch(statements);return json({imported:statements.length});
 }catch(e){return failure(e)}}
