import {route,readBody,HttpError,stmt,batch,str,num,auditStatement,tenantOf,tenantSettings} from '../../server/core';
import {emailReady} from '../../server/notify';
import {env} from 'cloudflare:workers';
// Company-level settings: identity, branding, email domains, numbering and purchasing defaults.
export const GET=route(async(_req,u)=>{if(u.role!=='admin')throw new HttpError(403,'Only administrators manage company settings.');const t=await tenantOf(u);return {tenant:{...t,settings:tenantSettings(t)},integrations:{email:emailReady(),storage:!!env.BUCKET,assemblyai:!!env.ASSEMBLYAI_API_KEY,groq:!!env.GROQ_API_KEY}}});
export const POST=route(async(req,u)=>{
 if(u.role!=='admin')throw new HttpError(403,'Only administrators manage company settings.');
 const b=await readBody(req);const t=await tenantOf(u);const prev=tenantSettings(t);
 const prefix=(v:unknown,label:string,fallback:string)=>{const s=str(v||fallback,label,8).toUpperCase();if(!/^[A-Z]{1,8}$/.test(s))throw new HttpError(400,`${label} must be 1–8 letters.`);return s};
 const domains=str(b.domains,'Email domains',300,false).toLowerCase().split(',').map(s=>s.trim().replace(/^@/,'')).filter(Boolean);
 if(domains.some(d=>!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)))throw new HttpError(400,'Enter email domains like company.com, separated by commas.');
 const color=String(b.brandColor||t.brand_color);if(!/^#[0-9a-fA-F]{6}$/.test(color))throw new HttpError(400,'Choose a brand colour like #6D5EF8.');
 const settings={...prev,prPrefix:prefix(b.prPrefix,'Requisition prefix','PR'),poPrefix:prefix(b.poPrefix,'Order prefix','PO'),ticketPrefix:prefix(b.ticketPrefix,'Ticket prefix','TKT'),assetPrefix:prefix(b.assetPrefix,'Asset prefix','AST'),poTerms:str(b.poTerms,'Purchase order terms',4000,false),address:str(b.address,'Company address',400,false),taxId:str(b.taxId,'Tax ID',60,false),ticketCategories:str(b.ticketCategories,'Ticket categories',1000,false),assetCategories:str(b.assetCategories,'Asset categories',1000,false),weekStart:num(b.weekStart??1,'Week start',0,6)};
 const next={name:str(b.name,'Company name',120),legal_name:str(b.legalName,'Legal name',160,false),domains:domains.join(','),brand_color:color,currency:str(b.currency||'GHS','Currency',8).toUpperCase(),timezone:str(b.timezone||'Africa/Accra','Time zone',60)};
 await batch([stmt('UPDATE tenants SET name=?,legal_name=?,domains=?,brand_color=?,currency=?,timezone=?,settings_json=? WHERE id=?',next.name,next.legal_name,next.domains,next.brand_color,next.currency,next.timezone,JSON.stringify(settings),u.tenantId),auditStatement(u,'Company settings updated',u.tenantId,'Administration',{name:t.name,domains:t.domains},{...next,settings})]);
 return {ok:true};
});
