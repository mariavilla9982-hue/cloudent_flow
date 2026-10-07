import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AwsClient } from "npm:aws4fetch@1.0.20";
import twitterText from "npm:twitter-text@3.1.0";

const CORS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info, x-cloudent-worker-secret",
  "Access-Control-Allow-Methods":"GET,POST,OPTIONS"
};
const json=(x:any,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...CORS,"Content-Type":"application/json"}});
const enc=new TextEncoder();
const dec=new TextDecoder();
const APP_URL="https://cloudent-flow.vercel.app/";
const DRIVE_SCOPE="openid email profile https://www.googleapis.com/auth/drive.readonly";
const X_MEDIA_CHUNK=4*1024*1024;
const MAX_VIDEO_BYTES=512*1024*1024;
type CloudentR2Config={account_id:string;access_key_id:string;secret_access_key:string;bucket:string;endpoint:string};

function normalizeR2Config(row:any):CloudentR2Config|null{
  if(!row?.access_key_id||!row?.secret_access_key||!row?.bucket)return null;
  const accountId=String(row.account_id||"").trim();
  return {
    account_id:accountId,
    access_key_id:String(row.access_key_id).trim(),
    secret_access_key:String(row.secret_access_key).trim(),
    bucket:String(row.bucket).trim(),
    endpoint:String(row.endpoint||("https://"+accountId+".r2.cloudflarestorage.com")).trim().replace(/\/$/,"")
  };
}
async function getCloudentR2Config(admin:any):Promise<CloudentR2Config|null>{
  const {data,error}=await admin.rpc("get_cloudent_r2_config");
  if(error)return null;
  return normalizeR2Config(Array.isArray(data)?data[0]:data);
}
function s3RegionFromEndpoint(endpoint:string){
  try{
    const host=new URL(endpoint).hostname;
    const m=host.match(/^s3\.([^.]+)\.backblazeb2\.com$/i);
    return m?.[1]||"auto";
  }catch{return "auto"}
}
function r2KeyPath(key:string){return String(key||"").split("/").map(encodeURIComponent).join("/")}
async function r2PresignedUrl(config:CloudentR2Config,method:string,key:string,expires=3600,contentType=""){
  const aws=new AwsClient({
    service:"s3",region:s3RegionFromEndpoint(config.endpoint),
    accessKeyId:config.access_key_id,
    secretAccessKey:config.secret_access_key
  });
  const headers:Record<string,string>={};
  if(contentType)headers["Content-Type"]=contentType;
  const request=new Request(
    config.endpoint+"/"+encodeURIComponent(config.bucket)+"/"+r2KeyPath(key)+"?X-Amz-Expires="+Math.max(1,Math.min(604800,Number(expires)||3600)),
    {method,headers}
  );
  const signed=await aws.sign(request,{aws:{signQuery:true}});
  return signed.url.toString();
}

function captionValue(value:any){
 const text=String(value||"").trim();
 if(!text||!twitterText.parseTweet(text).valid)throw new HttpError("Defina uma legenda de até 280 caracteres.",400);
 return text;
}
async function uploadReadUrl(admin:any,provider:string,path:string){
 if(provider==="r2"){const cfg=await getCloudentR2Config(admin);if(!cfg)throw new HttpError("Armazenamento não configurado.",409);return r2PresignedUrl(cfg,"GET",path,3600);}
 const {data,error}=await admin.storage.from("videos").createSignedUrl(path,3600);if(error||!data?.signedUrl)throw error||new Error("signed_url_failed");return data.signedUrl;
}
async function uploadRange(source:string,start:number,end:number){
 const r=await fetch(source,{headers:{Range:`bytes=${start}-${end}`}});
 if(r.status!==206) {await r.body?.cancel();throw new HttpError("Armazenamento não retornou o trecho solicitado do vídeo.",502);}
 const b=await r.blob();if(b.size!==end-start+1)throw new HttpError("Trecho do vídeo incompleto.",502);return b;
}


const toB64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const fromB64=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const b64url=(bytes:Uint8Array)=>toB64(bytes).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const randomToken=(n=48)=>b64url(crypto.getRandomValues(new Uint8Array(n)));
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

async function hashHex(value:string){
  const h=new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(value)));
  return Array.from(h).map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function pkceChallenge(verifier:string){
  const h=new Uint8Array(await crypto.subtle.digest("SHA-256",enc.encode(verifier)));
  return b64url(h);
}
async function secretKey(master:string,usage:KeyUsage[]){
  const hash=await crypto.subtle.digest("SHA-256",enc.encode(master));
  return crypto.subtle.importKey("raw",hash,{name:"AES-GCM"},false,usage);
}
async function encryptSecret(value:string,master:string){
  const key=await secretKey(master,["encrypt"]);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,enc.encode(value));
  return {cipher:toB64(new Uint8Array(encrypted)),iv:toB64(iv)};
}
async function decryptSecret(cipher:string,iv:string,master:string){
  const key=await secretKey(master,["decrypt"]);
  const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:fromB64(iv)},key,fromB64(cipher));
  return dec.decode(plain);
}
function redirectBack(params:Record<string,string>){
  const u=new URL(APP_URL);
  for(const [k,v] of Object.entries(params))u.searchParams.set(k,v);
  u.hash="xStudio";
  return Response.redirect(u.toString(),302);
}
function cleanError(e:any){
  return e instanceof Error?e.message:String(e||"unknown_error");
}
function postText(caption:any,link:any){
  const a=String(caption||"").trim();
  const b=String(link||"").trim();
  return a&&b?`${a}\n\n${b}`:a||b;
}
function parseFolderId(value:string){
  const raw=String(value||"").trim();
  if(!raw)return "";
  const m=raw.match(/\/folders\/([A-Za-z0-9_-]+)/i);
  if(m?.[1])return m[1];
  if(/^[A-Za-z0-9_-]{10,}$/.test(raw))return raw;
  return "";
}
function bg(p:Promise<any>){
  const rt=(globalThis as any).EdgeRuntime;
  if(rt?.waitUntil)rt.waitUntil(p.catch(()=>null));
  else p.catch(()=>null);
}

class HttpError extends Error{
  status:number; payload:any; uncertain:boolean;
  constructor(message:string,status=500,payload:any=null,uncertain=false){super(message);this.status=status;this.payload=payload;this.uncertain=uncertain;}
}

async function parseBody(req:Request){
  try{return await req.json()}catch{return {}}
}
async function requireUser(admin:any,req:Request){
  const token=String(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"").trim();
  if(!token)throw new HttpError("unauthorized",401);
  const {data,error}=await admin.auth.getUser(token);
  if(error||!data?.user)throw new HttpError("unauthorized",401);
  return data.user;
}
async function masterSecret(admin:any){
  const {data,error}=await admin.rpc("get_cloudent_worker_secret");
  if(error||!data)throw error||new Error("worker_secret_missing");
  return String(data);
}

async function integration(admin:any,provider:string){
  const {data,error}=await admin.from("integrations").select("provider,enabled,account_label,external_account_id,config,last_verified_at").eq("provider",provider).maybeSingle();
  if(error)throw error;
  return data||{provider,config:{}};
}

async function googleApp(admin:any,master:string){
  const row=await integration(admin,"google_drive");
  const cfg:any=row?.config||{};
  if(!cfg.clientIdCipher||!cfg.clientIdIv||!cfg.clientSecretCipher||!cfg.clientSecretIv)throw new HttpError("google_app_not_configured",409);
  return {
    row,cfg,
    clientId:await decryptSecret(String(cfg.clientIdCipher),String(cfg.clientIdIv),master),
    clientSecret:await decryptSecret(String(cfg.clientSecretCipher),String(cfg.clientSecretIv),master)
  };
}

async function googleConnection(admin:any,userId:string){
  const {data,error}=await admin.from("google_drive_connections").select("*").eq("user_id",userId).maybeSingle();
  if(error)throw error;
  return data;
}

async function usableGoogleToken(admin:any,userId:string,master:string){
  const conn=await googleConnection(admin,userId);
  if(!conn)throw new HttpError("google_drive_not_connected",409);
  const expires=conn.token_expires_at?new Date(conn.token_expires_at).getTime():0;
  if(!expires||expires>Date.now()+5*60_000){
    return {token:await decryptSecret(String(conn.access_token_cipher),String(conn.access_token_iv),master),conn};
  }
  if(!conn.refresh_token_cipher||!conn.refresh_token_iv)throw new HttpError("google_refresh_token_missing",409);
  const app=await googleApp(admin,master);
  const refresh=await decryptSecret(String(conn.refresh_token_cipher),String(conn.refresh_token_iv),master);
  const body=new URLSearchParams({client_id:app.clientId,client_secret:app.clientSecret,refresh_token:refresh,grant_type:"refresh_token"});
  const r=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:body.toString()});
  let d:any={};try{d=await r.json()}catch{}
  if(!r.ok||!d.access_token)throw new HttpError(String(d?.error_description||d?.error||"google_token_refresh_failed"),r.status,d);
  const access=await encryptSecret(String(d.access_token),master);
  const now=new Date().toISOString();
  const expiresAt=new Date(Date.now()+Math.max(60,Number(d.expires_in||3600))*1000).toISOString();
  const {data:updated,error}=await admin.from("google_drive_connections").update({access_token_cipher:access.cipher,access_token_iv:access.iv,token_expires_at:expiresAt,last_verified_at:now,updated_at:now}).eq("user_id",userId).select().single();
  if(error)throw error;
  return {token:String(d.access_token),conn:updated};
}

async function driveFetch(url:string,token:string,init:RequestInit={}){
  const headers=new Headers(init.headers||{});headers.set("Authorization","Bearer "+token);
  const r=await fetch(url,{...init,headers});
  if(!r.ok){let d:any={};try{d=await r.json()}catch{d={}};throw new HttpError(String(d?.error?.message||`Google Drive ${r.status}`),r.status,d);}
  return r;
}

async function validateFolder(admin:any,userId:string,folderInput:string,master:string){
  const folderId=parseFolderId(folderInput);
  if(!folderId)throw new HttpError("Pasta do Google Drive inválida.",400);
  const {token}=await usableGoogleToken(admin,userId,master);
  const r=await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType,webViewLink&supportsAllDrives=true`,token);
  const f:any=await r.json();
  if(f?.mimeType!=="application/vnd.google-apps.folder")throw new HttpError("O link informado não aponta para uma pasta do Google Drive.",400);
  const now=new Date().toISOString();
  const {data,error}=await admin.from("google_drive_connections").update({folder_id:String(f.id),folder_name:String(f.name||"Pasta X"),folder_web_url:String(f.webViewLink||folderInput),last_verified_at:now,updated_at:now}).eq("user_id",userId).select().single();
  if(error)throw error;
  return data;
}

async function listDriveVideos(token:string,folderId:string){
  const out:any[]=[];let page="";
  do{
    const q=`'${folderId.replace(/'/g,"\\'")}' in parents and trashed=false`;
    const u=new URL("https://www.googleapis.com/drive/v3/files");
    u.searchParams.set("q",q);u.searchParams.set("spaces","drive");u.searchParams.set("pageSize","1000");
    u.searchParams.set("orderBy","createdTime asc");
    u.searchParams.set("fields","nextPageToken,files(id,name,mimeType,size,createdTime,modifiedTime,md5Checksum)");
    u.searchParams.set("supportsAllDrives","true");u.searchParams.set("includeItemsFromAllDrives","true");
    if(page)u.searchParams.set("pageToken",page);
    const r=await driveFetch(u.toString(),token);const j:any=await r.json();
    for(const f of j.files||[])if(String(f.mimeType||"").startsWith("video/"))out.push(f);
    page=String(j.nextPageToken||"");
  }while(page&&out.length<5000);
  return out;
}

async function syncFolder(admin:any,userId:string,master:string){
  const {token,conn}=await usableGoogleToken(admin,userId,master);
  if(!conn?.folder_id)throw new HttpError("google_drive_folder_missing",409);
  const files=await listDriveVideos(token,String(conn.folder_id));
  if(files.length){
    const rows=files.map((f:any)=>({
      user_id:userId,drive_file_id:String(f.id),drive_file_name:String(f.name||"video"),drive_mime_type:String(f.mimeType||"video/mp4"),
      drive_size_bytes:f.size?Number(f.size):null,drive_created_at:f.createdTime||null,drive_modified_at:f.modifiedTime||null,drive_md5:f.md5Checksum||null,updated_at:new Date().toISOString()
    }));
    for(let i=0;i<rows.length;i+=200){
      const {error}=await admin.from("x_drive_posts").upsert(rows.slice(i,i+200),{onConflict:"user_id,drive_file_id"});
      if(error)throw error;
    }
  }
  const now=new Date().toISOString();
  await admin.from("x_publish_configs").upsert({user_id:userId,last_sync_at:now,updated_at:now},{onConflict:"user_id"});
  return {files:files.length,folder_id:conn.folder_id,folder_name:conn.folder_name};
}

async function resolveXAccount(admin:any,userId:string,config:any){
  if(config?.platform_account_id){
    const {data}=await admin.from("platform_accounts").select("*").eq("id",config.platform_account_id).eq("platform","x").eq("enabled",true).maybeSingle();
    if(data&&String(data?.config?.owner_user_id||'')===userId)return data;
  }
  const {data,error}=await admin.from("platform_accounts").select("*").eq("platform","x").eq("enabled",true).order("created_at",{ascending:true});
  if(error)throw error;
  const owned=(data||[]).find((x:any)=>String(x?.config?.owner_user_id||"")===userId);
  return owned||null;
}

async function usableXToken(admin:any,platform:any,master:string){
  const cfg:any=platform?.config||{};
  if(!cfg.accessTokenCipher||!cfg.accessTokenIv)throw new HttpError("x_access_token_missing",409);
  const expires=cfg.tokenExpiresAt?new Date(cfg.tokenExpiresAt).getTime():0;
  if(!(cfg.refreshTokenCipher&&cfg.refreshTokenIv&&expires&&expires<Date.now()+5*60_000))return decryptSecret(String(cfg.accessTokenCipher),String(cfg.accessTokenIv),master);
  const xInt=await integration(admin,"x");const app:any=xInt?.config||{};
  if(!app.clientIdCipher||!app.clientIdIv||!app.clientSecretCipher||!app.clientSecretIv)throw new HttpError("x_oauth_app_config_missing",409);
  const refresh=await decryptSecret(String(cfg.refreshTokenCipher),String(cfg.refreshTokenIv),master);
  const clientId=await decryptSecret(String(app.clientIdCipher),String(app.clientIdIv),master);
  const clientSecret=await decryptSecret(String(app.clientSecretCipher),String(app.clientSecretIv),master);
  const body=new URLSearchParams({grant_type:"refresh_token",refresh_token:refresh});
  const r=await fetch("https://api.x.com/2/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+btoa(clientId+":"+clientSecret),"Content-Type":"application/x-www-form-urlencoded"},body:body.toString()});
  let d:any={};try{d=await r.json()}catch{}
  if(!r.ok||!d.access_token)throw new HttpError(String(d?.error_description||d?.error||"x_token_refresh_failed"),r.status,d);
  const access=await encryptSecret(String(d.access_token),master);const ref=d.refresh_token?await encryptSecret(String(d.refresh_token),master):null;
  const now=new Date().toISOString();
  const next={...cfg,accessTokenCipher:access.cipher,accessTokenIv:access.iv,refreshTokenCipher:ref?.cipher||cfg.refreshTokenCipher,refreshTokenIv:ref?.iv||cfg.refreshTokenIv,tokenExpiresAt:new Date(Date.now()+Math.max(60,Number(d.expires_in||7200))*1000).toISOString(),last_refresh_at:now};
  const {error}=await admin.from("platform_accounts").update({config:next,updated_at:now}).eq("id",platform.id);if(error)throw error;
  return String(d.access_token);
}

async function xJson(path:string,token:string,method="GET",body:any=null){
  const r=await fetch("https://api.x.com"+path,{method,headers:{Authorization:"Bearer "+token,...(body?{"Content-Type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});
  let j:any={};try{j=await r.json()}catch{}
  if(!r.ok)throw new HttpError(String(j?.detail||j?.title||j?.errors?.[0]?.message||j?.error||`X API ${r.status}`),r.status,j);
  return j;
}

async function driveRange(token:string,fileId:string,start:number,end:number){
  const u=`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;
  const r=await driveFetch(u,token,{headers:{Range:`bytes=${start}-${end}`}});
  return await r.blob();
}

async function uploadVideoX(driveToken:string,file:any,xToken:string,sourceUrl=""){
  const size=Number(file.drive_size_bytes||0);
  if(!size)throw new HttpError("O tamanho do vídeo não está disponível.",400);
  if(size>MAX_VIDEO_BYTES)throw new HttpError("Vídeo maior que 512 MB; bloqueado para evitar execução longa.",400);
  const mime=String(file.drive_mime_type||"video/mp4");
  const init=await xJson("/2/media/upload/initialize",xToken,"POST",{media_type:mime,total_bytes:size,media_category:"tweet_video"});
  const mediaId=String(init?.data?.id||init?.data?.media_id||init?.media_id_string||init?.media_id||"");
  if(!mediaId)throw new HttpError("X não retornou media_id ao iniciar upload.",502,init);
  let segment=0;
  for(let start=0;start<size;start+=X_MEDIA_CHUNK){
    const end=Math.min(size-1,start+X_MEDIA_CHUNK-1);
    const blob=sourceUrl?await uploadRange(sourceUrl,start,end):await driveRange(driveToken,String(file.drive_file_id),start,end);
    const form=new FormData();form.append("segment_index",String(segment));form.append("media",blob,String(file.drive_file_name||"video.mp4"));
    const r=await fetch(`https://api.x.com/2/media/upload/${encodeURIComponent(mediaId)}/append`,{method:"POST",headers:{Authorization:"Bearer "+xToken},body:form});
    if(!r.ok){let d:any={};try{d=await r.json()}catch{};throw new HttpError(String(d?.detail||d?.title||`X media append ${r.status}`),r.status,d);}
    segment++;
  }
  let fin=await xJson(`/2/media/upload/${encodeURIComponent(mediaId)}/finalize`,xToken,"POST",{});
  let info=fin?.data?.processing_info||fin?.processing_info||null;
  for(let i=0;info&&i<20;i++){
    const state=String(info.state||"").toLowerCase();
    if(state==="succeeded")break;
    if(state==="failed")throw new HttpError(String(info?.error?.message||"X falhou ao processar o vídeo."),422,info);
    await sleep(Math.min(10,Math.max(1,Number(info.check_after_secs||2)))*1000);
    const st=await xJson(`/2/media/upload?media_id=${encodeURIComponent(mediaId)}&command=STATUS`,xToken,"GET");
    info=st?.data?.processing_info||st?.processing_info||null;
  }
  if(info&&String(info.state||"").toLowerCase()!=="succeeded")throw new HttpError("Tempo limite aguardando o X processar o vídeo.",504,info);
  return mediaId;
}

async function createTweet(xToken:string,text:string,mediaId:string){
  let r:Response;
  try{
    r=await fetch("https://api.x.com/2/tweets",{method:"POST",headers:{Authorization:"Bearer "+xToken,"Content-Type":"application/json"},body:JSON.stringify({text,media:{media_ids:[mediaId]}})});
  }catch(e){throw new HttpError("Resposta do X ficou incerta após enviar o post. Verifique a conta antes de repetir.",599,{cause:cleanError(e)},true);}
  let j:any={};try{j=await r.json()}catch{}
  if(!r.ok){
    const uncertain=r.status>=500;
    throw new HttpError(String(j?.detail||j?.title||j?.errors?.[0]?.message||`X create post ${r.status}`),r.status,j,uncertain);
  }
  const id=String(j?.data?.id||"");if(!id)throw new HttpError("X não retornou o ID do post. Verifique a conta antes de repetir.",599,j,true);
  return id;
}

function backoff(attempt:number){return Math.min(180,Math.max(5,Math.pow(2,Math.max(0,attempt-1))*5));}

async function publishOne(admin:any,userId:string,config:any,master:string,workerId:string){
  const xAccount=await resolveXAccount(admin,userId,config);
  if(!xAccount)throw new HttpError("Nenhuma conta X conectada para esta conta.",409);
  const {data:file,error:claimErr}=await admin.rpc("claim_x_upload_post",{p_user_id:userId,p_worker_id:workerId});
  if(claimErr)throw claimErr;if(!file)return null;
  const attempt=Number(file.attempts||1);
  let postAccepted=false;
  try{
    const text=captionValue(file.post_text);
    const xToken=await usableXToken(admin,xAccount,master);
    let sourceUrl="",driveToken="";
    if(file.meta?.source==="upload"){
      const path=String(file.meta.storage_path||"");
      if(!path.startsWith(userId+"/x-uploads/"))throw new HttpError("Caminho do vídeo inválido.",403);
      sourceUrl=await uploadReadUrl(admin,String(file.meta.storage_provider||"supabase"),path);
    }else{driveToken=(await usableGoogleToken(admin,userId,master)).token;}
    const mediaId=await uploadVideoX(driveToken,file,xToken,sourceUrl);
    const {error:markErr}=await admin.from("x_drive_posts").update({meta:{...(file.meta||{}),publish_request_started:true},updated_at:new Date().toISOString()}).eq("id",file.id).eq("locked_by",workerId);
    if(markErr)throw markErr;
    const tweetId=await createTweet(xToken,text,mediaId);postAccepted=true;
    const now=new Date().toISOString();
    const {error:completeErr}=await admin.rpc("complete_x_upload_post",{p_id:file.id,p_worker_id:workerId,p_account_id:xAccount.id,p_text:text,p_media_id:mediaId,p_post_id:tweetId});
    if(completeErr)throw completeErr;
    await admin.from("activity_logs").insert({level:"info",event_type:"x_drive_post_published",message:"Vídeo da fila publicado no X",meta:{user_id:userId,drive_file_id:file.drive_file_id,drive_file_name:file.drive_file_name,x_post_id:tweetId}});
    return {id:file.id,state:"published",x_post_id:tweetId,file:file.drive_file_name};
  }catch(e:any){
    const message=cleanError(e);const uncertain=postAccepted||Boolean(e?.uncertain);const final=uncertain||attempt>=Number(file.max_attempts||5)||[400,401,403,409,422].includes(Number(e?.status||0));
    const next=new Date(Date.now()+backoff(attempt)*60_000).toISOString();
    await admin.from("x_drive_posts").update({status:final?"failed":"queued",next_attempt_at:final?file.next_attempt_at:next,locked_at:null,locked_by:null,last_error:message,meta:{...(file.meta||{}),publish_uncertain:uncertain,http_status:Number(e?.status||0)},updated_at:new Date().toISOString()}).eq("id",file.id);
    await admin.from("x_publish_configs").update({last_worker_at:new Date().toISOString(),last_error:message,updated_at:new Date().toISOString()}).eq("user_id",userId);
    await admin.from("activity_logs").insert({level:"error",event_type:"x_drive_post_error",message,meta:{user_id:userId,drive_file_id:file.drive_file_id,drive_file_name:file.drive_file_name,attempt,publish_uncertain:uncertain,http_status:Number(e?.status||0)}});
    return {id:file.id,state:final?"failed":"retry",error:message,uncertain};
  }
}

async function statusPayload(admin:any,userId:string,master:string){
  const [gInt,xInt,connRes,cfgRes,postsRes,accountsRes]=await Promise.all([
    integration(admin,"google_drive"),integration(admin,"x"),admin.from("google_drive_connections").select("id,account_email,account_name,folder_id,folder_name,folder_web_url,connected_at,last_verified_at").eq("user_id",userId).maybeSingle(),admin.from("x_publish_configs").select("*").eq("user_id",userId).maybeSingle(),admin.from("x_drive_posts").select("id,drive_file_id,drive_file_name,drive_mime_type,drive_size_bytes,status,post_text,x_post_id,attempts,max_attempts,last_error,published_at,meta,created_at,updated_at",{count:"exact"}).eq("user_id",userId).order("created_at",{ascending:false}).limit(80),admin.from("platform_accounts").select("id,external_account_id,account_label,enabled,config,created_at").eq("platform","x").eq("enabled",true).order("created_at",{ascending:true})
  ]);
  if(connRes.error)throw connRes.error;if(cfgRes.error)throw cfgRes.error;if(postsRes.error)throw postsRes.error;if(accountsRes.error)throw accountsRes.error;
  const cfg:any=cfgRes.data||{user_id:userId,enabled:false,caption:"",link_url:"",interval_minutes:120,timezone:"America/Recife"};
  const owned=(accountsRes.data||[]).filter((x:any)=>String(x?.config?.owner_user_id||"")===userId);
  const active=owned.find((x:any)=>x.id===cfg.platform_account_id)||owned[0]||null;
  const rows=postsRes.data||[];
  const counts={queued:0,processing:0,published:0,failed:0,total:Number(postsRes.count||0)} as any;
  await Promise.all(["queued","processing","published","failed"].map(async status=>{
    const {count,error}=await admin.from("x_drive_posts").select("id",{count:"exact",head:true}).eq("user_id",userId).eq("status",status);
    if(error)throw error;counts[status]=Number(count||0);
  }));
  const gcfg:any=gInt?.config||{};const xcfg:any=xInt?.config||{};
  const callback=`${Deno.env.get("SUPABASE_URL")}/functions/v1/cloudent-x-publish-worker?action=google-callback`;
  return {
    ok:true,
    google:{app_configured:Boolean(gcfg.clientIdCipher&&gcfg.clientSecretCipher),connected:Boolean(connRes.data),account:connRes.data?.account_email||connRes.data?.account_name||null,folder:connRes.data?.folder_id?{id:connRes.data.folder_id,name:connRes.data.folder_name,url:connRes.data.folder_web_url}:null,callback_url:callback},
    x:{app_configured:Boolean(xcfg.clientIdCipher&&xcfg.clientSecretCipher),connected:Boolean(active),account:active?{id:active.id,label:active.account_label,username:active?.config?.username||null,external_id:active.external_account_id}:null},
    config:cfg,
    counts,
    posts:rows
  };
}

async function runWorker(admin:any,master:string){
  const workerId="xdrive-"+crypto.randomUUID();const now=new Date().toISOString();
  await admin.rpc("release_stale_x_drive_posts");
  await admin.from("worker_runtime").upsert({worker_name:"x_drive_publisher",last_heartbeat:now,updated_at:now},{onConflict:"worker_name"});
  const {data:configs,error}=await admin.from("x_publish_configs").select("*").eq("enabled",true).order("updated_at",{ascending:true});if(error)throw error;
  const results:any[]=[];
  for(const cfg of configs||[]){
    const userId=String(cfg.user_id);
    try{
      const sync={files:0};
      const due=!cfg.next_publish_at||new Date(cfg.next_publish_at).getTime()<=Date.now();
      let pub:any=null;if(due)pub=await publishOne(admin,userId,cfg,master,workerId);
      results.push({user_id:userId,synced:sync.files,publish:pub||"not_due"});
    }catch(e){
      const message=cleanError(e);await admin.from("x_publish_configs").update({last_worker_at:new Date().toISOString(),last_error:message,updated_at:new Date().toISOString()}).eq("user_id",userId);
      results.push({user_id:userId,error:message});
    }
  }
  await admin.from("worker_runtime").upsert({worker_name:"x_drive_publisher",last_heartbeat:new Date().toISOString(),last_success_at:new Date().toISOString(),last_error:null,last_jobs:results.length,updated_at:new Date().toISOString()},{onConflict:"worker_name"});
  return {ok:true,worker:"x_drive_publisher",users:results.length,results};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  const supabaseUrl=Deno.env.get("SUPABASE_URL")!;const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const url=new URL(req.url);const action=String(url.searchParams.get("action")||"status");
  try{
    const master=await masterSecret(admin);
    if(action==="worker"){
      const supplied=String(req.headers.get("x-cloudent-worker-secret")||"");
      if(!supplied||supplied!==master)return json({ok:false,error:"unauthorized"},401);
      return json(await runWorker(admin,master));
    }
    if(action==="google-callback"){
      const oauthError=String(url.searchParams.get("error")||"");if(oauthError)return redirectBack({drive_error:oauthError});
      const state=String(url.searchParams.get("state")||"");const code=String(url.searchParams.get("code")||"");
      if(!state||!code)return redirectBack({drive_error:"oauth_callback_invalid"});
      const stateHash=await hashHex(state);
      const {data:st,error:se}=await admin.from("google_drive_oauth_states").select("*").eq("state_hash",stateHash).maybeSingle();if(se)throw se;
      if(!st||new Date(st.expires_at).getTime()<Date.now()){if(st?.id)await admin.from("google_drive_oauth_states").delete().eq("id",st.id);return redirectBack({drive_error:"oauth_state_invalid"});}
      const app=await googleApp(admin,master);const verifier=await decryptSecret(String(st.verifier_cipher),String(st.verifier_iv),master);
      const callback=`${supabaseUrl}/functions/v1/cloudent-x-publish-worker?action=google-callback`;
      const body=new URLSearchParams({client_id:app.clientId,client_secret:app.clientSecret,code,code_verifier:verifier,grant_type:"authorization_code",redirect_uri:callback});
      const tr=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:body.toString()});let td:any={};try{td=await tr.json()}catch{}
      if(!tr.ok||!td.access_token){await admin.from("google_drive_oauth_states").delete().eq("id",st.id);return redirectBack({drive_error:"token_exchange_failed"});}
      const profileRes=await fetch("https://www.googleapis.com/oauth2/v2/userinfo",{headers:{Authorization:"Bearer "+td.access_token}});let profile:any={};try{profile=await profileRes.json()}catch{}
      const old=await googleConnection(admin,String(st.user_id));const access=await encryptSecret(String(td.access_token),master);const refresh=td.refresh_token?await encryptSecret(String(td.refresh_token),master):null;const now=new Date().toISOString();
      const row={user_id:st.user_id,access_token_cipher:access.cipher,access_token_iv:access.iv,refresh_token_cipher:refresh?.cipher||old?.refresh_token_cipher||null,refresh_token_iv:refresh?.iv||old?.refresh_token_iv||null,token_expires_at:new Date(Date.now()+Math.max(60,Number(td.expires_in||3600))*1000).toISOString(),account_email:String(profile.email||old?.account_email||""),account_name:String(profile.name||old?.account_name||""),scopes:String(td.scope||DRIVE_SCOPE).split(/\s+/).filter(Boolean),connected_at:old?.connected_at||now,last_verified_at:now,updated_at:now};
      const {error:upErr}=await admin.from("google_drive_connections").upsert(row,{onConflict:"user_id"});if(upErr)throw upErr;
      await admin.from("google_drive_oauth_states").delete().eq("id",st.id);
      await admin.from("integrations").update({enabled:true,account_label:profile.email?`Google Drive · ${profile.email}`:"Google Drive",external_account_id:String(profile.id||"connected"),config:{...app.cfg,status:"connected",last_connected_at:now},last_verified_at:now,updated_at:now}).eq("provider","google_drive");
      return redirectBack({drive_connected:"1"});
    }

    const user=await requireUser(admin,req);const userId=String(user.id);
    if(action==="status")return json(await statusPayload(admin,userId,master));
    const body=await parseBody(req);

    if(action==="google-configure"){
      const clientId=String(body.client_id||"").trim(),clientSecret=String(body.client_secret||"").trim();if(!clientId||!clientSecret)return json({error:"missing_google_oauth_credentials",user_message:"Preencha Client ID e Client Secret do Google."},400);
      const a=await encryptSecret(clientId,master),s=await encryptSecret(clientSecret,master);const now=new Date().toISOString();const current=await integration(admin,"google_drive");
      const cfg={...(current?.config||{}),clientIdCipher:a.cipher,clientIdIv:a.iv,clientSecretCipher:s.cipher,clientSecretIv:s.iv,status:"configured",configured_at:now};
      const {error}=await admin.from("integrations").update({config:cfg,account_label:"Google Drive · OAuth configurado",updated_at:now}).eq("provider","google_drive");if(error)throw error;
      return json({ok:true,callback_url:`${supabaseUrl}/functions/v1/cloudent-x-publish-worker?action=google-callback`});
    }
    if(action==="google-start"){
      const app=await googleApp(admin,master);await admin.from("google_drive_oauth_states").delete().lt("expires_at",new Date().toISOString());
      const state=randomToken(32),verifier=randomToken(64),challenge=await pkceChallenge(verifier),stateHash=await hashHex(state),ev=await encryptSecret(verifier,master),expiresAt=new Date(Date.now()+10*60_000).toISOString();
      const {error}=await admin.from("google_drive_oauth_states").insert({user_id:userId,state_hash:stateHash,verifier_cipher:ev.cipher,verifier_iv:ev.iv,expires_at:expiresAt});if(error)throw error;
      const callback=`${supabaseUrl}/functions/v1/cloudent-x-publish-worker?action=google-callback`;const a=new URL("https://accounts.google.com/o/oauth2/v2/auth");a.searchParams.set("client_id",app.clientId);a.searchParams.set("redirect_uri",callback);a.searchParams.set("response_type","code");a.searchParams.set("scope",DRIVE_SCOPE);a.searchParams.set("access_type","offline");a.searchParams.set("prompt","consent");a.searchParams.set("include_granted_scopes","true");a.searchParams.set("state",state);a.searchParams.set("code_challenge",challenge);a.searchParams.set("code_challenge_method","S256");
      return json({ok:true,auth_url:a.toString(),callback_url:callback,expires_at:expiresAt});
    }
    if(action==="google-folder"){
      const conn=await validateFolder(admin,userId,String(body.folder||body.folder_url||body.folder_id||""),master);const sync=await syncFolder(admin,userId,master);return json({ok:true,folder:{id:conn.folder_id,name:conn.folder_name,url:conn.folder_web_url},sync});
    }
    if(action==="sync")return json({ok:true,...await syncFolder(admin,userId,master)});

    if(action==="upload-ticket"){
      if(req.method!=="POST")return json({error:"method_not_allowed"},405);
      const size=Number(body.size_bytes),mime=String(body.mime_type||"video/mp4");
      if(!Number.isSafeInteger(size)||size<=0||size>MAX_VIDEO_BYTES||!["video/mp4","video/quicktime"].includes(mime))return json({error:"invalid_video",user_message:"Envie um vídeo MP4 ou MOV de até 512 MB."},400);
      const path=userId+"/x-uploads/"+crypto.randomUUID()+(mime==="video/quicktime"?".mov":".mp4");
      const cfg=await getCloudentR2Config(admin);
      if(cfg)return json({ok:true,provider:"r2",object_path:path,upload_url:await r2PresignedUrl(cfg,"PUT",path,900,mime),content_type:mime});
      const {data,error}=await admin.storage.from("videos").createSignedUploadUrl(path);if(error)throw error;
      return json({ok:true,provider:"supabase",object_path:path,upload_url:data.signedUrl,content_type:mime});
    }
    if(action==="upload-complete"){
      const path=String(body.object_path||""),provider=String(body.provider||"");
      if(!new RegExp("^"+userId+"/x-uploads/[0-9a-f-]{36}\\.(mp4|mov)$").test(path)||!["r2","supabase"].includes(provider))return json({error:"invalid_upload_path"},403);
      const text=captionValue(body.caption),size=Number(body.size_bytes),mime=String(body.mime_type||"video/mp4");
      if(!Number.isSafeInteger(size)||size<=0||size>MAX_VIDEO_BYTES||!["video/mp4","video/quicktime"].includes(mime))return json({error:"invalid_video"},400);
      const source=await uploadReadUrl(admin,provider,path),head=await fetch(source,{method:"HEAD"});
      if(!head.ok||Number(head.headers.get("content-length"))!==size)return json({error:"upload_incomplete",user_message:"O upload do vídeo não foi concluído. Tente novamente."},409);
      const x=await resolveXAccount(admin,userId,{});
      const row={user_id:userId,platform_account_id:x?.id||null,drive_file_id:"upload:"+path,drive_file_name:String(body.file_name||"video.mp4").slice(0,255),drive_mime_type:mime,drive_size_bytes:size,status:"queued",post_text:text,meta:{source:"upload",storage_provider:provider,storage_path:path}};
      const {data,error}=await admin.from("x_drive_posts").insert(row).select("id").single();if(error){if(error.code==="23505")return json({ok:true,already_queued:true});throw error;}
      return json({ok:true,id:data.id});
    }
    if(action==="edit-caption"||action==="skip"){
      const text=action==="edit-caption"?captionValue(body.caption):null;
      const patch=action==="skip"?{status:"skipped"}:{post_text:text};
      const {data,error}=await admin.from("x_drive_posts").update({...patch,updated_at:new Date().toISOString()}).eq("id",String(body.id||"")).eq("user_id",userId).in("status",["queued","failed"]).select("id").maybeSingle();
      if(error)throw error;if(!data)return json({error:"post_locked",user_message:"Essa postagem já está sendo enviada ou foi finalizada."},409);return json({ok:true});
    }
    if(action==="save-config"){
      const interval=Number(body.interval_minutes||120),enabled=body.enabled===true;
      if(!Number.isInteger(interval)||interval<5||interval>10080)return json({error:"invalid_interval",user_message:"Escolha um intervalo entre 5 e 10080 minutos."},400);
      const x=await resolveXAccount(admin,userId,body);if(enabled&&!x)return json({error:"x_not_connected",user_message:"Conecte a conta X antes de iniciar."},409);
      const now=new Date().toISOString();
      const next=body.next_publish_at?new Date(body.next_publish_at):new Date();
      if(Number.isNaN(next.getTime()))return json({error:"invalid_start"},400);
      const row={user_id:userId,platform_account_id:x?.id||null,enabled,caption:"",link_url:"",interval_minutes:interval,timezone:String(body.timezone||"America/Recife"),next_publish_at:enabled?next.toISOString():null,last_error:null,updated_at:now};
      const {error}=await admin.from("x_publish_configs").upsert(row,{onConflict:"user_id"});if(error)throw error;
      if(enabled)bg(fetch(`${supabaseUrl}/functions/v1/cloudent-x-publish-worker?action=worker`,{method:"POST",headers:{"Content-Type":"application/json","x-cloudent-worker-secret":master},body:"{}"}));
      return json({ok:true,config:row});
    }
    if(action==="publish-next"){
      const now=new Date().toISOString();const {error}=await admin.from("x_publish_configs").upsert({user_id:userId,next_publish_at:now,updated_at:now},{onConflict:"user_id"});if(error)throw error;
      bg(fetch(`${supabaseUrl}/functions/v1/cloudent-x-publish-worker?action=worker`,{method:"POST",headers:{"Content-Type":"application/json","x-cloudent-worker-secret":master},body:"{}"}));
      return json({ok:true,state:"queued"});
    }
    if(action==="retry"){
      const id=String(body.id||"");if(!id)return json({error:"missing_id"},400);
      const {data:p,error:e}=await admin.from("x_drive_posts").select("id,status,meta").eq("id",id).eq("user_id",userId).maybeSingle();if(e)throw e;if(!p)return json({error:"not_found"},404);
      if(p.status!=="failed")return json({error:"post_not_failed"},409);
      if(Boolean(p?.meta?.publish_uncertain))return json({error:"publish_uncertain",user_message:"Esse envio pode já ter virado post no X. Confira a conta antes de forçar uma repetição."},409);
      const {error:u}=await admin.from("x_drive_posts").update({status:"queued",next_attempt_at:new Date().toISOString(),last_error:null,locked_at:null,locked_by:null,meta:{...(p.meta||{}),publish_uncertain:false},updated_at:new Date().toISOString()}).eq("id",id).eq("user_id",userId);if(u)throw u;
      return json({ok:true});
    }
    return json({error:"not_found"},404);
  }catch(e:any){
    const status=Number(e?.status||500);const message=cleanError(e);
    if(action==="google-callback")return redirectBack({drive_error:"oauth_internal_error"});
    return json({ok:false,error:message,user_message:message},status>=400&&status<600?status:500);
  }
});
