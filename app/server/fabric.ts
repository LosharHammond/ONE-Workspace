import {hasAction} from '../access-policy';
import {connectorTypeById,type ConnectorType} from '../connector-catalog';
import {grantedCapabilities} from '../connector-capabilities';
import {all,first,stmt,batch,run,uid,now,HttpError,parseJson} from './core';
import {loadConnector,typeOf,configOf,outbound,authHeaders,apiBase,mcpCall,mcpReadResource,markHealth,logStatement,canUseConnector,type ConnectorRow} from './connectors';
import {enqueueStatement,registerJob,kick} from './jobs';
import {safeUrl} from './secrets';
import type {Member} from './policy';

// ── Three-mode Connector Fabric ─────────────────────────────────────────────
// Synced: authorised external records copied into this workspace's own index (connector_records) with source
//   ids, timestamps, permission mapping, checkpoints, deletion propagation and Work Graph lineage.
// Federated: live reads at query time, permission-checked, never stored, returned with citations.
// Action: explicit, validated operations with idempotency keys, confirmation gates, verification and audit.
// External content is always untrusted: it is data for people and models, never instructions.
export type Mode='synced'|'federated'|'action';
export type Resource={id:string,label:string,modes:Mode[],description:string,schema:string[],requires?:string};
export type ActionInput={key:string,label:string,type:'text'|'textarea'|'email'|'emails'|'datetime'|'json',required?:boolean};
export type ActionDef={id:string,label:string,description:string,risk:'low'|'medium'|'high',confirm:boolean,requires?:string,input:ActionInput[],verify:string,recovery:string};
export type Manifest={id:string,name:string,provider:string,description:string,version:string,modes:Mode[],auth:string,requiredScopes:string[],resources:Resource[],actions:ActionDef[],triggers:string[],schemas:Record<string,string[]>,rateLimit:{perMinute:number,perDay:number|null},webhook:boolean,config:string[],secretFields:string[],healthCheck:string,permissions:string[],aiTools:string[],studioWidgets:string[],unsupported:string[]};
const MAIL:Resource={id:'mail',label:'Email messages',modes:['synced','federated'],description:'Inbox messages (subject, sender, preview).',schema:['subject','from','receivedAt','preview'],requires:'mail.read'};
const EVENTS:Resource={id:'events',label:'Calendar events',modes:['synced','federated'],description:'Meetings in the next 30 days.',schema:['subject','start','end','location','organizer'],requires:'calendar.read'};
const CONTACTS:Resource={id:'contacts',label:'Contacts',modes:['federated'],description:'Address book contacts (live only).',schema:['name','email','company'],requires:'contacts.read'};
const DRIVE:Resource={id:'files',label:'Files',modes:['synced','federated'],description:'Document names, types and links.',schema:['name','mimeType','modifiedTime','webLink'],requires:'files.read'};
const act=(id:string,label:string,description:string,risk:ActionDef['risk'],requires:string,input:ActionInput[],verify:string,recovery:string):ActionDef=>({id,label,description,risk,confirm:risk!=='low',requires,input,verify,recovery});
export function manifestFor(c:ConnectorRow|null,t:ConnectorType):Manifest{
 const cfg=c?configOf(c):{} as Record<string,string>;const base={id:t.id,name:t.name,provider:t.family||t.id,description:t.description,version:'1.0',auth:t.auth,requiredScopes:t.oauth?.scopes||[],triggers:[] as string[],rateLimit:{perMinute:120,perDay:c&&(c as ConnectorRow&{daily_call_limit?:number}).daily_call_limit?(c as ConnectorRow&{daily_call_limit:number}).daily_call_limit:null},webhook:false,config:t.config.map(f=>f.key),secretFields:t.secrets.map(f=>f.key),healthCheck:t.oauth?.test||'GET test path',permissions:['connectors.use_connectors (people)','connectors.configure (administrators)'],unsupported:[] as string[]};
 if(t.family==='microsoft'){
  const res=t.id==='onedrive'||t.id==='sharepoint'||t.id==='excel'?[DRIVE]:t.id==='outlook'||t.id==='microsoft365'?[MAIL,EVENTS,CONTACTS]:[];
  const actions=t.id==='outlook'||t.id==='microsoft365'?[act('create_draft','Create an email draft','Saves a draft in the mailbox; nothing is sent.','low','mail.draft',[{key:'to',label:'To',type:'emails',required:true},{key:'subject',label:'Subject',type:'text',required:true},{key:'body',label:'Message',type:'textarea'}],'Reads the draft back by id.','Delete the draft in Outlook.'),act('send_mail','Send an email','Sends from the connected mailbox.','high','mail.send',[{key:'to',label:'To',type:'emails',required:true},{key:'subject',label:'Subject',type:'text',required:true},{key:'body',label:'Message',type:'textarea'}],'Graph returns 202 Accepted; the message appears in Sent Items.','Sent email cannot be recalled reliably; send a correction.'),act('create_event','Create a calendar event','Creates a meeting and invites attendees.','medium','calendar.write',[{key:'subject',label:'Subject',type:'text',required:true},{key:'start',label:'Start',type:'datetime',required:true},{key:'end',label:'End',type:'datetime',required:true},{key:'attendees',label:'Attendees',type:'emails'},{key:'location',label:'Location',type:'text'}],'Reads the event back by id.','Cancel the meeting in Outlook (attendees are notified).')]:[];
  return {...base,modes:[...new Set(res.flatMap(r=>r.modes)),...(actions.length?['action' as Mode]:[])],resources:res,actions,schemas:Object.fromEntries(res.map(r=>[r.id,r.schema])),aiTools:['connector.search','connector.read',...(actions.length?['connector.action']:[])],studioWidgets:['connector'],unsupported:['Teams messages','SharePoint uploads','mail rules and deletion from automations']};
 }
 if(t.family==='google'){
  const res=t.id==='google-drive'?[DRIVE]:t.id==='google-calendar'?[EVENTS]:t.id==='gmail'?[{...MAIL,modes:['federated'] as Mode[]}]:[];
  const actions=t.id==='google-calendar'?[act('create_event','Create a Google Calendar event','Creates an event on the primary calendar.','medium','calendar.write',[{key:'subject',label:'Title',type:'text',required:true},{key:'start',label:'Start',type:'datetime',required:true},{key:'end',label:'End',type:'datetime',required:true},{key:'attendees',label:'Attendees',type:'emails'}],'Reads the event back by id.','Delete the event in Google Calendar.')]:t.id==='gmail'?[act('create_draft','Create a Gmail draft','Saves a draft; nothing is sent.','low','mail.draft',[{key:'to',label:'To',type:'emails',required:true},{key:'subject',label:'Subject',type:'text',required:true},{key:'body',label:'Message',type:'textarea'}],'Draft id returned by Gmail.','Delete the draft in Gmail.')]:[];
  return {...base,modes:[...new Set(res.flatMap(r=>r.modes)),...(actions.length?['action' as Mode]:[])],resources:res,actions,schemas:Object.fromEntries(res.map(r=>[r.id,r.schema])),aiTools:['connector.search','connector.read',...(actions.length?['connector.action']:[])],studioWidgets:['connector'],unsupported:['Drive uploads','Gmail sending (drafts only)']};
 }
 if(t.auth==='mcp'){
  const tools=parseJson<{name:string,description:string}[]>(c?.tools_json,[]),mutating=parseJson<string[]>(c?.mutating_tools_json,[]),allowed=parseJson<string[]>(c?.allowed_tools_json,[]);const resources=parseJson<{uri:string,name:string}[]>(c?.resources_json,[]);
  return {...base,modes:['synced','federated','action'],resources:[{id:'resources',label:'MCP resources',modes:['synced','federated'],description:`${resources.length} resources discovered.`,schema:['uri','name','text']},...tools.filter(x=>allowed.includes(x.name)&&!mutating.includes(x.name)).map(x=>({id:`tool:${x.name}`,label:x.name,modes:['federated'] as Mode[],description:x.description,schema:['text']}))],actions:tools.filter(x=>allowed.includes(x.name)&&mutating.includes(x.name)).map(x=>({id:`tool:${x.name}`,label:x.name,description:x.description,risk:'high' as const,confirm:true,input:[{key:'arguments',label:'Arguments (JSON)',type:'json' as const}],verify:'The MCP server’s result is recorded.',recovery:'Depends on the server; reverse the change there.'})),schemas:{resources:['uri','name','text']},aiTools:['connector.read','connector.action'],studioWidgets:['connector'],unsupported:['Sampling and prompts','Tools that are not allowed by an administrator']};
 }
 if(t.id==='webhook')return {...base,modes:['synced'],resources:[{id:'events',label:'Received events',modes:['synced'],description:'Signed events delivered to the webhook URL.',schema:['event','receivedAt','excerpt']}],actions:[],triggers:['webhook_received'],webhook:true,schemas:{events:['event','receivedAt','excerpt']},aiTools:['connector.read'],studioWidgets:['connector'],unsupported:['Outgoing calls (use a REST connector action)']};
 // Generic REST / OAuth / database / storage / custom services: resources and actions are configured.
 const resources=parseJson<{id:string,label:string,path:string,idField?:string,titleField?:string,updatedField?:string,urlField?:string,listField?:string}[]>(cfg.resources,[]);
 const actions=parseJson<{id:string,label:string,method:string,path:string,risk?:string,fields?:string[]}[]>(cfg.actions,[]);
 return {...base,modes:[...(resources.length?['synced','federated'] as Mode[]:['federated'] as Mode[]),...(actions.length?['action' as Mode]:[])],resources:resources.length?resources.map(r=>({id:r.id,label:r.label,modes:['synced','federated'] as Mode[],description:`GET ${r.path}`,schema:[r.idField||'id',r.titleField||'name',r.updatedField||'updated_at']})):[{id:'path',label:'Any read path',modes:['federated'],description:'GET a relative path at query time.',schema:['*']}],actions:actions.map(a=>({id:a.id,label:a.label,description:`${a.method.toUpperCase()} ${a.path}`,risk:(['low','medium','high'].includes(String(a.risk))?a.risk:'high') as ActionDef['risk'],confirm:a.risk!=='low',input:(a.fields||[]).map(k=>({key:k,label:k,type:'text' as const})),verify:'The response status and body id are recorded.',recovery:'Reverse the change in the external system.'})),schemas:Object.fromEntries(resources.map(r=>[r.id,[r.idField||'id',r.titleField||'name']])),aiTools:['connector.read',...(actions.length?['connector.action']:[])],studioWidgets:['connector'],unsupported:['Arbitrary methods not declared as actions']};
}
export async function manifest(c:ConnectorRow){const t=typeOf(c);const m=manifestFor(c,t);
 // Only capabilities covered by the granted OAuth scopes are offered.
 if(t.family){const caps=new Set(grantedCapabilities(t.family,c.granted_scopes||'').map(x=>x.id));m.resources=m.resources.filter(r=>!r.requires||caps.has(r.requires));m.actions=m.actions.filter(a=>!a.requires||caps.has(a.requires));m.modes=[...new Set([...m.resources.flatMap(r=>r.modes),...(m.actions.length?['action' as Mode]:[])])]}
 return m;
}
type Policy={allowAgents?:string[],autoConfirm?:string[],cacheSeconds?:number,allowAutomations?:boolean};
export const policyOf=(c:ConnectorRow)=>parseJson<Policy>((c as ConnectorRow&{policy_json?:string}).policy_json,{});
const env=(c:ConnectorRow)=>(c as ConnectorRow&{environment?:string}).environment||'production';
// Who may read this connector's data (people): the owner of a personal connection, or people it is enabled for.
export function mayUse(u:Member,c:ConnectorRow){if(c.tenant_id!==u.tenantId)return false;if(c.scope==='user')return c.owner_member_id===u.id;return u.role==='admin'||hasAction(u,'connectors','configure')||canUseConnector(u,c,'assistant')||canUseConnector(u,c,'app-pages')}
async function underLimit(c:ConnectorRow){const lim=(c as ConnectorRow&{daily_call_limit?:number}).daily_call_limit||0;if(!lim)return;const n=await first<{n:number}>("SELECT count(*) AS n FROM connector_logs WHERE tenant_id=? AND connector_id=? AND created_at>=?",c.tenant_id,c.id,new Date().toISOString().slice(0,10));if((n?.n||0)>=lim)throw new HttpError(429,`${c.name} reached its daily limit of ${lim} calls.`)}

// ── Fetching a resource (used by sync and federated reads) ─────────────────
type Item={sourceId:string,title:string,body:string,url:string,updatedAt:string|null,kind:string};
async function fetchResource(c:ConnectorRow,resource:string,o:{query?:string,since?:string|null,limit?:number}={}):Promise<Item[]>{
 const t=typeOf(c);const limit=Math.min(200,o.limit||100);const h=async()=>({Accept:'application/json',...await authHeaders(c)});const base=t.family?apiBase(c):'';
 const get=async(url:string)=>{const r=await outbound(c,url,{method:'GET',retry:true,headers:await h(),timeoutMs:20000});if(r.status===401||r.status===403)throw new HttpError(403,`${c.name} refused access (permission withdrawn or expired).`);if(!r.ok)throw new HttpError(502,`${c.name} answered ${r.status}.`);return r.json() as Promise<any>};
 const clip=(s:unknown,n=2000)=>String(s??'').slice(0,n);
 if(t.family==='microsoft'){
  if(resource==='mail'){const q=o.query?`$search="${encodeURIComponent(o.query.replace(/"/g,''))}"&`:o.since?`$filter=receivedDateTime ge ${o.since}&`:'';const d=await get(`${base}/me/messages?${q}$select=id,subject,from,receivedDateTime,bodyPreview,webLink&$top=${limit}`);return (d.value||[]).map((m:any)=>({sourceId:m.id,title:clip(m.subject,300)||'(no subject)',body:`From ${m.from?.emailAddress?.address||''}: ${clip(m.bodyPreview,1500)}`,url:m.webLink||'',updatedAt:m.receivedDateTime||null,kind:'email'}))}
  if(resource==='events'){const s=new Date().toISOString(),e=new Date(Date.now()+30*86400000).toISOString();const d=await get(`${base}/me/calendarView?startDateTime=${s}&endDateTime=${e}&$top=${limit}`);return (d.value||[]).filter((x:any)=>!o.query||String(x.subject).toLowerCase().includes(o.query.toLowerCase())).map((x:any)=>({sourceId:x.id,title:clip(x.subject,300),body:`${x.start?.dateTime||''} → ${x.end?.dateTime||''} · ${x.location?.displayName||''}`,url:x.webLink||'',updatedAt:x.lastModifiedDateTime||x.start?.dateTime||null,kind:'meeting'}))}
  if(resource==='contacts'){const d=await get(`${base}/me/contacts?$top=${limit}`);return (d.value||[]).filter((x:any)=>!o.query||JSON.stringify(x).toLowerCase().includes(o.query.toLowerCase())).map((x:any)=>({sourceId:x.id,title:clip(x.displayName,200),body:x.emailAddresses?.[0]?.address||'',url:'',updatedAt:null,kind:'contact'}))}
  if(resource==='files'){const d=await get(o.query?`${base}/me/drive/root/search(q='${encodeURIComponent(o.query)}')?$top=${limit}`:`${base}/me/drive/root/children?$top=${limit}`);return (d.value||[]).map((x:any)=>({sourceId:x.id,title:clip(x.name,300),body:x.file?.mimeType||'folder',url:x.webUrl||'',updatedAt:x.lastModifiedDateTime||null,kind:'file'}))}
 }
 if(t.family==='google'){
  if(resource==='files'){const q=o.query?`&q=${encodeURIComponent(`name contains '${o.query.replace(/'/g,'')}'`)}`:o.since?`&q=${encodeURIComponent(`modifiedTime > '${o.since}'`)}`:'';const d=await get(`${base}/drive/v3/files?pageSize=${limit}&fields=files(id,name,mimeType,modifiedTime,webViewLink)${q}`);return (d.files||[]).map((x:any)=>({sourceId:x.id,title:clip(x.name,300),body:x.mimeType||'',url:x.webViewLink||'',updatedAt:x.modifiedTime||null,kind:'file'}))}
  if(resource==='events'){const d=await get(`${base}/calendar/v3/calendars/primary/events?timeMin=${encodeURIComponent(new Date().toISOString())}&maxResults=${limit}&singleEvents=true${o.query?`&q=${encodeURIComponent(o.query)}`:''}`);return (d.items||[]).map((x:any)=>({sourceId:x.id,title:clip(x.summary,300),body:`${x.start?.dateTime||x.start?.date||''} · ${x.location||''}`,url:x.htmlLink||'',updatedAt:x.updated||null,kind:'meeting'}))}
  if(resource==='mail'){const d=await get(`${base}/gmail/v1/users/me/messages?maxResults=${Math.min(limit,20)}${o.query?`&q=${encodeURIComponent(o.query)}`:''}`);return (d.messages||[]).map((x:any)=>({sourceId:x.id,title:`Gmail message ${x.id}`,body:'',url:`https://mail.google.com/mail/u/0/#all/${x.id}`,updatedAt:null,kind:'email'}))}
 }
 if(t.auth==='mcp'){
  if(resource==='resources'){const list=parseJson<{uri:string,name:string}[]>(c.resources_json,[]).slice(0,limit);const out:Item[]=[];for(const r of list){let text='';try{text=await mcpReadResource(c,r.uri)}catch{text=''}if(o.query&&!`${r.name} ${text}`.toLowerCase().includes(o.query.toLowerCase()))continue;out.push({sourceId:r.uri,title:r.name||r.uri,body:clip(text),url:'',updatedAt:null,kind:'resource'})}return out}
  if(resource.startsWith('tool:')){const name=resource.slice(5);const allowed=parseJson<string[]>(c.allowed_tools_json,[]),mutating=parseJson<string[]>(c.mutating_tools_json,[]);if(!allowed.includes(name)||mutating.includes(name))throw new HttpError(403,'Only allowed, read-only tools can be read.');const r=await mcpCall(c,name,o.query?{query:o.query}:{});return r.text.split('\n').filter(Boolean).slice(0,limit).map((l,i)=>({sourceId:`${name}:${i}`,title:clip(l,200),body:clip(l),url:'',updatedAt:null,kind:'result'}))}
 }
 if(t.id==='webhook'){const rows=await all<{source_id:string,title:string,body:string,url:string,source_updated_at:string|null}>('SELECT source_id,title,body,url,source_updated_at FROM connector_records WHERE tenant_id=? AND connector_id=? AND deleted_at IS NULL ORDER BY synced_at DESC LIMIT ?',c.tenant_id,c.id,limit);return rows.map(r=>({sourceId:r.source_id,title:r.title,body:r.body,url:r.url,updatedAt:r.source_updated_at,kind:'event'}))}
 // Generic REST: configured resources or a relative path.
 const cfg=configOf(c);const baseUrl=safeUrl(cfg.baseUrl,'Base URL');
 const defs=parseJson<{id:string,path:string,idField?:string,titleField?:string,updatedField?:string,urlField?:string,listField?:string}[]>(cfg.resources,[]);
 const d=defs.find(x=>x.id===resource)||(resource.startsWith('/')?{id:'path',path:resource}:null);if(!d)throw new HttpError(404,'Unknown resource.');
 if(!/^\/[\w\-./?=&%,:]*$/.test(d.path)||d.path.includes('..'))throw new HttpError(400,'Invalid resource path.');
 const sep=d.path.includes('?')?'&':'?';const url=`${baseUrl}${d.path}${o.query?`${sep}q=${encodeURIComponent(o.query)}`:''}`;
 const body=await get(url);const list:any[]=Array.isArray(body)?body:(d as {listField?:string}).listField?body[(d as {listField:string}).listField]||[]:body.items||body.data||body.results||body.value||[];
 const idF=(d as {idField?:string}).idField||'id',titleF=(d as {titleField?:string}).titleField||'name',updF=(d as {updatedField?:string}).updatedField||'updated_at',urlF=(d as {urlField?:string}).urlField||'url';
 return list.slice(0,limit).map((x:any,i:number)=>({sourceId:String(x[idF]??x.sku??x.id??i),title:clip(x[titleF]??x.title??x.name??x.sku??`Record ${i+1}`,300),body:clip(JSON.stringify(x),1500),url:typeof x[urlF]==='string'?x[urlF]:'',updatedAt:x[updF]?String(x[updF]):null,kind:'record'}));
}

// ── Synced mode ─────────────────────────────────────────────────────────────
// Permission mapping: personal connections are visible only to their owner; department connections to that
// department; company connections to people the connector is enabled for (checked again at read time).
function permissionsFor(c:ConnectorRow){return c.scope==='user'&&c.owner_member_id?{people:[c.owner_member_id]}:c.scope==='department'?{departments:[configOf(c).department||'']}:{connector:'enabled-people'}}
async function hash(s:string){const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(b)].slice(0,12).map(x=>x.toString(16).padStart(2,'0')).join('')}
export async function syncConnector(tenantId:string,id:string,full:boolean){
 const c=await loadConnector(tenantId,id);if(c.status==='disabled'||c.paused)return {skipped:true};
 const m=await manifest(c);const res=m.resources.filter(r=>r.modes.includes('synced'));if(!res.length)return {skipped:true,reason:'No synced resources.'};
 await underLimit(c);
 const cp=await first<{cursor:string,last_full_at:string|null}>('SELECT cursor,last_full_at FROM connector_sync_checkpoints WHERE tenant_id=? AND connector_id=?',tenantId,id);
 const since=full?null:cp?.cursor||null;const started=Date.now();const stats={fetched:0,created:0,updated:0,unchanged:0,deleted:0,resources:res.map(r=>r.id)};let newest=since||'';
 const seen=new Set<string>();const perms=JSON.stringify(permissionsFor(c));const ts=now();const events:D1PreparedStatement[]=[];
 for(const r of res){
  const items=await fetchResource(c,r.id,{since,limit:200});stats.fetched+=items.length;
  for(const it of items){const sid=`${r.id}:${it.sourceId}`;seen.add(sid);if(it.updatedAt&&it.updatedAt>newest)newest=it.updatedAt;
   const h=await hash(`${it.title}|${it.body}|${it.url}|${it.updatedAt}`);
   const cur=await first<{id:string,content_hash:string,deleted_at:string|null}>('SELECT id,content_hash,deleted_at FROM connector_records WHERE tenant_id=? AND connector_id=? AND source_id=?',tenantId,id,sid);
   if(cur&&cur.content_hash===h&&!cur.deleted_at){stats.unchanged++;await run('UPDATE connector_records SET last_verified_at=? WHERE id=?',ts,cur.id);continue}
   // Conflict rule: external records are read-only here, so the source always wins; the prior hash is kept in the log.
   const rid=cur?.id||uid();
   await run('INSERT INTO connector_records(id,tenant_id,connector_id,source_id,kind,title,body,url,source_updated_at,permissions_json,content_hash,deleted_at,last_verified_at,synced_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL,?,?) ON CONFLICT(tenant_id,connector_id,source_id) DO UPDATE SET kind=excluded.kind,title=excluded.title,body=excluded.body,url=excluded.url,source_updated_at=excluded.source_updated_at,permissions_json=excluded.permissions_json,content_hash=excluded.content_hash,deleted_at=NULL,last_verified_at=excluded.last_verified_at,synced_at=excluded.synced_at',rid,tenantId,id,sid,it.kind,it.title,it.body,it.url,it.updatedAt,perms,h,ts,ts);
   cur?stats.updated++:stats.created++;
   events.push(stmt("INSERT INTO domain_events(id,tenant_id,type,entity_id,action,actor,payload_json,status,attempts,error,created_at) VALUES(?,?,?,?,?,?,?,'pending',0,'',?)",uid(),tenantId,cur?'project':'connector.record',rid,cur?'external':'connector record',`connector:${id}`,JSON.stringify({type:'external',connectorId:id,title:it.title,kind:it.kind}),ts));
  }
 }
 // Deletion propagation: on a full sync, records no longer in the source are removed (and leave the graph).
 if(full){const gone=await all<{id:string,source_id:string}>('SELECT id,source_id FROM connector_records WHERE tenant_id=? AND connector_id=? AND deleted_at IS NULL',tenantId,id);for(const g of gone)if(!seen.has(g.source_id)){await run('UPDATE connector_records SET deleted_at=? WHERE id=?',ts,g.id);await run("UPDATE graph_nodes SET deleted_at=? WHERE tenant_id=? AND type='external' AND source_id=?",ts,tenantId,g.id);stats.deleted++}}
 for(let i=0;i<events.length;i+=80)await batch(events.slice(i,i+80));
 await batch([stmt('INSERT INTO connector_sync_checkpoints(id,tenant_id,connector_id,cursor,last_full_at,last_incremental_at,stats_json,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,connector_id) DO UPDATE SET cursor=excluded.cursor,last_full_at=coalesce(excluded.last_full_at,connector_sync_checkpoints.last_full_at),last_incremental_at=coalesce(excluded.last_incremental_at,connector_sync_checkpoints.last_incremental_at),stats_json=excluded.stats_json,updated_at=excluded.updated_at',uid(),tenantId,id,newest||since||'',full?ts:null,full?null:ts,JSON.stringify(stats),ts),
  stmt('UPDATE connectors SET last_sync_at=?,last_ok_at=?,health=\'healthy\',last_error=\'\' WHERE id=? AND tenant_id=?',ts,ts,id,tenantId),logStatement(c,'scheduler',full?'sync.full':'sync.incremental','ok',Date.now()-started,stats)]);
 return stats;
}
registerJob('connector.fabric-sync',async job=>{const p=parseJson<{full?:boolean}>(job.payload_json,{});const c=await loadConnector(job.tenant_id,job.ref_id).catch(()=>null);if(!c)return;try{await syncConnector(job.tenant_id,job.ref_id,!!p.full)}catch(e){await markHealth(c,false,(e as Error).message);await logStatement(c,'scheduler','sync','error',0,{error:(e as Error).message.slice(0,200),attempt:job.attempts}).run();throw e}});
registerJob('connector.fabric-sync:failed',async job=>{const c=await loadConnector(job.tenant_id,job.ref_id).catch(()=>null);if(c)await logStatement(c,'scheduler','sync','error',0,{deadLetter:job.status==='dead',error:job.last_error.slice(0,200)}).run()});
export function queueSync(tenantId:string,id:string,full:boolean){return enqueueStatement(tenantId,'connector.fabric-sync',id,{full},{key:`fabric-sync:${id}:${full?'full':'inc'}:${now().slice(0,16)}`,maxAttempts:5})}
// Disconnecting removes synced data and its graph nodes (no orphaned copies remain for search or AI).
export async function purgeSynced(tenantId:string,id:string){const ts=now();await batch([stmt("UPDATE graph_nodes SET deleted_at=? WHERE tenant_id=? AND type='external' AND source_id IN (SELECT id FROM connector_records WHERE tenant_id=? AND connector_id=?)",ts,tenantId,tenantId,id),stmt('DELETE FROM connector_records WHERE tenant_id=? AND connector_id=?',tenantId,id),stmt('DELETE FROM connector_sync_checkpoints WHERE tenant_id=? AND connector_id=?',tenantId,id)])}
// Synced records a person may see (for search, reports, widgets and agents).
export async function connectorRecordsFor(u:Member,connectorId:string,limit=100,q=''){
 const c=await loadConnector(u.tenantId,connectorId);if(!mayUse(u,c))throw new HttpError(403,'This connector is not available to you.');
 const rows=await all<{id:string,source_id:string,kind:string,title:string,body:string,url:string,source_updated_at:string|null,permissions_json:string,last_verified_at:string|null}>(`SELECT * FROM connector_records WHERE tenant_id=? AND connector_id=? AND deleted_at IS NULL${q?" AND (instr(lower(title),?)>0 OR instr(lower(body),?)>0)":''} ORDER BY synced_at DESC LIMIT ?`,u.tenantId,connectorId,...(q?[q.toLowerCase(),q.toLowerCase()]:[]),limit);
 return rows.filter(r=>{const p=parseJson<{people?:string[],departments?:string[]}>(r.permissions_json,{});if(u.role==='admin')return true;if(p.people?.length&&!p.people.includes(u.id))return false;if(p.departments?.length&&!p.departments.some(d=>d.toLowerCase()===u.department.toLowerCase()))return false;return true}).map(r=>({id:r.id,externalId:r.source_id,kind:r.kind,title:r.title,excerpt:r.body.slice(0,300),url:r.url,sourceUpdatedAt:r.source_updated_at,lastVerifiedAt:r.last_verified_at,provider:c.provider,connector:c.name,mode:'synced',link:`#/graph?type=external&id=${r.id}`}));
}

// ── Federated mode ──────────────────────────────────────────────────────────
export async function federated(u:Member,connectorId:string,resource:string,query:string,limit=20){
 const c=await loadConnector(u.tenantId,connectorId);if(!mayUse(u,c))throw new HttpError(403,'This connector is not available to you.');
 if(c.paused||c.status==='disabled')throw new HttpError(409,`${c.name} is paused.`);
 const m=await manifest(c);const r=m.resources.find(x=>x.id===resource&&x.modes.includes('federated'))||(resource.startsWith('/')&&m.resources.some(x=>x.id==='path')?{id:resource}:null);if(!r)throw new HttpError(400,'This resource cannot be read live.');
 await underLimit(c);const started=Date.now();
 try{
  const items=await fetchResource(c,r.id,{query,limit});
  await logStatement(c,u.id,'federated.read','ok',Date.now()-started,{resource,count:items.length,cached:false}).run();
  const retrievedAt=now();
  // Live results are returned, never written to the index or the graph.
  return {live:true,retrievedAt,connector:c.name,provider:c.provider,items:items.map(i=>({externalId:i.sourceId,title:i.title,excerpt:i.body.slice(0,400),url:i.url,updatedAt:i.updatedAt,kind:i.kind,citation:`${c.name} · ${i.title}`}))};
 }catch(e){await logStatement(c,u.id,'federated.read','error',Date.now()-started,{resource,error:(e as Error).message.slice(0,200)}).run();throw e}
}

// ── Action mode ─────────────────────────────────────────────────────────────
type RunRow={id:string,tenant_id:string,connector_id:string,action:string,input_json:string,idempotency_key:string,status:string,origin:string,requested_by:string,confirmed_by:string|null,result_json:string,external_id:string|null,verified:number,error:string,created_at:string,finished_at:string|null};
function validateInput(a:ActionDef,input:Record<string,unknown>){
 const out:Record<string,unknown>={};
 for(const f of a.input){const v=input[f.key];if(v===undefined||v===null||v===''){if(f.required)throw new HttpError(400,`${f.label} is required.`);continue}
  if(f.type==='emails'){const list=(Array.isArray(v)?v:String(v).split(/[;,]/)).map(x=>String(x).trim()).filter(Boolean).slice(0,50);for(const x of list)if(!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(x))throw new HttpError(400,`“${x}” is not a valid email address.`);if(f.required&&!list.length)throw new HttpError(400,`${f.label} is required.`);out[f.key]=list}
  else if(f.type==='datetime'){if(!Number.isFinite(Date.parse(String(v))))throw new HttpError(400,`${f.label} must be a date and time.`);out[f.key]=String(v).slice(0,40)}
  else if(f.type==='json'){if(typeof v==='object')out[f.key]=v;else{try{out[f.key]=JSON.parse(String(v))}catch{throw new HttpError(400,`${f.label} must be JSON.`)}}}
  else out[f.key]=String(v).slice(0,f.type==='textarea'?20000:500);
 }
 return out;
}
export type ActionRequest={connectorId:string,action:string,input:Record<string,unknown>,origin:'user'|'automation'|'agent',requestedBy:string,idempotencyKey:string,agentId?:string};
// Creates (or returns) an action run. Consequential actions wait for a person unless the connector's policy
// explicitly pre-approves that non-high-risk action for automations.
export async function executeAction(tenantId:string,req:ActionRequest){
 const c=await loadConnector(tenantId,req.connectorId);const m=await manifest(c);const a=m.actions.find(x=>x.id===req.action);
 if(!a)throw new HttpError(400,`${c.name} does not offer “${req.action}” with the permissions it was granted.`);
 const key=`${req.connectorId}:${req.idempotencyKey}`.slice(0,200);
 const prev=await first<RunRow>('SELECT * FROM connector_action_runs WHERE tenant_id=? AND idempotency_key=?',tenantId,key);if(prev)return shapeRun(prev);
 const input=validateInput(a,req.input);const pol=policyOf(c);
 if(req.origin==='agent'&&req.agentId&&!(pol.allowAgents||[]).includes(req.agentId))throw new HttpError(403,`${c.name} is not enabled for this agent.`);
 if(req.origin==='automation'&&pol.allowAutomations===false)throw new HttpError(403,`${c.name} does not allow automations.`);
 const auto=req.origin==='automation'&&a.risk!=='high'&&(pol.autoConfirm||[]).includes(a.id);
 const id=uid();await run("INSERT INTO connector_action_runs(id,tenant_id,connector_id,action,input_json,idempotency_key,status,origin,requested_by,result_json,verified,error,created_at) VALUES(?,?,?,?,?,?,?,?,?,'{}',0,'',?)",id,tenantId,c.id,a.id,JSON.stringify(input),key,a.confirm&&!auto?'pending_confirmation':'confirmed',req.origin,req.requestedBy,now());
 await logStatement(c,req.requestedBy,`action.${a.id}`,'ok',0,{status:a.confirm&&!auto?'awaiting confirmation':'queued',origin:req.origin}).run();
 if(a.confirm&&!auto)return shapeRun((await first<RunRow>('SELECT * FROM connector_action_runs WHERE id=?',id))!);
 return perform(c,a,id,req.requestedBy);
}
export async function confirmAction(u:Member,runId:string,approve:boolean,edited?:Record<string,unknown>){
 const r=await first<RunRow>("SELECT * FROM connector_action_runs WHERE id=? AND tenant_id=?",runId,u.tenantId);if(!r)throw new HttpError(404,'Action not found.');
 if(r.status!=='pending_confirmation')return shapeRun(r);
 const c=await loadConnector(u.tenantId,r.connector_id);
 // The owner of a personal connection confirms its actions; company connectors need a connector administrator or the requester with access.
 const may=c.scope==='user'?c.owner_member_id===u.id:(u.role==='admin'||hasAction(u,'connectors','configure')||(r.requested_by===u.id&&mayUse(u,c)));
 if(!may)throw new HttpError(403,'You cannot confirm actions on this connector.');
 if(!approve){await batch([stmt("UPDATE connector_action_runs SET status='rejected',confirmed_by=?,finished_at=? WHERE id=?",u.id,now(),r.id),stmt('INSERT INTO audit (id,action,actor,record_id,department,before_json,after_json,created_at,tenant_id) VALUES (?,?,?,?,?,NULL,?,?,?)',uid(),`Connector action rejected: ${r.action}`,u.id,c.id,'Integrations',JSON.stringify({run:r.id}),now(),u.tenantId)]);return shapeRun((await first<RunRow>('SELECT * FROM connector_action_runs WHERE id=?',r.id))!)}
 const m=await manifest(c);const a=m.actions.find(x=>x.id===r.action);if(!a)throw new HttpError(409,'This action is no longer permitted by the connection.');
 if(edited)await run('UPDATE connector_action_runs SET input_json=? WHERE id=?',JSON.stringify(validateInput(a,{...parseJson(r.input_json,{}),...edited})),r.id);
 await run("UPDATE connector_action_runs SET status='confirmed',confirmed_by=? WHERE id=?",u.id,r.id);
 return perform(c,a,r.id,u.id);
}
async function perform(c:ConnectorRow,a:ActionDef,runId:string,actor:string){
 const r=(await first<RunRow>('SELECT * FROM connector_action_runs WHERE id=?',runId))!;const input=parseJson<Record<string,any>>(r.input_json,{});const t=typeOf(c);const started=Date.now();
 const finish=async(status:string,result:unknown,externalId:string|null,verified:boolean,error='')=>{await batch([stmt('UPDATE connector_action_runs SET status=?,result_json=?,external_id=?,verified=?,error=?,finished_at=? WHERE id=?',status,JSON.stringify(result??{}).slice(0,4000),externalId,verified?1:0,error,now(),runId),logStatement(c,actor,`action.${a.id}`,status==='succeeded'?'ok':'error',Date.now()-started,{run:runId,externalId,verified,environment:env(c)}),stmt('INSERT INTO audit (id,action,actor,record_id,department,before_json,after_json,created_at,tenant_id) VALUES (?,?,?,?,?,NULL,?,?,?)',uid(),`Connector action ${status}: ${a.label}`,actor,c.id,'Integrations',JSON.stringify({run:runId,externalId,verified,origin:r.origin}),now(),c.tenant_id)]);return shapeRun((await first<RunRow>('SELECT * FROM connector_action_runs WHERE id=?',runId))!)};
 if(c.paused||c.status==='disabled')return finish('failed',null,null,false,`${c.name} is paused.`);
 try{await underLimit(c)}catch(e){return finish('failed',null,null,false,(e as Error).message)}
 // Test environment: the request is validated and recorded, but nothing is sent to the external system.
 if(env(c)==='test')return finish('succeeded',{testEnvironment:true,wouldSend:{action:a.id,input}},`test-${runId.slice(0,8)}`,true);
 try{
  const base=t.family?apiBase(c):'';const json=async(method:string,url:string,body?:unknown)=>{const res=await outbound(c,url,{method,headers:{Accept:'application/json','Content-Type':'application/json',...await authHeaders(c)},body:body===undefined?undefined:JSON.stringify(body),timeoutMs:30000});if(res.status===401||res.status===403)throw new Error(`${c.name} refused the action (permission missing or expired).`);if(!res.ok)throw new Error(`${c.name} answered ${res.status}.`);return {status:res.status,data:res.status===202||res.status===204?null:await res.json().catch(()=>null) as any}};
  if(t.family==='microsoft'){
   if(a.id==='create_draft'){const r1=await json('POST',`${base}/me/messages`,{subject:input.subject,body:{contentType:'Text',content:input.body||''},toRecipients:(input.to||[]).map((x:string)=>({emailAddress:{address:x}}))});const vid=r1.data?.id;let ok=false;if(vid){const v=await json('GET',`${base}/me/messages/${encodeURIComponent(vid)}?$select=id`).catch(()=>null);ok=!!v}return finish('succeeded',{id:vid},vid||null,ok)}
   if(a.id==='send_mail'){const r1=await json('POST',`${base}/me/sendMail`,{message:{subject:input.subject,body:{contentType:'Text',content:input.body||''},toRecipients:(input.to||[]).map((x:string)=>({emailAddress:{address:x}}))},saveToSentItems:true});return finish('succeeded',{accepted:r1.status===202},null,r1.status===202)}
   if(a.id==='create_event'){const r1=await json('POST',`${base}/me/events`,{subject:input.subject,start:{dateTime:input.start,timeZone:'UTC'},end:{dateTime:input.end,timeZone:'UTC'},location:{displayName:input.location||''},attendees:(input.attendees||[]).map((x:string)=>({emailAddress:{address:x},type:'required'}))});const vid=r1.data?.id;let ok=false;if(vid){ok=!!await json('GET',`${base}/me/events/${encodeURIComponent(vid)}?$select=id`).catch(()=>null)}return finish('succeeded',{id:vid},vid||null,ok)}
  }
  if(t.family==='google'){
   if(a.id==='create_event'){const r1=await json('POST',`${base}/calendar/v3/calendars/primary/events`,{summary:input.subject,start:{dateTime:input.start},end:{dateTime:input.end},attendees:(input.attendees||[]).map((x:string)=>({email:x}))});return finish('succeeded',{id:r1.data?.id},r1.data?.id||null,!!r1.data?.id)}
   if(a.id==='create_draft'){const raw=btoa(unescape(encodeURIComponent(`To: ${(input.to||[]).join(', ')}\r\nSubject: ${String(input.subject).replace(/[\r\n]/g,' ')}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${input.body||''}`))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');const r1=await json('POST',`${base}/gmail/v1/users/me/drafts`,{message:{raw}});return finish('succeeded',{id:r1.data?.id},r1.data?.id||null,!!r1.data?.id)}
  }
  if(t.auth==='mcp'&&a.id.startsWith('tool:')){const out=await mcpCall(c,a.id.slice(5),(input.arguments||{}) as Record<string,unknown>);return finish(out.isError?'failed':'succeeded',{text:out.text.slice(0,2000)},null,!out.isError,out.isError?'The MCP server reported an error.':'')}
  const defs=parseJson<{id:string,method:string,path:string}[]>(configOf(c).actions,[]);const d=defs.find(x=>x.id===a.id);
  if(d){if(!/^\/[\w\-./?=&%,:]*$/.test(d.path)||d.path.includes('..'))throw new Error('Invalid action path.');const method=['POST','PUT','PATCH'].includes(d.method.toUpperCase())?d.method.toUpperCase():'POST';const r1=await json(method,`${safeUrl(configOf(c).baseUrl,'Base URL')}${d.path}`,input);const eid=r1.data&&typeof r1.data==='object'?String(r1.data.id??r1.data.reference??''):'';return finish('succeeded',r1.data,eid||null,!!eid)}
  return finish('failed',null,null,false,'This action is not implemented for this connector.');
 }catch(e){return finish('failed',null,null,false,(e as Error).message.slice(0,300))}
}
const shapeRun=(r:RunRow)=>({id:r.id,connectorId:r.connector_id,action:r.action,status:r.status,origin:r.origin,input:parseJson(r.input_json,{}),result:parseJson(r.result_json,{}),externalId:r.external_id,verified:!!r.verified,error:r.error,requestedBy:r.requested_by,confirmedBy:r.confirmed_by,createdAt:r.created_at,finishedAt:r.finished_at});
export async function pendingActions(u:Member){
 const rows=await all<RunRow&{name:string,scope:string,owner_member_id:string|null}>("SELECT r.*,c.name,c.scope,c.owner_member_id FROM connector_action_runs r JOIN connectors c ON c.id=r.connector_id AND c.tenant_id=r.tenant_id WHERE r.tenant_id=? AND r.status='pending_confirmation' ORDER BY r.created_at DESC LIMIT 100",u.tenantId);
 return rows.filter(r=>r.scope==='user'?r.owner_member_id===u.id:(u.role==='admin'||hasAction(u,'connectors','configure')||r.requested_by===u.id)).map(r=>({...shapeRun(r),connector:r.name}));
}
export async function actionRuns(tenantId:string,connectorId:string){return (await all<RunRow>('SELECT * FROM connector_action_runs WHERE tenant_id=? AND connector_id=? ORDER BY created_at DESC LIMIT 50',tenantId,connectorId)).map(shapeRun)}
export {kick};
