import {waitUntil} from 'cloudflare:workers';
import {all,first,stmt,run,uid,now} from './core';
import {resolveType,syncNode} from './graph';

// Domain events. Every audited change writes an 'audit' event in the same transaction (a database trigger on
// the audit table: a transactional outbox), and modules may emit explicit events with emitStatement(). The
// processor claims pending events and projects the changed record into the Work Graph. Consumers report
// completion explicitly; a matching automation without an executor is marked deferred, never falsely done.
export type DomainEvent={id:string,tenant_id:string,type:string,entity_id:string,action:string,actor:string,payload_json:string,status:string,attempts:number,error:string,created_at:string};
export type ConsumerResult={status:'complete'|'deferred',reason?:string};
export function emitStatement(tenantId:string,type:string,entityId:string,payload:Record<string,unknown>={},actor='system',action=''){
 return stmt("INSERT INTO domain_events(id,tenant_id,type,entity_id,action,actor,payload_json,status,attempts,error,created_at) VALUES(?,?,?,?,?,?,?,'pending',0,'',?)",uid(),tenantId,type,entityId,action,actor,JSON.stringify(payload),now());
}
export async function processEvents(limit=40,tenantId?:string){
 const ts=now(),lease=new Date(Date.now()+5*60_000).toISOString();let done=0;
 // A worker can disappear after claiming an event. Treat processing rows as leased so another request
 // can recover them after five minutes instead of leaving them stuck forever.
 const rows=await all<DomainEvent>(`SELECT * FROM domain_events WHERE (status='pending' OR (status IN ('retrying','processing') AND coalesce(processed_at,'')<=?))${tenantId?' AND tenant_id=?':''} ORDER BY created_at LIMIT ?`,...[ts,...(tenantId?[tenantId]:[]),limit]);
 for(const e of rows){
  const claim=await run("UPDATE domain_events SET status='processing',attempts=attempts+1,processed_at=? WHERE id=? AND (status='pending' OR (status IN ('retrying','processing') AND coalesce(processed_at,'')<=?))",lease,e.id,ts);
  if(!claim.meta.changes)continue;
  try{
   const payload=JSON.parse(e.payload_json||'{}') as Record<string,unknown>;
   let entityType=typeof payload.type==='string'?payload.type:null;
   if(e.type==='audit'||e.type==='project'){entityType=entityType||await resolveType(e.tenant_id,e.entity_id);if(entityType)await syncNode(e.tenant_id,entityType,e.entity_id)}
   else if(e.entity_id&&entityType)await syncNode(e.tenant_id,entityType,e.entity_id);
   const deferred:string[]=[];
   if(e.type!=='project'){
    const {onDomainEvent}=await import('./studio');const studio=await onDomainEvent(e,entityType,payload);if(studio.status==='deferred')deferred.push(studio.reason||'Studio consumer deferred.');
    const agents=await import('./agents');const agent=await agents.onDomainEvent(e,entityType);if(agent.status==='deferred')deferred.push(agent.reason||'Agent consumer deferred.');
   }
   await run("UPDATE domain_events SET status=?,processed_at=?,error=? WHERE id=?",deferred.length?'deferred':'done',now(),deferred.join('; ').slice(0,300),e.id);done++;
  }catch(err){
   const msg=(err instanceof Error?err.message:'Failed').slice(0,300);const dead=e.attempts+1>=5;
   await run('UPDATE domain_events SET status=?,error=?,processed_at=? WHERE id=?',dead?'failed':'retrying',msg,new Date(Date.now()+Math.min(3600,20*2**(e.attempts+1))*1000).toISOString(),e.id);
  }
 }
 return done;
}
// Runs pending events after the response (writes call this), without delaying the request.
export function kickEvents(){try{waitUntil(processEvents(25).catch(e=>console.error('One Workspace events failed',e instanceof Error?e.message:'error')))}catch{/* outside a request */}}
export async function retryEvent(tenantId:string,id:string){return run("UPDATE domain_events SET status='pending',attempts=0,error='',processed_at=NULL WHERE id=? AND tenant_id=? AND status IN ('failed','retrying','deferred')",id,tenantId)}
export async function eventStats(tenantId:string){return first<{pending:number,failed:number,deferred:number,done:number}>("SELECT sum(status IN ('pending','processing','retrying')) AS pending,sum(status='failed') AS failed,sum(status='deferred') AS deferred,sum(status='done') AS done FROM domain_events WHERE tenant_id=?",tenantId)}
