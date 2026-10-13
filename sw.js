const CACHE="cloudentflow-pwa-v26";
const APP_SHELL="/";
const STATIC=[APP_SHELL,"/manifest.webmanifest","/cloudent-icon.svg","/cloudent-notification-icon.svg"];

function isCacheable(response){
  return Boolean(response&&response.ok&&(response.type==="basic"||response.type==="default"));
}

async function injectCalendarPatch(response){
  if(!response||!response.ok)return response;
  const type=response.headers.get("content-type")||"";
  if(!type.includes("text/html"))return response;
  try{
    let html=await response.text();
    const calendarTag='<script src="/calendar-connect-patch.js?v=8"></script>';
    const mobileScheduleTag='<script src="/production-schedule-mobile-patch.js?v=3"></script>';
    const timeHotfixTag='<script src="/production-schedule-time-hotfix.js?v=1"></script>';
    const viralsTag='<script src="/virals-patch.js?v=3"></script>';
    const forYouTag='<script src="/virals-foryou-patch.js?v=1"></script>';
    const forYouWatchdogTag='<script src="/virals-foryou-watchdog.js?v=1"></script>';
    const faceSwapCharacterTag='<script src="/face-swap-character-presets.js?v=6"></script>';
    const faceSwapQueueTag='<script src="/face-swap-queue-patch.js?v=2"></script>';
    const oldCalendarPatch=/<script\b[^>]*src=["'][^"']*calendar-connect-patch\.js[^"']*["'][^>]*><\/script>/gi;
    const oldMobileSchedulePatch=/<script\b[^>]*src=["'][^"']*production-schedule-mobile-patch\.js[^"']*["'][^>]*><\/script>/gi;
    const oldTimeHotfix=/<script\b[^>]*src=["'][^"']*production-schedule-time-hotfix\.js[^"']*["'][^>]*><\/script>/gi;
    const oldViralsPatch=/<script\b[^>]*src=["'][^"']*virals-patch\.js[^"']*["'][^>]*><\/script>/gi;
    const oldForYouPatch=/<script\b[^>]*src=["'][^"']*virals-foryou-patch\.js[^"']*["'][^>]*><\/script>/gi;
    const oldForYouWatchdog=/<script\b[^>]*src=["'][^"']*virals-foryou-watchdog\.js[^"']*["'][^>]*><\/script>/gi;
    const oldFaceSwapCharacter=/<script\b[^>]*src=["'][^"']*face-swap-character-presets\.js[^"']*["'][^>]*><\/script>/gi;
    const oldFaceSwapCharacterClickHotfix=/<script\b[^>]*src=["'][^"']*face-swap-character-click-hotfix\.js[^"']*["'][^>]*><\/script>/gi;
    const oldFaceSwapQueue=/<script\b[^>]*src=["'][^"']*face-swap-queue-patch\.js[^"']*["'][^>]*><\/script>/gi;

    if(oldCalendarPatch.test(html))html=html.replace(oldCalendarPatch,calendarTag);
    else html=html.includes("</body>")?html.replace("</body>",calendarTag+"</body>"):html+calendarTag;

    if(oldMobileSchedulePatch.test(html))html=html.replace(oldMobileSchedulePatch,mobileScheduleTag);
    else html=html.includes("</body>")?html.replace("</body>",mobileScheduleTag+"</body>"):html+mobileScheduleTag;

    if(oldTimeHotfix.test(html))html=html.replace(oldTimeHotfix,timeHotfixTag);
    else html=html.includes("</body>")?html.replace("</body>",timeHotfixTag+"</body>"):html+timeHotfixTag;

    if(oldViralsPatch.test(html))html=html.replace(oldViralsPatch,viralsTag);
    else html=html.includes("</body>")?html.replace("</body>",viralsTag+"</body>"):html+viralsTag;

    if(oldForYouPatch.test(html))html=html.replace(oldForYouPatch,forYouTag);
    else html=html.includes("</body>")?html.replace("</body>",forYouTag+"</body>"):html+forYouTag;

    if(oldForYouWatchdog.test(html))html=html.replace(oldForYouWatchdog,forYouWatchdogTag);
    else html=html.includes("</body>")?html.replace("</body>",forYouWatchdogTag+"</body>"):html+forYouWatchdogTag;

    // Cached native and legacy documents share one selector controller.
    html=html.replace(oldFaceSwapCharacterClickHotfix,'');
    if(oldFaceSwapCharacter.test(html))html=html.replace(oldFaceSwapCharacter,faceSwapCharacterTag);
    else html=html.includes('</body>')?html.replace('</body>',faceSwapCharacterTag+'</body>'):html+faceSwapCharacterTag;

    if(oldFaceSwapQueue.test(html))html=html.replace(oldFaceSwapQueue,faceSwapQueueTag);
    else html=html.includes("</body>")?html.replace("</body>",faceSwapQueueTag+"</body>"):html+faceSwapQueueTag;

    const headers=new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.delete("transfer-encoding");
    return new Response(html,{status:response.status,statusText:response.statusText,headers});
  }catch{
    return response;
  }
}

self.addEventListener("install",event=>{
  event.waitUntil(
    caches.open(CACHE)
      .then(cache=>cache.addAll(STATIC))
      .catch(()=>null)
  );
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)));
    if(self.registration.navigationPreload){
      try{await self.registration.navigationPreload.enable()}catch{}
    }
    await self.clients.claim();
  })());
});

async function handleNavigation(event){
  const request=event.request;
  const cache=await caches.open(CACHE);
  const cached=await cache.match(APP_SHELL);

  const networkPromise=(async()=>{
    try{
      let response=null;
      try{response=await event.preloadResponse}catch{}
      if(!response)response=await fetch(request,{cache:"no-store"});
      if(isCacheable(response))await cache.put(APP_SHELL,response.clone());
      return response;
    }catch{
      return null;
    }
  })();

  const response=(await networkPromise)||cached||Response.error();
  return injectCalendarPatch(response);
}

async function staleWhileRevalidate(event){
  const request=event.request;
  const cache=await caches.open(CACHE);
  const cached=await cache.match(request);

  const networkPromise=fetch(request)
    .then(async response=>{
      if(isCacheable(response))await cache.put(request,response.clone());
      return response;
    })
    .catch(()=>null);

  if(cached){
    event.waitUntil(networkPromise.catch(()=>null));
    return cached;
  }

  return (await networkPromise)||Response.error();
}

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;

  let url;
  try{url=new URL(request.url)}catch{return}

  if(url.origin!==self.location.origin||url.pathname.startsWith("/api/"))return;

  if(
    url.pathname==="/calendar-connect-patch.js"||
    url.pathname==="/production-schedule-mobile-patch.js"||
    url.pathname==="/production-schedule-time-hotfix.js"||
    url.pathname==="/virals-patch.js"||
    url.pathname==="/virals-foryou-patch.js"||
    url.pathname==="/virals-foryou-watchdog.js"||
    url.pathname==="/face-swap-character-presets.js"||
    url.pathname==="/face-swap-character-click-hotfix.js"||
    url.pathname==="/face-swap-queue-patch.js"
  ){
    event.respondWith(fetch(request,{cache:"no-store"}).catch(()=>Response.error()));
    return;
  }

  if(request.mode==="navigate"||request.destination==="document"){
    event.respondWith(handleNavigation(event));
    return;
  }

  if(["style","script","image","font","manifest"].includes(request.destination)){
    event.respondWith(staleWhileRevalidate(event));
  }
});

self.addEventListener("push",event=>{
  let data={};
  try{data=event.data?event.data.json():{}}catch{
    data={body:event.data?event.data.text():""};
  }
  const title=data.title||"CloudentFlow";
  const options={
    body:data.body||"O CloudentFlow encontrou uma atualização.",
    icon:"/cloudent-notification-icon.svg",
    badge:"/cloudent-notification-icon.svg",
    tag:data.tag||("cloudent-"+(data.id||Date.now())),
    renotify:true,
    requireInteraction:data.severity==="error",
    data:{
      url:data.url||"/",
      notification_id:data.id||null,
      category:data.category||"system"
    },
    actions:[{action:"open",title:"Abrir CloudentFlow"}]
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener("notificationclick",event=>{
  event.notification.close();
  const target=event.notification?.data?.url||"/";
  event.waitUntil(
    self.clients.matchAll({type:"window",includeUncontrolled:true}).then(clients=>{
      for(const client of clients){
        try{
          const u=new URL(client.url);
          if(u.origin===self.location.origin){
            client.navigate(target).catch(()=>null);
            return client.focus();
          }
        }catch{}
      }
      return self.clients.openWindow(target);
    })
  );
});