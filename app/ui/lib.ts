'use client';
import {useCallback,useEffect,useRef,useState} from 'react';

// ── API ─────────────────────────────────────────────────────────────────────
export class ApiError extends Error{constructor(message:string,public status:number){super(message)}}
export async function api<T=any>(url:string,body?:unknown,init?:RequestInit):Promise<T>{
 const isForm=typeof FormData!=='undefined'&&body instanceof FormData;
 const r=await fetch(url,{cache:'no-store',...(body!==undefined?{method:'POST',body:isForm?body as FormData:JSON.stringify(body),headers:isForm?undefined:{'Content-Type':'application/json'}}:{}),...init});
 let d:any={};try{d=await r.json()}catch{}
 if(!r.ok)throw new ApiError(d.error||`Request failed (${r.status}).`,r.status);
 return d as T;
}
// Loads data on mount and whenever `key` changes; `reload` refetches in place.
export function useApi<T=any>(url:string|null){
 const [data,setData]=useState<T|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(!!url);
 const seq=useRef(0);
 const reload=useCallback(async()=>{if(!url)return;const n=++seq.current;setLoading(true);try{const d=await api<T>(url);if(n===seq.current){setData(d);setError('')}}catch(e){if(n===seq.current)setError((e as Error).message)}finally{if(n===seq.current)setLoading(false)}},[url]);
 useEffect(()=>{reload()},[reload]);
 return {data,error,loading,reload,setData};
}

// ── Router (hash based: #/app/view/id) ──────────────────────────────────────
export type Route={app:string,parts:string[]};
export function parseHash(h:string):Route{const clean=h.replace(/^#\/?/,'');const parts=clean.split('/').filter(Boolean).map(decodeURIComponent);return {app:parts[0]||'home',parts:parts.slice(1)}}
export function go(path:string){const next=path.startsWith('#')?path:'#/'+path.replace(/^\//,'');if(location.hash!==next)location.hash=next}
export function useRoute(){const [r,setR]=useState<Route>(()=>typeof location==='undefined'?{app:'home',parts:[]}:parseHash(location.hash));useEffect(()=>{const f=()=>setR(parseHash(location.hash));f();window.addEventListener('hashchange',f);return()=>window.removeEventListener('hashchange',f)},[]);return r}

// ── Formatting ──────────────────────────────────────────────────────────────
export const money=(n:number,currency='GHS',digits=2)=>{try{return new Intl.NumberFormat('en-GH',{style:'currency',currency,maximumFractionDigits:digits,minimumFractionDigits:digits}).format(n||0)}catch{return `${currency} ${(n||0).toLocaleString(undefined,{maximumFractionDigits:digits})}`}};
export const compact=(n:number)=>new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(n||0);
export const dateOnly=(s?:string|null)=>s?new Date(s.length===10?s+'T00:00:00':s).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}):'—';
export const dateTime=(s?:string|null)=>s?new Date(s).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'—';
export function ago(s?:string|null){if(!s)return 'never';const d=(Date.now()-Date.parse(s))/1000;if(d<60)return 'just now';if(d<3600)return `${Math.floor(d/60)}m ago`;if(d<86400)return `${Math.floor(d/3600)}h ago`;if(d<86400*7)return `${Math.floor(d/86400)}d ago`;return dateOnly(s)}
export function until(s?:string|null){if(!s)return '';const d=(Date.parse(s)-Date.now())/3600000;if(d<0)return `${Math.ceil(-d)<48?Math.ceil(-d)+'h':Math.ceil(-d/24)+'d'} overdue`;return d<48?`due in ${Math.ceil(d)}h`:`due in ${Math.ceil(d/24)}d`}
export const bytes=(n:number)=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(0)} KB`:`${(n/1048576).toFixed(1)} MB`;
export const initials=(name?:string)=>(name||'?').split(/\s+/).filter(Boolean).slice(0,2).map(s=>s[0]).join('').toUpperCase();
export const cx=(...c:(string|false|null|undefined)[])=>c.filter(Boolean).join(' ');
export const slug=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
// Stable pastel hue per string, for avatars and space covers.
export function hue(s:string){let h=0;for(const c of s||'')h=(h*31+c.charCodeAt(0))%360;return h}

// ── Local preferences (per viewer; storage can be unavailable) ──────────────
export function pref<T>(key:string,fallback:T):T{try{const v=localStorage.getItem('ows:'+key);return v===null?fallback:JSON.parse(v)}catch{return fallback}}
export function setPref(key:string,value:unknown){try{localStorage.setItem('ows:'+key,JSON.stringify(value))}catch{}}

// ── Files ───────────────────────────────────────────────────────────────────
export function downloadCsv(name:string,rows:unknown[][]){
 const esc=(v:unknown)=>`"${String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')}"`;
 const url=URL.createObjectURL(new Blob(['﻿'+rows.map(r=>r.map(esc).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
 const a=document.createElement('a');a.href=url;a.download=name.endsWith('.csv')?name:name+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function parseCsv(text:string){const rows:string[][]=[];let row:string[]=[],cell='',q=false;for(let i=0;i<text.length;i++){const c=text[i];if(q){if(c==='"'&&text[i+1]==='"'){cell+='"';i++}else if(c==='"')q=false;else cell+=c}else if(c==='"')q=true;else if(c===','){row.push(cell);cell=''}else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell=''}else cell+=c}if(cell||row.length){row.push(cell);rows.push(row)}return rows.filter(r=>r.some(c=>c.trim()))}

// Minimal .xlsx reader (first worksheet) using the browser's built-in inflate.
export async function readXlsx(file:File):Promise<string[][]>{
 const buf=new Uint8Array(await file.arrayBuffer());const dv=new DataView(buf.buffer);
 let eocd=-1;for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--)if(dv.getUint32(i,true)===0x06054b50){eocd=i;break}
 if(eocd<0)throw Error('This is not a valid .xlsx file.');
 const count=dv.getUint16(eocd+10,true);let p=dv.getUint32(eocd+16,true);const entries:Record<string,{method:number,size:number,offset:number}>={};
 for(let i=0;i<count;i++){const method=dv.getUint16(p+10,true),size=dv.getUint32(p+20,true),nameLen=dv.getUint16(p+28,true),extra=dv.getUint16(p+30,true),comment=dv.getUint16(p+32,true),offset=dv.getUint32(p+42,true);const name=new TextDecoder().decode(buf.subarray(p+46,p+46+nameLen));entries[name]={method,size,offset};p+=46+nameLen+extra+comment}
 async function text(name:string){const e=entries[name];if(!e)return '';const lh=e.offset,start=lh+30+dv.getUint16(lh+26,true)+dv.getUint16(lh+28,true);const data=buf.subarray(start,start+e.size);if(e.method===0)return new TextDecoder().decode(data);const ds=new DecompressionStream('deflate-raw');const out=new Response(new Blob([data]).stream().pipeThrough(ds));return await out.text()}
 const xml=(s:string)=>new DOMParser().parseFromString(s,'application/xml');
 const shared=[...xml(await text('xl/sharedStrings.xml')).getElementsByTagName('si')].map(si=>[...si.getElementsByTagName('t')].map(t=>t.textContent||'').join(''));
 const wb=xml(await text('xl/workbook.xml'));const firstSheet=wb.getElementsByTagName('sheet')[0];const rid=firstSheet?.getAttribute('r:id');
 let path='xl/worksheets/sheet1.xml';if(rid){const rels=xml(await text('xl/_rels/workbook.xml.rels'));for(const r of rels.getElementsByTagName('Relationship'))if(r.getAttribute('Id')===rid){const t=r.getAttribute('Target')||'';path=t.startsWith('/')?t.slice(1):'xl/'+t.replace(/^\.\//,'')}}
 const sheet=xml(await text(path));const out:string[][]=[];
 const col=(ref:string)=>{const m=ref.match(/^[A-Z]+/)?.[0]||'A';let n=0;for(const c of m)n=n*26+c.charCodeAt(0)-64;return n-1};
 for(const row of sheet.getElementsByTagName('row')){const r:string[]=[];for(const c of row.getElementsByTagName('c')){const t=c.getAttribute('t'),v=c.getElementsByTagName('v')[0]?.textContent??'';let val=t==='s'?shared[Number(v)]??'':t==='inlineStr'?[...c.getElementsByTagName('t')].map(x=>x.textContent).join(''):v;val=val.replaceAll('&gt;','>');r[col(c.getAttribute('r')||'A')]=val}out.push(Array.from(r,x=>x??''))}
 return out.filter(r=>r.some(c=>String(c).trim()));
}
// Turns a sheet into objects using the first row that looks like a header.
export function sheetObjects(rows:string[][],hint=/name|email/i){const hi=Math.max(0,rows.findIndex(r=>r.filter(c=>String(c).trim()).length>=2&&r.some(c=>hint.test(String(c)))));const header=rows[hi]||[];return rows.slice(hi+1).map(r=>Object.fromEntries(header.map((h,i)=>[String(h).trim(),String(r[i]??'').trim()]).filter(([h])=>h)))}
