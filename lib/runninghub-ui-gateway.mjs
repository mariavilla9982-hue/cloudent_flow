import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {WebSocket,WebSocketServer} from 'ws';
const root='/vercel/runninghub-ui';
const tokenFile=root+'/setup-token';
if(!fs.existsSync(tokenFile))fs.writeFileSync(tokenFile,crypto.randomBytes(32).toString('hex'),{mode:0o600});
function route(req){
  if(Date.now()-fs.statSync(tokenFile).mtimeMs>1800000)return null;
  const token=fs.readFileSync(tokenFile,'utf8').trim();
  const url=new URL(req.url,'http://localhost');
  const prefix='/setup/'+token+'/';
  if(!url.pathname.startsWith(prefix))return null;
  return '/'+url.pathname.slice(prefix.length)+url.search;
}
const server=http.createServer((req,res)=>{
  const path=route(req);if(!path){res.writeHead(404);return res.end();}
  const upstream=http.request({hostname:'127.0.0.1',port:6081,path,method:req.method,headers:{...req.headers,host:'127.0.0.1:6081'}},reply=>{
    res.writeHead(reply.statusCode,{...reply.headers,'cache-control':'no-store','referrer-policy':'no-referrer','x-frame-options':'DENY'});reply.pipe(res);
  });upstream.on('error',()=>{res.writeHead(503);res.end();});req.pipe(upstream);
});
const wss=new WebSocketServer({noServer:true});
server.on('upgrade',(req,socket,head)=>{
  const path=route(req);if(path!=='/websockify'){socket.destroy();return;}
  wss.handleUpgrade(req,socket,head,client=>{
    const target=new WebSocket('ws://127.0.0.1:6081/websockify');
    const pending=[];
    client.on('message',(data,binary)=>{if(target.readyState===WebSocket.OPEN)target.send(data,{binary});else pending.push([data,binary]);});
    target.on('open',()=>{for(const [data,binary]of pending)target.send(data,{binary});pending.length=0;});
    target.on('message',(data,binary)=>{if(client.readyState===WebSocket.OPEN)client.send(data,{binary});});
    for(const s of [client,target]){s.on('error',()=>{client.close();target.close();});s.on('close',()=>{client.close();target.close();});}
  });
});
server.listen(6080,'0.0.0.0');
