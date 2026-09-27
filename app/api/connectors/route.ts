import {hasAction,pageActions} from '../../access-policy';
import {route,readBody,HttpError,all,first,stmt,batch,uid,now,str,idOf,auditStatement,platformAuditStatement,requirePlatformOwner,tenantOf,tenantSettings,parseJson,origin,hash} from '../../server/core';
import {connectorTypes,connectorTypeById} from '../../connector-catalog';
import {loadConnector,secretsOf,sealSecrets,logStatement,outbound,markHealth,authHeaders,oauthApp,oauthUrls,mcpDiscover,mcpCall,canUseConnector,connectorRead,configOf,typeOf,type ConnectorRow,type Secrets} from '../../server/connectors';
import {sealSecret,secretHint,safeUrl,PLATFORM_SCOPE} from '../../server/secrets';
import {planLimits} from '../../modules';
import type {Member} from '../../server/policy';

// Connector Center. Company scope: Company Admins (or roles with Connectors › Configure) manage their own
// workspace's connectors. Platform scope ('__platform__'): only the Platform Owner, outside support sessions.
// Secrets are write-only: responses carry at most a hint like ••••3f9a.
function scopeOf(u:Member,b:{scope?:unknown}|URLSearchParams){const s=b instanceof URLSearchParams?b.get('scope'):b.scope;if(s==='platform'){requirePlatformOwner(u);if(u.supportSessionId)throw new HttpError(409,'Exit the support session to manage platform connectors.');return PLATFORM_SCOPE}if(!hasAction(u,'connectors')&&u.role!=='admin')throw new HttpError(403,'Connectors are not available to you.');return u.tenantId}
function requireConfigure(u:Member,scope:string){if(scope===PLATFORM_SCOPE)return;if(u.role!=='admin'&&!hasAction(u,'connectors','configure'))throw new HttpError(403,'Only administrators configure connectors.')}
const view=(c:ConnectorRow)=>({id:c.id,scope:c.scope,provider:c.provider,name:c.name,description:c.description,authType:c.auth_type,config:configOf(c),secretHint:c.secret_hint,hasWebhookSecret:!!c.webhook_secret_enc,status:c.status,health:c.health,lastOkAt:c.last_ok_at,lastSyncAt:c.last_sync_at,lastError:c.last_error,syncMinutes:c.sync_minutes,pages:parseJson(c.pages_json,[]),roles:parseJson(c.roles_json,[]),allowedTools:parseJson(c.allowed_tools_json,[]),mutatingTools:parseJson(c.mutating_tools_json,[]),tools:parseJson(c.tools_json,[]),resources:parseJson(c.resources_json,[]),fieldMap:parseJson(c.field_map_json,{}),createdBy:c.created_by,createdAt:c.created_at,updatedBy:c.updated_by,updatedAt:c.updated_at});
// Company actions go to the workspace audit; platform actions to the platform audit.
function audit(u:Member,scope:string,req:Request,action:string,id:string,before:unknown,after:unknown){return scope===PLATFORM_SCOPE?platformAuditStatement({...u,tenantId:null},`connector.${action.toLowerCase().replace(/\s+/g,'-')}`,req,{id,before,after}):auditStatement(u,`Connector ${action}`,id,'Integrations',before,after)}
function cleanConfig(type:string,input:unknown){const t=connectorTypeById.get(type)!;const src=(input&&typeof input==='object'?input:{}) as Record<string,unknown>;const out:Record<string,string>={};for(const f of t.config){const v=str(src[f.key],f.label,500,!!f.required);if(!v)continue;if(f.options&&!f.options.includes(v))throw new HttpError(400,`Choose a valid ${f.label.toLowerCase()}.`);out[f.key]=/url$|endpoint/i.test(f.key)?safeUrl(v,f.label):v}if(out.testPath&&!/^\/[\w\-./?=&%]*$/.test(out.testPath))throw new HttpError(400,'The test path must start with / .');return out}
const list=(v:unknown,max=100)=>Array.isArray(v)?[...new Set(v.map(x=>String(x).slice(0,100)))].slice(0,max):[];

export const GET=route(async(req,u)=>{
 const url=new URL(req.url);const scope=scopeOf(u,url.searchParams);const id=url.searchParams.get('id');
 if(id){requireConfigure(u,scope);const c=await loadConnector(scope,idOf(id,'Connector'));const [logs,history]=await Promise.all([all('SELECT l.id,l.action,l.status,l.duration_ms AS ms,l.detail_json AS detail,l.created_at AS createdAt,m.name AS actorName FROM connector_logs l LEFT JOIN members m ON m.id=l.actor WHERE l.tenant_id=? AND l.connector_id=? ORDER BY l.created_at DESC LIMIT 80',scope,c.id),scope===PLATFORM_SCOPE?all("SELECT action,created_at AS createdAt,detail_json AS detail FROM platform_audit WHERE action LIKE 'connector.%' AND detail_json LIKE ? ORDER BY created_at DESC LIMIT 40",`%${c.id}%`):all('SELECT a.action,a.created_at AS createdAt,m.name AS actorName FROM audit a LEFT JOIN members m ON m.id=a.actor WHERE a.tenant_id=? AND a.record_id=? ORDER BY a.created_at DESC LIMIT 40',scope,c.id)]);
  return {connector:view(c),logs,history,webhookUrl:c.provider==='webhook'?`${origin(req)}/api/hooks?id=${c.id}`:null,redirectUri:`${origin(req)}/api/connectors/oauth`}}
 const rows=await all<ConnectorRow>('SELECT * FROM connectors WHERE tenant_id=? ORDER BY name',scope);
 const configure=scope===PLATFORM_SCOPE||u.role==='admin'||hasAction(u,'connectors','configure');
 // People who only use connectors see the ones enabled for them, without configuration.
 const visible=configure?rows:rows.filter(c=>['app-pages','assistant'].some(p=>canUseConnector(u,c,p)));
 const t=scope===PLATFORM_SCOPE?null:await tenantOf(u);
 const limit=t?{...(planLimits[t.plan]||planLimits.business),...((tenantSettings(t).limits as object)||{})} as {maxConnectors:number}:null;
 return {types:connectorTypes,connectors:visible.map(c=>configure?view(c):{id:c.id,name:c.name,provider:c.provider,status:c.status,pages:parseJson(c.pages_json,[])}),canConfigure:configure,limit:limit?.maxConnectors??null,pages:Object.keys(pageActions),roles:t?await all('SELECT id,name FROM roles WHERE tenant_id=? ORDER BY name',u.tenantId):[],redirectUri:`${origin(req)}/api/connectors/oauth`};
},{module:'integrations'});

export const POST=route(async(req,u)=>{
 const b=await readBody(req,100000);const scope=scopeOf(u,b);const action=String(b.action||'');
 const actor=u.id;
 // ── Use (people with "use connectors") ──
 if(action==='read'){const rows=await connectorRead(u,idOf(b.id,'Connector'),str(b.path,'Path',300,false),Math.min(50,Number(b.limit)||20));return {rows}}
 if(action==='mcp-call'){
  const c=await loadConnector(scope,idOf(b.id,'Connector'));const tool=str(b.tool,'Tool',100);
  const page=scope===PLATFORM_SCOPE?'platform':String(b.page||'app-pages');
  if(scope!==PLATFORM_SCOPE&&!canUseConnector(u,c,page)&&!(u.role==='admin'||hasAction(u,'connectors','configure'))){await logStatement(c,actor,`tool:${tool}`,'denied').run();throw new HttpError(403,'This connector is not available to you here.')}
  const allowed=parseJson<string[]>(c.allowed_tools_json,[]),mutating=parseJson<string[]>(c.mutating_tools_json,[]);
  if(!allowed.includes(tool)){await logStatement(c,actor,`tool:${tool}`,'denied',0,{reason:'not allowed'}).run();throw new HttpError(403,'This tool is not allowed. An administrator must allow it first.')}
  // Mutating tools need explicit confirmation and configure-level authority.
  if(mutating.includes(tool)){if(b.confirm!==true)return {needsConfirmation:true,tool,message:`${tool} can change data in ${c.name}. Confirm to run it.`};if(scope!==PLATFORM_SCOPE&&u.role!=='admin'&&!hasAction(u,'connectors','configure'))throw new HttpError(403,'Only administrators can run tools that change data.')}
  const args=(b.args&&typeof b.args==='object'?b.args:{}) as Record<string,unknown>;if(JSON.stringify(args).length>20000)throw new HttpError(413,'Tool input is too large.');
  const started=Date.now();
  try{const r=await mcpCall(c,tool,args,req.signal);await batch([logStatement(c,actor,`tool:${tool}`,r.isError?'error':'ok',Date.now()-started,{argKeys:Object.keys(args).slice(0,20),mutating:mutating.includes(tool),resultChars:r.text.length}),...(mutating.includes(tool)?[audit(u,scope,req,'tool run',c.id,null,{tool})]:[])]);return {result:r.text,isError:r.isError,untrusted:true}}
  catch(e){await logStatement(c,actor,`tool:${tool}`,'error',Date.now()-started,{error:(e as Error).message.slice(0,200)}).run();throw e}
 }
 requireConfigure(u,scope);
 if(action==='create'){
  const type=connectorTypeById.get(String(b.provider));if(!type)throw new HttpError(400,'Choose a connector type.');
  if(scope!==PLATFORM_SCOPE){const t=await tenantOf(u);const lim={...(planLimits[t.plan]||planLimits.business),...((tenantSettings(t).limits as object)||{})} as {maxConnectors:number};const n=await first<{n:number}>('SELECT count(*) AS n FROM connectors WHERE tenant_id=?',scope);if((n?.n||0)>=lim.maxConnectors)throw new HttpError(409,`Your plan allows ${lim.maxConnectors} connectors. Ask the Platform Owner to raise the limit.`)}
  const id=uid();const config=cleanConfig(type.id,b.config);
  const secretsIn=(b.secrets&&typeof b.secrets==='object'?b.secrets:{}) as Record<string,unknown>;const secrets:Secrets={};
  for(const f of type.secrets){const v=str(secretsIn[f.key],f.label,2000,false);if(v)(secrets as Record<string,string>)[f.key]=v;else if(f.required)throw new HttpError(400,`${f.label} is required.`)}
  const sealed=Object.keys(secrets).length?await sealSecrets(scope,id,secrets):null;
  // Webhooks get a generated signing secret, shown once.
  const webhookSecret=type.id==='webhook'?Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join(''):null;
  const pages=list(b.pages).filter(p=>['app-pages','assistant'].includes(p)),roles=list(b.roles);
  await batch([stmt('INSERT INTO connectors(id,tenant_id,scope,provider,name,description,auth_type,config_json,secret_enc,secret_hint,webhook_secret_enc,status,pages_json,roles_json,sync_minutes,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,scope,scope===PLATFORM_SCOPE?'platform':'company',type.id,str(b.name||type.name,'Name',80),str(b.description,'Description',300,false),type.auth,JSON.stringify(config),sealed,secrets.secret?secretHint(secrets.secret):secrets.clientSecret?secretHint(secrets.clientSecret):'',webhookSecret?await sealSecret(scope,`${id}:webhook`,webhookSecret):null,type.auth==='oauth2'?'needs-auth':'configured',JSON.stringify(pages),JSON.stringify(roles),Math.max(0,Math.min(1440,Math.round(Number(b.syncMinutes)||0))),u.name,now(),u.name,now()),
   audit(u,scope,req,'connected',id,null,{provider:type.id,name:b.name||type.name,config,pages,roles}),logStatement({id,tenant_id:scope},actor,'create','ok')]);
  return {id,webhookSecret};
 }
 const c=await loadConnector(scope,idOf(b.id,'Connector'));const type=typeOf(c);
 switch(action){
  case 'update':{
   const config=b.config?cleanConfig(c.provider,b.config):configOf(c);
   const pages=b.pages!==undefined?list(b.pages).filter(p=>['app-pages','assistant'].includes(p)):parseJson(c.pages_json,[]);
   const roles=b.roles!==undefined?list(b.roles):parseJson(c.roles_json,[]);
   const known=new Set(parseJson<{name:string}[]>(c.tools_json,[]).map(t=>t.name));
   const allowed=b.allowedTools!==undefined?list(b.allowedTools,200).filter(t=>known.has(t)):parseJson(c.allowed_tools_json,[]);
   const mutating=b.mutatingTools!==undefined?list(b.mutatingTools,200).filter(t=>known.has(t)):parseJson(c.mutating_tools_json,[]);
   const fieldMap=b.fieldMap&&typeof b.fieldMap==='object'?Object.fromEntries(Object.entries(b.fieldMap as Record<string,unknown>).slice(0,40).map(([k,v])=>[k.slice(0,60),str(v,'Field',60)])):parseJson(c.field_map_json,{});
   const next={name:str(b.name??c.name,'Name',80),description:str(b.description??c.description,'Description',300,false),config,pages,roles,allowed,mutating,fieldMap,syncMinutes:b.syncMinutes!==undefined?Math.max(0,Math.min(1440,Math.round(Number(b.syncMinutes)||0))):c.sync_minutes};
   await batch([stmt('UPDATE connectors SET name=?,description=?,config_json=?,pages_json=?,roles_json=?,allowed_tools_json=?,mutating_tools_json=?,field_map_json=?,sync_minutes=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',next.name,next.description,JSON.stringify(config),JSON.stringify(pages),JSON.stringify(roles),JSON.stringify(allowed),JSON.stringify(mutating),JSON.stringify(fieldMap),next.syncMinutes,u.name,now(),c.id,scope),audit(u,scope,req,'configured',c.id,{name:c.name,config:configOf(c),pages:parseJson(c.pages_json,[]),roles:parseJson(c.roles_json,[]),allowed:parseJson(c.allowed_tools_json,[]),mutating:parseJson(c.mutating_tools_json,[])},{...next,fieldMap:undefined}),logStatement(c,actor,'configure','ok')]);
   return {ok:true};
  }
  case 'rotate':{
   if(type.id==='webhook'){const secret=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');await batch([stmt('UPDATE connectors SET webhook_secret_enc=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',await sealSecret(scope,`${c.id}:webhook`,secret),u.name,now(),c.id,scope),audit(u,scope,req,'credentials rotated',c.id,null,{webhook:true}),logStatement(c,actor,'rotate','ok')]);return {webhookSecret:secret}}
   const cur=await secretsOf(c);const input=(b.secrets&&typeof b.secrets==='object'?b.secrets:{}) as Record<string,unknown>;const next:Secrets={...cur};let changed=false;
   for(const f of type.secrets){const v=str(input[f.key],f.label,2000,false);if(v){(next as Record<string,string>)[f.key]=v;changed=true}}
   if(!changed)throw new HttpError(400,'Enter the new credential.');
   await batch([stmt('UPDATE connectors SET secret_enc=?,secret_hint=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',await sealSecrets(scope,c.id,next),secretHint(next.secret||next.clientSecret||''),u.name,now(),c.id,scope),audit(u,scope,req,'credentials rotated',c.id,null,{fields:type.secrets.filter(f=>input[f.key]).map(f=>f.key)}),logStatement(c,actor,'rotate','ok')]);
   return {ok:true};
  }
  case 'disable':case 'enable':{
   await batch([stmt('UPDATE connectors SET status=?,updated_by=?,updated_at=? WHERE id=? AND tenant_id=?',action==='disable'?'disabled':'configured',u.name,now(),c.id,scope),audit(u,scope,req,action==='disable'?'disabled':'enabled',c.id,{status:c.status},{status:action==='disable'?'disabled':'configured'}),logStatement(c,actor,action,'ok')]);return {ok:true};
  }
  case 'disconnect':{
   // Explicit confirmation: the connector's exact name must be typed.
   if(String(b.confirm||'').trim()!==c.name)throw new HttpError(400,`Type the connector name “${c.name}” to confirm.`);
   await batch([stmt('DELETE FROM connectors WHERE id=? AND tenant_id=?',c.id,scope),audit(u,scope,req,'disconnected',c.id,{name:c.name,provider:c.provider},null),logStatement(c,actor,'disconnect','ok')]);return {ok:true};
  }
  case 'test':case 'sync':{
   const started=Date.now();
   try{
    let detail:Record<string,unknown>={};
    if(type.auth==='mcp'){const d=await mcpDiscover(c);
     // Safe default on first discovery: every tool not declared read-only is treated as changing data.
     const first=!parseJson<string[]>(c.allowed_tools_json,[]).length&&!parseJson<string[]>(c.mutating_tools_json,[]).length;
     await stmt('UPDATE connectors SET tools_json=?,resources_json=?,last_sync_at=?,mutating_tools_json=CASE WHEN ? THEN ? ELSE mutating_tools_json END WHERE id=? AND tenant_id=?',JSON.stringify(d.tools),JSON.stringify(d.resources),now(),first?1:0,JSON.stringify(d.tools.filter(t=>!t.readOnly).map(t=>t.name)),c.id,scope).run();detail={server:d.server?.name||null,tools:d.tools.length,resources:d.resources.length}}
    else if(type.auth==='webhook'){const last=await first<{created_at:string}>("SELECT created_at FROM connector_logs WHERE tenant_id=? AND connector_id=? AND action='webhook.received' AND status='ok' ORDER BY created_at DESC LIMIT 1",scope,c.id);detail={lastEvent:last?.created_at||null};if(!last)throw new HttpError(409,'No signed event has been received yet. Send one to the webhook URL.')}
    else{const url=type.auth==='oauth2'?oauthUrls(c,type).test:`${safeUrl(configOf(c).baseUrl,'Base URL')}${configOf(c).testPath||''}`;const r=await outbound(c,url,{method:'GET',retry:true,headers:{Accept:'application/json',...await authHeaders(c)}});detail={status:r.status};if(!r.ok)throw new HttpError(502,`${c.name} answered ${r.status}.`);if(action==='sync')await stmt('UPDATE connectors SET last_sync_at=? WHERE id=? AND tenant_id=?',now(),c.id,scope).run()}
    await markHealth(c,true);await logStatement(c,actor,action,'ok',Date.now()-started,detail).run();
    return {ok:true,ms:Date.now()-started,detail};
   }catch(e){const msg=e instanceof HttpError?e.message:'Connection failed.';await markHealth(c,false,msg);await logStatement(c,actor,action,'error',Date.now()-started,{error:msg.slice(0,200)}).run();return {ok:false,error:msg}}
  }
  case 'oauth-start':{
   if(type.auth!=='oauth2')throw new HttpError(400,'This connector does not use OAuth.');
   const app=await oauthApp(c,type);const urls=oauthUrls(c,type);
   const state=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
   const verifier=Array.from(crypto.getRandomValues(new Uint8Array(48)),x=>x.toString(16).padStart(2,'0')).join('');
   const challenge=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
   await batch([stmt('DELETE FROM oauth_states WHERE expires<?',Date.now()),stmt('INSERT INTO oauth_states(state_hash,tenant_id,connector_id,member_id,verifier_enc,expires) VALUES(?,?,?,?,?,?)',await hash(state),scope,c.id,u.id,await sealSecret(scope,`${c.id}:pkce`,verifier),Date.now()+600000),logStatement(c,actor,'oauth.start','ok')]);
   const q=new URLSearchParams({client_id:app.clientId,response_type:'code',redirect_uri:`${origin(req)}/api/connectors/oauth`,scope:urls.scopes.join(' '),state,code_challenge:challenge,code_challenge_method:'S256',...(type.family==='google'?{access_type:'offline',prompt:'consent'}:{})});
   return {url:`${urls.authorize}?${q}`};
  }
 }
 throw new HttpError(400,'Unknown action.');
},{module:'integrations'});
