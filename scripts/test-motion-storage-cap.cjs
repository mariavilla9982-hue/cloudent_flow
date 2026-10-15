const fs=require("fs"),vm=require("vm"),a=require("assert/strict");
const source=fs.readFileSync("supabase/functions/cloudent-motion-control/index.ts","utf8");
const helper=source.slice(source.indexOf("class MotionStorageError"),source.indexOf("async function wake"));
function ctx(responses){return vm.createContext({Date,Error,AbortSignal,signed:async(_,m)=>m,fetch:async()=>responses.shift()});}
function response(status,headers={},text=""){return {ok:status>=200&&status<300,status,headers:{get:k=>headers[k]??null},text:async()=>text,body:{cancel:async()=>{}}};}
(async()=>{
let c=ctx([response(403),response(403,{},"<Error><Message>Cannot download file, download bandwidth or transaction (Class B) cap exceeded.</Message></Error>")]);vm.runInContext(helper,c);
await a.rejects(c.exists({},"key"),e=>e.code==="storage_read_cap_exceeded");
await a.rejects(c.exists({},"key"),e=>e.code==="storage_read_cap_exceeded");
c=ctx([response(404)]);vm.runInContext(helper,c);a.equal(await c.exists({},"key"),false);
c=ctx([response(200,{"content-length":"42"})]);vm.runInContext(helper,c);a.equal(await c.exists({},"key",42),true);
c=ctx([response(200,{"content-length":"41"})]);vm.runInContext(helper,c);await a.rejects(c.exists({},"key",42),e=>e.code==="storage_size_mismatch");
c=ctx([response(403),response(206,{"content-range":"bytes 0-0/42"})]);vm.runInContext(helper,c);a.equal(await c.exists({},"key",42),true);
c=ctx([response(403),response(403,{},"<Error>AccessDenied</Error>")]);vm.runInContext(helper,c);await a.rejects(c.exists({},"key"),e=>e.code==="storage_read_forbidden");
let calls=0;
c=vm.createContext({window:{CloudentMotionControl:{version:6}},document:{},productionData:{jobs:[{id:"m",meta:{workflow_key:"motion_control"}},{id:"s",meta:{}}]},productionJobRow:()=>"<span>Pronto</span>",loadProductionThumb:async el=>{calls++;el.img={complete:true,naturalWidth:0,addEventListener(){},remove(){el.img=null}}},esc:String,setTimeout(){throw Error("Unexpected retry")},console});
vm.runInContext(fs.readFileSync("motion-control-production.js","utf8"),c);
const element=id=>({dataset:{productionThumbId:id,productionThumbKind:"video-thumb"},querySelector(){return this.img}});
let el=element("m");await c.loadProductionThumb(el);a.equal(el.img,null);a.match(el.title,/indisponível/);
await c.loadProductionThumb(element("m"));a.equal(calls,1);
await c.loadProductionThumb(element("s"));a.equal(calls,2);
console.log("PASS: quota classification/cooldown, 404, size validation, GET fallback, permission errors, Motion thumbnail failure cooldown and standard isolation");
})().catch(e=>{console.error(e);process.exitCode=1});
