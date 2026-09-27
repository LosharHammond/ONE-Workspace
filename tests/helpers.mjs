// Minimal browser-like client for the acceptance tests: keeps the session cookie and sends the
// same-origin header the API requires for writes.
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
export const BASE=process.env.OWS_BASE,SETUP=process.env.OWS_SETUP,STATE=process.env.OWS_STATE;
export const rand=()=>randomBytes(4).toString('hex');
export const strongPassword=()=>`Test-${randomBytes(12).toString('hex')}!`;
export class Client{
 constructor(){this.cookie=''}
 async req(path,body,method,attempt=0){
  const r=await fetch(BASE+path,{method:method||(body===undefined?'GET':'POST'),redirect:'manual',headers:{Origin:BASE,...(body!==undefined?{'Content-Type':'application/json'}:{}),...(this.cookie?{Cookie:this.cookie}:{})},body:body===undefined?undefined:JSON.stringify(body)});
  const set=r.headers.get('set-cookie');if(set){const m=set.match(/(__Host-ows-session=[^;]*)/);if(m)this.cookie=m[1].endsWith('=')?'':m[1]}
  const text=await r.text();
  // Wrangler dev reloads after direct database reads; it states the request never ran, so retry it.
  if(r.status===503&&text.includes('restarted mid-request')&&attempt<8){await new Promise(x=>setTimeout(x,1000));return this.req(path,body,method,attempt+1)}
  let data={};try{data=JSON.parse(text)}catch{data={_raw:text.slice(0,300)}}
  return {status:r.status,data};
 }
 get(p){return this.req(p)}
 post(p,b){return this.req(p,b)}
 async login(login,password){const r=await this.post('/api/auth/login',{login,password});if(r.status!==200)throw Error(`login ${login}: ${r.status} ${r.data.error}`);return r}
 async upload(entityType,entityId,name,text){const fd=new FormData();fd.set('file',new File([text],name,{type:'text/plain'}));fd.set('entityType',entityType);fd.set('entityId',entityId);for(let i=0;i<8;i++){const r=await fetch(BASE+'/api/files',{method:'POST',headers:{Origin:BASE,Cookie:this.cookie},body:fd});const text=await r.text();if(r.status===503&&text.includes('restarted mid-request')){await new Promise(x=>setTimeout(x,1000));continue}return {status:r.status,data:JSON.parse(text)}}throw Error('Worker kept restarting')}
}
export const tokenFrom=link=>link.split('#/activate/')[1];
// Reads the isolated test database directly (never the development database).
// Reading the database with a separate wrangler process makes the local Worker reload; callers await
// settle() before the next request so it never lands mid-restart.
export async function settle(){await new Promise(r=>setTimeout(r,1500));for(let i=0;i<40;i++){try{const r=await fetch(BASE+'/api/session');if(r.ok&&(await r.text()).includes('mode'))return}catch{}await new Promise(r=>setTimeout(r,250))}}
export function sql(query){const out=execFileSync(process.execPath,['--import','./scripts/wrangler-env.mjs','./node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--local','--config','dist/server/wrangler.json','--persist-to',STATE,'--json','--command',query],{encoding:'utf8',stdio:['ignore','pipe','ignore']});return JSON.parse(out)[0].results}
