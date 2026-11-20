// Authorized active-task cancellation test completed for task 2123589000321392641.
// Exact dispatch source and dependencies are retained in commit 90e4c9719e7148e375165f7163ee1d7cbecf4c7a.
// This test stopped before output; it does not prove capture-then-cancel end to end.
Deno.serve(()=>new Response(JSON.stringify({ok:false,error:'authorized_test_closed'}),{status:410,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}}));
