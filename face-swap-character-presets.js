// Face Swap character selector v5. One controller; no observers or global click handlers.
(()=>{
  if(window.CloudentFaceSwapCharacter)return;
  const JULIA_THUMB='data:image/jpeg;base64,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';
  const SAHRY_THUMB='data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA4KCw0LCQ4NDA0QDw4RFiQXFhQUFiwgIRokNC43NjMuMjI6QVNGOj1OPjIySGJJTlZYXV5dOEVmbWVabFNbXVn/2wBDAQ8QEBYTFioXFypZOzI7WVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVlZWVn/wAARCABuAJMDASIAAhEBAxEB/8QAGwAAAgMBAQEAAAAAAAAAAAAABAUAAgMGAQf/xAAzEAACAQMCBAUEAQMEAwAAAAABAgMABBESIQUxQVETImFxkRQjMqFSBnKxFUKB8CQz0f/EABgBAAMBAQAAAAAAAAAAAAAAAAECAwQA/8QAIhEAAgICAwABBQAAAAAAAAAAAAECESExAxIiQhMyQWFx/9oADAMBAAIRAxEAPwDuI0XQvlHIdK00r/EfFeR/gvsKtQOEPF5bi7nlsrJhEIgPFkxyJ6Urs7u64ZxSOK4fxbeZguTvg9/et7V4bm74kHLCRLoyHBxkch78qTcXeOOASAkySTDG/LBztWdvNmtRVUd55f4j4qEL2HxWEUmuNG/koP6rTNaDIbQovhr5Ry7UFxu8NjYlolXxnOlMjl60dD/6l9q5z+q5sSxoDuqZ+TScjqOCnFFSlk5Oa+vUnMv1Moc9dVdn/TV1d3Foy3+lpFwVJHmI9a57hVvb3cxkdPPG5A7bcqe8PzHxRwpyHTzZPIDtUuNuy/Kk0Php/iPivCF/iPiswd6sTWgyFokXB8o5npWuhf4j4qkP4n3Na0TgPiRmjsZGtFTx8YXUK+f3kt3JKfqLiRnB3DHGP+K+g3/mREP4ls5Bwciua4tbwSO8kiefQcaedQ5Ls08NUef0vxR3nNlcNrBXMZbmMcxXUEL2HxXzbhU/0/FoHJxokGT6HavoxNNxvFE+VU7MJQPEPlHxUqkp+4alUJDKNxoXnyHSvJJdOcRyMfRa9iHkX2FXYhVJPIDNcccZZxx8M4hcT8QukSd1IEe+wJzvQPEuGz8WKT8OInEbHkdt/wDFEJbDivE5C7LpyWk38xpxwaMQXEoWKOJdONKeh2rPHLNc/Kv8hdgsy2cKzROkioAwI6iidx0PxWwfNQnNaDKy0Ljwk58u1ctx+zv7q8keG0mkX/aQvPHL911UA+2vtW2KWUe2GNCfR2jiuHcJubS3UXMckQLapHPJR708svonZ3s3EhxhtLE4FTjzhms7Y4KzOxKk416VJAz70mt2Wz49bmNVjWYtCVU7EYz/AJpF5dFXco2dIAc/ifivST2PxVlfNek1UznsDgKefM9K21D1+KygHlPua3AonGE4Ro21kqo3J5YpK/8Ap9xI8FvOsski8s5NH8aINrFGys8ckoVlU7sMHb5xXIcRthayrfW/2ND6gC2Qd/1UZvJfjWLsGn4DxKO6JjtJXXONSjn2NdvAZDbRGRGV9I1AjkcVrb3Ant45V5SKG+a0Jp4xS0JOblsBlJ8Q7H4qVebHiHepTkxlH+C+woTi90trw+ZifOykKo3JNExnyL7CkP8AUcrC2nC5ycID2GKTkdRH449pCHghJvZZRkYTSSO+c074ZcPHNcfVIAWI0Mo5j19azsuGiwskRWxIRqcnqTWzIuAxODjcCpRjJMtOcWtjWKVZFyhz0rXNJuGSt4kiMcnH+DTQNVou0QkqYXAftL7Vd2CqWPIVjAftL7V5dtiH3Iot0gJW6EnFYzxC+s5NZijt21Y6scj4pfd2TPxS3uo30eE+rSRsRnemviRvbISQxbOfmsXaJUAJJI5Z51Lo27Ld0lQxguFkJA2IGcVvmkfDZAbptJyuWFNw21Ui7WSUkk8BcB8p9zW3Shrc+Q+5rfNMKLuNYksniBIk2ZD2YcqQzWMt1YhLoqszfkE3UHvvTy7VZpW82CDsaEuCqE75NSlBtlozUVR5wbxLSyjtrkgspIRhyYdKZ6qSeOz2oc/kj4H/AAaa6qMHaoXkVOysp+4alZSt9w1KoTGsSDQvPkOtSSzt5hiWFHGc+YZq8R8i+wrWhR1i3iqRQ2bMIxrJVQQMkZIG1CcIEU9qRNGrujshLDc4OxP/ANoviTapo48gZUk5pdYyf+e65GNPT3pL9FFHyNktLdDlIUU9wK9MSD/aK0U5FQ05MrAg8NfbvWxhRhhlyPWqQH7a1uKJwt4msdpwyZ4Y1DquEwORPLFB8ItibBfrV8ZychpAM47Uz4jC89uFjYKwdWyeWAd6U2c7R3TxM2QzHA7dam/uKrMcDRLS3U5SFFPcCvWiTooq6NkVGpyRSFBg9snrRAjH/TWUJ/L+40QDROMWghAJZFx1JrmeBXS3l7eJcaJBnVGGHIZOw9OVdHxEn6N8ZzkDb3rmLOxFjfmQMSHfb03qcrtUVik4uzo1tLbTgQRgZzjHWrNDH/AV7GdquackASxqJDhRUrSY/cNSicFQt5F9hW4O1Cw/gu/QVuCO9cAXcYDBQ4xgrpA65zQPD4T4+sAAKulvVutM71RLc2yEjSCXIPpyrCzjC+IRyaRjtSVkrfkOTYVCamRiqsR3pyZaA+RaIBoWD8F2NEBvQ0QElGpGXuMUms01TyuVG2FBpw7ZU8xtSuxdChQHzgksMetI9jrTDk2FRjUDADkaqzDsaYU9iO7f3USpoOLfVseZolT6GiAlwuuFwOeK5+KF3nUM5P3Cw9hXQSHMbAZBINKoQM2mCM6GJ9f+5pJbKR0w6PlVyaopx0r0uOxphAWY/dNSqzOPFOxqUQDCKMaF26DrW3hr2/dUhPkX2FbA0AifjrfT2ySRBkkeRYy6DLBetX4e6PapkLrA82Nt6I4nGXtWIOGXkaV2kw+sCqzHWuWB6UmpFKuI40IRyqjRr2qyNkV61OTKwRjw12/dbiMdv3WcB+2vtRANccZtGuDt8muf4XcSm9lSbU6SLrQsuNJBwVz2607vpRFbkk41eXNJbRjLdMQfKpz7bUktopFeWOdKkcqo0a9qtHyr1qcmSCNdJ26mttC9v3WcP4n3NeXb6bWQjtQeEcsuhY1w8srrG5AU7nJ+KzkklQbP+62hVUiAGMtuaGuWAJqfZpGj6abA5p7onQkkgZtl8x51u0sqxwgyOTkBvMdznehPG8O7gcDUQ/40QuZbxI1GQH1t6DNK5OVBUFGxjKq+IdqleSn7hqVYzDCBvIvsKIB2oKGZQi8+Q6VsLhR3+KYB7eDNrJk4wM5pHDbfTGKcbvMwJHv09sU5lmSSNlIOGGOVL1k1xRnG8DY364GKSSyUi8B8fKvWNZCZQOvxVWuB6/FMIbwHyLRIO1AQSgIu7fFECcY5t8UQFeIkCykLAkbcvelvC1Dw+MNi5O3bB5UTxG6HgGIAlpRgZ5Cs7QeBCEOBuThRsM0nyKfEPAwKqxrLxx3b4qrTj1+KcQJhPlP9xqXMfi27pzyOXesYJ10HOeZ6Vaa5WOFmAOQNtqD0ctiU3SxSCJidSjIz1FDTvPKCYomb9f5q96+D4i8xvgihIrh7rKxnwwvOo1ejV3S2TeBvNh7gjAA5IKb8MCi2Jx5yfMe9KykcIJGpmPNjzNGcLnBEuQdiKeMVH+kpycl+g6T8zUrKSUazzqU5I//Z';
  const valid=name=>['julia','sahry'].includes(name);
  let owner='', revision=0, desired='', confirmed=null, pending=null, failure=null;
  function session(){return typeof cloudSession==='undefined'?null:cloudSession}
  function reset(){
    const id=session()?.user?.id||'';
    if(id!==owner){owner=id;revision=0;desired='';confirmed=null;pending=null;failure=null;}
    return id;
  }
  function stamp(){reset();return {owner,revision}}
  function merge(data,started){
    reset();
    if(started.owner!==owner)return data;
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
        '<img src="'+(name==='julia'?JULIA_THUMB:SAHRY_THUMB)+'" alt="'+label+'"><span class="face-swap-preset-copy"><strong>'+label+'</strong><span>'+(active?(pending?'Salvando…':'Em uso'):'Usar esta folha')+'</span></span></button>';
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
  window.CloudentFaceSwapCharacter={version:5,stamp,merge,markup,select,flush};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
