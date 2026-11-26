import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { handleLunchRequest, type LunchStore } from "../lib/lunch-api";

function readBody(request:IncomingMessage,limit:number) {
  return new Promise<Uint8Array<ArrayBuffer>|null>((resolve,reject)=>{
    const chunks:Buffer[]=[];
    let size=0;
    request.on("data",(chunk:Buffer)=>{
      size+=chunk.length;
      if (size<=limit) chunks.push(chunk);
      else {
        chunks.length=0;
        resolve(null);
      }
    });
    request.once("end",()=>resolve(new Uint8Array(Buffer.concat(chunks))));
    request.once("error",reject);
    request.once("aborted",()=>reject(new Error("Client disconnected.")));
  });
}

async function send(response:ServerResponse,result:Response) {
  response.statusCode=result.status;
  for (const [key,value] of result.headers) {
    if (key!=="set-cookie") response.setHeader(key,value);
  }
  const cookies=result.headers.getSetCookie();
  if (cookies.length) response.setHeader("Set-Cookie",cookies);
  response.end(Buffer.from(await result.arrayBuffer()));
}

export function createScfServer(store:LunchStore,settings:Parameters<typeof handleLunchRequest>[3]) {
  return createServer(async (incoming,outgoing)=>{
    try {
      // The service handles API calls only. An absolute incoming target cannot change this origin.
      const relative=new URL(incoming.url??"/","https://localhost");
      const url=new URL("https://localhost");
      url.pathname=relative.pathname;
      url.search=relative.search;
      const path=url.pathname.startsWith("/api/")?url.pathname.slice(5):"";
      const method=incoming.method??"GET";
      const headers=new Headers();
      for (const [name,value] of Object.entries(incoming.headers)) {
        if (value!==undefined) headers.set(name,Array.isArray(value)?value.join(", "):value);
      }
      const limit=path==="transcriptions"?3_200_000:12_000;
      const body=method==="POST"?await readBody(incoming,limit):undefined;
      if (body===null) {
        const result=Response.json({error:"请求内容过长。"},
          {status:413,headers:{"Cache-Control":"no-store","Vary":"Origin"}});
        if (headers.get("origin")==="https://double-bean.github.io") {
          result.headers.set("Access-Control-Allow-Origin","https://double-bean.github.io");
        }
        return await send(outgoing,result);
      }
      const request=new Request(url,{method,headers,body});
      await send(outgoing,await handleLunchRequest(request,path,store,settings));
    } catch {
      if (!outgoing.headersSent) {
        outgoing.writeHead(500,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
      }
      outgoing.end(JSON.stringify({error:"午餐助手暂时不可用，请稍后再试。"}));
    }
  });
}
