import {currentUser,first,stmt,batch,now,hash,origin,platformAuditStatement,auditStatement,failure} from '../../../server/core';
import {loadConnector,oauthApp,oauthUrls,outbound,sealSecrets,secretsOf,logStatement,markHealth,typeOf} from '../../../server/connectors';
import {openSecret,PLATFORM_SCOPE} from '../../../server/secrets';
// OAuth 2.0 redirect target. The state is single-use, expires after 10 minutes, is bound to the person who
// started the flow and to the connector's workspace, and the code is exchanged with PKCE on the server.
export async function GET(req:Request){
 const url=new URL(req.url);const back=(path:string,msg:string)=>Response.redirect(`${origin(req)}/#/${path}?oauth=${encodeURIComponent(msg)}`,302);
 try{
  const u=await currentUser(req);if(!u)return back('home','Sign in and try again.');
  const state=url.searchParams.get('state')||'',code=url.searchParams.get('code')||'';
  const s=state?await first<{tenant_id:string,connector_id:string,member_id:string,verifier_enc:string,expires:number}>('SELECT * FROM oauth_states WHERE state_hash=?',await hash(state)):null;
  if(s)await stmt('DELETE FROM oauth_states WHERE state_hash=?',await hash(state)).run();
  const platform=s?.tenant_id===PLATFORM_SCOPE;
  if(!s||s.expires<Date.now()||s.member_id!==u.id||(!platform&&s.tenant_id!==u.tenantId)||(platform&&u.platformRole!=='owner'))return back('home','The sign-in link was invalid or expired. Start again from the Connector Center.');
  const page=platform?`platform/connectors/${s.connector_id}`:`admin/connectors/${s.connector_id}`;
  const c=await loadConnector(s.tenant_id,s.connector_id);
  if(url.searchParams.get('error')||!code){await logStatement(c,u.id,'oauth.callback','error',0,{error:(url.searchParams.get('error')||'no code').slice(0,80)}).run();return back(page,'Sign-in was cancelled or refused.')}
  const t=typeOf(c);const app=await oauthApp(c,t);const urls=oauthUrls(c,t);
  const verifier=await openSecret(s.tenant_id,`${c.id}:pkce`,s.verifier_enc);
  const r=await outbound(c,urls.token,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},body:new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:`${origin(req)}/api/connectors/oauth`,client_id:app.clientId,code_verifier:verifier,...(app.clientSecret?{client_secret:app.clientSecret}:{})})});
  if(!r.ok){await markHealth(c,false,`Token exchange failed (${r.status}).`);await logStatement(c,u.id,'oauth.callback','error',0,{status:r.status}).run();return back(page,'The service refused the sign-in. Check the app registration.')}
  const d=await r.json() as {access_token:string,refresh_token?:string,expires_in?:number};
  const next={...await secretsOf(c),accessToken:d.access_token,refreshToken:d.refresh_token,expiresAt:Date.now()+(d.expires_in||3600)*1000};
  await batch([stmt("UPDATE connectors SET secret_enc=?,status='connected',health='healthy',last_ok_at=?,last_error='' WHERE id=? AND tenant_id=?",await sealSecrets(s.tenant_id,c.id,next),now(),c.id,s.tenant_id),logStatement(c,u.id,'oauth.connected','ok'),platform?platformAuditStatement({...u,tenantId:null},'connector.oauth-connected',req,{id:c.id}):auditStatement(u,'Connector signed in (OAuth)',c.id,'Integrations',null,{provider:c.provider})]);
  return back(page,'Connected.');
 }catch(e){const r=failure(e);return r.status>=500?back('home','Connecting failed. Try again.'):r}
}
