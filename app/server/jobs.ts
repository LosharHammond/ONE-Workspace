import {waitUntil} from 'cloudflare:workers';
import {all,first,stmt,run,uid,now} from './core';

// Background jobs stored in D1. Work is queued inside the request's own batch (so a job exists exactly when
// its record does), then started after the response with waitUntil. Jobs are locked while running, retried
// with exponential backoff, and moved to a dead-letter state ("dead") after max_attempts. Idempotency keys
// make re-queuing the same work a no-op. `processDueJobs` can also be called from a Cron Trigger or by an
// administrator ("Retry") so nothing depends on a single request.
export type JobRow={id:string,tenant_id:string,kind:string,ref_id:string,status:string,stage:string,attempts:number,max_attempts:number,run_after:string,payload_json:string,last_error:string};
type Handler=(job:JobRow,progress:(stage:string)=>Promise<void>)=>Promise<void>;
const handlers=new Map<string,Handler>();
export function registerJob(kind:string,h:Handler){handlers.set(kind,h)}
export function enqueueStatement(tenantId:string,kind:string,refId:string,payload:unknown={},o:{key?:string,delaySec?:number,maxAttempts?:number}={}){
 const ts=now();const runAfter=new Date(Date.now()+(o.delaySec||0)*1000).toISOString();
 return stmt('INSERT INTO jobs(id,tenant_id,kind,ref_id,status,attempts,max_attempts,run_after,payload_json,idempotency_key,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?,?,?,?,?) ON CONFLICT(tenant_id,idempotency_key) DO NOTHING',uid(),tenantId,kind,refId,'queued',o.maxAttempts||3,runAfter,JSON.stringify(payload),o.key||null,ts,ts);
}
// Starts processing after the current response without delaying it.
export function kick(limit=3){try{waitUntil(processDueJobs(limit).catch(e=>console.error('One Workspace jobs failed',e instanceof Error?e.name:'error')))}catch{/* outside a request (tests) */}}
export async function processDueJobs(limit=3,tenantId?:string){
 await import('./job-handlers');
 const ts=now();let done=0;
 const due=await all<JobRow>(`SELECT * FROM jobs WHERE status IN ('queued','retrying') AND run_after<=? AND (locked_until IS NULL OR locked_until<?)${tenantId?' AND tenant_id=?':''} ORDER BY run_after LIMIT ?`,...[ts,ts,...(tenantId?[tenantId]:[]),limit]);
 for(const j of due){
  // Claim the job; another worker that claimed it first wins.
  const claim=await run("UPDATE jobs SET status='running',locked_until=?,attempts=attempts+1,updated_at=? WHERE id=? AND status IN ('queued','retrying') AND (locked_until IS NULL OR locked_until<?)",new Date(Date.now()+10*60000).toISOString(),ts,j.id,ts);
  if(!claim.meta.changes)continue;
  const h=handlers.get(j.kind);
  try{
   if(!h)throw new Error(`No handler for ${j.kind}`);
   await h({...j,attempts:j.attempts+1},async stage=>{await run('UPDATE jobs SET stage=?,updated_at=? WHERE id=?',stage,now(),j.id)});
   await run("UPDATE jobs SET status='done',stage='done',locked_until=NULL,last_error='',updated_at=? WHERE id=?",now(),j.id);done++;
  }catch(e){
   const msg=(e instanceof Error?e.message:'Failed').slice(0,300);const attempts=j.attempts+1;
   const dead=attempts>=j.max_attempts;
   await run('UPDATE jobs SET status=?,locked_until=NULL,last_error=?,run_after=?,updated_at=? WHERE id=?',dead?'dead':'retrying',msg,new Date(Date.now()+Math.min(3600,30*2**attempts)*1000).toISOString(),now(),j.id);
   const onFail=handlers.get(`${j.kind}:failed`);if(onFail)await onFail({...j,attempts,last_error:msg,status:dead?'dead':'retrying'},async()=>{}).catch(()=>{});
  }
 }
 return done;
}
export async function jobFor(tenantId:string,kind:string,refId:string){return first<JobRow>('SELECT * FROM jobs WHERE tenant_id=? AND kind=? AND ref_id=? ORDER BY created_at DESC LIMIT 1',tenantId,kind,refId)}
export async function retryJob(tenantId:string,id:string){return run("UPDATE jobs SET status='queued',run_after=?,attempts=0,last_error='',updated_at=? WHERE id=? AND tenant_id=? AND status IN ('dead','retrying','done')",now(),now(),id,tenantId)}
// Keeps scheduled work moving while the app is in use (no Cron Trigger needed): at most every 30 seconds per
// server instance, a request starts the runner in the background.
let lastSweep=0;
export function maybeKick(){if(Date.now()-lastSweep<30000)return;lastSweep=Date.now();kick(3)}
