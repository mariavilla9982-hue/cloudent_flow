import assert from 'node:assert/strict';
import {uploadedObjectMatches} from '../supabase/functions/_shared/upload-verification.ts';
const originalFetch=globalThis.fetch;
let count=0,cancelled=0;
try{
 globalThis.fetch=async(_url,options)=>{
  count++;assert.equal(options.method,'GET');assert.equal(options.headers.Range,'bytes=0-0');
  if(count===1)throw Error('connection closed https://private/?X-Amz-Signature=secret');
  return {status:206,ok:true,headers:new Headers({'content-range':'bytes 0-0/123'}),body:{cancel:async()=>cancelled++}};
 };
 assert.equal(await uploadedObjectMatches('https://storage.test/signed',123),true);assert.equal(count,2);assert.equal(cancelled,1);
 count=0;globalThis.fetch=async()=>{count++;return new Response(null,{status:404})};
 assert.equal(await uploadedObjectMatches('https://storage.test/signed',123),false);assert.equal(count,1);
 globalThis.fetch=async()=>new Response(null,{status:206,headers:{'content-range':'bytes 0-0/122'}});
 assert.equal(await uploadedObjectMatches('https://storage.test/signed',123),false);
 count=0;globalThis.fetch=async()=>{count++;return new Response(null,{status:503})};
 await assert.rejects(uploadedObjectMatches('https://storage.test/signed',123),e=>!e.message.includes('storage.test')&&!e.message.includes('Signature'));assert.equal(count,3);
 count=0;globalThis.fetch=async()=>{count++;throw Error('https://private/?X-Amz-Signature=secret')};
 await assert.rejects(uploadedObjectMatches('https://storage.test/signed',123),e=>!e.message.includes('secret')&&!e.message.includes('https'));assert.equal(count,3);
 count=0;globalThis.fetch=async()=>{count++;return new Response(null,{status:403})};
 await assert.rejects(uploadedObjectMatches('https://storage.test/signed',123));assert.equal(count,1);
}finally{globalThis.fetch=originalFetch}
console.log('PASS transient B2 failures retried, absent and incomplete objects blocked, forbidden not retried, bounded retries and presigned URL redaction');
