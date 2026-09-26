export const ASSEMBLY_MODELS=['universal-3-5-pro','universal-2'];
const base='https://api.assemblyai.com/v2';
export class AssemblyError extends Error {constructor(message:string,public uncertain=false){super(message)}}
async function response(r:Response){
 if(!r.ok){
  if(r.status===401||r.status===403)throw new AssemblyError('AssemblyAI credentials or project access need attention. Ask the administrator to check ASSEMBLYAI_API_KEY.');
  if(r.status===402)throw new AssemblyError('AssemblyAI credit is exhausted. Add credit to the AssemblyAI account; changing an OpenAI key will not help.');
  if(r.status===429)throw new AssemblyError('AssemblyAI has reached a usage or concurrency limit. Check the account limits before retrying.');
  throw new AssemblyError(`AssemblyAI could not accept the request (${r.status}). Check the account and recording format.`,r.status>=500);
 }
 return await r.json() as any;
}
export async function uploadAssembly(key:string,audio:ArrayBuffer){
 const d=await response(await fetch(base+'/upload',{method:'POST',headers:{authorization:key,'Content-Type':'application/octet-stream'},body:audio,signal:AbortSignal.timeout(90000)}));
 if(typeof d.upload_url!=='string'||!d.upload_url.startsWith('https://'))throw new AssemblyError('AssemblyAI returned an invalid upload response.');
 return d.upload_url as string;
}
export async function submitAssembly(key:string,audioUrl:string,callback:string,token:string){
 let r:Response;try{r=await fetch(base+'/transcript',{method:'POST',headers:{authorization:key,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),body:JSON.stringify({audio_url:audioUrl,speech_models:ASSEMBLY_MODELS,language_detection:true,speaker_labels:true,speech_understanding:{request:{summarization:{summary_type:'bullets',effort:'medium'}}},webhook_url:callback,webhook_auth_header_name:'X-OWS-Webhook',webhook_auth_header_value:token})})}catch{throw new AssemblyError('The submission response was interrupted. A cloud job may already exist. Wait for its callback instead of submitting another paid job.',true)}
 const d=await response(r);if(typeof d.id!=='string'||!/^[a-zA-Z0-9-]{1,160}$/.test(d.id))throw new AssemblyError('AssemblyAI returned an invalid job reference.',true);return d.id as string;
}
export async function fetchAssembly(key:string,id:string){if(!/^[a-zA-Z0-9-]{1,160}$/.test(id))throw new AssemblyError('Invalid transcription job reference.');return response(await fetch(base+'/transcript/'+encodeURIComponent(id),{headers:{authorization:key},signal:AbortSignal.timeout(7000)}))}
export function assemblyResult(d:any){
 if(!['queued','processing','completed','error'].includes(d.status))throw new AssemblyError('AssemblyAI returned an unknown job status.');
 if(d.status==='error')return {status:'Failed',transcript:null,summary:null,error:'AssemblyAI could not process this recording. Check that the file contains clear speech in a supported language, then retry.',model:null};
 if(d.status!=='completed')return {status:d.status==='queued'?'Queued':'Transcribing',transcript:null,summary:null,error:null,model:null};
 if(typeof d.text!=='string'||!d.text.trim())return {status:'Failed',transcript:null,summary:null,error:'No speech was detected. Check the recording before retrying.',model:null};
 if(d.text.length>180000)throw new AssemblyError('The transcript exceeds the supported length. Split the recording.');
 const utterances=Array.isArray(d.utterances)?d.utterances:[];
 const stamp=(ms:number)=>{const n=Math.max(0,Math.floor(ms/1000));return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`};
 const dialogue=utterances.filter((u:any)=>typeof u.text==='string').map((u:any)=>`[${stamp(Number(u.start)||0)}] Speaker ${String(u.speaker??'?').slice(0,8)}: ${u.text}`).join('\n');
 const task=d.speech_understanding?.response?.summarization;
 const chapters=task?.status==='success'&&Array.isArray(task.summary)?task.summary:[];
 const summary=chapters.map((c:any)=>{const text=typeof c.text==='string'?c.text:Array.isArray(c.bullets)?c.bullets.map((b:any)=>typeof b==='string'?b:typeof b?.text==='string'?b.text:'').filter(Boolean).map((b:string)=>'• '+b).join('\n'):'';return text.trim()?`[${stamp(Number(c.start)||0)}–${stamp(Number(c.end)||0)}] ${typeof c.headline==='string'?c.headline+'\n':''}${text}`:''}).filter(Boolean).join('\n\n')||(task?.status==='success'&&typeof task.block_summary==='string'?task.block_summary:'');
 return {status:summary?'Ready':'Transcript ready',transcript:dialogue||d.text,summary:summary.slice(0,100000)||null,error:summary?null:'Transcription completed, but the cloud summary is unavailable. Your transcript is saved. Retry to request a new analysis.',model:typeof d.speech_model_used==='string'?d.speech_model_used:ASSEMBLY_MODELS[0]};
}
