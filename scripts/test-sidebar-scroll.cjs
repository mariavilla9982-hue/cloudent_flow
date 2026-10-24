const fs=require('fs');
const assert=require('node:assert/strict');
const vm=require('vm');
const {chromium}=require('playwright');
const html=fs.readFileSync(process.cwd()+'/index.html','utf8');
for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
  if(!/src=|type=["']application\//.test(match[1])&&match[2].trim())new vm.Script(match[2]);
}
new vm.Script(fs.readFileSync(process.cwd()+'/sw.js','utf8'));
const css=[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]).join('\n');
const nav=Array.from({length:5},(_,g)=>'<div class="nav-group"><div class="nav-label">Grupo '+g+'</div>'+Array.from({length:4},(_,i)=>'<button><span class="nav-icon">◈</span><b>Área '+g+' '+i+'</b></button>').join('')+'</div>').join('');
function fixture(mode,styles=css){
 return '<style>'+styles+'</style><body class="auth-logged-in"><div class="app '+(mode==='pinned'?'':'sidebar-collapsed '+(mode==='hover'?'sidebar-hover-open':''))+'"><aside class="sidebar '+(mode==='pinned'?'':'compact '+(mode==='hover'?'hover-open':''))+'"><div class="brand"><div class="brand-main"><div class="logo">C</div><span class="brand-name">CloudentFlow</span></div><button class="sidebar-pin">P</button></div><div class="workspace-switch">Produção</div><nav class="nav">'+nav+'</nav><div class="sidebar-foot"><div class="account-chip"><span class="account-avatar">C</span><div class="account-copy">Conta</div></div></div></aside><main class="main"><h1>Produção IA</h1><div style="height:12000px">Fila extensa</div></main></div></body>';
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],headless:true});
 const page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 let cases=0;
 for(const width of [800,1440])for(const height of [540,900])for(const mode of ['compact','hover','pinned']){
  await page.setViewportSize({width,height});await page.setContent(fixture(mode));await page.waitForTimeout(250);
  const read=()=>page.evaluate(()=>{
   const s=document.querySelector('.sidebar'),n=document.querySelector('.nav'),f=document.querySelector('.sidebar-foot');
   const rect=x=>{const r=x.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,height:r.height}};
   return {sidebar:rect(s),nav:rect(n),foot:rect(f),first:rect(n.querySelector('button')),position:getComputedStyle(s).position,overflow:getComputedStyle(n).overflowY,bodyOverflow:getComputedStyle(document.body).overflowY,scrollY};
  });
  const before=await read();
  await page.evaluate(()=>window.scrollTo(0,2400));const after=await read();
  assert.equal(after.position,'sticky');assert(after.scrollY>2000);
  assert(Math.abs(after.sidebar.top)<1,JSON.stringify({mode,width,height,after}));
  assert(Math.abs(before.first.top-after.first.top)<1);
  assert(after.sidebar.height<=height+1);
  assert(after.foot.bottom<=height+1);assert(after.nav.bottom<=after.foot.top+1);
  assert.equal(after.overflow,'auto');
  assert.equal(Math.round(after.sidebar.width),mode==='compact'?72:240);
  await page.locator('.nav').evaluate(n=>n.scrollTop=n.scrollHeight);
  const end=await page.locator('.nav').evaluate(n=>{const b=n.querySelector('button:last-child').getBoundingClientRect();const all=n.querySelectorAll('button');return {last:all[all.length-1].getBoundingClientRect().bottom,bottom:n.getBoundingClientRect().bottom,scroll:n.scrollTop}});
  assert(end.scroll>0);assert(end.last<=end.bottom+1);
  cases++;
 }
 await page.setViewportSize({width:1440,height:900});await page.setContent(fixture('compact'));await page.evaluate(()=>window.scrollTo(0,5000));
 await page.screenshot({path:process.env.SIDEBAR_SCREENSHOT||'/tmp/cloudent-sidebar-scrolled.png',fullPage:false});
 await page.setViewportSize({width:390,height:844});await page.setContent(fixture('compact'));
 assert.equal(await page.locator('.sidebar').evaluate(n=>getComputedStyle(n).display),'none');
 assert.deepEqual(errors,[]);
 await browser.close();console.log('PASS: '+cases+' desktop scroll/compact/hover/pinned cases, mobile hidden, SPA/SW parse, zero JS errors');
})().catch(e=>{console.error(e);process.exit(1)});
