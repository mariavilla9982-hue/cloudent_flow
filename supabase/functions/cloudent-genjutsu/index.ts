import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.49.8';
import {genjutsuApi} from '../_shared/genjutsu-api.ts';

Deno.serve((req:Request)=>genjutsuApi(req,{
  admin:createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}}),
  supabaseUrl:Deno.env.get('SUPABASE_URL')!,apiKey:Deno.env.get('GEMINI_API_KEY')||''
}));
