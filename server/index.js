import { WebSocketServer, WebSocket } from 'ws';
import { generateSession } from '../src/model.js';
const port=Number(process.env.PORT||8787);
const wss=new WebSocketServer({host:'127.0.0.1',port,maxPayload:1024});
// Each new client gets a complete state frame. Never queue behind a slow client.
wss.on('connection',socket=>{
  const frames=generateSession(42,3600).frames;let index=0;
  const send=()=>{if(socket.readyState!==WebSocket.OPEN)return;if(socket.bufferedAmount>256*1024){socket.close(1013,'Slow telemetry consumer');return;}socket.send(JSON.stringify(frames[index++]));if(index===frames.length)socket.close(1000,'Demo session complete');};
  send();const timer=setInterval(send,1000);socket.on('close',()=>clearInterval(timer));socket.on('error',()=>clearInterval(timer));
});
wss.on('listening',()=>console.log(`Read-only DEMO telemetry: ws://127.0.0.1:${port}`));
wss.on('error',error=>{console.error(error.message);process.exitCode=1;});
function shutdown(){for(const s of wss.clients)s.close(1001,'Server shutdown');wss.close();setTimeout(()=>process.exit(),1000).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
