const CACHE="cloudentflow-pwa-v3";
const STATIC=["/manifest.webmanifest","/cloudent-icon.svg","/cloudent-notification-icon.svg"];

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC)).catch(()=>null));
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  event.respondWith(fetch(event.request).catch(()=>caches.match(event.request)));
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
