(()=>{'use strict';
const $=id=>document.getElementById(id),key='cloudentflow-user-session';let busy=false,challenge=null;
const messages={challenge_expired:'A confirmação anterior expirou. Faça uma nova conexão aqui e aprove apenas a nova tentativa no Instagram.',challenge_not_resumable:'Este desafio não permite retomada por esta tela. Conclua a verificação no Instagram; depois reconecte aqui.',resume_password_required:'A aprovação foi verificada, mas falta finalizar o login. Informe a senha abaixo e use Já confirmei para concluir na mesma sessão.',login_cloudent_required:'Entre no CloudentFlow e abra este link novamente.',admin_required:'Este teste exige seu acesso de administradora.',backend_rejected:'A operação não foi liberada. Se você acabou de tentar conectar, aguarde um minuto antes de repetir.',two_factor_required:'O Instagram pediu verificação em duas etapas. Aguarde um minuto, informe novamente a senha e o código atual.',instagram_verification_required:'A tentativa anterior parou na verificação do Instagram. Sem o número informado pela origem, não selecione uma opção no aplicativo.',bad_credentials:'O Instagram recusou o usuário ou a senha. Confira o acesso da @sahryjapah.',instagram_rate_limited:'O Instagram limitou o acesso. O teste foi pausado; não vamos insistir automaticamente.',instagram_login_required:'O Instagram recusou a sessão. Será necessário reconectar.',instagram_account_mismatch:'A sessão não corresponde à @sahryjapah. O envio foi bloqueado.',configuration_unavailable:'A conexão está temporariamente indisponível.',instagram_request_failed:'O Instagram não concluiu a operação. O teste foi pausado.',media_source_unavailable:'O arquivo do vídeo não está disponível para este teste.',request_unavailable:'Não foi possível concluir a consulta. Atualize para conferir o estado antes de tentar qualquer envio.'};
function say(text){$('status').textContent=text}
function verification(hint){
 challenge=hint||null;
 $('verification').hidden=!challenge;
 $('resume').hidden=!challenge?.can_resume||challenge?.expired===true;
 const number=String(challenge?.matching_number??'');
 const hasNumber=/^\d{1,2}$/.test(number);
 $('matchingNumber').hidden=!hasNumber;$('matchingNumber').textContent=hasNumber?number:'';
 $('verificationText').textContent=challenge?.expired?'A confirmação salva expirou. Não aprove a notificação antiga. Inicie uma nova conexão abaixo.':challenge?.needs_password?'Informe a senha no formulário abaixo e clique em Já confirmei para finalizar a mesma tentativa.':hasNumber?'O Instagram informou o número abaixo. Na confirmação da tentativa que você acabou de iniciar, selecione exatamente este número.':'O Instagram não forneceu um número legível para esta tentativa. Não escolha uma das opções no chute. Essa confirmação por números ainda não pode ser concluída por esta tela. Se você já usa um autenticador, pode tentar a senha com o código atual dele.';
}
async function token(){
 let session;try{session=JSON.parse(localStorage.getItem(key)||'null')}catch{}
 if(!session?.access_token)throw new Error('login_cloudent_required');
 if(session.expires_at&&session.expires_at*1000<Date.now()+30000&&session.refresh_token){
  const cfg=window.CloudentConfig;
  const response=await fetch(cfg.supabaseUrl+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{apikey:cfg.publishableKey,'Content-Type':'application/json'},body:JSON.stringify({refresh_token:session.refresh_token})});
  if(!response.ok)throw new Error('login_cloudent_required');
  session={...session,...await response.json()};localStorage.setItem(key,JSON.stringify(session));
 }
 return session.access_token;
}
async function call(body){
 const access=await token();
 const response=await fetch('/api/instagram-private-pilot',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const data=await response.json();if(!response.ok)throw new Error(data.error_code||'request_unavailable');return data;
}
function render(data){
 $('login').hidden=!['new','two_factor','blocked','login_pending'].includes(data.phase);
 $('connected').hidden=data.phase!=='connected';$('filename').textContent=data.file_name||'Vídeo pendente da Sahry Japah';
 $('result').hidden=true;
 if(data.phase==='blocked')verification(data.challenge||{expired:false,can_resume:false});
 else if(data.phase==='connected'||data.phase==='published')verification(null);
 if(data.phase==='connected')say('Acesso à @sahryjapah validado. Você já pode executar o teste com um vídeo.');
 else if(data.phase==='published'){
  say('Publicação confirmada no Instagram. O teste foi concluído e o vídeo foi marcado como publicado na agenda.');
  if(/^https:\/\/www\.instagram\.com\/reel\/[\w-]+\/$/.test(data.permalink||'')){$('result').href=data.permalink;$('result').hidden=false;}
 }else if(['publishing','uncertain'].includes(data.phase))say('O teste já foi enviado ou ficou sem confirmação final. Não faremos outro envio para evitar duplicação. Avise pelo chat para conferir o resultado.');
 else if(data.phase==='login_pending')say('Uma tentativa de conexão foi iniciada. Aguarde um minuto antes de tentar novamente.');
 else if(data.challenge?.expired)say(messages.challenge_expired);
 else say(messages[data.error_code]||'Seu acesso ao CloudentFlow está confirmado. Conecte a @sahryjapah para começar.');
}
async function run(work){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await work()}catch(error){say(messages[error.message]||messages.request_unavailable)}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false)}}
async function refresh(){render(await call({action:'status'}))}
$('login').addEventListener('submit',event=>{event.preventDefault();run(async()=>{
 const password=$('password').value,verification_code=$('code').value;$('password').value='';$('code').value='';say('Conectando à @sahryjapah…');
 verification(null);
 const result=await call({action:'login',password,verification_code});await refresh();
 if(result.error_code==='instagram_verification_required'){
  verification(result.challenge||{});say('O Instagram exige confirmar esta tentativa. Confira as instruções abaixo antes de aprovar qualquer acesso.');
 }else if(result.error_code)say(messages[result.error_code]||messages.instagram_request_failed);
})});
$('resume').addEventListener('click',()=>run(async()=>{say('Conferindo a confirmação na mesma sessão…');const password=$('password').value,verification_code=$('code').value;$('password').value='';$('code').value='';const result=await call({action:'resume',...(password?{password}:{}),...(verification_code?{verification_code}:{})});await refresh();if(result.error_code){verification(result.challenge||{});say(result.error_code==='challenge_not_resumable'?'A confirmação anterior expirou ou não permite retomada. Nenhuma nova tentativa de login foi iniciada.':messages[result.error_code]||messages.instagram_request_failed)}}));
$('publish').addEventListener('click',()=>run(async()=>{say('Publicando o vídeo de teste. Aguarde a confirmação…');await call({action:'publish',confirm_username:'sahryjapah'});await refresh()}));
run(refresh);
})();
