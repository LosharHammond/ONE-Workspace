import {env} from 'cloudflare:workers';
import {HttpError} from './core';
// Short-lived signed file links (5 minutes). A link is issued only after the normal access check, names the
// workspace, file, version and person, and is verified with HMAC-SHA256 using a key derived from SECRETS_KEY.
const enc=new TextEncoder();
async function key(){if(typeof env.SECRETS_KEY!=='string'||env.SECRETS_KEY.length<32)throw new HttpError(503,'Signed links need the SECRETS_KEY server secret.');const base=await crypto.subtle.importKey('raw',enc.encode(env.SECRETS_KEY),'HKDF',false,['deriveKey']);return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode('one-workspace-file-links'),info:enc.encode('v1')},base,{name:'HMAC',hash:'SHA-256',length:256},false,['sign','verify'])}
const b64u=(b:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
export async function signFileLink(p:{tenantId:string,fileId:string,version:number,memberId:string,disposition:'inline'|'attachment',kind?:string},ttlSec=300){
 const exp=Math.floor(Date.now()/1000)+ttlSec;const payload=[p.tenantId,p.fileId,p.version,p.memberId,p.disposition,p.kind||'file',exp].join('.');
 const sig=b64u(await crypto.subtle.sign('HMAC',await key(),enc.encode(payload)));
 return `/api/files/signed?t=${encodeURIComponent(btoa(payload))}&s=${sig}`;
}
export async function verifyFileLink(t:string,s:string){
 let payload='';try{payload=atob(t)}catch{throw new HttpError(403,'Invalid link.')}
 const parts=payload.split('.');if(parts.length!==7)throw new HttpError(403,'Invalid link.');
 const sig=Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((s.length+3)%4)),c=>c.charCodeAt(0));
 if(!await crypto.subtle.verify('HMAC',await key(),sig,enc.encode(payload)))throw new HttpError(403,'Invalid link.');
 const [tenantId,fileId,version,memberId,disposition,kind,exp]=parts;
 if(Number(exp)<Date.now()/1000)throw new HttpError(403,'This link has expired. Open the file again to get a new one.');
 return {tenantId,fileId,version:Number(version),memberId,disposition:disposition as 'inline'|'attachment',kind};
}
