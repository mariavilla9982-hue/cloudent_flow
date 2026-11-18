export async function uploadedObjectMatches(address:string,size:number){
  if(!Number.isSafeInteger(size)||size<1)return false;
  // Range GET preserves the method in the presigned URL and reads one byte.
  // B2 can close a pooled connection before headers; retry only transient reads.
  for(let attempt=0;attempt<3;attempt++){
    try{
      const r=await fetch(address,{method:'GET',headers:{Range:'bytes=0-0'},signal:AbortSignal.timeout(8000),redirect:'error'});
      const range=r.headers.get('content-range')||'';
      const actual=r.status===206?Number(range.match(/\/(\d+)$/)?.[1]):Number(r.headers.get('content-length'));
      try{await r.body?.cancel();}catch{}
      if(r.status===404)return false;
      if(r.ok)return Number.isSafeInteger(actual)&&actual===size;
      if(![408,429,500,502,503,504].includes(r.status))throw Object.assign(new Error('storage_request_rejected'),{permanent:true});
    }catch(error){
      if((error as any)?.permanent)throw new Error('Não foi possível confirmar os arquivos no armazenamento. Tente novamente.');
      // Never propagate request errors: they can contain a presigned URL.
    }
    if(attempt<2)await new Promise(resolve=>setTimeout(resolve,(attempt+1)*250));
  }
  throw new Error('O armazenamento está instável. Os arquivos enviados foram preservados; tente confirmar novamente.');
}
