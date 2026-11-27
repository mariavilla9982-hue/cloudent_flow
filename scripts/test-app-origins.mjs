import assert from 'node:assert/strict';
import {appOrigin,sameAppOrigin} from '../lib/app-origins.js';
const canonical='https://cloudent-flow.vercel.app';
for(const host of ['cloudent-flow.vercel.app','cloudentflow-pc.vercel.app']){
 assert.equal(appOrigin({headers:{host}}),'https://'+host);
 assert(sameAppOrigin({headers:{host,origin:'https://'+host}}));
 assert(!sameAppOrigin({headers:{host,origin:'https://foreign.example'}}));
}
assert(!sameAppOrigin({headers:{host:'cloudentflow-pc.vercel.app',origin:canonical}}));
for(const host of ['evil.example','cloudentflow-pc.vercel.app.evil.example','cloudentflow-pc.vercel.app:444','cloudentflow-pc.vercel.app/path','']){
 const req={headers:{host,origin:canonical,'x-forwarded-host':'cloudentflow-pc.vercel.app'}};
 assert.equal(appOrigin(req),canonical,'unknown host never becomes an outbound fetch target');assert(!sameAppOrigin(req));
}
console.log('PASS exact production origins, same-origin forms, cross-domain rejection, host injection and untrusted forwarded headers');
