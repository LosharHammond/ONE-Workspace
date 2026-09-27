import {env} from 'cloudflare:workers';
import {HttpError} from './core';

// Secrets at rest (connector credentials, AI provider keys, webhook secrets).
// AES-256-GCM with a key derived from the SECRETS_KEY server secret and the owning scope (a workspace id or
// "__platform__"). The scope and record id are bound as additional data, so a secret copied into another
// workspace's row cannot be decrypted there. Plaintext secrets are never returned to the browser or logged.
export const PLATFORM_SCOPE='__platform__';
const enc=new TextEncoder(),dec=new TextDecoder();
const b64=(b:ArrayBuffer|Uint8Array)=>btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export function secretsConfigured(){return typeof env.SECRETS_KEY==='string'&&env.SECRETS_KEY.length>=32}
async function keyFor(scope:string){
 if(!secretsConfigured())throw new HttpError(503,'Secret storage is not configured. Add a SECRETS_KEY server secret (32+ random characters).');
 const base=await crypto.subtle.importKey('raw',enc.encode(env.SECRETS_KEY!),'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode('one-workspace-secrets-v1'),info:enc.encode(scope)},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function sealSecret(scope:string,recordId:string,plaintext:string){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:enc.encode(`${scope}|${recordId}`)},await keyFor(scope),enc.encode(plaintext));
 return `v1:${b64(iv)}:${b64(ct)}`;
}
export async function openSecret(scope:string,recordId:string,sealed:string|null|undefined){
 if(!sealed)return '';
 const [v,iv,ct]=sealed.split(':');if(v!=='v1'||!iv||!ct)throw new HttpError(500,'Stored secret is unreadable.');
 try{return dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:enc.encode(`${scope}|${recordId}`)},await keyFor(scope),unb64(ct)))}
 catch{throw new HttpError(500,'Stored secret could not be decrypted. Re-enter the credential.')}
}
// A short, non-reversible hint shown after saving ("••••3f9a").
export const secretHint=(s:string)=>s?`••••${s.slice(-4)}`:'';
// Outbound URLs must be https; plain http is accepted only for a service on this machine (local development).
export function safeUrl(v:unknown,label='URL'){
 if(typeof v!=='string'||!v.trim())throw new HttpError(400,`${label} is required.`);
 let u:URL;try{u=new URL(v.trim())}catch{throw new HttpError(400,`Enter a valid ${label}.`)}
 const local=['localhost','127.0.0.1','[::1]'].includes(u.hostname);
 if(u.protocol!=='https:'&&!(u.protocol==='http:'&&local))throw new HttpError(400,`${label} must use https.`);
 if(u.username||u.password)throw new HttpError(400,`Put credentials in the secret field, not in the ${label}.`);
 return u.toString().replace(/\/$/,'');
}
