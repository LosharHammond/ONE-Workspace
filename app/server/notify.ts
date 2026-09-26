import {env} from 'cloudflare:workers';
import {all,stmt,batch,uid,now,origin} from './core';

// email:false keeps a notice in-app only (used for broadcast announcements).
export type Notice={kind:string,title:string,body?:string,link?:string,email?:boolean};
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

// In-app notification for every recipient, plus best-effort email when configured.
// The actor never notifies themselves.
export async function notify(actor:{id:string,tenantId:string},recipients:(string|null|undefined)[],n:Notice,req?:Request){
 const ids=[...new Set(recipients.filter((x):x is string=>!!x&&x!==actor.id))];
 if(!ids.length)return;
 const people=await all<{id:string,email:string,name:string,notify_email:number}>(`SELECT id,email,name,notify_email FROM members WHERE tenant_id=? AND active=1 AND id IN (${ids.map(()=>'?').join(',')})`,actor.tenantId,...ids);
 const mail=!!env.RESEND_API_KEY&&!!env.MAIL_FROM&&n.email!==false;
 const rows=people.map(p=>({id:uid(),p,email:mail&&p.notify_email&&/\S+@\S+/.test(p.email)}));
 if(!rows.length)return;
 await batch(rows.map(r=>stmt('INSERT INTO notifications(id,tenant_id,member_id,kind,title,body,link,email_status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',r.id,actor.tenantId,r.p.id,n.kind,n.title.slice(0,200),(n.body||'').slice(0,1000),n.link||'',r.email?'queued':'none',now())));
 const toSend=rows.filter(r=>r.email);
 if(!toSend.length)return;
 let base='';try{base=origin(req)}catch{}
 const results=await Promise.allSettled(toSend.map(r=>fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(8000),headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:env.MAIL_FROM,to:[r.p.email],subject:n.title,html:emailHtml(r.p.name,n,base)})}).then(x=>{if(!x.ok)throw Error(String(x.status))})));
 await batch(toSend.map((r,i)=>stmt('UPDATE notifications SET email_status=? WHERE id=?',results[i].status==='fulfilled'?'sent':'failed',r.id))).catch(()=>{});
}
export const emailReady=()=>!!env.RESEND_API_KEY&&!!env.MAIL_FROM;
export async function sendEmail(to:string,subject:string,html:string,replyTo?:string){
 if(!emailReady())throw Error('Email is not configured. Add RESEND_API_KEY and MAIL_FROM to the site secrets.');
 const r=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:env.MAIL_FROM,to:[to],subject,html,...(replyTo?{reply_to:replyTo}:{})})});
 if(!r.ok)throw Error(`The email service rejected the message (${r.status}).`);
}
export {esc as escapeHtml};
function emailHtml(name:string,n:Notice,base:string){const link=base&&n.link?`${base}/${n.link.startsWith('#')?n.link:'#'+n.link}`:base;return `<div style="font-family:Segoe UI,Arial,sans-serif;background:#f4f4f1;padding:32px"><div style="max-width:520px;margin:auto;background:#fff;border-radius:14px;padding:28px;border:1px solid #e6e6e0"><div style="font-weight:700;letter-spacing:-.3px;font-size:15px;color:#6D5EF8">● One Workspace</div><p style="color:#555">Hi ${esc(name.split(' ')[0]||name)},</p><h2 style="font-size:19px;margin:8px 0 6px;color:#14151a">${esc(n.title)}</h2><p style="color:#444;line-height:1.55;white-space:pre-line">${esc(n.body||'')}</p>${link?`<p style="margin-top:22px"><a href="${esc(link)}" style="background:#14151a;color:#fff;text-decoration:none;padding:10px 16px;border-radius:9px;font-weight:600">Open in One Workspace</a></p>`:''}<p style="color:#999;font-size:12px;margin-top:26px">You receive this because of your role in a workflow. Manage email alerts from your profile.</p></div></div>`}
