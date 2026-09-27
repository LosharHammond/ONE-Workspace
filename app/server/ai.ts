import {env} from 'cloudflare:workers';
import {first,stmt,uid,now,HttpError,tenantOf,tenantSettings} from './core';
import {openSecret} from './secrets';
import {platformSetting} from './platform-settings';
import {planLimits} from '../modules';

// Provider-independent AI layer. Priority: the company's own provider → the platform Groq default
// (server-side GROQ_API_KEY) → "AI is not configured". A company provider only ever applies to that
// company and never touches the platform credentials. Keys stay on the server.
export type AiProviderId='groq'|'openai'|'anthropic'|'gemini'|'azure-openai'|'openai-compatible';
export const aiProviderCatalog:{id:AiProviderId,name:string,baseUrl:string,defaultModel:string,needsBaseUrl:boolean,embeddings:boolean,tools:boolean}[]=[
 {id:'groq',name:'Groq',baseUrl:'https://api.groq.com/openai/v1',defaultModel:'openai/gpt-oss-120b',needsBaseUrl:false,embeddings:false,tools:true},
 {id:'openai',name:'OpenAI',baseUrl:'https://api.openai.com/v1',defaultModel:'gpt-4.1-mini',needsBaseUrl:false,embeddings:true,tools:true},
 {id:'anthropic',name:'Anthropic',baseUrl:'https://api.anthropic.com/v1',defaultModel:'claude-sonnet-5',needsBaseUrl:false,embeddings:false,tools:false},
 {id:'gemini',name:'Google Gemini',baseUrl:'https://generativelanguage.googleapis.com/v1beta',defaultModel:'gemini-2.5-flash',needsBaseUrl:false,embeddings:true,tools:false},
 {id:'azure-openai',name:'Azure OpenAI',baseUrl:'',defaultModel:'',needsBaseUrl:true,embeddings:true,tools:true},
 {id:'openai-compatible',name:'OpenAI-compatible / self-hosted',baseUrl:'',defaultModel:'',needsBaseUrl:true,embeddings:true,tools:true},
];
export const GROQ_DEFAULT_MODEL='openai/gpt-oss-120b';
export type AiProvider={id:AiProviderId,name:string,model:string,baseUrl:string,key:string,source:'company'|'platform',fallback:'platform'|'none'};
export type AiMessage={role:'system'|'user'|'assistant',content:string};
export type AiUsage={prompt:number,completion:number};
export type AiResult={text:string,usage:AiUsage,toolCalls?:{name:string,arguments:string}[]};
export type AiTool={name:string,description:string,parameters:Record<string,unknown>};

export class AiError extends HttpError{constructor(status:number,message:string,public code:string){super(status,message)}}
function normalise(status:number,provider:string):AiError{
 if(status===401||status===403)return new AiError(502,`${provider} rejected the credentials. An administrator should check the AI provider settings.`,'auth');
 if(status===402)return new AiError(502,`${provider} reports the account is out of credit.`,'quota');
 if(status===429)return new AiError(429,`${provider} is rate limiting requests. Try again shortly.`,'rate');
 if(status===404)return new AiError(502,`${provider} could not find the configured model.`,'model');
 if(status===400||status===422)return new AiError(502,`${provider} could not process this request.`,'bad_request');
 return new AiError(502,`${provider} is unavailable right now (${status}). Try again shortly.`,'provider');
}

// The platform default (Groq) is available when the server has GROQ_API_KEY.
export async function platformAi():Promise<AiProvider|null>{
 if(!env.GROQ_API_KEY)return null;
 const cfg=await platformSetting<{model?:string}>('ai',{});
 return {id:'groq',name:'Groq',model:cfg.model||GROQ_DEFAULT_MODEL,baseUrl:(env.AI_GROQ_BASE_URL||aiProviderCatalog[0].baseUrl).replace(/\/$/,''),key:env.GROQ_API_KEY,source:'platform',fallback:'none'};
}
type ProviderRow={id:string,provider:AiProviderId,label:string,model:string,base_url:string,secret_enc:string|null,fallback:string};
export async function companyAiRow(tenantId:string){return first<ProviderRow&{secret_hint:string,active:number,updated_at:string,updated_by:string}>('SELECT * FROM ai_providers WHERE tenant_id=?',tenantId)}
export async function resolveAi(tenantId:string):Promise<AiProvider|null>{
 const c=await first<ProviderRow>('SELECT id,provider,label,model,base_url,secret_enc,fallback FROM ai_providers WHERE tenant_id=? AND active=1',tenantId);
 if(c){const cat=aiProviderCatalog.find(p=>p.id===c.provider);return {id:c.provider,name:c.label||cat?.name||c.provider,model:c.model,baseUrl:(c.base_url||cat?.baseUrl||'').replace(/\/$/,''),key:await openSecret(tenantId,c.id,c.secret_enc),source:'company',fallback:c.fallback==='platform'?'platform':'none'}}
 return platformAi();
}

// ── Chat (with optional streaming) ──────────────────────────────────────────
type ChatOpts={messages:AiMessage[],json?:boolean,maxTokens?:number,temperature?:number,onDelta?:(text:string)=>void|Promise<void>,tools?:AiTool[],signal?:AbortSignal};
async function* sse(res:Response){
 const reader=res.body!.getReader();const d=new TextDecoder();let buf='';
 while(true){const {done,value}=await reader.read();if(done)break;buf+=d.decode(value,{stream:true});let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(line.startsWith('data:')){const data=line.slice(5).trim();if(data&&data!=='[DONE]'){try{yield JSON.parse(data)}catch{/* ignore keep-alives */}}}}}
}
async function call(p:AiProvider,url:string,headers:Record<string,string>,body:unknown,signal?:AbortSignal){
 let r:Response;
 try{r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),signal:signal||AbortSignal.timeout(90000)})}
 catch(e){throw new AiError(504,(e as Error).name==='TimeoutError'?`${p.name} did not answer in time.`:`Could not reach ${p.name}.`,'network')}
 if(!r.ok)throw normalise(r.status,p.name);
 return r;
}
export async function chat(p:AiProvider,o:ChatOpts):Promise<AiResult>{
 const stream=!!o.onDelta&&!o.tools;
 const maxTokens=o.maxTokens||1500;
 if(p.id==='anthropic'){
  const system=o.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
  const r=await call(p,`${p.baseUrl}/messages`,{'x-api-key':p.key,'anthropic-version':'2023-06-01'},{model:p.model,max_tokens:maxTokens,temperature:o.temperature??0.2,system,stream,messages:o.messages.filter(m=>m.role!=='system')},o.signal);
  if(!stream){const d=await r.json() as any;return {text:(d.content||[]).filter((c:any)=>c.type==='text').map((c:any)=>c.text).join(''),usage:{prompt:d.usage?.input_tokens||0,completion:d.usage?.output_tokens||0}}}
  let text='';const usage={prompt:0,completion:0};
  for await(const ev of sse(r)){if(ev.type==='content_block_delta'&&ev.delta?.text){text+=ev.delta.text;await o.onDelta!(ev.delta.text)}if(ev.type==='message_start')usage.prompt=ev.message?.usage?.input_tokens||0;if(ev.type==='message_delta')usage.completion=ev.usage?.output_tokens||0}
  return {text,usage};
 }
 if(p.id==='gemini'){
  const system=o.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n\n');
  const body={systemInstruction:system?{parts:[{text:system}]}:undefined,contents:o.messages.filter(m=>m.role!=='system').map(m=>({role:m.role==='assistant'?'model':'user',parts:[{text:m.content}]})),generationConfig:{maxOutputTokens:maxTokens,temperature:o.temperature??0.2,...(o.json?{responseMimeType:'application/json'}:{})}};
  const r=await call(p,`${p.baseUrl}/models/${encodeURIComponent(p.model)}:${stream?'streamGenerateContent?alt=sse':'generateContent'}`,{'x-goog-api-key':p.key},body,o.signal);
  const pick=(d:any)=>(d.candidates?.[0]?.content?.parts||[]).map((x:any)=>x.text||'').join('');
  if(!stream){const d=await r.json() as any;return {text:pick(d),usage:{prompt:d.usageMetadata?.promptTokenCount||0,completion:d.usageMetadata?.candidatesTokenCount||0}}}
  let text='';const usage={prompt:0,completion:0};
  for await(const ev of sse(r)){const t=pick(ev);if(t){text+=t;await o.onDelta!(t)}if(ev.usageMetadata){usage.prompt=ev.usageMetadata.promptTokenCount||0;usage.completion=ev.usageMetadata.candidatesTokenCount||0}}
  return {text,usage};
 }
 // OpenAI-style APIs: Groq, OpenAI, Azure OpenAI and OpenAI-compatible endpoints.
 const azure=p.id==='azure-openai';
 const url=azure?`${p.baseUrl}/chat/completions?api-version=2024-10-21`:`${p.baseUrl}/chat/completions`;
 const headers:Record<string,string>=azure?{'api-key':p.key}:p.key?{Authorization:`Bearer ${p.key}`}:{};
 const body:Record<string,unknown>={model:p.model,messages:o.messages,max_tokens:maxTokens,temperature:o.temperature??0.2,stream};
 if(stream&&p.id!=='openai-compatible')body.stream_options={include_usage:true};
 if(o.json)body.response_format={type:'json_object'};
 if(o.tools?.length)body.tools=o.tools.map(t=>({type:'function',function:t}));
 const r=await call(p,url,headers,body,o.signal);
 if(!stream){const d=await r.json() as any;const m=d.choices?.[0]?.message;return {text:typeof m?.content==='string'?m.content:'',usage:{prompt:d.usage?.prompt_tokens||0,completion:d.usage?.completion_tokens||0},toolCalls:(m?.tool_calls||[]).map((c:any)=>({name:c.function?.name,arguments:c.function?.arguments||'{}'}))}}
 let text='';const usage={prompt:0,completion:0};
 for await(const ev of sse(r)){const t=ev.choices?.[0]?.delta?.content;if(typeof t==='string'&&t){text+=t;await o.onDelta!(t)}const u=ev.usage||ev.x_groq?.usage;if(u){usage.prompt=u.prompt_tokens||0;usage.completion=u.completion_tokens||0}}
 return {text,usage};
}
// Structured output: asks for JSON and parses it; a malformed answer is an error, never a silent default.
export async function chatJson<T>(p:AiProvider,messages:AiMessage[],maxTokens=1200):Promise<{data:T,usage:AiUsage}>{
 const r=await chat(p,{messages,json:true,maxTokens,temperature:0});
 const raw=r.text.trim().replace(/^```(?:json)?\s*/i,'').replace(/```$/,'');
 try{return {data:JSON.parse(raw) as T,usage:r.usage}}catch{throw new AiError(502,'The AI answer was not in the expected format. Try again.','format')}
}
// Embeddings where the provider offers them (Groq does not).
export async function embed(p:AiProvider,texts:string[],model?:string):Promise<number[][]>{
 const cat=aiProviderCatalog.find(x=>x.id===p.id);if(!cat?.embeddings)throw new AiError(400,`${p.name} does not provide embeddings.`,'unsupported');
 if(p.id==='gemini'){const r=await call(p,`${p.baseUrl}/models/${encodeURIComponent(model||'text-embedding-004')}:batchEmbedContents`,{'x-goog-api-key':p.key},{requests:texts.map(t=>({model:`models/${model||'text-embedding-004'}`,content:{parts:[{text:t}]}}))});const d=await r.json() as any;return (d.embeddings||[]).map((e:any)=>e.values)}
 const azure=p.id==='azure-openai';
 const r=await call(p,azure?`${p.baseUrl}/embeddings?api-version=2024-10-21`:`${p.baseUrl}/embeddings`,azure?{'api-key':p.key}:{Authorization:`Bearer ${p.key}`},{model:model||'text-embedding-3-small',input:texts});
 const d=await r.json() as any;return (d.data||[]).map((e:any)=>e.embedding);
}

// ── Limits and usage ────────────────────────────────────────────────────────
export async function aiLimit(tenantId:string){const t=await tenantOf({tenantId});const s=tenantSettings(t);const l={...(planLimits[t.plan]||planLimits.business),...((s.limits as object)||{})} as {aiRequestsPerMonth:number};return {limit:l.aiRequestsPerMonth??planLimits.business.aiRequestsPerMonth,settings:s}}
export async function aiUsedThisMonth(tenantId:string){const start=new Date();start.setUTCDate(1);start.setUTCHours(0,0,0,0);const r=await first<{n:number}>('SELECT count(*) AS n FROM ai_usage WHERE tenant_id=? AND created_at>=?',tenantId,start.toISOString());return r?.n||0}
export async function assertAiQuota(tenantId:string){const {limit}=await aiLimit(tenantId);if(await aiUsedThisMonth(tenantId)>=limit)throw new AiError(429,`Your company has used its ${limit.toLocaleString()} AI requests for this month. An administrator can ask the Platform Owner to raise the limit.`,'limit')}
// Usage rows never contain prompt or answer text.
export function usageStatement(u:{id:string,tenantId:string},p:{id:string,model:string},kind:string,usage:AiUsage,ok=true){return stmt('INSERT INTO ai_usage(id,tenant_id,member_id,provider,model,kind,prompt_tokens,completion_tokens,ok,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),u.tenantId,u.id,p.id,p.model,kind,usage.prompt,usage.completion,ok?1:0,now())}
// Runs a chat with the company provider, falling back to the platform default only if the company chose that.
export async function chatWithFallback(tenantId:string,o:ChatOpts):Promise<{result:AiResult,provider:AiProvider}>{
 const p=await resolveAi(tenantId);if(!p)throw new AiError(503,'AI is not configured for this workspace.','not_configured');
 try{return {result:await chat(p,o),provider:p}}
 catch(e){if(p.source==='company'&&p.fallback==='platform'&&e instanceof AiError&&['network','provider','rate'].includes(e.code)){const g=await platformAi();if(g)return {result:await chat(g,o),provider:g}}throw e}
}
