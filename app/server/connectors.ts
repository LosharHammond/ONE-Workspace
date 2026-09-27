import {hasAction} from '../access-policy';
import {first,stmt,uid,now,HttpError,parseJson,run} from './core';
import {openSecret,sealSecret,safeUrl,PLATFORM_SCOPE} from './secrets';
import {rateLimit} from './auth';
import {connectorTypeById,type ConnectorType} from '../connector-catalog';
import {scopesFor} from '../connector-capabilities';
import {env} from 'cloudflare:workers';
import type {Member} from './policy';

// Connector runtime. Connectors belong to one workspace (tenant_id) or to the platform ('__platform__').
// Secrets are sealed per scope, used only on the server, and never logged. Everything a connector returns is
// untrusted: it is shown as plain text and handed to the AI only as data. Connectors never bypass
// One Workspace permissions: a person needs the "use connectors" permission, their role must be allowed,
// and the page they use it from must be enabled for the connector.
export type ConnectorRow={owner_member_id?:string|null,granted_scopes?:string,account_identity?:string,paused?:number,next_sync_at?:string|null,conflict_rule?:string,id:string,tenant_id:string,scope:string,provider:string,name:string,description:string,auth_type:string,config_json:string,secret_enc:string|null,secret_hint:string,webhook_secret_enc:string|null,status:string,health:string,last_ok_at:string|null,last_sync_at:string|null,last_error:string,sync_minutes:number,pages_json:string,roles_json:string,allowed_tools_json:string,mutating_tools_json:string,tools_json:string,resources_json:string,field_map_json:string,created_by:string,created_at:string,updated_by:string,updated_at:string};
export type Secrets={secret?:string,clientSecret?:string,accessToken?:string,refreshToken?:string,expiresAt?:number};
export const typeOf=(c:ConnectorRow)=>connectorTypeById.get(c.provider) as ConnectorType;
export const configOf=(c:ConnectorRow)=>parseJson<Record<string,string>>(c.config_json,{});
export async function loadConnector(scope:string,id:string){const c=await first<ConnectorRow>('SELECT * FROM connectors WHERE id=? AND tenant_id=?',id,scope);if(!c)throw new HttpError(404,'Connector not found.');return c}
export async function secretsOf(c:ConnectorRow):Promise<Secrets>{return parseJson<Secrets>(await openSecret(c.tenant_id,c.id,c.secret_enc),{})}
export async function sealSecrets(scope:string,id:string,s:Secrets){return sealSecret(scope,id,JSON.stringify(s))}
// Connector activity log. Details never include secrets or request/response bodies from the service.
export function logStatement(c:{id:string,tenant_id:string},actor:string,action:string,status:'ok'|'error'|'denied',ms=0,detail?:Record<string,unknown>){return stmt('INSERT INTO connector_logs(id,tenant_id,connector_id,actor,action,status,duration_ms,detail_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)',uid(),c.tenant_id,c.id,actor,action,status,ms,detail?JSON.stringify(detail):null,now())}

// ── Outbound HTTP with timeout, one retry for reads, and failure bookkeeping ──
export async function outbound(c:ConnectorRow,url:string,init:RequestInit&{timeoutMs?:number,retry?:boolean},signal?:AbortSignal){
 await rateLimit(`connector:${c.id}`,'calls',120,60000).catch(()=>{throw new HttpError(429,`${c.name} is being called too often. Try again in a minute.`)});
 const attempt=async()=>{const t=AbortSignal.timeout(init.timeoutMs||20000);const s=signal?AbortSignal.any([t,signal]):t;return fetch(url,{...init,signal:s,redirect:'manual'})};
 let r:Response|null=null,err:unknown=null;
 for(let i=0;i<(init.retry?2:1);i++){try{r=await attempt();if(r.status<500)break}catch(e){err=e;if((e as Error).name==='AbortError'&&signal?.aborted)break}if(i===0&&init.retry)await new Promise(x=>setTimeout(x,400))}
 if(!r){const timeout=(err as Error)?.name==='TimeoutError';throw new HttpError(504,timeout?`${c.name} did not answer in time.`:signal?.aborted?'Cancelled.':`Could not reach ${c.name}.`)}
 return r;
}
export async function markHealth(c:ConnectorRow,ok:boolean,error=''){await run('UPDATE connectors SET health=?,last_error=?,last_ok_at=CASE WHEN ? THEN ? ELSE last_ok_at END,status=CASE WHEN status=\'disabled\' THEN status WHEN ? THEN \'connected\' ELSE \'error\' END WHERE id=? AND tenant_id=?',ok?'healthy':'failing',error.slice(0,300),ok?1:0,now(),ok?1:0,c.id,c.tenant_id)}

// ── Authentication headers ──
export async function oauthApp(c:ConnectorRow,t:ConnectorType){
 const cfg=configOf(c);const s=await secretsOf(c);
 if(cfg.clientId)return {clientId:cfg.clientId,clientSecret:s.clientSecret||''};
 // Company connectors may use the platform's app registration for Microsoft/Google.
 if(t.family&&c.tenant_id!==PLATFORM_SCOPE){const p=await first<ConnectorRow>('SELECT * FROM connectors WHERE tenant_id=? AND provider IN (?,?) AND status!=\'disabled\' ORDER BY updated_at DESC LIMIT 1',PLATFORM_SCOPE,t.family==='microsoft'?'microsoft365':'google-workspace',t.family==='microsoft'?'entra':'gmail');if(p){const pc=configOf(p),ps=await secretsOf(p);if(pc.clientId)return {clientId:pc.clientId,clientSecret:ps.clientSecret||''}}}
 throw new HttpError(400,'No OAuth app is configured. Enter a client ID and secret, or ask the Platform Owner to add a platform app registration.');
}
const override=(url:string)=>{const e=env as unknown as Record<string,string|undefined>;return url.replace('https://login.microsoftonline.com',e.MS_LOGIN_BASE||'https://login.microsoftonline.com').replace('https://graph.microsoft.com',e.MS_GRAPH_BASE||'https://graph.microsoft.com').replace('https://accounts.google.com',e.GOOGLE_AUTH_BASE||'https://accounts.google.com').replace('https://oauth2.googleapis.com',e.GOOGLE_AUTH_BASE||'https://oauth2.googleapis.com').replace('https://www.googleapis.com',e.GOOGLE_API_BASE||'https://www.googleapis.com').replace('https://gmail.googleapis.com',e.GOOGLE_API_BASE||'https://gmail.googleapis.com')};
export const apiBase=(c:ConnectorRow)=>{const t=typeOf(c);return override(t.family==='microsoft'?'https://graph.microsoft.com/v1.0':t.family==='google'?'https://www.googleapis.com':oauthUrls(c,t).base)};
export function oauthUrls(c:ConnectorRow,t:ConnectorType){const cfg=configOf(c);if(t.oauth){const dir=encodeURIComponent(cfg.directory||'organizations');const caps=cfg.capabilities?cfg.capabilities.split(',').filter(Boolean):[];const chosen=caps.length?[...(t.family==='microsoft'?['offline_access','User.Read']:['openid','email']),...scopesFor(t.family,caps)]:null;return {authorize:override(t.oauth.authorize.replace('{directory}',dir)),token:override(t.oauth.token.replace('{directory}',dir)),scopes:chosen||(cfg.scopes?cfg.scopes.split(/\s+/):t.oauth.scopes),test:override(t.oauth.test),base:override(t.oauth.base)}}return {authorize:safeUrl(cfg.authorizeUrl,'Authorization URL'),token:safeUrl(cfg.tokenUrl,'Token URL'),scopes:(cfg.scopes||'').split(/\s+/).filter(Boolean),test:cfg.testPath?`${safeUrl(cfg.baseUrl,'Base URL')}${cfg.testPath}`:safeUrl(cfg.baseUrl,'Base URL'),base:safeUrl(cfg.baseUrl,'Base URL')}}
async function accessToken(c:ConnectorRow){
 const s=await secretsOf(c);if(!s.accessToken)throw new HttpError(409,`${c.name} is not connected yet. Use Connect to sign in.`);
 if(s.expiresAt&&s.expiresAt<Date.now()+60000&&s.refreshToken){
  const t=typeOf(c);const app=await oauthApp(c,t);const urls=oauthUrls(c,t);
  const r=await outbound(c,urls.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:s.refreshToken,client_id:app.clientId,...(app.clientSecret?{client_secret:app.clientSecret}:{})})});
  if(!r.ok){await markHealth(c,false,'Token refresh failed. Reconnect.');throw new HttpError(409,`${c.name} needs to be reconnected.`)}
  const d=await r.json() as {access_token:string,refresh_token?:string,expires_in?:number};
  const next={...s,accessToken:d.access_token,refreshToken:d.refresh_token||s.refreshToken,expiresAt:Date.now()+(d.expires_in||3600)*1000};
  await run('UPDATE connectors SET secret_enc=? WHERE id=? AND tenant_id=?',await sealSecrets(c.tenant_id,c.id,next),c.id,c.tenant_id);
  return next.accessToken;
 }
 return s.accessToken;
}
export async function authHeaders(c:ConnectorRow):Promise<Record<string,string>>{
 const t=typeOf(c);const cfg=configOf(c);
 if(t.auth==='oauth2')return {Authorization:`Bearer ${await accessToken(c)}`};
 const s=await secretsOf(c);const kind=cfg.authType||(t.auth==='mcp'?'bearer':'api_key');
 if(kind==='none'||!s.secret)return {};
 if(kind==='bearer')return {Authorization:`Bearer ${s.secret}`};
 if(kind==='basic')return {Authorization:`Basic ${btoa(`${cfg.username||''}:${s.secret}`)}`};
 return {[/^[A-Za-z0-9-]{1,60}$/.test(cfg.header||'')?cfg.header:'X-API-Key']:s.secret};
}

// ── MCP (streamable HTTP, JSON-RPC 2.0) ──
async function mcpRpc(c:ConnectorRow,method:string,params:unknown,session:string|null,signal?:AbortSignal){
 const cfg=configOf(c);const endpoint=safeUrl(cfg.endpoint,'Server URL');
 const r=await outbound(c,endpoint,{method:'POST',timeoutMs:Math.min(60,Math.max(3,Number(cfg.timeoutSeconds)||20))*1000,headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-06-18',...(session?{'Mcp-Session-Id':session}:{}),...await authHeaders(c)},body:JSON.stringify({jsonrpc:'2.0',id:method==='notifications/initialized'?undefined:uid(),method,params})},signal);
 if(!r.ok&&r.status!==202)throw new HttpError(502,`${c.name} returned ${r.status}.`);
 const sid=r.headers.get('Mcp-Session-Id')||session;
 if(r.status===202||method.startsWith('notifications/'))return {result:null,session:sid};
 const text=(await r.text()).slice(0,500000);
 let msg:any=null;
 if((r.headers.get('Content-Type')||'').includes('text/event-stream')){for(const line of text.split('\n')){if(line.startsWith('data:')){try{const m=JSON.parse(line.slice(5));if(m.id!==undefined)msg=m}catch{/* skip */}}}}
 else{try{msg=JSON.parse(text)}catch{throw new HttpError(502,`${c.name} did not return valid JSON-RPC.`)}}
 if(msg?.error)throw new HttpError(502,`${c.name}: ${String(msg.error.message||'error').slice(0,200)}`);
 return {result:msg?.result,session:sid};
}
export async function mcpSession(c:ConnectorRow,signal?:AbortSignal){
 const init=await mcpRpc(c,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'One Workspace',version:'1.0'}},null,signal);
 await mcpRpc(c,'notifications/initialized',{},init.session,signal).catch(()=>null);
 return {session:init.session,server:init.result?.serverInfo||null,capabilities:init.result?.capabilities||{}};
}
export async function mcpDiscover(c:ConnectorRow){
 const s=await mcpSession(c);
 const tools=await mcpRpc(c,'tools/list',{},s.session).then(r=>(r.result?.tools||[]) as {name:string,description?:string,inputSchema?:unknown,annotations?:{readOnlyHint?:boolean,destructiveHint?:boolean}}[]).catch(()=>[]);
 const resources=s.capabilities.resources?await mcpRpc(c,'resources/list',{},s.session).then(r=>(r.result?.resources||[]) as {uri:string,name?:string,description?:string}[]).catch(()=>[]):[];
 return {server:s.server,tools:tools.slice(0,200).map(t=>({name:String(t.name).slice(0,100),description:String(t.description||'').slice(0,300),readOnly:t.annotations?.readOnlyHint===true,destructive:t.annotations?.destructiveHint===true,inputSchema:t.inputSchema||{}})),resources:resources.slice(0,200).map(r=>({uri:String(r.uri).slice(0,300),name:String(r.name||'').slice(0,100),description:String(r.description||'').slice(0,300)}))};
}
// Reads one MCP resource (resources/read); the text is untrusted content.
export async function mcpReadResource(c:ConnectorRow,uri:string,signal?:AbortSignal){
 const s=await mcpSession(c,signal);
 const r=await mcpRpc(c,'resources/read',{uri},s.session,signal);
 const contents=(r.result?.contents||[]) as {text?:string}[];
 return contents.map(x=>String(x.text||'')).join('\n').slice(0,20000);
}
export async function mcpCall(c:ConnectorRow,tool:string,args:Record<string,unknown>,signal?:AbortSignal){
 const s=await mcpSession(c,signal);
 const r=await mcpRpc(c,'tools/call',{name:tool,arguments:args},s.session,signal);
 const content=(r.result?.content||[]) as {type:string,text?:string}[];
 return {isError:!!r.result?.isError,text:content.filter(x=>x.type==='text').map(x=>String(x.text||'')).join('\n').slice(0,20000)};
}

// ── Use from pages (widgets, assistant) ──
export function canUseConnector(u:Member,c:ConnectorRow,page:string){
 if(c.status==='disabled'||c.paused||c.tenant_id!==u.tenantId)return false;
 if(c.scope==='user')return c.owner_member_id===u.id;
 if(c.scope==='department'&&u.role!=='admin'&&(configOf(c).department||'').toLowerCase()!==u.department.toLowerCase())return false;
 if(!hasAction(u,'connectors','use_connectors')&&u.role!=='admin')return false;
 const pages=parseJson<string[]>(c.pages_json,[]),roles=parseJson<string[]>(c.roles_json,[]);
 if(!pages.includes(page))return false;
 return u.role==='admin'||roles.includes(u.roleId||'')||roles.includes(u.role);
}
const flat=(o:unknown)=>o&&typeof o==='object'&&!Array.isArray(o)?Object.fromEntries(Object.entries(o as Record<string,unknown>).filter(([,v])=>v===null||['string','number','boolean'].includes(typeof v)).slice(0,12).map(([k,v])=>[k.slice(0,40),typeof v==='string'?v.slice(0,300):v])):{value:String(o).slice(0,300)};
// Read-only data for a widget: a GET under the connector's base URL, or a read-only MCP tool.
export async function connectorRead(u:Member,id:string,path:string,limit=20){
 const c=await loadConnector(u.tenantId,id);
 if(!canUseConnector(u,c,'app-pages')){await logStatement(c,u.id,'widget.read','denied').run();throw new HttpError(403,'This connector is not available to you on custom pages.')}
 const t=typeOf(c);const started=Date.now();
 try{
  let rows:Record<string,unknown>[]=[];
  if(t.auth==='mcp'){
   const allowed=parseJson<string[]>(c.allowed_tools_json,[]),mutating=parseJson<string[]>(c.mutating_tools_json,[]);
   if(!allowed.includes(path)||mutating.includes(path))throw new HttpError(403,'Only allowed, read-only MCP tools can feed a widget.');
   const r=await mcpCall(c,path,{});rows=r.text.split('\n').filter(Boolean).slice(0,limit).map(l=>({text:l}));
  }else{
   if(!t.readable)throw new HttpError(400,'This connector cannot be read from a widget.');
   if(!/^\/[\w\-./?=&%,:]*$/.test(path||'/')||path.includes('..'))throw new HttpError(400,'Use a path such as /items?limit=10.');
   const cfg=configOf(c);const base=t.auth==='oauth2'?oauthUrls(c,t).base:safeUrl(cfg.baseUrl,'Base URL');
   const r=await outbound(c,base+(path||''),{method:'GET',retry:true,headers:{Accept:'application/json',...await authHeaders(c)}});
   if(!r.ok)throw new HttpError(502,`${c.name} returned ${r.status}.`);
   const d=await r.json().catch(()=>null) as any;
   const arr=Array.isArray(d)?d:Array.isArray(d?.value)?d.value:Array.isArray(d?.items)?d.items:Array.isArray(d?.data)?d.data:Array.isArray(d?.results)?d.results:d?[d]:[];
   const map=parseJson<Record<string,string>>(c.field_map_json,{});
   rows=arr.slice(0,limit).map((x:unknown)=>{const f=flat(x);if(!Object.keys(map).length)return f;return Object.fromEntries(Object.entries(map).map(([ext,own])=>[own,f[ext]??'']))});
  }
  await Promise.all([logStatement(c,u.id,'widget.read','ok',Date.now()-started,{path:path.slice(0,120),rows:rows.length}).run(),run('UPDATE connectors SET last_sync_at=? WHERE id=? AND tenant_id=?',now(),c.id,c.tenant_id)]);
  return rows;
 }catch(e){await logStatement(c,u.id,'widget.read','error',Date.now()-started,{path:path.slice(0,120),error:(e as Error).message.slice(0,200)}).run();throw e}
}
