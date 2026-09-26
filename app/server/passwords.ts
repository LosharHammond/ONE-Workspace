export const ITERATIONS=100000;
export function hex(a:ArrayBuffer){return Array.from(new Uint8Array(a)).map(b=>b.toString(16).padStart(2,'0')).join('')}
export function randomHex(){return hex(crypto.getRandomValues(new Uint8Array(32)).buffer)}
export async function derive(password:string,salt:string,iterations=ITERATIONS){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return hex(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:Uint8Array.from(salt.match(/.{2}/g)!,b=>parseInt(b,16)),iterations},key,256))}
export function equal(a:string,b:string){let diff=a.length^b.length;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^(b.charCodeAt(i)||0);return diff===0}
