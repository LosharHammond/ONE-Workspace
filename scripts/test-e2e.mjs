// Runs the acceptance tests against the built Worker with an isolated, throwaway database.
//   npm run build && npm run test:e2e
// Only .wrangler/test-state is (re)created; the development database in .wrangler/state is never touched.
// A random PLATFORM_SETUP_TOKEN is generated per run and passed to the Worker only as a variable.
import {spawn,execFileSync} from 'node:child_process';
import {rmSync,existsSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';

const PORT=8799,STATE='.wrangler/test-state',wrangler=['--import','./scripts/wrangler-env.mjs','./node_modules/wrangler/bin/wrangler.js'];
if(!existsSync('dist/server/wrangler.json')){console.error('Build first: npm run build');process.exit(1)}
rmSync(STATE,{recursive:true,force:true});
execFileSync(process.execPath,[...wrangler,'d1','migrations','apply','DB','--local','--config','dist/server/wrangler.json','--persist-to',STATE],{stdio:['ignore','ignore','inherit'],env:{...process.env,CI:'1'}});
const token=randomBytes(24).toString('hex');
const server=spawn(process.execPath,[...wrangler,'dev','--config','dist/server/wrangler.json','--local','--persist-to',STATE,'--ip','127.0.0.1','--port',String(PORT),'--inspector-port','0','--var',`PLATFORM_SETUP_TOKEN:${token}`],{stdio:['ignore','pipe','pipe']});
let log='';server.stdout.on('data',d=>{log+=d});server.stderr.on('data',d=>{log+=d});
const base=`http://127.0.0.1:${PORT}`;
for(let i=0;i<120;i++){try{const r=await fetch(base+'/api/session');if(r.ok)break}catch{}await new Promise(r=>setTimeout(r,500));if(i===119){console.error(log);server.kill();process.exit(1)}}
const run=spawn(process.execPath,['--test','--test-reporter=spec','--test-concurrency=1','tests/platform.test.mjs'],{stdio:'inherit',env:{...process.env,OWS_BASE:base,OWS_SETUP:token,OWS_STATE:STATE}});
// On failure the Worker log is kept for diagnosis (it never contains passwords or tokens).
run.on('exit',code=>{server.kill();if(code)writeFileSync('.wrangler/test-server.log',log);process.exit(code??1)});
