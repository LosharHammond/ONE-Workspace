import {first,stmt,json,HttpError,failure,now} from '../../server/core';
import {openSecret} from '../../server/secrets';
import {logStatement,type ConnectorRow} from '../../server/connectors';
import {rateLimit} from '../../server/auth';
// Incoming webhooks: POST /api/hooks?id=<connector id>
// Headers: X-OneWorkspace-Timestamp (unix seconds) and X-OneWorkspace-Signature: sha256=<hex HMAC-SHA256 of "timestamp.body">.
// Events older than 5 minutes are refused (replay protection). Payloads are untrusted: only a short, size-limited
// excerpt is kept in the connector log; nothing in them is executed or treated as an instruction.
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
function equal(a:string,b:string){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
export async function POST(req:Request){try{
 const id=new URL(req.url).searchParams.get('id')||'';if(!/^[A-Za-z0-9-]{8,80}$/.test(id))throw new HttpError(404,'Not found.');
 const c=await first<ConnectorRow>("SELECT * FROM connectors WHERE id=? AND provider='webhook' AND status!='disabled'",id);if(!c||!c.webhook_secret_enc)throw new HttpError(404,'Not found.');
 await rateLimit(`webhook:${c.id}`,'in',300,60000).catch(()=>{throw new HttpError(429,'Too many events.')});
 const body=await req.text();if(body.length>256000)throw new HttpError(413,'Payload too large.');
 const ts=req.headers.get('X-OneWorkspace-Timestamp')||'',sig=(req.headers.get('X-OneWorkspace-Signature')||'').replace(/^sha256=/,'');
 const fresh=/^\d{9,11}$/.test(ts)&&Math.abs(Date.now()/1000-Number(ts))<=300;
 const secret=await openSecret(c.tenant_id,`${c.id}:webhook`,c.webhook_secret_enc);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const expected=hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(`${ts}.${body}`)));
 if(!fresh||!equal(expected,sig.toLowerCase())){await logStatement(c,'webhook','webhook.received','denied',0,{reason:fresh?'bad signature':'stale or missing timestamp'}).run();throw new HttpError(401,'Invalid signature.')}
 let event='';try{const d=JSON.parse(body);event=String(d?.event||d?.type||'').slice(0,60)}catch{/* not JSON */}
 await stmt("UPDATE connectors SET last_sync_at=?,health='healthy' WHERE id=?",now(),c.id).run();
 await logStatement(c,'webhook','webhook.received','ok',0,{event,bytes:body.length,excerpt:body.slice(0,300),untrusted:true}).run();
 // Synced mode: each delivery becomes an event record (idempotent per delivery id or body hash), a Work Graph
 // node with lineage, and a domain event that Studio automations can trigger on ("webhook received").
 const delivery=(req.headers.get('X-OneWorkspace-Delivery')||'').slice(0,100)||[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ts+body)))].slice(0,12).map(x=>x.toString(16).padStart(2,'0')).join('');
 const rid=crypto.randomUUID();const t=now();
 const ins=await stmt("INSERT INTO connector_records(id,tenant_id,connector_id,source_id,kind,title,body,url,source_updated_at,permissions_json,content_hash,deleted_at,last_verified_at,synced_at) VALUES(?,?,?,?,'event',?,?,'',?,'{\"connector\":\"enabled-people\"}',?,NULL,?,?) ON CONFLICT(tenant_id,connector_id,source_id) DO NOTHING",rid,c.tenant_id,c.id,`events:${delivery}`,(event||'Webhook event').slice(0,200),body.slice(0,2000),t,delivery,t,t).run();
 if(ins.meta.changes)await stmt("INSERT INTO domain_events(id,tenant_id,type,entity_id,action,actor,payload_json,status,attempts,error,created_at) VALUES(?,?,'connector.webhook',?,?,?,?,'pending',0,'',?)",crypto.randomUUID(),c.tenant_id,rid,'webhook received','webhook',JSON.stringify({type:'external',connectorId:c.id,event,title:event||'Webhook event'}),t).run();
 return json({ok:true});
}catch(e){return failure(e)}}
