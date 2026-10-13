// Face Swap character selector v6. One controller; no observers or global click handlers.
(()=>{
  if(window.CloudentFaceSwapCharacter)return;
  const valid=name=>['julia','sahry'].includes(name);
  let owner='', revision=0, desired='', confirmed=null, pending=null, failure=null;
  let presets={};
  const attr=value=>String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function session(){return typeof cloudSession==='undefined'?null:cloudSession}
  function reset(){
    const id=session()?.user?.id||'';
    if(id!==owner){owner=id;revision=0;desired='';confirmed=null;pending=null;failure=null;presets={};}
    return id;
  }
  function stamp(){reset();return {owner,revision}}
  function merge(data,started){
    reset();
    if(started.owner!==owner)return data;
    if(data?.workflow?.character_presets)presets=data.workflow.character_presets;
    const character=data?.workflow?.character;
    if(!pending&&started.revision===revision){
      const name=String(character?.file_name||'').toLowerCase();
      if(valid(name)){confirmed=character;desired=name;}
    }
    if(data?.workflow&&confirmed)data.workflow.character=confirmed;
    return data;
  }
  function paint(){
    reset();
    document.querySelectorAll('#faceSwap [data-face-swap-preset]').forEach(btn=>{
      const active=btn.dataset.faceSwapPreset===desired;
      btn.classList.toggle('active',active);
      btn.disabled=false;
      const img=btn.querySelector('img');
      const preview=presets[btn.dataset.faceSwapPreset]?.preview_url;
      if(img&&preview&&img.getAttribute('src')!==preview)img.src=preview;
      btn.setAttribute('aria-pressed',String(active));
      btn.setAttribute('aria-busy',String(active&&!!pending));
      const label=btn.querySelector('.face-swap-preset-copy span');
      const text=active?(pending?'Salvando…':'Em uso'):'Usar esta folha';
      if(label&&label.textContent!==text)label.textContent=text;
    });
  }
  async function rpc(name,retry=true){
    const token=session()?.access_token;
    if(!token)throw new Error('Entre no CloudentFlow novamente.');
    const res=await fetch('https://dxrhvudvutmgrmfkmzxo.supabase.co/rest/v1/rpc/set_face_swap_character_preset',{
      method:'POST',cache:'no-store',
      headers:{apikey:'sb_publishable_eu6EGnAw7H-Y5q6w6pmSKQ_88GUR9HI',Authorization:'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({p_preset:name})
    });
    if(res.status===401&&retry&&typeof refreshCloudSession==='function'&&await refreshCloudSession())return rpc(name,false);
    const data=await res.json();
    if(!res.ok||!data?.ok||!data.character||data.preset!==name)throw new Error(data.message||data.error||'Não foi possível salvar a folha.');
    return data.character;
  }
  async function drain(id){
    // Never abort a write: cancelling fetch does not cancel a database transaction.
    // Serial writes guarantee the last requested preset is the last committed write.
    while(owner===id){
      const mine=revision,name=desired;
      try{
        const character=await rpc(name);
        if(owner!==id)return;
        confirmed=character;
        if(faceSwapData){faceSwapData.workflow=faceSwapData.workflow||{};faceSwapData.workflow.character=character;}
        if(mine===revision){failure=null;return;}
      }catch(error){
        if(owner!==id)return;
        if(mine!==revision)continue;
        failure=error;
        desired=String(confirmed?.file_name||'').toLowerCase();
        toast(error.message||'Não foi possível salvar a folha.','err');
        return;
      }
    }
  }
  function select(name){
    const id=reset();
    if(!id||!valid(name))return;
    desired=name;revision++;failure=null;
    if(!pending){
      pending=Promise.resolve().then(()=>drain(id)).finally(()=>{
        if(owner===id){pending=null;paint();}
      });
    }
    paint();
    return pending;
  }
  async function flush(){
    reset();
    while(pending)await pending;
    if(failure)throw failure;
  }
  function markup(){
    reset();
    return '<div class="face-swap-quick-actions">'+['julia','sahry'].map(name=>{
      const active=name===desired,label=name==='julia'?'Julia':'Sahry';
      return '<button type="button" class="face-swap-preset-btn '+(active?'active':'')+'" data-face-swap-preset="'+name+'" aria-pressed="'+active+'" onclick="CloudentFaceSwapCharacter.select(\''+name+'\')">'+
        '<img '+(presets[name]?.preview_url?'src="'+attr(presets[name].preview_url)+'" ':'')+'alt="'+label+'"><span class="face-swap-preset-copy"><strong>'+label+'</strong><span>'+(active?(pending?'Salvando…':'Em uso'):'Usar esta folha')+'</span></span></button>';
    }).join('')+'</div>';
  }
  function mountLegacy(){
    const card=document.querySelector('#faceSwap .face-swap-character-card');
    if(!card)return;
    if(!confirmed&&!pending&&typeof faceSwapData!=='undefined'&&faceSwapData){
      faceSwapData=merge(faceSwapData,stamp());
    }
    if(!card.querySelector('[data-face-swap-preset]')){
      card.innerHTML='<div class="ui3-panel-head"><div><span>PERSONAGEM</span><h3>Folha de personagem</h3></div></div>'+
        '<p class="muted">A troca vale para os próximos vídeos. Os que já estão na fila mantêm a folha usada no envio.</p>'+markup();
    }
    paint();
  }
  function install(){
    if(typeof faceSwapPage!=='function')return;
    if(!document.getElementById('faceSwapCharacterSelectorStyle')){
      const style=document.createElement('style');style.id='faceSwapCharacterSelectorStyle';
      style.textContent=`#faceSwap .face-swap-character-card .face-swap-quick-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px}
        #faceSwap .face-swap-preset-btn{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid #333;border-radius:12px;background:#101010;color:#fff;text-align:left;cursor:pointer}
        #faceSwap .face-swap-preset-btn.active{border-color:#fff;background:#191919}
        #faceSwap .face-swap-preset-btn img{width:52px;height:48px;object-fit:cover;border-radius:8px}
        #faceSwap .face-swap-preset-copy{display:flex;flex-direction:column;gap:3px}
        #faceSwap .face-swap-preset-copy strong{font-size:13px}
        #faceSwap .face-swap-preset-copy span{font-size:10px;color:#999}`;
      document.head.appendChild(style);
    }
    // Cached HTML still renders the retired upload/reset controls. Replace only
    // its Face Swap render boundary, using the same controller as native HTML.
    if(!String(faceSwapPage).includes('CloudentFaceSwapCharacter.markup()')){
      const render=faceSwapPage;
      faceSwapPage=function(...args){const result=render.apply(this,args);mountLegacy();return result};
      if(typeof loadFaceSwapData==='function'&&!String(loadFaceSwapData).includes('CloudentFaceSwapCharacter.merge')){
        const load=loadFaceSwapData;
        loadFaceSwapData=async function(...args){const started=stamp();const result=await load.apply(this,args);if(faceSwapData)faceSwapData=merge(faceSwapData,started);return result};
      }
      if(typeof uploadFaceSwapJobDirect==='function'&&!String(uploadFaceSwapJobDirect).includes('CloudentFaceSwapCharacter.flush')){
        const upload=uploadFaceSwapJobDirect;
        uploadFaceSwapJobDirect=async function(...args){await flush();return upload.apply(this,args)};
      }
    }
    mountLegacy();
  }
  window.CloudentFaceSwapCharacter={version:6,stamp,merge,markup,select,flush};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
