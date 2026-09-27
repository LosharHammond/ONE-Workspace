import {env} from 'cloudflare:workers';
import {all,first,stmt,batch,uid,now,hash} from './core';
import {aiProviderCatalog,embed,type AiProvider} from './ai';
import {openSecret} from './secrets';
import {hitsByIds,type Hit,type SourceType} from './search';
import type {Member} from './policy';

// Workspace knowledge index for ONE (vector search).
// Embeddings: Groq has no embeddings API, so workspaces on the Groq default use Cloudflare Workers AI
// (@cf/baai/bge-base-en-v1.5). A company whose own provider offers embeddings can opt in by setting an
// embedding model in AI settings; its data is then embedded by its own provider.
// Vectors: Cloudflare Vectorize with one namespace per workspace when the VECTORIZE binding exists, otherwise
// a D1 table filtered by tenant_id (local development). The index holds every record of the workspace; results
// are ALWAYS re-checked with the asking person's permissions (hitsByIds) before anything reaches a model.
type WorkersAi={run:(model:string,input:{text:string[]})=>Promise<{data:number[][]}>};
type Vectorize={upsert:(v:{id:string,values:number[],namespace?:string,metadata?:Record<string,string>}[])=>Promise<unknown>,query:(v:number[],o:{topK:number,namespace?:string,returnMetadata?:'all'|'indexed'|'none'})=>Promise<{matches:{id:string,score:number,metadata?:Record<string,string>}[]}>,deleteByIds:(ids:string[])=>Promise<unknown>};
const bindings=()=>env as unknown as {AI?:WorkersAi,VECTORIZE?:Vectorize};
export const WORKERS_AI_EMBEDDING='@cf/baai/bge-base-en-v1.5';
const DEFAULT_EMBEDDING:Record<string,string>={openai:'text-embedding-3-small','openai-compatible':'text-embedding-3-small','azure-openai':'text-embedding-3-small',gemini:'text-embedding-004'};

export type Embedder={source:'workers-ai'|'company',model:string,embed:(texts:string[])=>Promise<number[][]>};
export async function embedderFor(tenantId:string):Promise<Embedder|null>{
 const c=await first<{id:string,provider:string,model:string,base_url:string,secret_enc:string|null,embedding_model:string,label:string}>('SELECT id,provider,model,base_url,secret_enc,embedding_model,label FROM ai_providers WHERE tenant_id=? AND active=1',tenantId).catch(()=>null);
 const cat=c?aiProviderCatalog.find(p=>p.id===c.provider):null;
 if(c&&cat?.embeddings&&c.embedding_model){
  const p:AiProvider={id:cat.id,name:c.label||cat.name,model:c.model,baseUrl:(c.base_url||cat.baseUrl).replace(/\/$/,''),key:await openSecret(tenantId,c.id,c.secret_enc),source:'company',fallback:'none'};
  const model=c.embedding_model||DEFAULT_EMBEDDING[cat.id];
  return {source:'company',model:`${cat.id}:${model}`,embed:t=>embed(p,t,model)};
 }
 const ai=bindings().AI;
 if(ai)return {source:'workers-ai',model:WORKERS_AI_EMBEDDING,embed:async t=>(await ai.run(WORKERS_AI_EMBEDDING,{text:t})).data};
 return null;
}
const storeFor=(e:Embedder)=>e.source==='workers-ai'&&bindings().VECTORIZE?'vectorize':'d1';
export async function knowledgeInfo(tenantId:string){
 const e=await embedderFor(tenantId);
 const r=await first<{docs:number,chunks:number,last:string|null}>('SELECT count(*) AS docs,coalesce(sum(chunks),0) AS chunks,max(indexed_at) AS last FROM knowledge_documents WHERE tenant_id=?',tenantId);
 return {available:!!e,source:e?.source||null,model:e?.model||null,store:e?storeFor(e):null,documents:r?.docs||0,chunks:r?.chunks||0,lastIndexedAt:r?.last||null};
}

// ── What gets indexed (system view; permissions are applied at query time) ──
type Doc={type:SourceType,id:string,text:string};
const clip=(s:unknown,n:number)=>String(s??'').replace(/\s+/g,' ').trim().slice(0,n);
const sources:{type:SourceType,table:string,sql:string,text:(r:any)=>string,updated:boolean,where?:string}[]=[
 {type:'ticket',table:'tickets',sql:'id,number,title,description,category,subcategory,department,status,priority,location',updated:true,text:r=>`Ticket ${r.number}: ${r.title}. Category ${r.category} ${r.subcategory}. Department ${r.department}. Status ${r.status}, priority ${r.priority}. Location ${r.location}. ${clip(r.description,3000)}`},
 {type:'page',table:'pages',sql:'id,title,body,department,kind',updated:true,text:r=>`${r.kind==='announcement'?'Announcement':'Page'} ${r.title} (${r.department||'Company'}): ${clip(r.body,6000)}`},
 {type:'asset',table:'assets',sql:'id,code,name,category,subcategory,brand,model,serial,status,location,department,notes,vendor',updated:true,text:r=>`Asset ${r.code}: ${r.name}. ${r.category} ${r.subcategory}, ${r.brand} ${r.model}, serial ${r.serial}. Status ${r.status}. Location ${r.location}. Department ${r.department}. Vendor ${r.vendor}. ${clip(r.notes,1500)}`},
 {type:'doc',table:'purchase_docs',sql:'id,kind,number,title,justification,department,status,total,currency',updated:true,text:r=>`${r.kind==='PO'?'Purchase order':'Purchase requisition'} ${r.number}: ${r.title}. Department ${r.department}, status ${r.status}, total ${r.currency} ${r.total}. ${clip(r.justification,2500)}`},
 // Files include their generated summary and the start of their extracted text or transcript.
 {type:'file',table:'files',sql:"t.id,t.name,t.description,t.tags,t.department,(SELECT content FROM file_artifacts a WHERE a.tenant_id=t.tenant_id AND a.file_id=t.id AND a.kind='summary' ORDER BY a.created_at DESC LIMIT 1) AS summary,(SELECT substr(content,1,6000) FROM file_artifacts a WHERE a.tenant_id=t.tenant_id AND a.file_id=t.id AND a.kind='text' ORDER BY a.created_at DESC LIMIT 1) AS extracted",updated:true,where:'t.deleted_at IS NULL',text:r=>{let sum='';try{const j=JSON.parse(r.summary||'{}');sum=[j.short,j.detailed].filter(Boolean).join(' ')}catch{/* none */}return `File ${r.name} (${r.department||'company'}), tags ${r.tags}. ${clip(r.description,800)} ${clip(sum,2500)} ${clip(r.extracted,5000)}`}},
 {type:'task',table:'tasks',sql:'t.id,t.title,t.description,t.status,t.type,t.tags,t.due_date',updated:true,where:'t.deleted_at IS NULL',text:r=>`Task ${r.title} (${r.type}), status ${r.status}, due ${r.due_date||'—'}, tags ${r.tags}. ${clip(r.description,2000)}`},
 {type:'project',table:'projects',sql:'t.id,t.code,t.name,t.type,t.stage,t.description,t.business_case,t.department',updated:true,text:r=>`Project ${r.code} ${r.name} (${r.type}), stage ${r.stage}, department ${r.department}. ${clip(r.description,2500)} ${clip(r.business_case,1500)}`},
 {type:'message',table:'messages',sql:'t.id,t.body,t.created_at',updated:false,where:'t.deleted_at IS NULL AND t.hidden=0',text:r=>`Message ${String(r.created_at).slice(0,16)}: ${clip(r.body,1500)}`},
 {type:'order',table:'work_orders',sql:'id,number,title,description,status,department',updated:true,text:r=>`Work order ${r.number}: ${r.title}. Status ${r.status}. Department ${r.department}. ${clip(r.description,2000)}`},
 {type:'item',table:'inventory_items',sql:'id,sku,name,category,unit,notes',updated:true,text:r=>`Stock item ${r.sku}: ${r.name}, category ${r.category}, unit ${r.unit}. ${clip(r.notes,800)}`},
 {type:'vendor',table:'vendors',sql:'id,name,category,notes',updated:false,text:r=>`Vendor ${r.name}, supplies ${r.category}. ${clip(r.notes,800)}`},
 {type:'person',table:'members',sql:'id,name,title,department,location',updated:false,text:r=>`${r.name}, ${r.title||'staff'} in ${r.department}, based at ${r.location||'—'}.`},
];
function chunks(text:string,size=900,max=6){const out:string[]=[];let t=text.trim();while(t&&out.length<max){let cut=t.length<=size?t.length:t.lastIndexOf(' ',size);if(cut<size*.5)cut=size;out.push(t.slice(0,cut).trim());t=t.slice(cut)}return out.filter(Boolean)}
const vid=(type:string,id:string,n:number)=>`${type}:${id}:${n}`;

// Indexes records that are new, changed, or indexed with another model. `since` makes a full rebuild resumable.
export async function indexChanges(tenantId:string,o:{limit?:number,since?:string}={}){
 const e=await embedderFor(tenantId);if(!e)return {available:false,processed:0,remaining:0};
 const store=storeFor(e);const limit=Math.min(o.limit??40,100);const since=o.since||'';
 const pending:Doc[]=[];let remaining=0;
 for(const s of sources){
  const cond=since?'(kd.id IS NULL OR kd.indexed_at<?)':s.updated?'(kd.id IS NULL OR kd.model<>? OR kd.indexed_at<t.updated_at)':'(kd.id IS NULL OR kd.model<>?)';
  const extra=(s.table==='members'?' AND t.active=1':'')+(s.where?` AND ${s.where}`:'');
  const cols=s.sql.includes('t.')?s.sql:s.sql.split(',').map(c=>'t.'+c).join(',');
  const cnt=await first<{n:number}>(`SELECT count(*) AS n FROM ${s.table} t LEFT JOIN knowledge_documents kd ON kd.tenant_id=t.tenant_id AND kd.source_type=? AND kd.source_id=t.id WHERE t.tenant_id=?${extra} AND ${cond}`,s.type,tenantId,since||e.model);
  remaining+=cnt?.n||0;
  if(pending.length>=limit||!cnt?.n)continue;
  const rows=await all<any>(`SELECT ${cols} FROM ${s.table} t LEFT JOIN knowledge_documents kd ON kd.tenant_id=t.tenant_id AND kd.source_type=? AND kd.source_id=t.id WHERE t.tenant_id=?${extra} AND ${cond} LIMIT ?`,s.type,tenantId,since||e.model,limit-pending.length);
  pending.push(...rows.map(r=>({type:s.type,id:String(r.id),text:s.text(r).replace(/\s+/g,' ').trim()})));
 }
 if(!pending.length){if(since)await prune(tenantId,since,store);return {available:true,processed:0,remaining:0,source:e.source,store}}
 // Unchanged text with the same model only needs its timestamp refreshed.
 const existing=new Map((await all<{source_type:string,source_id:string,content_hash:string,model:string,chunks:number}>(`SELECT source_type,source_id,content_hash,model,chunks FROM knowledge_documents WHERE tenant_id=? AND source_id IN (${pending.map(()=>'?').join(',')})`,tenantId,...pending.map(p=>p.id))).map(r=>[`${r.source_type}:${r.source_id}`,r]));
 const work:{doc:Doc,hash:string,parts:string[],prev:number}[]=[];const touch:D1PreparedStatement[]=[];const ts=now();
 for(const d of pending){const h=await hash(`${e.model}\u0000${d.text}`);const prev=existing.get(`${d.type}:${d.id}`);if(prev&&prev.content_hash===h&&prev.model===e.model){touch.push(stmt('UPDATE knowledge_documents SET indexed_at=? WHERE tenant_id=? AND source_type=? AND source_id=?',ts,tenantId,d.type,d.id));continue}work.push({doc:d,hash:h,parts:chunks(d.text),prev:prev?.chunks||0})}
 const texts=work.flatMap(w=>w.parts);const vectors:number[][]=[];
 for(let i=0;i<texts.length;i+=50)vectors.push(...await e.embed(texts.slice(i,i+50)));
 let k=0;const writes:D1PreparedStatement[]=[...touch];
 const upserts:{id:string,values:number[],namespace:string,metadata:Record<string,string>}[]=[];const stale:string[]=[];
 for(const w of work){
  const vs=w.parts.map(()=>vectors[k++]);
  if(store==='vectorize'){vs.forEach((v,n)=>upserts.push({id:vid(w.doc.type,w.doc.id,n),values:v,namespace:tenantId,metadata:{type:w.doc.type,id:w.doc.id}}));for(let n=vs.length;n<w.prev;n++)stale.push(vid(w.doc.type,w.doc.id,n))}
  else{writes.push(stmt('DELETE FROM knowledge_chunks WHERE tenant_id=? AND source_type=? AND source_id=?',tenantId,w.doc.type,w.doc.id));vs.forEach((v,n)=>writes.push(stmt('INSERT INTO knowledge_chunks(id,tenant_id,source_type,source_id,chunk_no,model,embedding,created_at) VALUES(?,?,?,?,?,?,?,?)',uid(),tenantId,w.doc.type,w.doc.id,n,e.model,JSON.stringify(v.map(x=>Math.round(x*1e5)/1e5)),ts)))}
  writes.push(stmt('INSERT INTO knowledge_documents(id,tenant_id,source_type,source_id,content_hash,model,store,chunks,indexed_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id,source_type,source_id) DO UPDATE SET content_hash=excluded.content_hash,model=excluded.model,store=excluded.store,chunks=excluded.chunks,indexed_at=excluded.indexed_at',uid(),tenantId,w.doc.type,w.doc.id,w.hash,e.model,store,vs.length,ts));
 }
 if(upserts.length)for(let i=0;i<upserts.length;i+=500)await bindings().VECTORIZE!.upsert(upserts.slice(i,i+500));
 if(stale.length)await bindings().VECTORIZE!.deleteByIds(stale);
 for(let i=0;i<writes.length;i+=80)await batch(writes.slice(i,i+80));
 if(texts.length)await stmt('INSERT INTO ai_usage(id,tenant_id,member_id,provider,model,kind,prompt_tokens,completion_tokens,ok,created_at) VALUES(?,?,?,?,?,?,?,?,1,?)',uid(),tenantId,'system',e.source,e.model,'embed',texts.reduce((n,t)=>n+Math.ceil(t.length/4),0),0,ts).run();
 return {available:true,processed:pending.length,remaining:Math.max(0,remaining-pending.length),source:e.source,store};
}
// After a full rebuild: remove index entries for records that no longer exist.
async function prune(tenantId:string,since:string,store:string){
 const gone=await all<{source_type:string,source_id:string,chunks:number}>('SELECT source_type,source_id,chunks FROM knowledge_documents WHERE tenant_id=? AND indexed_at<?',tenantId,since);
 if(!gone.length)return;
 if(store==='vectorize'&&bindings().VECTORIZE){const ids=gone.flatMap(g=>Array.from({length:g.chunks},(_,n)=>vid(g.source_type,g.source_id,n)));for(let i=0;i<ids.length;i+=500)await bindings().VECTORIZE!.deleteByIds(ids.slice(i,i+500))}
 const s=gone.flatMap(g=>[stmt('DELETE FROM knowledge_chunks WHERE tenant_id=? AND source_type=? AND source_id=?',tenantId,g.source_type,g.source_id),stmt('DELETE FROM knowledge_documents WHERE tenant_id=? AND source_type=? AND source_id=?',tenantId,g.source_type,g.source_id)]);
 for(let i=0;i<s.length;i+=80)await batch(s.slice(i,i+80));
}
const cosine=(a:number[],b:number[])=>{let d=0,x=0,y=0;for(let i=0;i<a.length&&i<b.length;i++){d+=a[i]*b[i];x+=a[i]*a[i];y+=b[i]*b[i]}return x&&y?d/Math.sqrt(x*y):0};
// Semantic retrieval inside the person's workspace, filtered by their permissions.
export async function vectorSearch(u:Member,question:string,topK=8):Promise<Hit[]>{
 const e=await embedderFor(u.tenantId);if(!e)return [];
 const [qv]=await e.embed([question.slice(0,2000)]);if(!qv)return [];
 let matches:{type:SourceType,id:string,score:number}[]=[];
 if(storeFor(e)==='vectorize'){
  const r=await bindings().VECTORIZE!.query(qv,{topK:Math.min(50,topK*4),namespace:u.tenantId,returnMetadata:'all'});
  matches=r.matches.filter(m=>m.metadata?.type&&m.metadata?.id).map(m=>({type:m.metadata!.type as SourceType,id:m.metadata!.id,score:m.score}));
 }else{
  const rows=await all<{source_type:string,source_id:string,embedding:string}>('SELECT source_type,source_id,embedding FROM knowledge_chunks WHERE tenant_id=? AND model=? LIMIT 20000',u.tenantId,e.model);
  matches=rows.map(r=>({type:r.source_type as SourceType,id:r.source_id,score:cosine(qv,JSON.parse(r.embedding))})).sort((a,b)=>b.score-a.score).slice(0,topK*4);
 }
 const best=new Map<string,{type:SourceType,id:string,score:number}>();for(const m of matches){const k=`${m.type}:${m.id}`;if(!best.has(k)||best.get(k)!.score<m.score)best.set(k,m)}
 const refs=[...best.values()].sort((a,b)=>b.score-a.score).slice(0,topK*2);
 // Permission check happens here: records the person cannot open are dropped.
 return (await hitsByIds(u,refs)).slice(0,topK);
}
