// Runs the acceptance tests against the built Worker with an isolated, throwaway database.
//   npm run build && npm run test:e2e
// Only .wrangler/test-state is (re)created; the development database in .wrangler/state is never touched.
// Random PLATFORM_SETUP_TOKEN, SECRETS_KEY and a fake GROQ_API_KEY are generated per run and passed to the
// Worker only as variables. External services (Groq, a company AI provider, a REST API and an MCP server)
// are local mocks from tests/mock-services.mjs; nothing leaves this machine.
import {spawn,execFileSync} from 'node:child_process';
import {rmSync,existsSync,writeFileSync,appendFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';

const PORT=8799,MOCK=8797,STATE='.wrangler/test-state',LOG='.wrangler/test-server.log',wrangler=['--import','./scripts/wrangler-env.mjs','./node_modules/wrangler/bin/wrangler.js'];
if(!existsSync('dist/server/wrangler.json')){console.error('Build first: npm run build');process.exit(1)}
rmSync(STATE,{recursive:true,force:true});writeFileSync(LOG,'');
execFileSync(process.execPath,[...wrangler,'d1','migrations','apply','DB','--local','--config','dist/server/wrangler.json','--persist-to',STATE],{stdio:['ignore','ignore','inherit'],env:{...process.env,CI:'1'}});
const token=randomBytes(24).toString('hex'),secretsKey=randomBytes(32).toString('hex'),groqKey='gsk_test_'+randomBytes(12).toString('hex');
const mock=spawn(process.execPath,['tests/mock-services.mjs',String(MOCK)],{stdio:['ignore','ignore','inherit']});
const vars=[`PLATFORM_SETUP_TOKEN:${token}`,`SECRETS_KEY:${secretsKey}`,`GROQ_API_KEY:${groqKey}`,`AI_GROQ_BASE_URL:http://127.0.0.1:${MOCK}/groq/v1`,`MS_LOGIN_BASE:http://127.0.0.1:${MOCK}/ms-login`,`MS_GRAPH_BASE:http://127.0.0.1:${MOCK}/ms-graph`].flatMap(v=>['--var',v]);
const server=spawn(process.execPath,[...wrangler,'dev','--config','dist/server/wrangler.json','--local','--persist-to',STATE,'--ip','127.0.0.1','--port',String(PORT),'--inspector-port','0',...vars],{stdio:['ignore','pipe','pipe']});
// The Worker log is written to disk so a test can prove no secret ever appears in it.
server.stdout.on('data',d=>appendFileSync(LOG,d));server.stderr.on('data',d=>appendFileSync(LOG,d));
const base=`http://127.0.0.1:${PORT}`;
const stop=code=>{server.kill();mock.kill();process.exit(code)};
for(let i=0;i<120;i++){try{const r=await fetch(base+'/api/session');if(r.ok)break}catch{}await new Promise(r=>setTimeout(r,500));if(i===119){console.error('Worker did not start; see',LOG);stop(1)}}
const env={...process.env,OWS_BASE:base,OWS_SETUP:token,OWS_STATE:STATE,OWS_MOCK:`http://127.0.0.1:${MOCK}`,OWS_OWNER_PW:`Owner-${randomBytes(12).toString('hex')}!`,OWS_SECRETS:[token,secretsKey,groqKey].join(','),OWS_LOG:LOG};
// Suites share one database and build on each other (the owner is set up first), so they run one after another.
// OWS_SUITES=platform,collab runs a subset (the platform suite must stay first: it sets up the owner).
const suites=['platform','saas','collab','os','ops'].filter(n=>!process.env.OWS_SUITES||process.env.OWS_SUITES.split(',').includes(n)).map(n=>`tests/${n}.test.mjs`);
let failed=0;
for(const file of suites){
 const code=await new Promise(done=>spawn(process.execPath,['--test','--test-reporter=spec',file],{stdio:'inherit',env}).on('exit',c=>done(c??1)));
 if(code)failed++;
}
stop(failed?1:0);
