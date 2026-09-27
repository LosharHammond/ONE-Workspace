import {hasAction} from '../../../access-policy';
import {route,HttpError,batch} from '../../../server/core';
import {resolveAi,platformAi,assertAiQuota,usageStatement,AiError,type AiProvider} from '../../../server/ai';
import {rateLimit} from '../../../server/auth';

// Voice input for ONE: speech-to-text with Whisper. The audio is sent to the transcription service once and
// never stored or logged. Groq Whisper is the default; a company whose own provider offers Whisper
// (OpenAI, Azure OpenAI, OpenAI-compatible, Groq) uses it instead. Other company providers fall back to the
// platform Groq Whisper only if the company allowed platform fallback.
const MAX_BYTES=10*1024*1024;
const TYPES=/^audio\/(webm|ogg|mpeg|mp4|m4a|wav|x-wav|aac|flac)(;.*)?$/;
function transcriber(p:AiProvider){
 if(p.id==='groq')return {url:`${p.baseUrl}/audio/transcriptions`,headers:{Authorization:`Bearer ${p.key}`},model:'whisper-large-v3-turbo'};
 if(p.id==='openai'||p.id==='openai-compatible')return {url:`${p.baseUrl}/audio/transcriptions`,headers:p.key?{Authorization:`Bearer ${p.key}`}:{} as Record<string,string>,model:'whisper-1'};
 if(p.id==='azure-openai')return {url:`${p.baseUrl}/audio/transcriptions?api-version=2024-10-21`,headers:{'api-key':p.key},model:'whisper'};
 return null;
}
export const POST=route(async(req,u)=>{
 if(!hasAction(u,'assistant','run_ai'))throw new HttpError(403,'ONE is not available to you.');
 await rateLimit('ai-voice',u.id,30,60000).catch(()=>{throw new HttpError(429,'Too many voice requests. Wait a minute and try again.')});
 await assertAiQuota(u.tenantId);
 const form=await req.formData().catch(()=>{throw new HttpError(400,'Send the recording as form data.')});
 const audio=form.get('audio');
 if(!(audio instanceof File)||!audio.size)throw new HttpError(400,'No recording received.');
 if(audio.size>MAX_BYTES)throw new HttpError(413,'Recordings are limited to 10 MB (about 5 minutes).');
 if(!TYPES.test(audio.type||''))throw new HttpError(415,'Unsupported audio format.');
 const lang=String(form.get('language')||'').slice(0,5);
 let p=await resolveAi(u.tenantId);if(!p)throw new AiError(503,'AI is not configured for this workspace.','not_configured');
 let t=transcriber(p);
 if(!t&&p.source==='company'&&p.fallback==='platform'){const g=await platformAi();if(g){p=g;t=transcriber(g)}}
 if(!t)throw new AiError(400,`${p.name} does not offer speech-to-text. Type your question, or allow the platform fallback in AI settings.`,'unsupported');
 const body=new FormData();body.set('file',audio,audio.name||'speech.webm');body.set('model',t.model);body.set('response_format','json');body.set('temperature','0');if(/^[a-z]{2}$/.test(lang))body.set('language',lang);
 let r:Response;
 try{r=await fetch(t.url,{method:'POST',headers:t.headers,body,signal:AbortSignal.timeout(60000)})}
 catch{await usageStatement(u,p,'voice',{prompt:0,completion:0},false).run();throw new AiError(504,'Speech-to-text did not answer in time.','network')}
 if(!r.ok){await usageStatement(u,p,'voice',{prompt:0,completion:0},false).run();throw new AiError(r.status===429?429:502,r.status===429?'Speech-to-text is busy. Try again shortly.':'Speech-to-text could not process the recording.','provider')}
 const d=await r.json() as {text?:string};
 const text=String(d.text||'').trim().slice(0,4000);
 await batch([usageStatement(u,{id:p.id,model:t.model},'voice',{prompt:0,completion:0})]);
 return {text};
});
