const CACHE="cloudentflow-pwa-v6";
const APP_SHELL="/";
const CALENDAR_CONNECT_PATCH="/calendar-connect-patch.js";
const STATIC=[APP_SHELL,"/manifest.webmanifest","/cloudent-icon.svg","/cloudent-notification-icon.svg",CALENDAR_CONNECT_PATCH];

function isCacheable(response){
  return Boolean(response&&response.ok&&(response.type==="basic"||response.type==="default"));
}

async function injectCalendarPatch(response){
  if(!response||!response.ok)return response;
  const type=response.headers.get("content-type")||"";
  if(!type.includes("text/html"))return response;
  try{
    let html=await response.text();
    if(!html.includes("calendar-connect-patch.js")){
      const tag='<script src="/calendar-connect-patch.js?v=2"></script>';
      html=html.includes("</body>")?html.replace("</body>",tag+"</body>"):html+tag;
    }
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
      if(!response)response=await fetch(request);
      if(isCacheable(response))await cache.put(APP_SHELL,response.clone());
      return response;
    }catch{
      return null;
    }
  })();

  if(cached){
    event.waitUntil(networkPromise.catch(()=>null));
    return injectCalendarPatch(cached);
  }

  const response=(await networkPromise)||Response.error();
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
