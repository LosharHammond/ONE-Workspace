'use client';
import {useCallback,useEffect,useRef,useState} from 'react';

// Voice for ONE: microphone capture with automatic stop on silence, Whisper transcription on the server,
// an optional "Hello ONE" wake phrase, and spoken replies. Nothing listens until the person turns it on.

// Records one utterance: stops after ~1.4 s of silence once speech has started, or after maxMs.
export function useRecorder(maxMs=30000){
 const [recording,setRecording]=useState(false),[level,setLevel]=useState(0);
 const stopRef=useRef<(()=>void)|null>(null);
 const record=useCallback(()=>new Promise<Blob|null>(async(resolve,reject)=>{
  let stream:MediaStream;
  try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}})}catch{reject(new Error('Microphone access was blocked. Allow it in your browser to talk to ONE.'));return}
  const mime=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'].find(t=>typeof MediaRecorder!=='undefined'&&MediaRecorder.isTypeSupported(t))||'';
  const rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);const chunks:BlobPart[]=[];
  const ctx=new AudioContext();const src=ctx.createMediaStreamSource(stream);const an=ctx.createAnalyser();an.fftSize=1024;src.connect(an);const buf=new Uint8Array(an.fftSize);
  let spoke=false,quietSince=0,raf=0;const started=Date.now();
  const finish=()=>{if(rec.state!=='inactive')rec.stop()};stopRef.current=finish;
  const tick=()=>{an.getByteTimeDomainData(buf);let sum=0;for(const v of buf){const x=(v-128)/128;sum+=x*x}const rms=Math.sqrt(sum/buf.length);setLevel(Math.min(1,rms*6));
   if(rms>0.04){spoke=true;quietSince=0}else if(spoke){quietSince||=Date.now();if(Date.now()-quietSince>1400){finish();return}}
   if(Date.now()-started>maxMs||(!spoke&&Date.now()-started>8000)){finish();return}
   raf=requestAnimationFrame(tick)};
  rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  rec.onstop=()=>{cancelAnimationFrame(raf);stream.getTracks().forEach(t=>t.stop());ctx.close().catch(()=>{});setRecording(false);setLevel(0);stopRef.current=null;resolve(spoke&&chunks.length?new Blob(chunks,{type:rec.mimeType||'audio/webm'}):null)};
  rec.start(250);setRecording(true);raf=requestAnimationFrame(tick);
 }),[maxMs]);
 const stop=useCallback(()=>stopRef.current?.(),[]);
 return {record,stop,recording,level};
}
// Server-side Whisper (Groq by default). The recording is not stored.
export async function transcribe(blob:Blob){
 const fd=new FormData();fd.set('audio',new File([blob],'speech.'+(blob.type.includes('mp4')?'mp4':blob.type.includes('ogg')?'ogg':'webm'),{type:blob.type.split(';')[0]||'audio/webm'}));
 const lang=(navigator.language||'').slice(0,2).toLowerCase();if(/^[a-z]{2}$/.test(lang))fd.set('language',lang);
 const r=await fetch('/api/ai/voice',{method:'POST',body:fd});const d=await r.json().catch(()=>({})) as {text?:string,error?:string};
 if(!r.ok)throw new Error(d.error||'Could not understand the recording.');return (d.text||'').trim();
}

// "Hello ONE" wake phrase using the browser's speech recognition (Chrome, Edge, Safari). The browser vendor
// processes that audio; the UI says so before it is enabled. Recognition pauses while ONE is speaking,
// while recording, and when the tab is hidden.
type SR={continuous:boolean,interimResults:boolean,lang:string,start:()=>void,stop:()=>void,abort:()=>void,onresult:((e:any)=>void)|null,onend:(()=>void)|null,onerror:((e:any)=>void)|null};
const WAKE=/\b(hello|hallo|hey|hi|ok|okay)[\s,.!]*(one|won|wan|juan|1|onе)\b/i;
export function wakeSupported(){return typeof window!=='undefined'&&!!((window as any).SpeechRecognition||(window as any).webkitSpeechRecognition)}
export function useWakeWord(enabled:boolean,paused:boolean,onWake:()=>void){
 const [state,setState]=useState<'off'|'listening'|'error'>('off');const [error,setError]=useState('');
 const cb=useRef(onWake);useEffect(()=>{cb.current=onWake},[onWake]);
 useEffect(()=>{
  if(!enabled||paused||!wakeSupported()){setState('off');return}
  const Ctor=(window as any).SpeechRecognition||(window as any).webkitSpeechRecognition;const r:SR=new Ctor();
  r.continuous=true;r.interimResults=true;r.lang=navigator.language||'en-US';
  let alive=true,fired=false;
  r.onresult=e=>{for(let i=e.resultIndex;i<e.results.length;i++){const t=String(e.results[i][0]?.transcript||'');if(!fired&&WAKE.test(t)){fired=true;alive=false;r.abort();cb.current()}}};
  r.onerror=e=>{if(e.error==='not-allowed'||e.error==='service-not-allowed'){alive=false;setState('error');setError('Microphone or speech recognition was blocked by the browser.')}};
  r.onend=()=>{if(alive&&document.visibilityState==='visible'){try{r.start()}catch{/* already started */}}};
  const vis=()=>{if(document.visibilityState==='visible'&&alive){try{r.start()}catch{/* running */}}};document.addEventListener('visibilitychange',vis);
  try{r.start();setState('listening');setError('')}catch{setState('error')}
  return()=>{alive=false;document.removeEventListener('visibilitychange',vis);try{r.abort()}catch{/* stopped */}};
 },[enabled,paused]);
 return {state,error,supported:wakeSupported()};
}
// Spoken replies (browser speech synthesis). Markdown and source markers are stripped.
export function speak(text:string,onEnd?:()=>void){
 if(typeof speechSynthesis==='undefined'){onEnd?.();return}
 speechSynthesis.cancel();
 const clean=text.replace(/\[S\d+\]/g,'').replace(/[*_`#>|]/g,'').replace(/\[(.*?)\]\(.*?\)/g,'$1').replace(/\s+/g,' ').trim().slice(0,1500);
 const u=new SpeechSynthesisUtterance(clean);u.lang=navigator.language||'en-US';u.rate=1.03;u.onend=()=>onEnd?.();u.onerror=()=>onEnd?.();speechSynthesis.speak(u);
}
export function stopSpeaking(){if(typeof speechSynthesis!=='undefined')speechSynthesis.cancel()}
// A short, quiet chime when ONE wakes up.
export function chime(){try{const c=new AudioContext();const o=c.createOscillator(),g=c.createGain();o.type='sine';o.frequency.setValueAtTime(660,c.currentTime);o.frequency.setValueAtTime(880,c.currentTime+.09);g.gain.setValueAtTime(.0001,c.currentTime);g.gain.exponentialRampToValueAtTime(.08,c.currentTime+.02);g.gain.exponentialRampToValueAtTime(.0001,c.currentTime+.25);o.connect(g).connect(c.destination);o.start();o.stop(c.currentTime+.26);setTimeout(()=>c.close(),400)}catch{/* no audio */}}
