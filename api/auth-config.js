import { supabaseConfig } from "../lib/supabase-config.js";
export default function handler(req,res){
  res.setHeader("Content-Type","application/javascript; charset=utf-8");
  res.setHeader("Cache-Control","no-store, max-age=0");
  res.setHeader("X-Content-Type-Options","nosniff");
  try{
    const {url,key,ref}=supabaseConfig();
    res.end("window.CloudentConfig=Object.freeze("+JSON.stringify({supabaseUrl:url,publishableKey:key,projectRef:ref})+");");
  }catch{
    res.statusCode=503;res.end('window.CloudentConfig=Object.freeze({});');
  }
}
