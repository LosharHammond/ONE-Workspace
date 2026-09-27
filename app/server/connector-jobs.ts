import {stmt,batch,now,run} from './core';
import {registerJob} from './jobs';
import {loadConnector,typeOf,configOf,outbound,authHeaders,oauthUrls,mcpDiscover,markHealth,logStatement,type ConnectorRow} from './connectors';
import {safeUrl} from './secrets';
import {enqueueStatement} from './jobs';

// Scheduled connector synchronization. Each run checks the connection (and for MCP servers refreshes tools),
// records the result, and queues the next run. Failures retry with backoff; after the last attempt the job is
// dead-lettered and the connector shows as failing until someone retries it.
registerJob('connector.sync',async job=>{
 const c:ConnectorRow=await loadConnector(job.tenant_id,job.ref_id).catch(()=>null as never);
 if(!c||c.status==='disabled'||c.paused)return;
 const t=typeOf(c);const started=Date.now();
 if(t.auth==='mcp'){const d=await mcpDiscover(c);await run('UPDATE connectors SET tools_json=?,resources_json=? WHERE id=? AND tenant_id=?',JSON.stringify(d.tools),JSON.stringify(d.resources),c.id,c.tenant_id)}
 else if(t.auth!=='webhook'){const url=t.auth==='oauth2'?oauthUrls(c,t).test:`${safeUrl(configOf(c).baseUrl,'Base URL')}${configOf(c).testPath||''}`;const r=await outbound(c,url,{method:'GET',retry:true,headers:{Accept:'application/json',...await authHeaders(c)}});if(!r.ok)throw new Error(`${c.name} answered ${r.status}.`)}
 await markHealth(c,true);
 const next=c.sync_minutes>0?new Date(Date.now()+c.sync_minutes*60000).toISOString():null;
 await batch([stmt('UPDATE connectors SET last_sync_at=?,next_sync_at=? WHERE id=? AND tenant_id=?',now(),next,c.id,c.tenant_id),logStatement(c,'scheduler','sync','ok',Date.now()-started,{attempt:job.attempts}),...(next?[enqueueStatement(c.tenant_id,'connector.sync',c.id,{},{key:`sync:${c.id}:${next}`,delaySec:c.sync_minutes*60,maxAttempts:5})]:[])]);
});
registerJob('connector.sync:failed',async job=>{
 const c=await loadConnector(job.tenant_id,job.ref_id).catch(()=>null);if(!c)return;
 await markHealth(c,false,job.status==='dead'?`Sync failed ${job.attempts} times: ${job.last_error}`:job.last_error);
 await logStatement(c,'scheduler','sync','error',0,{error:job.last_error.slice(0,200),deadLetter:job.status==='dead'}).run();
});
