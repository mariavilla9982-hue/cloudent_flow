import {AwsClient} from "npm:aws4fetch@1.0.20";

export class MotionStorageSafetyError extends Error{
  code:string;
  constructor(message:string,code="storage_protected"){super(message);this.code=code;}
}
export const RESERVE_INPUT_MAX=12*1024*1024;
export const RESERVE_OUTPUT_MAX=40*1024*1024;
export async function storageRPC(admin:any,name:string,args:any={}){
  const {data,error}=await admin.rpc(name,args);if(error)throw error;return data;
}
export async function motionObjectConfig(admin:any){
  const row=await storageRPC(admin,"get_cloudent_r2_config");const r=Array.isArray(row)?row[0]:row;
  if(!r?.access_key_id||!r?.secret_access_key||!r?.bucket)return null;
  return {...r,endpoint:String(r.endpoint||("https://"+r.account_id+".r2.cloudflarestorage.com")).replace(/\/$/,"")};
}
function region(endpoint:string){try{return new URL(endpoint).hostname.match(/^s3\.([^.]+)\.backblazeb2\.com$/i)?.[1]||"auto"}catch{return "auto"}}
export async function motionObjectURL(config:any,method:string,key:string){
  const aws=new AwsClient({service:"s3",region:region(config.endpoint),accessKeyId:config.access_key_id,secretAccessKey:config.secret_access_key});
  const path=key.split("/").map(encodeURIComponent).join("/");
  const signed=await aws.sign(new Request(config.endpoint+"/"+encodeURIComponent(config.bucket)+"/"+path+"?X-Amz-Expires=300",{method}),{aws:{signQuery:true}});
  return signed.url.toString();
}
export async function motionStorageRead(admin:any,config:any,key:string,range:string|null=null){
  if(!await storageRPC(admin,"motion_storage_record_read",{p_count:1}))throw new MotionStorageSafetyError("Motion pausado: orçamento preventivo de leituras atingido. A fila será retomada automaticamente.","storage_read_budget");
  let r:Response;
  try{r=await fetch(await motionObjectURL(config,"GET",key),{headers:range?{Range:range}:{},cache:"no-store",signal:AbortSignal.timeout(15000)})}
  catch{await storageRPC(admin,"motion_storage_block",{p_reason:"storage_unavailable",p_error:"Armazenamento principal indisponível."});throw new MotionStorageSafetyError("Armazenamento indisponível. A fila foi preservada.");}
  if(r.ok||r.status===404)return r;
  const detail=(await r.text()).slice(0,8192);
  const cap=/download bandwidth or transaction.*cap exceeded|download_cap_exceeded|transaction_cap_exceeded/i.test(detail);
  const message=cap?"Backblaze atingiu o limite de leitura. Novas gerações estão pausadas; a fila foi preservada.":"Armazenamento principal recusou a leitura (HTTP "+r.status+"). A fila foi preservada.";
  await storageRPC(admin,"motion_storage_block",{p_reason:cap?"provider_cap":"storage_unavailable",p_error:message});
  throw new MotionStorageSafetyError(message,cap?"storage_read_cap_exceeded":"storage_read_unavailable");
}
export async function motionCheckObject(admin:any,config:any,key:string,expectedSize=0){
  const r=await motionStorageRead(admin,config,key,"bytes=0-0");
  if(r.status===404)return false;
  const total=r.headers.get("content-range")?.match(/\/(\d+)$/)?.[1]||r.headers.get("content-length");
  await r.body?.cancel().catch(()=>{});
  if(expectedSize>0&&Number(total)!==expectedSize)throw new MotionStorageSafetyError("Arquivo enviado com tamanho diferente do esperado.","storage_size_mismatch");
  return true;
}
export async function motionStorageHealth(admin:any){
  const owner=crypto.randomUUID();
  const state=await storageRPC(admin,"motion_storage_claim_probe",{p_owner:owner});
  if(!state?.should_probe)return state;
  try{
    const config=await motionObjectConfig(admin);if(!config)throw new Error("Armazenamento principal não configurado.");
    const key="cloudent-system/motion-read-probe-v1.txt";
    let r=await motionStorageRead(admin,config,key,"bytes=0-0");
    if(r.status===404){
      const put=await fetch(await motionObjectURL(config,"PUT",key),{method:"PUT",body:"C",signal:AbortSignal.timeout(15000)});
      if(!put.ok)throw new Error("Não foi possível preparar a verificação de armazenamento.");
      r=await motionStorageRead(admin,config,key,"bytes=0-0");
    }
    if(!r.ok||await r.text()!=="C")throw new Error("Armazenamento não confirmou a leitura de verificação.");
    return await storageRPC(admin,"motion_storage_finish_probe",{p_owner:owner,p_ok:true});
  }catch(e){
    // A read failure may already have opened the breaker and invalidated this lease.
    return await storageRPC(admin,"motion_storage_finish_probe",{p_owner:owner,p_ok:false,p_reason:e instanceof MotionStorageSafetyError?e.code:"storage_unavailable",p_error:e instanceof Error?e.message:"Armazenamento indisponível."});
  }
}
export async function requireMotionStorage(admin:any){
  const state=await motionStorageHealth(admin);
  if(!state?.allow_primary)throw new MotionStorageSafetyError("Proteção ativa: novas gerações aguardam a recuperação do armazenamento. Sua fila foi preservada.");
  return state;
}
export async function reserveMotionStorage(admin:any,jobId:string,userId:string,inputBytes=0,outputBytes=RESERVE_OUTPUT_MAX){
  if(inputBytes>RESERVE_INPUT_MAX||outputBytes>RESERVE_OUTPUT_MAX)throw new MotionStorageSafetyError("Reserva do Motion aceita entradas até 12 MB e resultado até 40 MB.","storage_reserve_file_limit");
  const r=await storageRPC(admin,"motion_storage_reserve",{p_job_id:jobId,p_user_id:userId,p_input_bytes:inputBytes,p_output_bytes:outputBytes});
  if(!r?.ok)throw new MotionStorageSafetyError("A reserva de armazenamento atingiu o teto de segurança. A fila foi preservada; aguarde a recuperação do armazenamento principal.","storage_reserve_full");
  return r;
}
export async function commitMotionStorage(admin:any,jobId:string,path:string,size:number){
  await storageRPC(admin,"motion_storage_commit",{p_job_id:jobId,p_result_path:path,p_result_bytes:size});
}
export async function putMotionPrimary(admin:any,config:any,key:string,blob:Blob,mime:string){
  const r=await fetch(await motionObjectURL(config,"PUT",key),{method:"PUT",headers:{"Content-Type":mime},body:blob,signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw new MotionStorageSafetyError("Não foi possível gravar o vídeo no armazenamento principal.");
  if(!await motionCheckObject(admin,config,key,blob.size))throw new MotionStorageSafetyError("Cópia do vídeo não encontrada no armazenamento principal.");
}
