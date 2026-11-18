import { readFile } from 'node:fs/promises';

// /api/ avoids the SPA service worker's shell cache and script injection.
export default async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://iubzjfidmxfjvvonusos.supabase.co; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  if(req.method!=='GET'){res.statusCode=405;return res.end();}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end(await readFile(new URL('../lib/instagram-session-test.html',import.meta.url),'utf8'));
}
