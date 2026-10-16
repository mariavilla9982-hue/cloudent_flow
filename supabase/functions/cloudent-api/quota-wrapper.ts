import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const nativeFetch=globalThis.fetch.bind(globalThis);
const supabaseUrl=Deno.env.get("SUPABASE_URL")||"";
const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";

function bearer(headers:Headers){
  const value=headers.get("authorization")||"";
  return value.replace(/^Bearer\s+/i,"").trim();
}

async function localAdminUser(token:string){
  if(!token.startsWith("cf_local_"))return null;
  const opaque=token.slice("cf_local_".length);
  if(!opaque)return null;
  const res=await nativeFetch(supabaseUrl+"/rest/v1/rpc/cloudent_x_local_session",{
    method:"POST",
    headers:{
      apikey:serviceKey,
      Authorization:"Bearer "+serviceKey,
      "Content-Type":"application/json"
    },
    body:JSON.stringify({p_token:opaque})
  });
  if(!res.ok)return null;
  const payload=await res.json().catch(()=>null);
  const session=Array.isArray(payload)?payload[0]:payload;
  if(!session?.user_id||session.role!=="admin")return null;
  return {
    id:String(session.user_id),
    aud:"authenticated",
    role:"authenticated",
    email:String(session.email||""),
    email_confirmed_at:new Date(0).toISOString(),
    phone:"",
    confirmed_at:new Date(0).toISOString(),
    last_sign_in_at:new Date().toISOString(),
    app_metadata:{provider:"cloudent_local",providers:["cloudent_local"],cloudent_role:"admin"},
    user_metadata:{cloudent_role:"admin"},
    identities:[],
    created_at:new Date(0).toISOString(),
    updated_at:new Date().toISOString(),
    is_anonymous:false
  };
}

globalThis.fetch=async(input:RequestInfo|URL,init?:RequestInit)=>{
  let url="";
  try{url=typeof input==="string"?input:input instanceof URL?input.toString():input.url}catch{}
  if(supabaseUrl&&url.startsWith(supabaseUrl+"/auth/v1/user")){
    const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));
    const token=bearer(headers);
    if(token.startsWith("cf_local_")){
      const user=await localAdminUser(token);
      if(!user)return new Response(JSON.stringify({message:"Invalid JWT"}),{status:401,headers:{"Content-Type":"application/json"}});
      return new Response(JSON.stringify(user),{status:200,headers:{"Content-Type":"application/json"}});
    }
  }
  return nativeFetch(input as any,init);
};

await import("https://raw.githubusercontent.com/mariavilla9982-hue/cloudent_flow/94f9a5a6feea9bfeb2495433260664e42d5351b9/supabase/functions/cloudent-api/index.ts");
