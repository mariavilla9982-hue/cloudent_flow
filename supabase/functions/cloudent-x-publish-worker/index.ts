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
const MAX_PHOTO_BYTES=5*1024*1024;
const UPLOAD_EXTENSIONS=new Map([
 ["video/mp4","mp4"],["video/quicktime","mov"],["image/jpeg","jpg"],["image/png","png"],
]);
const PHOTO_SIGNATURES=new Map([
 ["image/jpeg",[255,216,255]],["image/png",[137,80,78,71,13,10,26,10]],
]);
function uploadExtension(mime:string,size:number){
 const extension=UPLOAD_EXTENSIONS.get(mime);
 const photo=PHOTO_SIGNATURES.get(mime);
 if(!extension||!Number.isSafeInteger(size)||size<(photo?.length||1)||size>(photo?MAX_PHOTO_BYTES:MAX_VIDEO_BYTES)){
  throw new HttpError("Envie uma foto JPG ou PNG de até 5 MB, ou um vídeo MP4 ou MOV de até 512 MB.",400);
 }
 return extension;
}
function uploadPathMime(userId:string,path:string){
 const prefix=userId+"/x-uploads/";
 if(!path.startsWith(prefix))return "";
 const extension=path.slice(prefix.length).match(/^[0-9a-f-]{36}[.](mp4|mov|jpg|png)$/)?.[1];
 for(const [mime,suffix] of UPLOAD_EXTENSIONS)if(suffix===extension)return mime;
 return "";
}
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

function scheduleValue(value:any){
 if(value===undefined||value===null||value==="")return null;
 const date=new Date(value);
 if(!Number.isFinite(date.getTime())||date.getTime()<=Date.now())throw new HttpError("Escolha uma data e um horário futuros.",400);
 return date.toISOString();
}
function captionValue(value:any,optional=false){
 const text=String(value||"").trim();
 if(optional&&!text)return "";
 if(!text||!twitterText.parseTweet(text).valid)throw new HttpError("Defina uma legenda de até 280 caracteres.",400);
 return text;
}
async function uploadReadUrl(admin:any,provider:string,path:string){
 if(provider==="r2"){const cfg=await getCloudentR2Config(admin);if(!cfg)throw new HttpError("Armazenamento não configurado.",409);return r2PresignedUrl(cfg,"GET",path,3600);}
 const {data,error}=await admin.storage.from("videos").createSignedUrl(path,3600);if(error||!data?.signedUrl)throw error||new Error("signed_url_failed");return data.signedUrl;
}
async function uploadedVideoMatches(source:string,size:number){
 // The URL is signed for GET. Read just one byte to verify the object and its full size.
 const r=await fetch(source,{method:"GET",headers:{Range:"bytes=0-0"}});
 const range=String(r.headers.get("content-range")||"").match(/^bytes 0-0\/(\d+)$/i);
 const valid=r.status===206&&!!range&&Number(range[1])===size;
 await r.body?.cancel();
 return valid;
}

async function uploadedPhotoMatches(source:string,size:number,signature:number[]){
 const end=signature.length-1;
 const response=await fetch(source,{headers:{Range:"bytes=0-"+end},signal:AbortSignal.timeout(10000)});
 if(response.status!==206||response.headers.get("content-range")!==`bytes 0-${end}/${size}`){
  await response.body?.cancel();return false;
 }
 const bytes=new Uint8Array(await response.arrayBuffer());
 return bytes.length===signature.length&&signature.every((byte,i)=>byte===bytes[i]);
}

async function uploadedThumbnailMatches(source:string){
 try{
  const r=await fetch(source,{method:"GET",headers:{Range:"bytes=0-2"},signal:AbortSignal.timeout(10000)});
  const range=String(r.headers.get("content-range")||"").match(/^bytes 0-2\/(\d+)$/i);
  if(r.status!==206||!range||Number(range[1])<3||Number(range[1])>1048576||!String(r.headers.get("content-type")).toLowerCase().startsWith("image/jpeg")){await r.body?.cancel();return false;}
  const bytes=new Uint8Array(await r.arrayBuffer());return bytes.length===3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 }catch{return false;}
}

async function uploadRange(source:string,start:number,end:number){
 const r=await fetch(source,{headers:{Range:`bytes=${start}-${end}`}});
 if(r.status!==206) {await r.body?.cancel();throw new HttpError("Armazenamento não retornou o trecho solicitado do arquivo.",502);}
 const b=await r.blob();if(b.size!==end-start+1)throw new HttpError("Trecho do arquivo incompleto.",502);return b;
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
  let claims:any;try{claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));}catch{throw new HttpError("unauthorized",401);}
  if(claims.iss!==String(Deno.env.get("SUPABASE_URL"))+"/auth/v1"||!claims.session_id)throw new HttpError("unauthorized",401);
  const {data:active,error:sessionError}=await admin.rpc("cloudent_auth_session_active",{p_session_id:claims.session_id,p_user_id:data.user.id});
  if(sessionError||!active)throw new HttpError("unauthorized",401);
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
 const id=String(config?.platform_account_id||"");
 if(!/^[0-9a-f-]{36}$/i.test(id))throw new HttpError("platform_account_id_required",400);
 const {data:allowed,error:permissionError}=await admin.rpc("cloudent_x_access",{p_user:userId,p_account:id});
 if(permissionError)throw permissionError;if(!allowed)throw new HttpError("forbidden",403);
 const {data,error}=await admin.from("platform_accounts").select("*").eq("id",id).eq("platform","x").maybeSingle();
 if(error)throw error;if(!data)throw new HttpError("not_found",404);return data;
}
async function requireXMember(admin:any,userId:string){
 const {data,error}=await admin.from("app_members").select("role,enabled,workspace_id").eq("user_id",userId).maybeSingle();
 if(error)throw error;if(!data?.enabled||!["admin","x_user"].includes(data.role))throw new HttpError("forbidden",403);return data;
}
function safeAccount(a:any){return {id:a.id,label:a.account_label,username:a.config?.username||a.account_label,avatar_url:a.config?.profile_image_url||null,public_metrics:a.config?.public_metrics||null,enabled:a.enabled,status:a.config?.status||"disconnected",token_expires_at:a.config?.tokenExpiresAt||null};}
async function auditX(admin:any,member:any,userId:string,accountId:string|null,event:string,metadata:any={}){
 await admin.from("x_audit_log").insert({workspace_id:member.workspace_id,user_id:userId,platform_account_id:accountId,event_type:event,metadata});
}

async function usableXToken(admin:any,platform:any,master:string){
 if(isBufferAccount(platform))throw new HttpError("Esta conta publica exclusivamente pelo Buffer.",409);
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
  if(!r.ok||!d.access_token){await admin.from("platform_accounts").update({config:{...cfg,status:"reconnection_required"}}).eq("id",platform.id);throw new HttpError("x_reconnection_required",409);}
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
  const mime=String(file.drive_mime_type||"video/mp4");
  const photo=PHOTO_SIGNATURES.has(mime);
  if(!size)throw new HttpError("O tamanho do arquivo não está disponível.",400);
  if(size>(photo?MAX_PHOTO_BYTES:MAX_VIDEO_BYTES))throw new HttpError("O arquivo ultrapassa o limite de envio.",400);
  const init=await xJson("/2/media/upload/initialize",xToken,"POST",{media_type:mime,total_bytes:size,media_category:photo?"tweet_image":"tweet_video"});
  const mediaId=String(init?.data?.id||init?.data?.media_id||init?.media_id_string||init?.media_id||"");
  if(!mediaId)throw new HttpError("X não retornou media_id ao iniciar upload.",502,init);
  let segment=0;
  for(let start=0;start<size;start+=X_MEDIA_CHUNK){
    const end=Math.min(size-1,start+X_MEDIA_CHUNK-1);
    const blob=sourceUrl?await uploadRange(sourceUrl,start,end):await driveRange(driveToken,String(file.drive_file_id),start,end);
    const form=new FormData();form.append("segment_index",String(segment));form.append("media",blob,String(file.drive_file_name||"media"));
    const r=await fetch(`https://api.x.com/2/media/upload/${encodeURIComponent(mediaId)}/append`,{method:"POST",headers:{Authorization:"Bearer "+xToken},body:form});
    if(!r.ok){let d:any={};try{d=await r.json()}catch{};throw new HttpError(String(d?.detail||d?.title||`X media append ${r.status}`),r.status,d);}
    segment++;
  }
  let fin=await xJson(`/2/media/upload/${encodeURIComponent(mediaId)}/finalize`,xToken,"POST",{});
  let info=fin?.data?.processing_info||fin?.processing_info||null;
  for(let i=0;info&&i<20;i++){
    const state=String(info.state||"").toLowerCase();
    if(state==="succeeded")break;
    if(state==="failed")throw new HttpError(String(info?.error?.message||"X falhou ao processar o arquivo."),422,info);
    await sleep(Math.min(10,Math.max(1,Number(info.check_after_secs||2)))*1000);
    const st=await xJson(`/2/media/upload?media_id=${encodeURIComponent(mediaId)}&command=STATUS`,xToken,"GET");
    info=st?.data?.processing_info||st?.processing_info||null;
  }
  if(info&&String(info.state||"").toLowerCase()!=="succeeded")throw new HttpError("Tempo limite aguardando o X processar o arquivo.",504,info);
  return mediaId;
}

async function createTweet(xToken:string,text:string,mediaId:string){
  let r:Response;
  try{
    r=await fetch("https://api.x.com/2/tweets",{method:"POST",headers:{Authorization:"Bearer "+xToken,"Content-Type":"application/json"},body:JSON.stringify({...(text?{text}:{}),media:{media_ids:[mediaId]}})});
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

function bufferChannelFor(accountId:string):string{
 const raw=Deno.env.get("CLOUDENT_X_BUFFER_CHANNELS");
 if(!raw)return "";
 try{
  const channels=JSON.parse(raw);
  if(!channels||typeof channels!=="object"||Array.isArray(channels))throw new Error();
  if(!Object.hasOwn(channels,accountId))return "";
  const channel=channels[accountId];
  if(typeof channel!=="string"||!channel.trim())throw new Error();
  return channel.trim();
 }catch{throw new HttpError("Configuração dos canais do Buffer inválida.",503);}
}

async function bufferGraph(query:string,variables:Record<string,unknown>,write=false,key=Deno.env.get("CLOUDENT_X_BUFFER_API_KEY")){
 if(!key)throw new HttpError("Conecte o Buffer antes de publicar.",409);
 let response:Response;
 try{
  response=await fetch("https://api.buffer.com",{method:"POST",headers:{Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({query,variables}),signal:AbortSignal.timeout(8000)});
 }catch{throw new HttpError("Buffer indisponível. Confira o envio antes de repetir.",502,null,write);}
 if(!response.ok)throw new HttpError("Buffer retornou HTTP "+response.status+".",response.status,null,write&&response.status>=500);
 const result=await response.json().catch(()=>null);
 if(!result?.data||result.errors?.length)throw new HttpError("O Buffer não confirmou a operação.",502,null,write);
 return result.data;
}

function isBufferAccount(account:any){
 return account.config?.publish_provider==="buffer"||!!bufferChannelFor(account.id);
}

async function verifiedBufferChannel(channelId:string,username:string,key?:string){
 const {channel}=await bufferGraph("query Channel($id: ChannelId!) { channel(input:{id:$id}) { service serviceId name isDisconnected isLocked isQueuePaused } }",{id:channelId},false,key);
 const handle=username.replace(/^@/,"").toLowerCase();
 if(channel?.service!=="twitter"||!handle||String(channel.name||"").replace(/^@/,"").toLowerCase()!==handle||channel.isDisconnected||channel.isLocked||channel.isQueuePaused)throw new HttpError("O canal do Buffer está indisponível ou pertence a outra conta X.",409);
 return channel;
}

function submittedBufferKey(body:any){
 const key=String(body.api_key||"").trim();
 if(!key||key.length>1024||!/^[!-~]+$/.test(key))throw new HttpError("Informe uma chave válida do Buffer.",400);
 return key;
}

async function listBufferChannels(key:string){
 const {account}=await bufferGraph("query Organizations { account { organizations { id } } }",{},false,key);
 const organizations=Array.isArray(account?.organizations)?account.organizations.slice(0,5):[];
 const results=await Promise.all(organizations.map((org:any)=>bufferGraph(
  "query Channels($id: OrganizationId!) { channels(input:{organizationId:$id}) { id name service isDisconnected isLocked } }",{id:org.id},false,key)));
 return results.flatMap((result,index)=>(result.channels||[]).map(channel=>({...channel,organizationId:String(organizations[index].id)})))
  .filter(channel=>channel.service==="twitter"&&!channel.isDisconnected&&!channel.isLocked)
  .map(channel=>({id:String(channel.id),username:String(channel.name).replace(/^@/,""),organizationId:channel.organizationId}));
}

async function connectOwnBufferAccount(admin:any,userId:string,master:string,body:any){
 const key=submittedBufferKey(body);
 const channelId=String(body.channel_id||"");
 const username=String(body.username||"");
 if(!channelId||channelId.length>160||!/^\w{1,15}$/.test(username))throw new HttpError("Selecione uma conta X autorizada no Buffer.",400);
 const channel=await verifiedBufferChannel(channelId,username,key);
 if(!/^\d+$/.test(String(channel.serviceId)))throw new HttpError("O Buffer não confirmou o ID da conta X.",409);
 const encrypted=await encryptSecret(key,master);
 const {data,error}=await admin.rpc("x_buffer_connect_own_account",{p_owner:userId,p_username:username,p_x_user_id:String(channel.serviceId),p_channel_id:channelId,p_cipher:encrypted.cipher,p_iv:encrypted.iv});
 if(error)throw new HttpError("Não foi possível conectar esta conta. Confira se ela já pertence a outro usuário do Cloudent.",409);
 return {ok:true,account_id:data};
}

async function registerBufferAccount(admin:any,body:any){
 const id=String(body.account_id||"");
 const owner=String(body.owner_user_id||"");
 const username=String(body.username||"").replace(/^@/,"");
 if(!/^[0-9a-f-]{36}$/i.test(id)||!/^[0-9a-f-]{36}$/i.test(owner)||!/^\w{1,15}$/.test(username))throw new HttpError("Conta do Buffer inválida.",400);
 const channelId=bufferChannelFor(id);
 if(!channelId)throw new HttpError("Vincule o canal do Buffer antes de cadastrar.",409);
 const channel=await verifiedBufferChannel(channelId,username);
 if(!/^\d+$/.test(String(channel.serviceId)))throw new HttpError("O Buffer não confirmou o ID da conta X.",409);
 const {data,error}=await admin.rpc("x_buffer_register_account",{p_id:id,p_owner:owner,p_username:username,p_x_user_id:String(channel.serviceId)});
 if(error)throw error;
 return {ok:true,account_id:data,username};
}

function bufferReplyLink(text:string,postId:string,workerUrl:string){
 const links=twitterText.extractUrlsWithIndices(text);
 if(links.length!==1)return {text,target:null};
 const {url,indices:[start,end]}=links[0];
 let target:URL;
 try{target=new URL(url);}catch{return {text,target:null};}
 if(target.protocol!=="https:"||target.username||target.password||target.origin===new URL(workerUrl).origin)return {text,target:null};
 const tracked=new URL(workerUrl);
 tracked.searchParams.set("action","link");
 tracked.searchParams.set("id",postId);
 return {text:text.slice(0,start)+tracked.href+text.slice(end),target:target.href};
}

function bufferXPostId(url:unknown){
 return typeof url==="string"?url.match(/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/(?:[\w]+\/status|i\/web\/status)\/(\d+)(?:[/?#]|$)/i)?.[1]||"": "";
}

const BUFFER_VIDEO_TTL_SECONDS=6*60*60;

async function bufferVideoKey(master:string){
 return crypto.subtle.importKey("raw",enc.encode(master),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
}
function bufferVideoClaim(id:string,expires:number){
 return enc.encode("cloudent-buffer-video:"+id+":"+expires);
}
async function bufferVideoUrl(id:string,path:string,master:string){
 const expires=Math.floor(Date.now()/1000)+BUFFER_VIDEO_TTL_SECONDS;
 const signature=await crypto.subtle.sign("HMAC",await bufferVideoKey(master),bufferVideoClaim(id,expires));
 const token=Array.from(new Uint8Array(signature),b=>b.toString(16).padStart(2,"0")).join("");
 const suffix=path.split(".").pop();
 const url=new URL(Deno.env.get("SUPABASE_URL")+"/functions/v1/cloudent-x-publish-worker/buffer-video."+suffix);
 url.search=new URLSearchParams({action:"buffer-video",id,expires:String(expires),token}).toString();
 return url.href;
}

async function serveBufferVideo(admin:any,req:Request,url:URL,master:string){
 const method=req.method;
 if(method!=="HEAD"&&method!=="GET")return new Response(null,{status:405,headers:{Allow:"GET, HEAD"}});
 const id=url.searchParams.get("id")||"",token=url.searchParams.get("token")||"";
 const expires=Number(url.searchParams.get("expires"));
 if(!/^[0-9a-f-]{36}$/.test(id)||!Number.isSafeInteger(expires)||expires<=Date.now()/1000||!/^[0-9a-f]{64}$/.test(token))return new Response(null,{status:404});
 const signature=Uint8Array.from(token.match(/../g)!,part=>parseInt(part,16));
 if(!await crypto.subtle.verify("HMAC",await bufferVideoKey(master),signature,bufferVideoClaim(id,expires)))return new Response(null,{status:404});

 const {data:post,error}=await admin.from("x_drive_posts").select("user_id,meta").eq("id",id).maybeSingle();
 if(error)return new Response(null,{status:502});
 const path=String(post?.meta?.storage_path||"");
 const mime=post?uploadPathMime(post.user_id,path):"";
 if(post?.meta?.source!=="upload"||post.meta.storage_provider!=="r2"||!mime)return new Response(null,{status:404});
 const cfg=await getCloudentR2Config(admin);
 if(!cfg)return new Response(null,{status:502});
 const range=req.headers.get("range");
 if(range&&method==="GET"&&!/^bytes=(?:\d+-\d*|-\d+)$/.test(range))return new Response(null,{status:416});
 const source=await fetch(await r2PresignedUrl(cfg,method,path,60),{
  method,headers:range&&method==="GET"?{Range:range}:{},redirect:"error",signal:AbortSignal.timeout(60_000)
 });
 if(![200,206,416].includes(source.status)){
  await source.body?.cancel();
  return new Response(null,{status:source.status===404?404:502});
 }
 const headers=new Headers({
  "Content-Type":mime,
  "X-Content-Type-Options":"nosniff",
  "Accept-Ranges":"bytes",
  "Cache-Control":"private, no-store"
 });
 for(const name of ["content-length","content-range"]){
  const value=source.headers.get(name);
  if(value!==null)headers.set(name,value);
 }
 return new Response(method==="HEAD"?null:source.body,{status:source.status,headers});
}

const BUFFER_POST_FIELDS="id status externalLink sentAt error { message }";

async function sendBufferPost(admin:any,file:any,xAccount:any,channelId:string,workerId:string,meta:any,master:string,key?:string){
 const channel=await verifiedBufferChannel(channelId,String(xAccount.config?.username||xAccount.account_label||""),key);
 if(xAccount.external_account_id&&String(channel.serviceId)!==String(xAccount.external_account_id))throw new HttpError("O ID do canal do Buffer difere da conta cadastrada no X Studio.",409);
 const path=String(meta.storage_path||"");
 const mime=uploadPathMime(file.user_id,path);
 if(meta.source!=="upload"||meta.storage_provider!=="r2"||!mime)throw new HttpError("Para publicar via Buffer, envie o arquivo pelo X Studio para o armazenamento principal.",409);
 const text=captionValue(file.post_text,true);
 const url=await bufferVideoUrl(file.id,path,master);
 const assets=[PHOTO_SIGNATURES.has(mime)?{image:{url}}:{video:{url}}];
 const workerUrl=Deno.env.get("SUPABASE_URL")+"/functions/v1/cloudent-x-publish-worker";
 const reply=file.reply_text?bufferReplyLink(captionValue(file.reply_text),file.id,workerUrl):null;
 const thread=reply?[{text,assets},{text:captionValue(reply.text),assets:[]}]:null;
 const input={channelId,...(text||thread?{text}:{}),assets,schedulingType:"automatic",mode:"shareNow",...(thread?{metadata:{twitter:{thread}}}:{})};
 Object.assign(meta,{publish_provider:"buffer",publish_request_started:true,publish_started_at:new Date().toISOString(),buffer_click_target:reply?.target??null});
 const {data:marked,error:markError}=await admin.from("x_drive_posts").update({meta}).eq("id",file.id).eq("locked_by",workerId).eq("status","processing").select("id").maybeSingle();
 if(markError||!marked)throw markError||new Error("publication_claim_lost");
 const {createPost}=await bufferGraph("mutation Send($input: CreatePostInput!) { createPost(input:$input) { __typename ... on PostActionSuccess { post { "+BUFFER_POST_FIELDS+" } } ... on MutationError { message } } }",{input},true,key);
 if(!createPost?.post?.id){
  if(createPost?.__typename==="PostLimitReachedError")throw new HttpError("A fila grátis do Buffer está ocupada. O Cloudent vai tentar novamente.",429);
  if(createPost?.__typename&&createPost.__typename!=="PostActionSuccess"){
   const detail=String(createPost.message||createPost.__typename)
    .replace(/https?:\/\/[^\s<>"']+/gi,"[URL]")
    .replace(/[\u0000-\u001f\u007f]+/g," ").trim().slice(0,240);
   throw new HttpError("O Buffer recusou esta publicação: "+detail,409);
  }
  throw new HttpError("O Buffer não devolveu o identificador do envio.",502,null,true);
 }
 meta.buffer_post_id=String(createPost.post.id);
 const {data:saved,error:saveError}=await admin.from("x_drive_posts").update({meta}).eq("id",file.id).eq("locked_by",workerId).eq("status","processing").select("id").maybeSingle();
 if(saveError||!saved)throw new HttpError("O Buffer recebeu o envio, mas o Cloudent não salvou a confirmação.",502,null,true);
 return {id:file.id,state:"buffer_processing"};
}

async function pollBufferPost(admin:any,cfg:any,key?:string){
 const {data:file,error}=await admin.from("x_drive_posts").select("id,locked_by,post_text,reply_text,meta").eq("platform_account_id",cfg.platform_account_id).eq("status","processing").maybeSingle();
 if(error)throw error;
 if(!file)return null;
 if(!file.meta?.buffer_post_id)return {id:file.id,state:"processing"};
 const {post}=await bufferGraph("query Status($id: PostId!) { post(input:{id:$id}) { "+BUFFER_POST_FIELDS+" } }",{id:file.meta.buffer_post_id},false,key);
 if(post?.id!==file.meta.buffer_post_id)throw new HttpError("O Buffer não confirmou o identificador do envio.",502);
 const postId=bufferXPostId(post.externalLink);
 if(postId&&(post.status==="sent"||post.error)){
  const {error:completeError}=await admin.rpc("complete_x_upload_post",{p_id:file.id,p_worker_id:file.locked_by,p_account_id:cfg.platform_account_id,p_text:file.post_text,p_media_id:null,p_post_id:postId});
  if(completeError)throw completeError;
  if(file.reply_text){
   const {error:replyError}=await admin.from("x_drive_posts").update({reply_status:post.error?"uncertain":"published",reply_error:post.error?"O Buffer confirmou o post principal. Confira a resposta no X.":null}).eq("id",file.id).eq("x_post_id",postId);
   if(replyError)throw replyError;
  }
  return {id:file.id,state:"published",x_post_id:postId};
 }
 if(post.error||["error","failed"].includes(post.status)){
  const {error:failError}=await admin.from("x_drive_posts").update({status:"failed",locked_at:null,locked_by:null,last_error:"O Buffer informou uma falha. Confira a conta antes de reenviar.",meta:{...file.meta,publish_uncertain:true}}).eq("id",file.id).eq("locked_by",file.locked_by).eq("status","processing");
  if(failError)throw failError;
  return {id:file.id,state:"failed"};
 }
 return {id:file.id,state:"buffer_processing"};
}

async function followBufferLink(admin:any,req:Request,url:URL){
 const id=url.searchParams.get("id")||"";
 if(!["GET","HEAD"].includes(req.method)||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))return json({error:"not_found"},404);
 const agent=req.headers.get("user-agent")||"";
 const preview=/bot|crawler|spider|preview|facebookexternalhit|curl|wget/i.test(agent)||/prefetch/i.test((req.headers.get("purpose")||"")+" "+(req.headers.get("sec-purpose")||""));
 const {data:target,error}=await admin.rpc("x_buffer_follow_link",{p_post_id:id,p_count:req.method==="GET"&&!!agent&&!preview});
 if(error)return json({error:"link_unavailable"},503);
 if(typeof target!=="string"||!target.startsWith("https://"))return json({error:"not_found"},404);
 return new Response(null,{status:302,headers:{Location:target,"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
}

async function publishOne(admin:any,userId:string,config:any,master:string,workerId:string){
  const bufferConfig=config.platform_accounts?.config||{};
  const bufferChannel=String(bufferConfig.buffer_channel_id||bufferChannelFor(config.platform_account_id));
  const bufferKey=bufferConfig.buffer_key_cipher&&bufferConfig.buffer_key_iv
   ?await decryptSecret(bufferConfig.buffer_key_cipher,bufferConfig.buffer_key_iv,master):Deno.env.get("CLOUDENT_X_BUFFER_API_KEY");
  if(bufferChannel){
   if(!bufferKey)throw new HttpError("Conecte o Buffer antes de publicar.",409);
   const pending=await pollBufferPost(admin,config,bufferKey);
   if(pending)return pending;
  }
  const {data:file,error:claimErr}=await admin.rpc("claim_x_account_post",{p_account:config.platform_account_id,p_worker:workerId});
  if(claimErr)throw claimErr;if(!file)return null;
  const attempt=Number(file.attempts||1);
  let postAccepted=false;let publicationMeta={...(file.meta||{})};
  userId=String(file.user_id);
  try{
    const xAccount=await resolveXAccount(admin,userId,{platform_account_id:file.platform_account_id});
    if(!xAccount.enabled||xAccount.config?.status!=="connected")throw new HttpError("x_reconnection_required",409);
    if(bufferChannel)return await sendBufferPost(admin,file,xAccount,bufferChannel,workerId,publicationMeta,master,bufferKey);
    const text=captionValue(file.post_text,true);
    const xToken=await usableXToken(admin,xAccount,master);
    let sourceUrl="",driveToken="";
    if(file.meta?.source==="upload"){
      const path=String(file.meta.storage_path||"");
      if(!path.startsWith(userId+"/x-uploads/"))throw new HttpError("Caminho do arquivo inválido.",403);
      sourceUrl=await uploadReadUrl(admin,String(file.meta.storage_provider||"supabase"),path);
    }else{driveToken=(await usableGoogleToken(admin,userId,master)).token;}
    const mediaId=await uploadVideoX(driveToken,file,xToken,sourceUrl);
    publicationMeta={...publicationMeta,publish_request_started:true,publish_started_at:new Date().toISOString(),x_media_id:mediaId};
    const {data:marked,error:markErr}=await admin.from("x_drive_posts").update({meta:publicationMeta,updated_at:new Date().toISOString()}).eq("id",file.id).eq("locked_by",workerId).eq("status","processing").is("x_post_id",null).select("id").maybeSingle();
    if(markErr||!marked)throw markErr||new Error("publication_claim_lost");
    const tweetId=await createTweet(xToken,text,mediaId);postAccepted=true;
    const now=new Date().toISOString();
    const {error:completeErr}=await admin.rpc("complete_x_upload_post",{p_id:file.id,p_worker_id:workerId,p_account_id:xAccount.id,p_text:text,p_media_id:mediaId,p_post_id:tweetId});
    if(completeErr)throw completeErr;
    await admin.from("activity_logs").insert({level:"info",event_type:"x_drive_post_published",message:"Vídeo da fila publicado no X",meta:{user_id:userId,drive_file_id:file.drive_file_id,drive_file_name:file.drive_file_name,x_post_id:tweetId}});
    await publishReply(admin,{...file,x_post_id:tweetId,reply_status:file.reply_text?"pending":"none"},master);
    return {id:file.id,state:"published",x_post_id:tweetId,file:file.drive_file_name};
  }catch(e:any){
    const message=cleanError(e);const uncertain=postAccepted||Boolean(e?.uncertain);const final=uncertain||attempt>=Number(file.max_attempts||5)||[400,401,403,409,422].includes(Number(e?.status||0));
    if(bufferChannel&&!uncertain)publicationMeta.publish_request_started=false;
    const next=new Date(Date.now()+backoff(attempt)*60_000).toISOString();
    await admin.from("x_drive_posts").update({status:final?"failed":"queued",next_attempt_at:final?file.next_attempt_at:next,locked_at:null,locked_by:null,last_error:message,meta:{...publicationMeta,publish_uncertain:uncertain,http_status:Number(e?.status||0)},updated_at:new Date().toISOString()}).eq("id",file.id).eq("locked_by",workerId).eq("status","processing");
    await admin.from("x_account_configs").update({last_worker_at:new Date().toISOString(),last_error:message,updated_at:new Date().toISOString()}).eq("platform_account_id",file.platform_account_id);
    await admin.from("activity_logs").insert({level:"error",event_type:"x_drive_post_error",message,meta:{user_id:userId,drive_file_id:file.drive_file_id,drive_file_name:file.drive_file_name,attempt,publish_uncertain:uncertain,http_status:Number(e?.status||0)}});
    return {id:file.id,state:final?"failed":"retry",error:message,uncertain};
  }
}

async function canUseXDashboard(admin:any,userId:string,member:any){
 if(member.role!=="x_user")return false;
 const {data,error}=await admin.from("app_settings").select("value").eq("key","x_studio_private_dashboard").maybeSingle();
 return !error&&data?.value?.user_id===userId;
}

function xDashboardMetric(metrics:any[],type:string){
 const value=metrics.find(m=>m?.type===type&&m.unit==="count")?.value;
 return typeof value==="number"&&Number.isFinite(value)&&value>=0?value:null;
}

async function xDashboardPayload(admin:any,userId:string,member:any,master:string){
 const [{data:accounts,error},{data:grants,error:grantError}]=await Promise.all([
  admin.from("platform_accounts").select("id,account_label,config").eq("platform","x").eq("workspace_id",member.workspace_id).eq("owner_user_id",userId).eq("enabled",true).order("created_at"),
  admin.from("x_account_access").select("platform_account_id").eq("workspace_id",member.workspace_id).eq("user_id",userId)
 ]);
 if(error||grantError)throw error||grantError;
 const visibleIds=new Set((grants||[]).map(g=>g.platform_account_id));
 const channelLists=new Map<string,ReturnType<typeof listBufferChannels>>();
 const end=new Date(),start=new Date(end.getTime()-30*86400000);
 const rows=await Promise.all((accounts||[]).filter(a=>visibleIds.has(a.id)).map(async a=>{
  const username=String(a.config?.username||a.account_label||"").replace(/^@/,"");
  const row={id:a.id,username,views:null as number|null,impressions:null as number|null,updated_at:null as string|null,message:"Métricas indisponíveis para esta conexão."};
  const cfg=a.config||{},channelId=String(cfg.buffer_channel_id||"");
  if(!channelId||!cfg.buffer_key_cipher||!cfg.buffer_key_iv)return row;
  try{
   const key=await decryptSecret(cfg.buffer_key_cipher,cfg.buffer_key_iv,master);
   if(!channelLists.has(key))channelLists.set(key,listBufferChannels(key));
   const channel=(await channelLists.get(key)!).find(c=>c.id===channelId);
   if(!channel||channel.username.toLowerCase()!==username.toLowerCase())return row;
   const input={organizationId:channel.organizationId,channelIds:[channelId],startDateTime:start.toISOString(),endDateTime:end.toISOString()};
   const {aggregatedPostMetrics}=await bufferGraph("query XDashboard($input: AggregatedPostMetricsInput!) { aggregatedPostMetrics(input:$input) { metrics { type value unit } metricsUpdatedAt } }",{input},false,key);
   const metrics=Array.isArray(aggregatedPostMetrics?.metrics)?aggregatedPostMetrics.metrics:[];
   const views=xDashboardMetric(metrics,"views"),impressions=xDashboardMetric(metrics,"impressions");
   return {...row,views,impressions,updated_at:aggregatedPostMetrics?.metricsUpdatedAt??null,message:views===null&&impressions===null?"O Buffer ainda não retornou dados para esta conta.":""};
  }catch{
   return {...row,message:"Não foi possível consultar o Buffer. Confira a permissão de leitura de métricas da chave (insightsRead)."};
  }
 }));
 return {ok:true,accounts:rows};
}

async function statusPayload(admin:any,userId:string,master:string,url:URL){
 const member=await requireXMember(admin,userId);
 const {data:all,error}=await admin.from("platform_accounts").select("id,account_label,enabled,config,workspace_id,owner_user_id,external_account_id").eq("platform","x").eq("workspace_id",member.workspace_id).order("created_at");if(error)throw error;
 const {data:grants,error:ge}=await admin.from("x_account_access").select("platform_account_id").eq("user_id",userId).eq("workspace_id",member.workspace_id);if(ge)throw ge;
 const accounts=(all||[]).filter((a:any)=>member.role==="admin"||(grants||[]).some((g:any)=>g.platform_account_id===a.id));
 const selected=url.searchParams.get("platform_account_id")||"";
 if(selected&&selected!=="all"&&!accounts.some((a:any)=>a.id===selected))throw new HttpError("forbidden",403);
 // No implicit account selection. An empty selection only returns account metadata.
 const ids=selected==="all"?accounts.map((a:any)=>a.id):selected?[selected]:[];
 const active=accounts.find((a:any)=>a.id===selected);
 const from=new Date(url.searchParams.get("from")||Date.now()-7*86400000),to=new Date(url.searchParams.get("to")||Date.now()+35*86400000);
 if(!Number.isFinite(from.getTime())||!Number.isFinite(to.getTime())||to<=from||to.getTime()-from.getTime()>43*86400000)throw new HttpError("invalid_period",400);
 const [postResult,configResult,captionResult]=await Promise.all([
  ids.length?admin.from("x_drive_posts").select("id,user_id,platform_account_id,drive_file_name,drive_mime_type,drive_size_bytes,status,post_text,scheduled_at,x_post_id,attempts,max_attempts,last_error,published_at,meta,created_at,reply_text,reply_status,external_reply_id,reply_error,metrics,metrics_synced_at").eq("workspace_id",member.workspace_id).in("platform_account_id",ids).order("created_at",{ascending:false}).limit(500):null,
  active?admin.from("x_account_configs").select("*").eq("platform_account_id",active.id).maybeSingle():null,
  active?admin.from("x_caption_queue").select("id,caption,status,created_at").eq("platform_account_id",active.id).eq("user_id",userId).eq("workspace_id",member.workspace_id).in("status",["pending","reserved"]).order("created_at").limit(100):null
 ]);
 for(const result of [postResult,configResult,captionResult])if(result?.error)throw result.error;
 const posts:any[]=postResult?.data||[],captions:any[]=captionResult?.data||[];
 const cfg=configResult?.data||{enabled:false,interval_minutes:120,daily_slots:["12:00","18:00"]};
 const previewPaths=posts.map(p=>{
  const path=String(p.meta?.storage_path||"");
  if(p.meta?.source!=="upload"||p.meta?.storage_provider!=="r2"||!path.startsWith(p.user_id+"/x-uploads/"))return "";
  if(PHOTO_SIGNATURES.has(p.drive_mime_type)&&p.status!=="skipped")return path;
  return p.meta?.thumbnail_path===path+".jpg"?p.meta.thumbnail_path:"";
 });
 const thumbConfig=previewPaths.some(Boolean)?await getCloudentR2Config(admin):null;
 if(thumbConfig){
  const urls=new Map<string,Promise<string>>();
  await Promise.all(posts.map(async(p,i)=>{
   const path=previewPaths[i];if(!path)return;
   if(!urls.has(path))urls.set(path,r2PresignedUrl(thumbConfig,"GET",path,3600));
   p.thumbnail_url=await urls.get(path);
  }));
 }
 const calendar=posts.filter(p=>p.scheduled_at&&new Date(p.scheduled_at)>=from&&new Date(p.scheduled_at)<to&&p.status!=="skipped");
 const counts:any={total:posts.length};for(const st of ["queued","processing","published","failed"])counts[st]=posts.filter(p=>p.status===st).length;
 counts.interval_queued=posts.filter(p=>p.status==="queued"&&!p.scheduled_at).length;
 const next=posts.filter(p=>p.status==="queued"&&p.scheduled_at).map(p=>p.scheduled_at).sort()[0]||null;
 const visibleAccounts=accounts.map((a:any)=>{
  const buffer=isBufferAccount(a);
  const tracked=posts.filter(p=>p.platform_account_id===a.id&&p.meta?.buffer_click_target&&p.published_at&&Date.parse(p.published_at)>=Date.now()-30*86400000);
  return {...safeAccount(a),publish_provider:buffer?"buffer":"x",clicks:tracked.length?tracked.reduce((sum,p)=>sum+Number(p.meta.buffer_link_clicks||0),0):null};
 });
 return {ok:true,accounts:visibleAccounts,x:{account:visibleAccounts.find((a:any)=>a.id===selected)||null,connected:Boolean(active?.enabled)},config:cfg,captions,counts,posts,calendar_posts:calendar,next_scheduled_at:next,aggregate:selected==="all",truncated:posts.length===500};
}

function metricError(e:any){
 const status=Number(e?.status||0);
 if(status===429)return 'O X limitou as consultas. Aguarde antes de sincronizar novamente.';
 if(status===401)return 'Reconecte esta conta X para renovar a autorização.';
 if(status===402||status===403)return 'A API do X não autorizou a leitura de métricas. Confira as permissões e o acesso do aplicativo no X.';
 return cleanError(e);
}
async function syncAccountMetrics(admin:any,account:any,master:string){
 if(isBufferAccount(account))return {ok:true,user_message:"Cliques atualizados no Cloudent. As visualizações estão disponíveis no X."};
 const {data:config,error:ce}=await admin.from('x_account_configs').select('last_metrics_at,metrics_snapshot').eq('platform_account_id',account.id).maybeSingle();if(ce)throw ce;
 if(config?.last_metrics_at&&Date.now()-Date.parse(config.last_metrics_at)<60000)return {ok:true,cached:true,updated:0};
 const at=new Date().toISOString();
 await admin.from('x_account_configs').update({last_metrics_at:at}).eq('platform_account_id',account.id);
 try{
  const token=await usableXToken(admin,account,master);
  const profile=await xJson('/2/users/'+encodeURIComponent(account.external_account_id)+'?user.fields=public_metrics',token);
  if(String(profile.data?.id)!==String(account.external_account_id))throw new HttpError('metrics_account_mismatch',403);
  const snapshot:any={account:profile.data.public_metrics||{},synced_at:at,recent_posts:[],posts_error:null};
  try{
   const result=await xJson('/2/users/'+encodeURIComponent(account.external_account_id)+'/tweets?max_results=20&exclude=retweets,replies&tweet.fields=public_metrics,created_at,author_id,attachments&expansions=attachments.media_keys&media.fields=public_metrics',token);
   if(result.errors?.length&&!result.data?.length)throw new HttpError("A API do X não retornou métricas dos posts.",403);
   const media=new Map((result.includes?.media||[]).map((m:any)=>[m.media_key,m.public_metrics||{}]));
   for(const post of result.data||[]){
    if(String(post.author_id)!==String(account.external_account_id))continue;
    const metrics:any={...(post.public_metrics||{})};
    let views=0,hasViews=false;for(const key of post.attachments?.media_keys||[]){const m:any=media.get(key);if(typeof m?.view_count==='number'){views+=m.view_count;hasViews=true;}}
    if(hasViews)metrics.view_count=views;
    snapshot.recent_posts.push({id:String(post.id),created_at:post.created_at,metrics});
    const {error}=await admin.from('x_drive_posts').update({metrics,metrics_synced_at:at}).eq('platform_account_id',account.id).eq('x_post_id',String(post.id));if(error)throw error;
   }
  }catch(e){snapshot.posts_error=metricError(e);}
  const {error}=await admin.from('x_account_configs').update({metrics_snapshot:snapshot,metrics_error:snapshot.posts_error,last_metrics_at:at}).eq('platform_account_id',account.id);if(error)throw error;
  return {ok:true,updated:snapshot.recent_posts.length,partial:!!snapshot.posts_error,user_message:snapshot.posts_error};
 }catch(e){const message=metricError(e);await admin.from('x_account_configs').update({metrics_error:message}).eq('platform_account_id',account.id);throw new HttpError(message,Number((e as any)?.status)||502);}
}

async function publishReply(admin:any,file:any,master:string){
 if(!file.reply_text||!file.x_post_id||file.external_reply_id||file.reply_status!=="pending")return;
 if(file.meta?.publish_provider==="buffer"||bufferChannelFor(file.platform_account_id))return;
 const {data:claimed,error}=await admin.from("x_drive_posts").update({reply_status:"processing",reply_started_at:new Date().toISOString(),reply_attempts:(file.reply_attempts||0)+1}).eq("id",file.id).eq("reply_status","pending").is("external_reply_id",null).select("id").maybeSingle();
 if(error||!claimed)return;
 let sent=false;
 try{
  const account=await resolveXAccount(admin,file.user_id,{platform_account_id:file.platform_account_id});if(!account.enabled)throw new HttpError("x_disconnected",409);
  const token=await usableXToken(admin,account,master);sent=true;
  const reply=await xJson("/2/tweets",token,"POST",{text:captionValue(file.reply_text),reply:{in_reply_to_tweet_id:file.x_post_id}});
  if(!reply?.data?.id)throw new Error("reply_response_uncertain");
  const {error:saveError}=await admin.from("x_drive_posts").update({reply_status:"published",external_reply_id:String(reply.data.id),reply_error:null}).eq("id",file.id);if(saveError)throw saveError;
 }catch(e:any){await admin.from("x_drive_posts").update({reply_status:sent&&(!e.status||e.status>=500)?"uncertain":"failed",reply_error:cleanError(e)}).eq("id",file.id);}
}

// A lost POST response is never retried blindly. Only a matching uploaded media ID
// in this exact account timeline can resolve an uncertain publication automatically.
async function reconcileUncertain(admin:any,cfg:any,master:string){
 const {data:rows,error}=await admin.from("x_drive_posts").select("*").eq("platform_account_id",cfg.platform_account_id).eq("status","failed").is("x_post_id",null).limit(100);if(error)throw error;
 const uncertain=(rows||[]).filter((p:any)=>p.meta?.publish_uncertain&&p.meta?.x_media_id&&p.meta?.publish_started_at);if(!uncertain.length)return;
 const account=await resolveXAccount(admin,cfg.user_id,{platform_account_id:cfg.platform_account_id});
 if(!account.enabled||!account.external_account_id)return;
 const token=await usableXToken(admin,account,master);
 const start=new Date(Math.max(Date.now()-7*86400000,Math.min(...uncertain.map((p:any)=>new Date(p.meta.publish_started_at).getTime()))-60000)).toISOString();
 let pagination="";
 for(let page=0;page<5;page++){
  const query=new URLSearchParams({max_results:"100",exclude:"retweets,replies",start_time:start,"tweet.fields":"created_at,attachments","expansions":"attachments.media_keys","media.fields":"media_key"});if(pagination)query.set("pagination_token",pagination);
  const timeline=await xJson("/2/users/"+encodeURIComponent(account.external_account_id)+"/tweets?"+query,token);
  for(const post of uncertain){const match=(timeline.data||[]).find((t:any)=>(t.attachments?.media_keys||[]).some((key:string)=>key.split('_').pop()===String(post.meta.x_media_id)));if(!match)continue;
   const {error:save}=await admin.from("x_drive_posts").update({status:"published",x_post_id:String(match.id),x_media_id:String(post.meta.x_media_id),published_at:match.created_at||new Date().toISOString(),last_error:null,locked_at:null,locked_by:null,reply_status:post.reply_text?"pending":"none",meta:{...post.meta,publish_uncertain:false,reconciled_at:new Date().toISOString()}}).eq("id",post.id).eq("status","failed").is("x_post_id",null);if(save)throw save;
  }
  pagination=String(timeline.meta?.next_token||"");if(!pagination)break;
 }
}

async function runWorker(admin:any,master:string){
  const workerId="xdrive-"+crypto.randomUUID();const now=new Date().toISOString();
  await admin.rpc("release_stale_x_drive_posts");
  await admin.from("worker_runtime").upsert({worker_name:"x_drive_publisher",last_heartbeat:now,updated_at:now},{onConflict:"worker_name"});
  const {data:configs,error}=await admin.from("x_account_configs").select("*,platform_accounts(config)").eq("enabled",true).order("last_worker_at",{ascending:true,nullsFirst:true}).limit(7);if(error)throw error;
  const results:any[]=[];
  for(const cfg of configs||[]){
    const userId=String(cfg.user_id);
    try{
      const buffer=cfg.platform_accounts?.config?.publish_provider==="buffer"||!!bufferChannelFor(cfg.platform_account_id);
      if(!buffer)try{await reconcileUncertain(admin,cfg,master);}catch(e){await admin.from("x_account_configs").update({last_error:"Reconciliação pendente: "+cleanError(e)}).eq("platform_account_id",cfg.platform_account_id);}
      const sync={files:0};
      // The atomic claim checks both calendar due dates and the FIFO interval.
      let pub:any=await publishOne(admin,userId,cfg,master,workerId);
      if(!buffer&&(!cfg.last_metrics_at||Date.now()-new Date(cfg.last_metrics_at).getTime()>6*3600000)){
        try{const account=await resolveXAccount(admin,userId,{platform_account_id:cfg.platform_account_id});await syncAccountMetrics(admin,account,master);await admin.from("x_account_configs").update({last_metrics_at:new Date().toISOString()}).eq("platform_account_id",cfg.platform_account_id);}catch(e){await admin.from("x_account_configs").update({metrics_error:cleanError(e),last_metrics_at:new Date().toISOString()}).eq("platform_account_id",cfg.platform_account_id);}
      }
      await admin.from("x_account_configs").update({last_worker_at:new Date().toISOString()}).eq("platform_account_id",cfg.platform_account_id);
      results.push({user_id:userId,platform_account_id:cfg.platform_account_id,synced:sync.files,publish:pub||"not_due"});
    }catch(e){
      const message=cleanError(e);await admin.from("x_account_configs").update({last_worker_at:new Date().toISOString(),last_error:message,updated_at:new Date().toISOString()}).eq("platform_account_id",cfg.platform_account_id);
      results.push({user_id:userId,error:message});
    }
  }
  await admin.from("x_drive_posts").update({reply_status:"uncertain",reply_error:"Resposta interrompida. Confira o comentário no X antes de repetir."}).eq("reply_status","processing").lt("reply_started_at",new Date(Date.now()-15*60000).toISOString());
  const {data:replies}=await admin.from("x_drive_posts").select("*").eq("status","published").eq("reply_status","pending").limit(20);
  for(const reply of replies||[])await publishReply(admin,reply,master);
  await admin.from("worker_runtime").upsert({worker_name:"x_drive_publisher",last_heartbeat:new Date().toISOString(),last_success_at:new Date().toISOString(),last_error:null,last_jobs:results.length,updated_at:new Date().toISOString()},{onConflict:"worker_name"});
  return {ok:true,worker:"x_drive_publisher",users:results.length,results};
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:CORS});
  const supabaseUrl=Deno.env.get("SUPABASE_URL")!;const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const url=new URL(req.url);const action=String(url.searchParams.get("action")||"status");
  try{
    if(action==="link")return await followBufferLink(admin,req,url);
    const master=await masterSecret(admin);
    if(action==="buffer-video")return await serveBufferVideo(admin,req,url,master);
    if(action==="worker"||action==="buffer-register"){
      const supplied=String(req.headers.get("x-cloudent-worker-secret")||"");
      if(!supplied||supplied!==master)return json({ok:false,error:"unauthorized"},401);
      if(action==="buffer-register"){
        if(req.method!=="POST")return json({error:"method_not_allowed"},405);
        return json(await registerBufferAccount(admin,await parseBody(req)));
      }
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

    const user=await requireUser(admin,req);let userId=String(user.id);
    const member=await requireXMember(admin,userId);
    const {data:rateOk,error:rateError}=await admin.rpc("cloudent_rate_limit",{p_user:userId,p_bucket:action==="dashboard"?"x-dashboard":action==="status"?"x-read":"x-write",p_limit:action==="dashboard"?4:action==="status"?120:100});if(rateError)throw rateError;if(!rateOk)return json({error:"rate_limit"},429);
    if(action==="status")return json({...await statusPayload(admin,userId,master,url),dashboard_access:await canUseXDashboard(admin,userId,member)});
    if(action==="dashboard"){
      if(req.method!=="GET")return json({error:"method_not_allowed"},405);
      if(!await canUseXDashboard(admin,userId,member))return json({error:"forbidden"},403);
      return json(await xDashboardPayload(admin,userId,member,master));
    }
    if(req.method!=="POST")return json({error:"method_not_allowed"},405);
    const body=await parseBody(req);
    if(member.role!=="admin"&&["google-configure","google-start","google-folder","sync"].includes(action))return json({error:"forbidden"},403);
    if(action==="buffer-channels"||action==="buffer-connect"){
      const {data:allowed,error}=await admin.rpc("cloudent_rate_limit",{p_user:userId,p_bucket:"x-buffer-connect",p_limit:20});
      if(error)throw error;
      if(!allowed)return json({error:"rate_limit"},429);
      if(action==="buffer-channels")return json({ok:true,channels:(await listBufferChannels(submittedBufferKey(body))).map(({id,username})=>({id,username}))});
      return json(await connectOwnBufferAccount(admin,userId,master,body));
    }
    if(action==="audit-session"){await auditX(admin,member,userId,null,body.event==="logout"?"logout":"login");return json({ok:true});}
    if(action==="account-status"||action==="account-remove"){
      const account=await resolveXAccount(admin,userId,body);
      if(member.role!=="admin"&&(!isBufferAccount(account)||account.owner_user_id!==userId))return json({error:"forbidden"},403);
      const cfg={...account.config,status:action==="account-remove"?"removed":"disconnected"};
      for(const k of ["accessTokenCipher","accessTokenIv","refreshTokenCipher","refreshTokenIv"])delete cfg[k];
      for(const k of ["buffer_key_cipher","buffer_key_iv"])delete cfg[k];
      const {error}=await admin.from("platform_accounts").update({enabled:false,config:cfg,updated_at:new Date().toISOString()}).eq("id",account.id);if(error)throw error;
      await admin.from("x_account_configs").update({enabled:false}).eq("platform_account_id",account.id);
      await auditX(admin,member,userId,account.id,action==="account-remove"?"account_removed":"account_disconnected");return json({ok:true});
    }
    if(action==="caption-add"||action==="caption-remove"){
      const account=await resolveXAccount(admin,userId,body);
      if(action==="caption-add"){
        const caption=captionValue(body.caption);
        const {count,error:countError}=await admin.from("x_caption_queue").select("id",{count:"exact",head:true}).eq("user_id",userId).eq("platform_account_id",account.id).in("status",["pending","reserved"]);if(countError)throw countError;
        if((count||0)>=500)return json({error:"Limite de 500 legendas pendentes por conta."},409);
        const {data,error}=await admin.from("x_caption_queue").insert({user_id:userId,workspace_id:member.workspace_id,platform_account_id:account.id,caption}).select("id,caption,status,created_at").single();if(error)throw error;
        return json({ok:true,caption:data});
      }else{
        const {data,error}=await admin.from("x_caption_queue").update({status:"removed"}).eq("id",body.id).eq("user_id",userId).eq("platform_account_id",account.id).eq("status","pending").select("id").maybeSingle();if(error)throw error;if(!data)return json({error:"Legenda já reservada ou indisponível."},409);
      }
      return json({ok:true});
    }
    if(action==="metrics"){
      const account=await resolveXAccount(admin,userId,body);
      return json(await syncAccountMetrics(admin,account,master));
    }
    if(action==="health"){
      const account=await resolveXAccount(admin,userId,body);
      const [{data:runtime},{data:config},{data:last}]=await Promise.all([
       admin.from("worker_runtime").select("last_heartbeat,last_error").eq("worker_name","x_drive_publisher").maybeSingle(),
       admin.from("x_account_configs").select("last_worker_at,last_error,enabled").eq("platform_account_id",account.id).maybeSingle(),
       admin.from("x_drive_posts").select("published_at").eq("platform_account_id",account.id).eq("status","published").order("published_at",{ascending:false}).limit(1)]);
      return json({account:safeAccount(account),worker:runtime||null,queue:config||null,last_publication:last?.[0]?.published_at||null,supabase:"reachable",storage:"not_probed",vercel:"not_probed",x_api:"not_probed"});
    }
    // Existing post mutations must match the selected account as well as ownership.
    if(["preview","schedule","edit-caption","skip","retry","retry-reply","duplicate"].includes(action)){
      const account=await resolveXAccount(admin,userId,body);
      const {data:post,error}=await admin.from("x_drive_posts").select("id,user_id,platform_account_id,x_post_id,reply_status").eq("id",String(body.id||"")).eq("platform_account_id",account.id).maybeSingle();if(error)throw error;if(!post)return json({error:"not_found"},404);
      if(post.user_id!==userId&&member.role!=="admin")return json({error:"forbidden"},403);
      if(action==="retry-reply"){
        if(isBufferAccount(account))return json({error:"A resposta pelo Buffer acompanha a publicação original."},409);
        const {data:changed,error}=await admin.from("x_drive_posts").update({reply_status:"pending",reply_error:null}).eq("id",post.id).eq("reply_status","failed").is("external_reply_id",null).select("id").maybeSingle();if(error)throw error;if(!changed)return json({error:"reply_not_retryable"},409);return json({ok:true});
      }
      await auditX(admin,member,userId,account.id,action,{job_id:post.id});
      userId=String(post.user_id);
    }


    if(action==="duplicate"){
      const account=await resolveXAccount(admin,String(user.id),body);
      const {data:p,error}=await admin.from("x_drive_posts").select("*").eq("id",String(body.id||"")).eq("platform_account_id",account.id).maybeSingle();if(error)throw error;if(!p)return json({error:"not_found"},404);
      const scheduled=scheduleValue(body.scheduled_at);
      const {data:copy,error:ce}=await admin.from("x_drive_posts").insert({user_id:p.user_id,workspace_id:member.workspace_id,platform_account_id:p.platform_account_id,drive_file_id:"copy:"+crypto.randomUUID(),drive_file_name:p.drive_file_name,drive_mime_type:p.drive_mime_type,drive_size_bytes:p.drive_size_bytes,post_text:captionValue(body.caption??p.post_text,true),reply_text:body.reply_text===undefined?p.reply_text:String(body.reply_text||"").trim()||null,scheduled_at:scheduled,next_attempt_at:scheduled||new Date().toISOString(),status:"queued",meta:{source:p.meta?.source,storage_provider:p.meta?.storage_provider,storage_path:p.meta?.storage_path,thumbnail_path:p.meta?.thumbnail_path,allow_empty_caption:body.caption===undefined?p.meta?.allow_empty_caption===true:!String(body.caption||"").trim()}}).select("id").single();if(ce){if(ce.code==="23505")return json({error:"slot_taken"},409);throw ce;}return json({ok:true,id:copy.id});
    }
    if(action==="google-configure"){
      if(member.role!=="admin")return json({error:"forbidden"},403);
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
      if(member.role!=="admin")return json({error:"forbidden"},403);
      const conn=await validateFolder(admin,userId,String(body.folder||body.folder_url||body.folder_id||""),master);const sync=await syncFolder(admin,userId,master);return json({ok:true,folder:{id:conn.folder_id,name:conn.folder_name,url:conn.folder_web_url},sync});
    }
    if(action==="sync")return json({error:"drive_import_requires_account_migration"},409);

    if(action==="preview"){
      const {data:p,error}=await admin.from("x_drive_posts").select("meta").eq("id",String(body.id||"")).eq("user_id",userId).maybeSingle();
      if(error)throw error;if(!p)return json({error:"not_found"},404);
      const path=String(p.meta?.storage_path||"");
      if(p.meta?.source!=="upload"||!path.startsWith(userId+"/x-uploads/"))return json({error:"preview_unavailable",user_message:"Prévia indisponível para este arquivo."},409);
      return json({ok:true,url:await uploadReadUrl(admin,String(p.meta.storage_provider||"supabase"),path)});
    }
    if(action==="schedule"){
      const scheduled=scheduleValue(body.scheduled_at);if(!scheduled)return json({error:"missing_schedule"},400);
      const caption=body.caption===undefined?undefined:captionValue(body.caption,true);if(body.reply_text)captionValue(body.reply_text);
      const {data:p,error:pe}=await admin.from("x_drive_posts").select("meta").eq("id",String(body.id||"")).eq("user_id",userId).maybeSingle();
      if(pe)throw pe;if(!p)return json({error:"not_found"},404);
      if(p.meta?.publish_uncertain)return json({error:"publish_uncertain",user_message:"Confira a publicação na conta X antes de reagendar."},409);
      const {data,error}=await admin.from("x_drive_posts").update({scheduled_at:scheduled,...(caption===undefined?{}:{post_text:caption,meta:{...p.meta,allow_empty_caption:!caption}}),...(body.reply_text===undefined?{}:{reply_text:String(body.reply_text||"").trim()||null}),next_attempt_at:scheduled,updated_at:new Date().toISOString()}).eq("id",String(body.id||"")).eq("user_id",userId).in("status",["queued","failed"]).select("id").maybeSingle();
      if(error){if(error.code==="23505")return json({error:"slot_taken",user_message:"Já existe uma publicação nesse horário. Escolha outra vaga."},409);throw error;}
      if(!data)return json({error:"post_locked",user_message:"Essa postagem já está sendo enviada ou foi finalizada."},409);
      return json({ok:true});
    }
    if(action==="upload-ticket"){
      const account=await resolveXAccount(admin,userId,body);if(!account.enabled)return json({error:"x_disconnected"},409);
      if(req.method!=="POST")return json({error:"method_not_allowed"},405);
      const size=Number(body.size_bytes),mime=String(body.mime_type||"video/mp4");
      const extension=uploadExtension(mime,size),photo=PHOTO_SIGNATURES.has(mime);
      const path=userId+"/x-uploads/"+crypto.randomUUID()+"."+extension;
      const cfg=await getCloudentR2Config(admin);
      if(cfg){
        const ticket={ok:true,provider:"r2",object_path:path,upload_url:await r2PresignedUrl(cfg,"PUT",path,900,mime),content_type:mime};
        if(photo)return json(ticket);
        const thumbnail_path=path+".jpg";
        return json({...ticket,thumbnail:{object_path:thumbnail_path,upload_url:await r2PresignedUrl(cfg,"PUT",thumbnail_path,900,"image/jpeg"),content_type:"image/jpeg"}});
      }
      if(photo)throw new HttpError("O armazenamento de fotos está indisponível. Tente novamente mais tarde.",503);
      const {data,error}=await admin.storage.from("videos").createSignedUploadUrl(path);if(error)throw error;
      return json({ok:true,provider:"supabase",object_path:path,upload_url:data.signedUrl,content_type:mime});
    }
    if(action==="upload-complete"){
      const path=String(body.object_path||""),provider=String(body.provider||"");
      const size=Number(body.size_bytes),mime=String(body.mime_type||"video/mp4");
      if(uploadPathMime(userId,path)!==mime||!["r2","supabase"].includes(provider))return json({error:"invalid_upload_path"},403);
      const signature=PHOTO_SIGNATURES.get(mime);
      if(signature&&provider!=="r2")return json({error:"invalid_upload_path"},403);
      let thumbnail_path=null;
      if(body.thumbnail_path){
        if(signature||String(body.thumbnail_path)!==path+".jpg"||provider!=="r2")return json({error:"invalid_thumbnail_path"},403);
        if(await uploadedThumbnailMatches(await uploadReadUrl(admin,provider,String(body.thumbnail_path))))thumbnail_path=String(body.thumbnail_path);
      }
      const extension=uploadExtension(mime,size);
      const scheduled=body.gallery===true?null:scheduleValue(body.scheduled_at);
      const gallery=body.gallery===true;
      const text=captionValue(body.caption,true);
      const source=await uploadReadUrl(admin,provider,path);
      const complete=signature?await uploadedPhotoMatches(source,size,signature):await uploadedVideoMatches(source,size);
      if(!complete)return json({error:"upload_incomplete",user_message:signature?"A foto enviada não corresponde ao formato ou tamanho informado.":"O upload do vídeo não foi concluído. Tente novamente."},409);
      const ids=Array.isArray(body.platform_account_ids)?[...new Set(body.platform_account_ids.map(String))]:[String(body.platform_account_id||"")];
      if(!ids.length||ids.length>100)return json({error:"invalid_accounts"},400);
      const accounts=[];for(const id of ids){const a=await resolveXAccount(admin,userId,{platform_account_id:id});if(!a.enabled)throw new HttpError("x_disconnected",409);accounts.push(a);}
      const reply=String(body.reply_text||"").trim();if(reply)captionValue(reply);
      const rows=accounts.map(a=>({user_id:userId,workspace_id:member.workspace_id,platform_account_id:a.id,drive_file_id:"upload:"+path,drive_file_name:String(body.file_name||"arquivo."+extension).slice(0,255),drive_mime_type:mime,drive_size_bytes:size,status:"queued",post_text:text,reply_text:reply||null,scheduled_at:scheduled,next_attempt_at:scheduled||new Date().toISOString(),meta:{source:"upload",storage_provider:provider,storage_path:path,thumbnail_path,gallery,allow_empty_caption:!gallery&&!text}}));
      const {data,error}=await admin.from("x_drive_posts").upsert(rows,{onConflict:"user_id,drive_file_id,platform_account_id",ignoreDuplicates:true}).select("id,platform_account_id");
      if(error){if(error.code==="23505")return json({error:"slot_taken",user_message:"Horário já ocupado nesta conta."},409);throw error;}
      await Promise.all(accounts.map(a=>auditX(admin,member,userId,a.id,"post_created",{count:1})));
      return json({ok:true,jobs:data||[],thumbnail_warning:!!body.thumbnail_path&&!thumbnail_path});
    }

    if(action==="edit-caption"||action==="skip"){
      const text=action==="edit-caption"?captionValue(body.caption,true):null;
      const {data:original,error:oe}=await admin.from("x_drive_posts").select("meta").eq("id",String(body.id||"")).eq("user_id",userId).maybeSingle();if(oe)throw oe;
      if(original?.meta?.publish_uncertain)return json({error:"Confira a publicação incerta no X antes de alterar."},409);
      const patch=action==="skip"?{status:"skipped"}:{post_text:text,meta:{...original?.meta,allow_empty_caption:!text}};
      const {data,error}=await admin.from("x_drive_posts").update({...patch,updated_at:new Date().toISOString()}).eq("id",String(body.id||"")).eq("user_id",userId).in("status",["queued","failed"]).select("id").maybeSingle();
      if(error)throw error;if(!data)return json({error:"post_locked",user_message:"Essa postagem já está sendo enviada ou foi finalizada."},409);
      if(action==="skip"){const {error:releaseError}=await admin.from("x_caption_queue").update({status:"pending",post_id:null}).eq("post_id",String(body.id||"")).eq("user_id",userId).eq("status","reserved");if(releaseError)throw releaseError;}
      return json({ok:true});
    }
    if(action==="save-config"){
      const x=await resolveXAccount(admin,userId,body);
      const {data:old,error:oldError}=await admin.from("x_account_configs").select("*").eq("platform_account_id",x.id).maybeSingle();if(oldError)throw oldError;
      const interval=Number(body.interval_minutes??old?.interval_minutes??120),enabled=body.enabled===undefined?old?.enabled===true:body.enabled===true;
      if(!Number.isInteger(interval)||interval<5||interval>10080)return json({error:"Escolha um intervalo entre 5 e 10080 minutos."},400);
      const slots=body.daily_slots===undefined?(old?.daily_slots||["12:00","18:00"]):Array.isArray(body.daily_slots)?[...new Set(body.daily_slots.map(String))].sort():[];
      if(!slots.length||slots.length>15||slots.some((t:any)=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))return json({error:"Defina entre 1 e 15 horários no formato HH:MM."},400);
      const mode=body.queue_mode??old?.queue_mode??"daily_slots";if(!["daily_slots","interval"].includes(mode))return json({error:"invalid_queue_mode"},400);
      const now=new Date().toISOString();let next:any=body.next_publish_at||old?.next_publish_at||now;
      if(!Number.isFinite(Date.parse(next)))return json({error:"invalid_start"},400);
      if(enabled&&mode==="daily_slots"){
        const {data:slot,error:slotError}=await admin.rpc("x_next_daily_slot",{p_slots:slots,p_after:now});if(slotError)throw slotError;next=slot;
      }
      const row={daily_slots:slots,queue_mode:mode,user_id:userId,workspace_id:member.workspace_id,platform_account_id:x.id,enabled,interval_minutes:interval,timezone:"America/Sao_Paulo",next_publish_at:enabled?next:null,last_error:null,updated_at:now};
      const {error}=await admin.from("x_account_configs").upsert(row,{onConflict:"platform_account_id"});if(error)throw error;
      if(enabled)bg(fetch(`${supabaseUrl}/functions/v1/cloudent-x-publish-worker?action=worker`,{method:"POST",headers:{"Content-Type":"application/json","x-cloudent-worker-secret":master},body:"{}"}));
      return json({ok:true,config:row});
    }
    if(action==="publish-next"){
      const account=await resolveXAccount(admin,userId,body);const now=new Date().toISOString();const {error}=await admin.from("x_account_configs").update({next_publish_at:now,updated_at:now}).eq("platform_account_id",account.id);if(error)throw error;
      bg(fetch(`${supabaseUrl}/functions/v1/cloudent-x-publish-worker?action=worker`,{method:"POST",headers:{"Content-Type":"application/json","x-cloudent-worker-secret":master},body:"{}"}));
      return json({ok:true,state:"queued"});
    }
    if(action==="retry"){
      const id=String(body.id||"");if(!id)return json({error:"missing_id"},400);
      const {data:p,error:e}=await admin.from("x_drive_posts").select("id,status,meta,x_post_id,attempts").eq("id",id).eq("user_id",userId).maybeSingle();if(e)throw e;if(!p)return json({error:"not_found"},404);
      if(p.attempts>=20)return json({error:"attempts_exhausted"},409);
      if(p.x_post_id)return json({error:"already_published"},409);
      if(p.status!=="failed")return json({error:"post_not_failed"},409);
      if(Boolean(p?.meta?.publish_uncertain))return json({error:"publish_uncertain",user_message:"Esse envio pode já ter virado post no X. Confira a conta antes de forçar uma repetição."},409);
      const {error:u}=await admin.from("x_drive_posts").update({status:"queued",max_attempts:20,next_attempt_at:new Date().toISOString(),last_error:null,locked_at:null,locked_by:null,meta:{...(p.meta||{}),publish_uncertain:false},updated_at:new Date().toISOString()}).eq("id",id).eq("user_id",userId).eq("status","failed");if(u)throw u;
      return json({ok:true});
    }
    return json({error:"not_found"},404);
  }catch(e:any){
    const status=Number(e?.status||500);const message=cleanError(e);
    if(action==="google-callback")return redirectBack({drive_error:"oauth_internal_error"});
    return json({ok:false,error:message,user_message:message},status>=400&&status<600?status:500);
  }
});

