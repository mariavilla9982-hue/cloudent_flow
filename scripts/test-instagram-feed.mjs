import assert from "node:assert/strict";
import {publishDueFeedPosts} from "../supabase/functions/cloudent-posting-scheduler-recovery/instagram-feed.ts";
import {instagramFeedApi} from "../supabase/functions/cloudent-api/instagram-feed.ts";

const id = "a302f997-385f-4c1c-b506-b9b23d129ae0";
const json = (body,status=200) => Response.json(body,{status});
const url = new URL("https://test.invalid/?resource=instagram-feed");
const deps = {json,resolveAccount:async (_,account) => account};
let statusReads = [];
const admin = {
  from(table) {
    assert.equal(table,"instagram_feed_posts");
    let patch;
    const query = {
      select:()=>query,in:()=>query,lte:()=>query,or:()=>query,order:()=>query,
      eq:()=>query,update:value=>{patch=value;return query;},
      maybeSingle:async()=>{if(patch)Object.assign(post,patch);return {data:patch ? {id} : null};},
      single:async()=>{Object.assign(post,patch);return {data:{id}};},
      limit:async()=>({data:[{...post}]})
    };
    return query;
  }
};
const req = body => new Request(url,{method:"POST",body:JSON.stringify(body)});
assert.equal((await instagramFeedApi(req({operation:"ticket",id:"bad"}),url,admin,"user",deps)).status,400);
assert.equal((await instagramFeedApi(req({operation:"ticket",id,photo_sizes:[1.25]}),url,admin,"user",deps)).status,400);
assert.equal((await instagramFeedApi(req({operation:"ticket",id,photo_sizes:[1],scheduled_at:"2000-01-01"}),url,admin,"user",deps)).status,400);

let post = {id,platform_account_id:"account",photo_paths:["first","second"],status:"scheduled",caption:"Legenda",child_ids:[]};
let calls = [];
let publishTimeout = false;
const worker = {
  route:async()=>({base:"graph",token:"test",igId:"ig"}),
  r2Url:async (_,path)=>"https://photos.invalid/"+path,
  graph:async (_,path,_token,method,params) => {
    if(method === "GET") {statusReads.push(path);return {status_code:post.status === "publishing" ? "PUBLISHED" : "FINISHED"};}
    calls.push([path,params]);
    if (path.endsWith("media_publish") && publishTimeout) throw new Error("timeout");
    return {id:String(calls.length)};
  }
};
await publishDueFeedPosts(admin,worker);
assert.deepEqual(post.child_ids,["1","2"]);
assert.deepEqual(calls.map(([,p])=>p.is_carousel_item),["true","true"]);
await publishDueFeedPosts(admin,worker);
assert.deepEqual(calls[2],[ "ig/media",{media_type:"CAROUSEL",children:"1,2",caption:"Legenda"}]);
assert.deepEqual(statusReads,["1","2"]);
publishTimeout = true;
await publishDueFeedPosts(admin,worker);
assert.equal(post.status,"publishing");
await publishDueFeedPosts(admin,worker);
assert.equal(post.status,"published");
assert.equal(calls.filter(([path])=>path.endsWith("media_publish")).length,1);
assert.equal(post.lock_id,null);

calls = [];
publishTimeout = false;
post = {id,platform_account_id:"account",photo_paths:["first"],status:"scheduled",caption:"Foto única",child_ids:[]};
await publishDueFeedPosts(admin,worker);
assert.deepEqual(calls[0],["ig/media",{image_url:"https://photos.invalid/first",caption:"Foto única"}]);
await publishDueFeedPosts(admin,worker);
assert.equal(post.status,"published");
assert.equal(post.instagram_media_id,"2");
console.log("PASS single photo, ordered carousel, validation and ambiguous receipt reconciliation");
