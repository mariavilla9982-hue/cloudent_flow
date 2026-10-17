(()=>{
  if(window.CloudentBackblazeMediaGuard?.installed)return;
  const nativeFetch=window.fetch.bind(window);
  const guard={installed:true,blocked:0};
  window.CloudentBackblazeMediaGuard=guard;

  const blockedCloudentActions=new Set([
    "upload",
    "production-upload",
    "face-swap-upload",
    "trial-upload"
  ]);
  const guardedTickets=new Set([
    "upload-ticket",
    "production-upload-ticket",
    "face-swap-upload-ticket",
    "trial-upload-ticket"
  ]);

  function parsed(input){
    try{
      const raw=typeof input==="string"?input:(input?.url||String(input||""));
      return new URL(raw,location.origin);
    }catch{return null}
  }
  function blocked(message,code="backblaze_required"){
    guard.blocked++;
    return new Response(JSON.stringify({
      ok:false,
      error:code,
      user_message:message
    }),{
      status:503,
      headers:{"Content-Type":"application/json","Cache-Control":"no-store"}
    });
  }
  function isSupabaseFunction(url,slug){
    return !!url&&url.hostname==="dxrhvudvutmgrmfkmzxo.supabase.co"&&url.pathname.includes("/functions/v1/"+slug);
  }

  window.fetch=async function(input,init){
    const url=parsed(input);
    const action=url?.searchParams?.get("action")||"";

    if(isSupabaseFunction(url,"cloudent-motion-control")&&action==="upload"){
      return blocked("Backblaze B2 é obrigatório para o Motion. O vídeo não será enviado ao Supabase; aguarde o Backblaze voltar.");
    }

    if(isSupabaseFunction(url,"cloudent-api")&&blockedCloudentActions.has(action)){
      return blocked("Backblaze B2 é obrigatório para vídeos do CloudentFlow. O fallback para Supabase foi bloqueado.");
    }

    const response=await nativeFetch(input,init);

    const isMotionTicket=isSupabaseFunction(url,"cloudent-motion-control")&&action==="upload-ticket";
    const isCloudentTicket=isSupabaseFunction(url,"cloudent-api")&&guardedTickets.has(action);
    if((isMotionTicket||isCloudentTicket)&&response.ok){
      try{
        const data=await response.clone().json();
        if(data?.fallback===true||data?.provider==="supabase"){
          return blocked(
            "Backblaze B2 está indisponível ou não foi confirmado. Nenhum vídeo foi enviado ao Supabase.",
            "backblaze_unavailable"
          );
        }
      }catch{}
    }

    return response;
  };
})();
