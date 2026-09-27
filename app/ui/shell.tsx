'use client';
import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {api,useApi,useRoute,go,cx,pref,setPref,ago,PREVIEW_KEY} from './lib';
import {AppContext,AskDialog,Avatar,Btn,Empty,Icon,Inspector,Menu,useApp as useAppSafe,type Session} from './kit';
import {useFolders,fileViews} from './files';
import Projects from './projects';
import Tasks,{taskViews} from './tasks';
import Messages from './messages';
import Home from './home';
import People from './people';
import Tickets from './tickets';
import Assets from './assets';
import Purchasing from './purchasing';
import Files from './files';
import Spaces from './spaces';
import Operations from './ops';
import Admin from './admin';
import Platform from './platform';
import Inventory from './inventory';
import Maintenance from './maintenance';
import Reports from './reports';
import WorkGraph from './graph';
import Business,{businessViews} from './business';
import Studio from './studio';
import Agents,{AgentDock} from './agents';
import Inbox from './inbox';
import AppRuntime from './studio-runtime';
import Pages from './builder';
import {Assistant} from './assistant';
import {ConnectorCenter} from './integrations';

type View={id:string,label:string,icon:string,count?:number,hidden?:boolean,section?:string};
type AppDef={id:string,label:string,icon:string,tone:string,show:boolean,views:View[],render:(parts:string[])=>ReactNode};

export default function OneWorkspace(){
 const [boot,setBoot]=useState<{mode:string,ready?:boolean,user?:{name:string,email:string}}|null>(null),[s,setS]=useState<Session|null>(null);
 const load=useCallback(async()=>{try{const d=await api<any>('/api/session');setBoot(d);if(d.mode==='live')setS(d)}catch(e){setBoot({mode:'error',user:{name:(e as Error).message,email:''}})}},[]);
 useEffect(()=>{load()},[load]);
 useEffect(()=>{const t=pref<string>('theme','system');document.documentElement.dataset.theme=t==='system'?'':t},[]);
 const route=useRoute();
 if(route.app==='activate'&&route.parts[0])return <Activate token={route.parts[0]}/>;
 if(!boot)return <Splash/>;
 if(boot.mode==='signed-out'||boot.mode==='error')return <SignIn ready={boot.ready!==false} error={boot.mode==='error'?boot.user?.name:undefined} onDone={load}/>;
 if(boot.mode==='must-change')return <SignIn changing name={boot.user?.name} onDone={load}/>;
 if(!s)return <Splash/>;
 return <Shell s={s} refresh={load}/>;
}

// Role preview is kept per tab and only for the same administrator and workspace.
type RolePreview={roleName:string,tenantId:string,userId:string,permissions:Record<string,Record<string,string>>,rolePages:string[]|null};
function readPreview(s:Session):RolePreview|null{try{const p=JSON.parse(sessionStorage.getItem(PREVIEW_KEY)||'null') as RolePreview|null;return p&&p.tenantId===s.tenant.id&&p.userId===s.user.id&&s.user.role==='admin'?p:null}catch{return null}}
function NoAccess(){return <div className="page"><Empty icon="Lock" title="You don't have access to this page" action={<Btn variant="primary" icon="House" onClick={()=>go('home')}>Go to Home</Btn>}>Your role doesn't include it, or it isn't part of your company's plan. Ask an administrator if you need it.</Empty></div>}
function signOut(){const f=document.createElement('form');f.method='post';f.action='/api/auth/logout';document.body.appendChild(f);f.submit()}
function Splash(){return <div className="splash"><Logo size={44}/><span className="spin"/></div>}
export function Logo({size=34}:{size?:number}){return <span className="logo" style={{width:size,height:size}} aria-hidden><svg viewBox="0 0 40 40" width={size} height={size}><rect x="2" y="2" width="36" height="36" rx="11" fill="var(--brand)"/><rect x="9" y="9" width="10" height="10" rx="3.2" fill="#fff" opacity=".95"/><rect x="21" y="9" width="10" height="10" rx="3.2" fill="#fff" opacity=".55"/><rect x="9" y="21" width="10" height="10" rx="3.2" fill="#fff" opacity=".55"/><rect x="21" y="21" width="10" height="10" rx="5" fill="#fff" opacity=".95"/></svg></span>}

function AuthLayout({children}:{children:ReactNode}){return <div className="auth">
  <section className="auth-art">
   <div className="auth-brand"><Logo size={40}/><span>One Workspace</span></div>
   <div className="auth-copy"><h1>Your company,<br/>running as one.</h1><p>People, assets, tickets, purchasing, files and department knowledge — one calm operating system for the whole team.</p></div>
   <div className="auth-tiles">{[['Ticket','TKT-2026-0142','In progress','orange'],['Requisition','PR-2026-0088','Approved','green'],['Asset','AST-00417','Assigned','teal'],['Space','Finance · Month-end close','Published','pink']].map(([k,t,st,tone],i)=><div key={t} className="auth-tile" style={{animationDelay:`${i*.12}s`}}><span className={`tile-dot tone-${tone}`}/><div><small>{k}</small><b>{t}</b></div><em>{st}</em></div>)}</div>
   <div className="auth-orb a"/><div className="auth-orb b"/>
  </section>
  <section className="auth-form">{children}</section>
 </div>}

function SignIn({changing,name,onDone,ready=true,error}:{changing?:boolean,name?:string,onDone:()=>void,ready?:boolean,error?:string}){
 const [mode,setMode]=useState<'signin'|'claim'|'forgot'>('signin');
 const [token,setToken]=useState(''),[login,setLogin]=useState(''),[password,setPassword]=useState(''),[next,setNext]=useState(''),[confirm,setConfirm]=useState(''),[msg,setMsg]=useState<{text:string,ok?:boolean}|null>(error?{text:error}:null),[busy,setBusy]=useState(false);
 const claim=mode==='claim',forgot=mode==='forgot';
 async function submit(e:React.FormEvent){e.preventDefault();setMsg(null);if((changing||claim)&&next!==confirm){setMsg({text:'The new passwords do not match.'});return}setBusy(true);try{
  if(forgot){const r=await api<{message:string}>('/api/auth/forgot',{email:login});setMsg({text:r.message,ok:true});return}
  if(claim){await api('/api/platform/claim',{token,password:next});setMode('signin');setToken('');setLogin('');setPassword('');setNext('');setConfirm('');setMsg({text:'Platform Owner password set. Sign in now.',ok:true});return}
  await api(changing?'/api/auth/password':'/api/auth/login',changing?{current:password,password:next}:{login,password});onDone()}catch(e){setMsg({text:(e as Error).message})}finally{setBusy(false)}}
 return <AuthLayout><form onSubmit={submit} className="auth-card">
    <h2>{claim?'Platform Owner setup':forgot?'Reset your password':changing?`Welcome, ${name?.split(' ')[0]||''}`:'Sign in'}</h2>
    <p className="muted">{claim?'One-time setup for the Platform Owner account. Enter the setup token from the server secrets.':forgot?'Enter your work email. If it has an account, we will email a reset link.':changing?'Replace your temporary password with a personal one to continue.':'Use your work email or username.'}</p>
    {!ready&&<div className="note note-warn"><Icon name="TriangleAlert" size={16}/><span>The workspace database is not connected in this environment.</span></div>}
    {claim&&<label className="field"><span className="field-label">Setup token</span><input autoFocus required type="password" autoComplete="off" value={token} onChange={e=>setToken(e.target.value)}/></label>}
    {!changing&&!claim&&<label className="field"><span className="field-label">{forgot?'Work email':'Email or username'}</span><input autoFocus required type={forgot?'email':'text'} autoComplete="username" value={login} onChange={e=>setLogin(e.target.value)}/></label>}
    {!claim&&!forgot&&<label className="field"><span className="field-label">{changing?'Current (temporary) password':'Password'}</span><input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} autoFocus={changing}/></label>}
    {(changing||claim)&&<><label className="field"><span className="field-label">New password</span><input required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={next} onChange={e=>setNext(e.target.value)}/><small className="field-hint">At least 12 characters. A short sentence works well.</small></label><label className="field"><span className="field-label">Confirm new password</span><input required type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)}/></label></>}
    {msg&&<div className={`note ${msg.ok?'note-ok':'note-error'}`} role="alert"><Icon name={msg.ok?'CircleCheck':'CircleAlert'} size={16}/><span>{msg.text}</span></div>}
    <Btn type="submit" variant="primary" busy={busy} className="btn-block">{claim?'Set Platform Owner password':forgot?'Send reset link':changing?'Save password & continue':'Sign in'}</Btn>
    {changing&&<button type="button" className="link small" onClick={signOut}>Sign out</button>}
    {!changing&&<div className="auth-links">{mode!=='signin'?<button type="button" className="link small" onClick={()=>{setMode('signin');setMsg(null)}}>Back to sign in</button>:<><button type="button" className="link small" onClick={()=>{setMode('forgot');setMsg(null)}}>Forgot password?</button><button type="button" className="link small muted-link" onClick={()=>{setMode('claim');setMsg(null)}}>Platform Owner setup</button></>}</div>}
    <p className="auth-foot">Accounts are created by invitation from your company administrator.</p>
   </form></AuthLayout>;
}

// Invitation / password-reset landing page. The token stays in the URL fragment, so it never reaches server logs.
function Activate({token}:{token:string}){
 const [info,setInfo]=useState<{purpose:string,name:string,email:string,workspace:string|null}|null>(null),[err,setErr]=useState(''),[pw,setPw]=useState(''),[pw2,setPw2]=useState(''),[busy,setBusy]=useState(false),[done,setDone]=useState(false);
 useEffect(()=>{api<any>('/api/auth/activate',{token,check:true}).then(setInfo).catch(e=>setErr((e as Error).message))},[token]);
 async function submit(e:React.FormEvent){e.preventDefault();if(pw!==pw2){setErr('The passwords do not match.');return}setBusy(true);setErr('');try{await api('/api/auth/activate',{token,password:pw});setDone(true);history.replaceState(null,'','/#/home')}catch(x){setErr((x as Error).message)}finally{setBusy(false)}}
 return <AuthLayout><form className="auth-card" onSubmit={submit}>
  {done?<><h2>You're all set</h2><p className="muted">Your password is saved. Sign in with {info?.email}.</p><Btn variant="primary" className="btn-block" onClick={()=>{location.href='/'}}>Go to sign in</Btn></>:
  !info?<>{err?<><h2>Link not valid</h2><div className="note note-error" role="alert"><Icon name="CircleAlert" size={16}/><span>{err}</span></div><a className="link small" href="/">Back to sign in</a></>:<div className="spin-center"><span className="spin"/></div>}</>:<>
   <h2>{info.purpose==='invite'?`Join ${info.workspace||'One Workspace'}`:'Choose a new password'}</h2>
   <p className="muted">{info.purpose==='invite'?`Welcome, ${info.name.split(' ')[0]}. Choose a password to activate ${info.email}.`:`Resetting the password for ${info.email}.`}</p>
   <label className="field"><span className="field-label">New password</span><input autoFocus required type="password" minLength={12} maxLength={128} autoComplete="new-password" value={pw} onChange={e=>setPw(e.target.value)}/><small className="field-hint">At least 12 characters. This link works once.</small></label>
   <label className="field"><span className="field-label">Confirm password</span><input required type="password" autoComplete="new-password" value={pw2} onChange={e=>setPw2(e.target.value)}/></label>
   {err&&<div className="note note-error" role="alert"><Icon name="CircleAlert" size={16}/><span>{err}</span></div>}
   <Btn type="submit" variant="primary" busy={busy} className="btn-block">{info.purpose==='invite'?'Activate account':'Save new password'}</Btn>
  </>}
 </form></AuthLayout>;
}

function Shell({s,refresh}:{s:Session,refresh:()=>Promise<void>}){
 const route=useRoute();
 const [toasts,setToasts]=useState<{id:number,msg:string,tone:string}[]>([]);
 const [askState,setAsk]=useState<{a:any,resolve:(v:string|false)=>void}|null>(null);
 const [palette,setPalette]=useState(false),[bell,setBell]=useState(false),[railOpen,setRailOpen]=useState(()=>pref('rail',true)),[mobileNav,setMobileNav]=useState(false),[shortcuts,setShortcuts]=useState(false);
 const [theme,setTheme]=useState<string>(()=>pref('theme','system'));
 // "Preview as role": an administrator sees navigation and actions exactly as a role would. Data requests
 // still run with the administrator's own access; the banner says so.
 const [preview]=useState<RolePreview|null>(()=>readPreview(s));
 const perms=preview?.permissions||s.user.permissions;
 const can=useCallback((page:string,action='view')=>{const p=perms[page];return !!p&&p.view!=='none'&&!!p[action]&&p[action]!=='none'},[perms]);
 const scope=useCallback((page:string,action='view')=>perms[page]?.[action]||'none',[perms]);
 const peopleById=useMemo(()=>new Map(s.people.map(p=>[p.id,p])),[s.people]);
 const toast=useCallback((msg:string,tone:'ok'|'error'|'info'='ok')=>{const id=Date.now()+Math.random();setToasts(t=>[...t.slice(-3),{id,msg,tone}]);setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)),tone==='error'?7000:4000)},[]);
 const ask=useCallback((a:any)=>new Promise<string|false>(resolve=>setAsk({a,resolve})),[]);
 const ctx=useMemo(()=>({s,can,scope,person:(id?:string|null)=>id?peopleById.get(id):undefined,refresh,toast,ask}),[s,can,scope,peopleById,refresh,toast,ask]);
 const admin=s.user.role==='admin'&&!preview;
 const strict=preview?!!preview.rolePages:!!s.user.rolePages;
 // Keep counters fresh while the app is open.
 useEffect(()=>{const t=setInterval(()=>{if(document.visibilityState==='visible')refresh()},90000);return()=>clearInterval(t)},[refresh]);
 useEffect(()=>{document.documentElement.dataset.theme=theme==='system'?'':theme;setPref('theme',theme)},[theme]);
 useEffect(()=>{document.documentElement.style.setProperty('--brand',s.tenant.brandColor||'#6D5EF8');document.title=`${s.tenant.name} · One Workspace`},[s.tenant]);
 useEffect(()=>{setMobileNav(false)},[route.app,route.parts.join('/')]);

 // Navigation follows the permission map from the server. Pages of switched-off modules come back as
 // "none" there, so the module disappears here and its API refuses requests.
 const owner=s.user.platformRole==='owner';
 const apps:AppDef[]=[
  {id:'home',label:'Home',icon:'House',tone:'violet',show:true,views:[],render:p=>p[0]==='connections'&&s.tenant.modules.includes('integrations')?<ConnectorCenter scope="company" personal parts={p.slice(1)}/>:<Home/>},
  {id:'tickets',label:'Tickets',icon:'LifeBuoy',tone:'orange',show:can('maintenance'),views:[{id:'mine',label:'Assigned to me',icon:'UserCheck',count:s.counts.tickets},{id:'requested',label:'Raised by me',icon:'Send'},{id:'department',label:'My department',icon:'Building2'},{id:'queue',label:'Team queue',icon:'Inbox',hidden:!can('maintenance','update')},{id:'board',label:'Board',icon:'Kanban'},{id:'all',label:'All tickets',icon:'List'}],render:p=><Tickets parts={p}/>},
  {id:'purchasing',label:'Purchasing',icon:'ShoppingBag',tone:'green',show:can('requests')||can('procurement'),views:[{id:'inbox',label:'Approvals inbox',icon:'Stamp',count:s.counts.approvals},{id:'pr',label:'Requisitions',icon:'ClipboardList',hidden:!can('requests')},{id:'po',label:'Purchase orders',icon:'FileText',hidden:!can('procurement')},{id:'vendors',label:'Vendors',icon:'Store',hidden:!can('suppliers')&&!can('procurement')},{id:'budgets',label:'Budgets',icon:'PiggyBank',hidden:!can('budgets')},{id:'workflows',label:'Approval workflows',icon:'Workflow',hidden:!admin}],render:p=><Purchasing parts={p}/>},
  {id:'assets',label:'Assets',icon:'Boxes',tone:'teal',show:can('assets')||(!strict&&s.tenant.modules.includes('assets')),views:[{id:'mine',label:'My assets',icon:'Laptop'},{id:'all',label:'Asset register',icon:'Database',hidden:!can('assets')},{id:'audits',label:'Asset audits',icon:'ClipboardCheck',hidden:!can('assets')},{id:'dashboard',label:'Overview',icon:'ChartPie',hidden:!can('assets')}],render:p=><Assets parts={p}/>},
  {id:'inventory',label:'Inventory',icon:'Package',tone:'amber',show:can('inventory')&&s.tenant.modules.includes('inventory'),views:[{id:'items',label:'Stock items',icon:'Package'},{id:'reorder',label:'Reorder list',icon:'TriangleAlert'},{id:'moves',label:'Movements',icon:'ArrowRightLeft'}],render:p=><Inventory parts={p}/>},
  {id:'maintenance',label:'Maintenance',icon:'Wrench',tone:'indigo',show:can('schedules'),views:[{id:'orders',label:'Work orders',icon:'ClipboardList'},{id:'mine',label:'Assigned to me',icon:'UserCheck'},{id:'plans',label:'Preventive plans',icon:'CalendarClock'}],render:p=><Maintenance parts={p}/>},
  {id:'people',label:'People',icon:'Users',tone:'sky',show:can('people')||can('settings','manage_members'),views:[{id:'directory',label:'Directory',icon:'Contact'},{id:'org',label:'Org chart',icon:'Network'},{id:'departments',label:'Departments',icon:'Building2'},{id:'locations',label:'Locations',icon:'MapPin',hidden:!can('locations')},{id:'manage',label:'Manage users',icon:'UserCog',hidden:!can('settings','manage_members')}],render:p=><People parts={p}/>},
  {id:'projects',label:'Projects',icon:'FolderKanban',tone:'violet',show:can('projects'),views:[{id:'all',label:'All projects',icon:'LayoutGrid'},{id:'mine',label:'My projects',icon:'UserCheck'},{id:'archived',label:'Archived',icon:'Archive'},{id:'templates',label:'Templates',icon:'LayoutTemplate',section:'Setup'},{id:'workflows',label:'Lifecycles',icon:'Workflow',hidden:!admin,section:'Setup'}],render:p=><Projects parts={p}/>},
  {id:'tasks',label:'Tasks',icon:'ListTodo',tone:'green',show:can('tasks'),views:taskViews,render:p=><Tasks parts={p}/>},
  {id:'messages',label:'Messages',icon:'MessageSquare',tone:'blue',show:can('messages'),views:[],render:p=><Messages parts={p}/>},
  {id:'spaces',label:'Spaces',icon:'LibraryBig',tone:'pink',show:can('knowledge'),views:[],render:p=><Spaces parts={p}/>},
  {id:'files',label:'Files',icon:'FolderClosed',tone:'amber',show:can('documents'),views:[],render:p=><Files parts={p}/>},
  {id:'reports',label:'Reports',icon:'ChartColumn',tone:'blue',show:can('reports'),views:[],render:p=><Reports parts={p}/>},
  {id:'business',label:'Goals & customers',icon:'Target',tone:'violet',show:can('business'),views:businessViews,render:p=><Business parts={p}/>},
  {id:'graph',label:'Work Graph',icon:'Network',tone:'violet',show:can('graph'),views:[],render:()=> <WorkGraph/>},
  {id:'studio',label:'Workspace Studio',icon:'PanelsTopLeft',tone:'violet',show:can('studio')&&(admin||can('studio','configure')),views:[{id:'apps',label:'Apps',icon:'AppWindow'},{id:'data',label:'Data',icon:'Database',section:'Build'},{id:'forms',label:'Forms',icon:'ClipboardPen',section:'Build'},{id:'workflows',label:'Workflows',icon:'Workflow',section:'Build'},{id:'automations',label:'Automations',icon:'Zap',section:'Build'},{id:'reports',label:'Reports',icon:'ChartPie',section:'Build'},{id:'pages',label:'Pages',icon:'LayoutGrid',section:'Build'},{id:'widgets',label:'Widgets',icon:'Puzzle',section:'Library'},{id:'templates',label:'Templates',icon:'LayoutTemplate',section:'Library'},{id:'extensions',label:'Custom fields',icon:'Blocks',section:'Library'},{id:'approvals',label:'App approvals',icon:'Stamp',section:'Operate'},{id:'usage',label:'Usage',icon:'Gauge',section:'Operate'},{id:'published',label:'Published apps',icon:'Rocket',section:'Operate'}],render:p=> <Studio parts={p}/>},
  {id:'apps',label:'Apps',icon:'AppWindow',tone:'violet',show:can('studio'),views:[],render:p=> <AppRuntime parts={p}/>},
  {id:'inbox',label:'Inbox',icon:'Inbox',tone:'violet',show:true,views:[],render:p=> <Inbox parts={p}/>},
  {id:'agents',label:'AI workforce',icon:'Bot',tone:'violet',show:can('agents'),views:[],render:p=> <Agents parts={p}/>},
  {id:'pages',label:'Pages',icon:'LayoutGrid',tone:'violet',show:can('app-pages'),views:[],render:p=><Pages parts={p}/>},
  {id:'ops',label:'Operations',icon:'Factory',tone:'slate',show:['it','research'].some(p=>can(p))||(can('receipts')&&admin),views:[{id:'it',label:'IT & CCTV storage',icon:'HardDrive',hidden:!can('it')},{id:'research',label:'Consumer research',icon:'FlaskConical',hidden:!can('research')},{id:'inventory',label:'Imported stock register',icon:'Package',hidden:!can('inventory'),section:'Imported registers'},{id:'receipts',label:'Imported receipts',icon:'Truck',hidden:!can('receipts'),section:'Imported registers'},{id:'budgets',label:'Imported budgets',icon:'PiggyBank',hidden:!can('budgets'),section:'Imported registers'}],render:p=><Operations parts={p}/>},
  {id:'admin',label:'Admin',icon:'Settings2',tone:'gray',show:admin||can('audit'),views:[{id:'company',label:'Company settings',icon:'Building',hidden:!admin},{id:'lists',label:'Lists',icon:'ListChecks',hidden:!admin&&!can('settings','configure')},{id:'groups',label:'Groups',icon:'UsersRound',hidden:!admin&&!can('settings','configure')},{id:'roles',label:'Roles & permissions',icon:'ShieldCheck',hidden:!admin},{id:'overrides',label:'Access overrides',icon:'KeyRound',hidden:!admin},{id:'data',label:'Data hub',icon:'DatabaseZap',hidden:!can('company-data')},{id:'activity',label:'Activity log',icon:'History',hidden:!can('audit')},{id:'security',label:'Security log',icon:'ShieldAlert',hidden:!admin},{id:'connectors',label:'Connectors',icon:'Link',hidden:!(admin&&s.tenant.modules.includes('integrations'))&&!can('connectors','configure'),section:'Integrations'},{id:'ai',label:'AI Control Tower',icon:'RadioTower',hidden:!admin,section:'Integrations'}],render:p=><Admin parts={p}/>},
  // The Platform app exists only for the Platform Owner and is separate from company administration.
  {id:'platform',label:'Platform',icon:'Globe',tone:'red',show:owner&&!preview,views:[{id:'workspaces',label:'Workspaces',icon:'Building'},{id:'catalog',label:'Page catalog',icon:'LayoutGrid'},{id:'connectors',label:'Connectors & AI',icon:'Link'},{id:'os',label:'Operating system',icon:'Cpu'},{id:'audit',label:'Platform audit',icon:'ScrollText'}],render:p=><Platform parts={p}/>},
 ];
 const visibleApps=apps.filter(a=>a.show);
 const dockGroups=[
  {id:'work',label:'Work',icon:'LayoutGrid',apps:['inbox','projects','tasks','business','messages','spaces','files','pages','apps','studio','graph']},
  {id:'operations',label:'Operations',icon:'Factory',apps:['tickets','purchasing','assets','inventory','maintenance','ops']},
  {id:'people',label:'People & admin',icon:'UsersRound',apps:['people','admin','agents','platform']},
 ];
 const denied=!!route.app&&apps.some(a=>a.id===route.app)&&!visibleApps.some(a=>a.id===route.app);
 const current=visibleApps.find(a=>a.id===route.app)||visibleApps[0];
 // First load with no route: go to the role's default landing screen.
 const landed=useRef(false);
 useEffect(()=>{if(landed.current)return;landed.current=true;if(!location.hash.replace(/^#\/?/,'')&&s.user.defaultScreen)go(s.user.defaultScreen)},[s.user.defaultScreen]);
 const views=current.views.filter(v=>!v.hidden);
 const activeView=route.parts[0]||views[0]?.id;

 // Global shortcuts: Ctrl/⌘+K palette, "/" search, "g" then a letter to jump, "?" help.
 const pendingG=useRef(0);
 useEffect(()=>{const f=(e:KeyboardEvent)=>{const t=e.target as HTMLElement;const typing=/INPUT|TEXTAREA|SELECT/.test(t.tagName)||t.isContentEditable;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setPalette(p=>!p);return}
  if(typing||e.ctrlKey||e.metaKey||e.altKey)return;
  if(e.key==='/'){e.preventDefault();setPalette(true);return}
  if(e.key==='?'){setShortcuts(true);return}
  if(e.key==='g'){pendingG.current=Date.now();return}
  if(Date.now()-pendingG.current<900){const map:Record<string,string>={h:'home',t:'tickets',p:'purchasing',a:'assets',i:'inventory',m:'maintenance',r:'reports',u:'people',s:'spaces',f:'files',o:'ops',x:'admin',j:'projects',k:'tasks',c:'messages'};if(map[e.key]){go(map[e.key]);pendingG.current=0}}
 };window.addEventListener('keydown',f);return()=>window.removeEventListener('keydown',f)},[]);

 const [paletteQuery,setPaletteQuery]=useState('');
 useEffect(()=>{const f=(e:Event)=>{setPaletteQuery(String((e as CustomEvent).detail||''));setPalette(true)};window.addEventListener('ows:search',f);return()=>window.removeEventListener('ows:search',f)},[]);
 const create=[
  {label:'New ticket',icon:'LifeBuoy',path:'tickets/new',show:can('maintenance','create')},
  {label:'New requisition',icon:'ClipboardList',path:'purchasing/pr/new',show:can('requests','create')},
  {label:'New purchase order',icon:'FileText',path:'purchasing/po/new',show:can('procurement','create')},
  {label:'Register asset',icon:'Boxes',path:'assets/all/new',show:can('assets','create')},
  {label:'New work order',icon:'Wrench',path:'maintenance/orders/new',show:can('schedules','create')},
  {label:'New stock item',icon:'Package',path:'inventory/items/new',show:can('inventory','create')},
  {label:'Write a page',icon:'PenLine',path:'spaces/edit/new',show:can('knowledge','create')},
  {label:'New announcement',icon:'Megaphone',path:'spaces/edit/new?kind=announcement',show:can('knowledge','create')},
  {label:'New task',icon:'ListTodo',path:'tasks/mine/new',show:can('tasks','create')},
  {label:'New project',icon:'FolderKanban',path:'projects/all/new',show:can('projects','create')},
  {label:'Upload file',icon:'Upload',path:'files/root/upload',show:can('documents','upload')},
  {label:'Invite person',icon:'UserPlus',path:'people/manage/new',show:can('settings','manage_members')},
 ].filter(c=>c.show);

 return <AppContext.Provider value={ctx}>
  <OfflineBanner/>
  <div className={cx('os',!railOpen&&'rail-collapsed',mobileNav&&'mobile-nav')}>
   <nav className="dock" aria-label="Apps">
    <a href="#/home" className="dock-logo" title={s.tenant.name}><Logo size={36}/></a>
    <div className="dock-apps">
     {visibleApps.filter(a=>a.id==='home').map(a=><a key={a.id} href={`#/${a.id}`} className={cx('dock-app',current.id===a.id&&'on')} aria-current={current.id===a.id?'page':undefined}><span className={`dock-tile tone-${a.tone}`}><Icon name={a.icon} size={19}/></span><span className="dock-label">{a.label}</span></a>)}
     {dockGroups.map(group=>{const members=visibleApps.filter(a=>group.apps.includes(a.id));if(!members.length)return null;const active=members.some(a=>a.id===current.id);return <Menu key={group.id} align="left" trigger={open=><button type="button" className={cx('dock-app','dock-group',active&&'on')} onClick={open} aria-label={`${group.label} apps`} aria-haspopup="menu" title={group.label}><span className="dock-tile"><Icon name={group.icon} size={19}/></span><span className="dock-label">{group.label}</span></button>} items={members.map(a=>({label:`${a.id===current.id?'• ':''}${a.label}${a.id==='purchasing'&&s.counts.approvals>0?` · ${s.counts.approvals} approvals`:a.id==='tickets'&&s.counts.tickets>0?` · ${s.counts.tickets} open`:''}`,icon:a.icon,onClick:()=>go(a.id)}))}/>})}
     {visibleApps.filter(a=>a.id==='reports').map(a=><a key={a.id} href={`#/${a.id}`} className={cx('dock-app',current.id===a.id&&'on')} aria-current={current.id===a.id?'page':undefined}><span className={`dock-tile tone-${a.tone}`}><Icon name={a.icon} size={19}/></span><span className="dock-label">{a.label}</span></a>)}
    </div>
    <div className="dock-foot">
     <button className="dock-btn" title="Notifications" onClick={()=>setBell(true)}><Icon name="Bell" size={19}/>{s.counts.notifications>0&&<b className="dock-badge">{s.counts.notifications>99?'99+':s.counts.notifications}</b>}</button>
     <Menu align="left" trigger={open=><button className="dock-me" onClick={open} title={s.user.name}><Avatar name={s.user.name} size={34} ring/></button>} items={[
      {label:`${s.user.name}`,icon:'User',onClick:()=>go(`people/directory/${s.user.id}`)},
      {label:`Theme: ${theme==='black'?'Black':theme==='dim'?'Dim white':theme==='light'?'Light':theme==='dark'?'Dark':'System'}`,icon:'Moon',onClick:()=>setTheme(theme==='black'?'dim':'black')},
      {label:'Black theme',icon:'Moon',onClick:()=>setTheme('black')},
      {label:'Dim white theme',icon:'Sun',onClick:()=>setTheme('dim')},
      {label:'Use system theme',icon:'Settings',onClick:()=>setTheme('system')},
      {label:'Keyboard shortcuts',icon:'Keyboard',onClick:()=>setShortcuts(true)},
      '-',
      {label:'Sign out',icon:'LogOut',danger:true,onClick:signOut},
     ]}/>
    </div>
   </nav>
   <aside className="rail" aria-label={`${current.label} navigation`}>
    <div className="rail-head"><div><WorkspaceSwitcher/><h2>{current.label}</h2></div><Btn size="sm" variant="ghost" icon="PanelLeftClose" title="Collapse sidebar" onClick={()=>{setRailOpen(false);setPref('rail',false)}}/></div>
    <RailBody app={current.id} views={views} active={activeView}/>
   </aside>
   <div className="stage">
    {s.support&&<SupportBanner/>}
    {preview&&<div className="support-banner preview-banner" role="status"><Icon name="ShieldCheck" size={17}/><span><b>Previewing as {preview.roleName}</b> · Navigation and actions show what this role can use. Data still loads with your own access.</span><button className="support-exit" onClick={()=>{try{sessionStorage.removeItem(PREVIEW_KEY)}catch{}location.hash='#/admin/roles';location.reload()}}>Exit preview</button></div>}
    <header className="topbar">
     <button className="topbar-menu" aria-label="Open navigation" onClick={()=>setMobileNav(!mobileNav)}><Icon name="Menu"/></button>
     {!railOpen&&<Btn size="sm" variant="ghost" icon="PanelLeftOpen" title="Show sidebar" onClick={()=>{setRailOpen(true);setPref('rail',true)}}/>}
     <div className="crumbs"><span>{current.label}</span>{views.find(v=>v.id===activeView)&&<><Icon name="ChevronRight" size={14}/><b>{views.find(v=>v.id===activeView)!.label}</b></>}</div>
     <button className="search-pill" onClick={()=>setPalette(true)}><Icon name="Search" size={16}/><span>Search or jump to…</span><kbd>Ctrl K</kbd></button>
     <div className="topbar-right">
      {create.length>0&&<Menu trigger={open=><Btn variant="primary" icon="Plus" onClick={open}>New</Btn>} items={create.map(c=>({label:c.label,icon:c.icon,onClick:()=>go(c.path)}))}/>}
     </div>
    </header>
    <main className="canvas" key={denied?'denied':current.id}>{denied?<NoAccess/>:current.render(route.parts)}</main>
   </div>
   <div className="mobile-scrim" onClick={()=>setMobileNav(false)}/>
  </div>
  {palette&&<Palette apps={visibleApps} create={create} initial={paletteQuery} onClose={()=>{setPalette(false);setPaletteQuery('')}}/>}
  {!preview&&<Assistant/>}
  {!preview&&<AgentDock/>}
  <Notifications open={bell} onClose={()=>setBell(false)}/>
  {shortcuts&&<Shortcuts onClose={()=>setShortcuts(false)}/>}
  <AskDialog ask={askState?.a||null} onDone={v=>{askState?.resolve(v);setAsk(null)}}/>
  <div className="toasts" aria-live="polite">{toasts.map(t=><div key={t.id} className={`toast toast-${t.tone}`}><Icon name={t.tone==='error'?'CircleAlert':t.tone==='info'?'Info':'CircleCheck'} size={17}/><span>{t.msg}</span></div>)}</div>
 </AppContext.Provider>;
}

// Module-specific rail content: plain views for most apps, live trees for Spaces and Files.
function RailBody({app,views,active}:{app:string,views:View[],active?:string}){
 if(app==='spaces')return <SpacesRail/>;
 if(app==='files')return <FilesRail/>;
 if(app==='home')return <HomeRail/>;
 return <nav className="rail-nav">{views.map((v,i)=>{const head=v.section&&v.section!==views[i-1]?.section?<p className="rail-section">{v.section}</p>:null;return <div key={v.id}>{head}<a href={`#/${app}/${v.id}`} className={cx('rail-link',active===v.id&&'on')}><Icon name={v.icon} size={17}/><span>{v.label}</span>{!!v.count&&<b>{v.count}</b>}</a></div>})}</nav>;
}
function HomeRail(){const {s,can}=useAppSafe();const links=[{href:'#/inbox',icon:'Inbox',label:'Inbox',show:true},{href:'#/apps',icon:'AppWindow',label:'Company apps',show:can('studio')},{href:'#/purchasing/inbox',icon:'Stamp',label:'My approvals',count:s.counts.approvals,show:can('requests')||can('procurement')},{href:'#/tickets/mine',icon:'UserCheck',label:'My tickets',count:s.counts.tickets,show:can('maintenance')},{href:'#/tickets/requested',icon:'Send',label:'Raised by me',show:can('maintenance')},{href:'#/purchasing/pr',icon:'ClipboardList',label:'My requisitions',show:can('requests')},{href:'#/assets/mine',icon:'Laptop',label:'My assets',show:true},{href:`#/people/directory/${s.user.id}`,icon:'IdCard',label:'My profile',show:true},{href:'#/home/connections',icon:'Link',label:'My connections',show:s.tenant.modules.includes('integrations')&&(s.user.role==='admin'||can('connectors','use_connectors'))},{href:'#/tasks/mine',icon:'ListTodo',label:'My tasks',show:can('tasks')},{href:'#/messages',icon:'MessageSquare',label:'Messages',show:can('messages')}];return <nav className="rail-nav"><a className="rail-link on" href="#/home"><Icon name="Sun" size={17}/><span>Today</span></a><p className="rail-section">Shortcuts</p>{links.filter(l=>l.show).map(l=><a key={l.href} className="rail-link" href={l.href}><Icon name={l.icon} size={17}/><span>{l.label}</span>{!!l.count&&<b>{l.count}</b>}</a>)}<div className="rail-card"><Icon name="Command" size={16}/><div><b>Tip</b><small>Press <kbd>Ctrl K</kbd> to find anything, or <kbd>g</kbd> then <kbd>t</kbd> for tickets.</small></div></div></nav>}
function SpacesRail(){const {data}=useApi<{spaces:{id:string,kind:string,name:string,color:string,status:string}[]}>('/api/spaces');const route=useRoute();const cur=route.parts[0]==='s'?route.parts[1]:route.parts[0]===undefined?'__home':route.parts[0];const list=(data?.spaces||[]).filter(x=>x.status!=='archived');const dot=(n:string,c?:string)=><span className="space-dot" style={{background:c||`hsl(${[...n].reduce((h,ch)=>(h*31+ch.charCodeAt(0))%360,0)} 65% 60%)`}}/>;const link=(x:{id:string,name:string,color:string})=><a key={x.id} className={cx('rail-link',cur===x.id&&'on')} href={`#/spaces/${x.id}`}>{dot(x.name,x.color)}<span>{x.name}</span></a>;return <nav className="rail-nav"><a className={cx('rail-link',cur==='__home'&&'on')} href="#/spaces"><Icon name="LayoutGrid" size={17}/><span>All spaces</span></a><a className={cx('rail-link',cur==='approvals'&&'on')} href="#/spaces/approvals"><Icon name="Stamp" size={17}/><span>Awaiting approval</span></a>{list.filter(x=>x.kind==='company').map(link)}<p className="rail-section">Departments</p>{list.filter(x=>x.kind==='department').map(link)}{list.some(x=>x.kind==='custom')&&<p className="rail-section">Spaces</p>}{list.filter(x=>x.kind==='custom').map(link)}{list.some(x=>x.kind==='project')&&<p className="rail-section">Projects</p>}{list.filter(x=>x.kind==='project').slice(0,15).map(link)}<a className={cx('rail-link',cur==='recycle'&&'on')} href="#/spaces/recycle"><Icon name="Trash2" size={17}/><span>Recycle bin</span></a></nav>}
function FilesRail(){const {s:sess}=useAppSafe();const {data}=useFolders();const route=useRoute();const cur=route.parts[0]||'root';const folders=(data?.folders||[]) as {id:string,parent_id:string|null,name:string}[];const tree=(parent:string|null,depth:number):ReactNode=>folders.filter(f=>f.parent_id===parent).map(f=><div key={f.id}><a className={cx('rail-link',cur===f.id&&'on')} style={{paddingLeft:12+depth*14}} href={`#/files/${f.id}`}><Icon name={cur===f.id?'FolderOpen':'Folder'} size={17}/><span>{f.name}</span></a>{tree(f.id,depth+1)}</div>);return <nav className="rail-nav">{fileViews.map(([id,label,icon])=><a key={id} className={cx('rail-link',cur===id&&'on')} href={`#/files/${id}`}><Icon name={icon} size={17}/><span>{label}</span></a>)}{sess.user.role==='admin'&&<a className={cx('rail-link',cur==='storage'&&'on')} href="#/files/storage"><Icon name="Database" size={17}/><span>Storage & policies</span></a>}<p className="rail-section">Folders</p>{tree(null,0)}</nav>}

function Palette({apps,create,onClose,initial=''}:{apps:AppDef[],create:{label:string,icon:string,path:string}[],onClose:()=>void,initial?:string}){
 const [q,setQ]=useState(initial),[results,setResults]=useState<{type:string,title:string,sub:string,link:string}[]>([]),[sel,setSel]=useState(0),[loading,setLoading]=useState(false);
 useEffect(()=>{if(q.trim().length<2){setResults([]);return}setLoading(true);const t=setTimeout(async()=>{try{setResults((await api<any>('/api/search?q='+encodeURIComponent(q))).results)}catch{setResults([])}finally{setLoading(false)}},180);return()=>clearTimeout(t)},[q]);
 const nav=[...apps.flatMap(a=>[{type:'Go to',title:a.label,sub:'',link:`#/${a.id}`,icon:a.icon},...a.views.filter(v=>!v.hidden).map(v=>({type:'Go to',title:`${a.label} › ${v.label}`,sub:'',link:`#/${a.id}/${v.id}`,icon:v.icon}))]),...create.map(c=>({type:'Create',title:c.label,sub:'',link:'#/'+c.path,icon:c.icon}))];
 const ql=q.toLowerCase();
 const items=[...(q?nav.filter(n=>n.title.toLowerCase().includes(ql)).slice(0,6):nav.filter(n=>n.type==='Create').concat(nav.filter(n=>n.type==='Go to'&&!n.title.includes('›')))),...results.map(r=>({...r,icon:({Person:'User',Ticket:'LifeBuoy',Requisition:'ClipboardList','Purchase order':'FileText',Asset:'Boxes',Page:'FileText',File:'File',Vendor:'Store'} as Record<string,string>)[r.type]||'Circle'}))];
 useEffect(()=>setSel(0),[q,results.length]);
 const open=(link:string)=>{onClose();location.hash=link};
 return <div className="overlay palette-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="palette" role="dialog" aria-label="Command palette">
  <div className="palette-input"><Icon name="Search" size={18}/><input autoFocus placeholder="Search people, tickets, orders, assets, pages… or type a command" value={q} onChange={e=>setQ(e.target.value)} onKeyDown={e=>{if(e.key==='Escape')onClose();if(e.key==='ArrowDown'){e.preventDefault();setSel(s=>Math.min(items.length-1,s+1))}if(e.key==='ArrowUp'){e.preventDefault();setSel(s=>Math.max(0,s-1))}if(e.key==='Enter'&&items[sel])open(items[sel].link)}}/>{loading&&<span className="spin"/>}<kbd>Esc</kbd></div>
  <div className="palette-list">{items.map((it,i)=><button key={i+it.link} className={cx('palette-item',i===sel&&'on')} onMouseEnter={()=>setSel(i)} onClick={()=>open(it.link)}><span className="palette-icon"><Icon name={it.icon} size={16}/></span><span className="palette-text"><b>{it.title}</b>{it.sub&&<small>{it.sub}</small>}</span><em>{it.type}</em></button>)}{q.length>=2&&!loading&&!items.length&&<div className="palette-empty">No results for “{q}”.</div>}</div>
  <div className="palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> open</span><span><kbd>g</kbd> + letter to jump</span></div>
 </div></div>;
}

function Notifications({open,onClose}:{open:boolean,onClose:()=>void}){
 const {refresh}=useAppSafe();const [items,setItems]=useState<{id:string,kind:string,title:string,body:string,link:string,readAt:string|null,createdAt:string}[]|null>(null);
 useEffect(()=>{if(open)api<any>('/api/notifications').then(d=>setItems(d.notifications)).catch(()=>setItems([]))},[open]);
 const icon:Record<string,string>={approval:'Stamp',approved:'BadgeCheck',rejected:'CircleX',ticket:'LifeBuoy',comment:'MessageSquare',asset:'Boxes',announcement:'Megaphone',page:'FileText',purchasing:'ShoppingBag'};
 async function readAll(){await api('/api/notifications',{action:'read-all'});setItems(i=>i?.map(n=>({...n,readAt:n.readAt||new Date().toISOString()}))||null);refresh()}
 return <Inspector open={open} onClose={onClose} title="Notifications" width={440} actions={<Btn size="sm" variant="ghost" icon="CheckCheck" onClick={readAll}>Mark all read</Btn>}>
  {!items?<div className="spin-center"><span className="spin"/></div>:!items.length?<div className="empty"><span className="empty-icon"><Icon name="BellOff" size={26}/></span><h3>You're all caught up</h3><p>Approvals, assignments and mentions will appear here.</p></div>:
  <div className="notes-list">{items.map(n=><button key={n.id} className={cx('notice',!n.readAt&&'unread')} onClick={async()=>{if(!n.readAt)api('/api/notifications',{action:'read',id:n.id}).then(refresh).catch(()=>{});onClose();if(n.link)location.hash=n.link}}><span className={`notice-icon k-${n.kind}`}><Icon name={icon[n.kind]||'Bell'} size={16}/></span><span className="notice-text"><b>{n.title}</b>{n.body&&<small>{n.body.split('\n')[0]}</small>}<em>{ago(n.createdAt)}</em></span></button>)}</div>}
 </Inspector>;
}

function Shortcuts({onClose}:{onClose:()=>void}){const rows=[['Ctrl K or /','Search and command palette'],['g h','Home'],['g t','Tickets'],['g p','Purchasing'],['g a','Assets'],['g u','People'],['g s','Spaces'],['g f','Files'],['g o','Operations'],['g x','Admin'],['Esc','Close panels and dialogs'],['Ctrl Enter','Send a comment'],['?','This list']];return <div className="overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal" role="dialog" aria-label="Keyboard shortcuts"><div className="modal-head"><h2>Keyboard shortcuts</h2><Btn icon="X" variant="ghost" title="Close" onClick={onClose}/></div><div className="modal-body"><dl className="shortcuts">{rows.map(([k,v])=><div key={k}><dt>{k.split(' ').map((x,i)=><kbd key={i}>{x}</kbd>)}</dt><dd>{v}</dd></div>)}</dl></div></div></div>}

// Shows the active workspace; people with several memberships can switch. Switching reloads the
// whole app so no data from the previous workspace can remain on screen.
function WorkspaceSwitcher(){
 const {s,toast}=useAppSafe();const others=s.memberships.filter(m=>m.tenantId!==s.tenant.id);
 async function sw(memberId:string){try{await api('/api/session',{memberId});location.hash='#/home';location.reload()}catch(e){toast((e as Error).message,'error')}}
 if(!others.length)return <small className="ws-name" title={s.tenant.name}>{s.tenant.name}</small>;
 return <Menu align="left" trigger={open=><button className="ws-switch" onClick={open} aria-label="Switch workspace"><span className="ws-dot" style={{background:s.tenant.brandColor}}/><small>{s.tenant.name}</small><Icon name="ChevronsUpDown" size={13}/></button>} items={[...s.memberships.map(m=>({label:(m.tenantId===s.tenant.id?'✓ ':'   ')+m.name,icon:'Building2',onClick:()=>{if(m.tenantId!==s.tenant.id)sw(m.id)}}))]}/>;
}
// Persistent banner while the Platform Owner is inside another company's workspace.
function SupportBanner(){
 const {s,toast}=useAppSafe();const [busy,setBusy]=useState(false);
 async function exit(){setBusy(true);try{await api('/api/platform',{action:'support-end'});location.hash='#/platform/workspaces';location.reload()}catch(e){toast((e as Error).message,'error');setBusy(false)}}
 return <div className="support-banner" role="status"><Icon name="ShieldAlert" size={17}/><span><b>Platform support session</b> · You are managing <b>{s.support!.tenantName}</b>. Every action is recorded.<em>Reason: {s.support!.reason}</em></span><button className="support-exit" onClick={exit} disabled={busy}>{busy?'Exiting…':'Exit workspace'}</button></div>;
}

// Offline state: shown while the browser has no connection; requests made meanwhile fail with a clear message.
function OfflineBanner(){const [off,setOff]=useState(false);useEffect(()=>{const up=()=>setOff(!navigator.onLine);up();window.addEventListener('online',up);window.addEventListener('offline',up);return()=>{window.removeEventListener('online',up);window.removeEventListener('offline',up)}},[]);if(!off)return null;return <div className="offline-banner" role="status"><Icon name="WifiOff" size={15}/>You are offline. Changes cannot be saved until the connection returns.</div>}
