// Single authorized generation was dispatched as task 2123542785978355713.
// Dispatch source is retained in commit 1eb1054a6720da9e2bae5c8926b4aa8b34264d7e.
// Production capture/cancellation runs independently of this closed test entry.
Deno.serve(()=>new Response(JSON.stringify({ok:false,error:'authorized_test_closed'}),{status:410,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}));
