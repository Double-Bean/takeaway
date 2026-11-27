import { mkdirSync, statSync, createReadStream } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DatabaseSync } from "node:sqlite";
import { createLunchHttp, type SessionRow } from "../lib/lunch-http";
import { omniModel } from "../lib/lunch-byok";

const siteRoot=resolve(__dirname,"../../site");
const dataDirectory=resolve(process.env.LUNCH_DATA_DIR||"/tmp/lunch-studio");
mkdirSync(dataDirectory,{recursive:true,mode:0o700});
const db=new DatabaseSync(resolve(dataDirectory,"lunch.sqlite"));
db.exec(`
  CREATE TABLE IF NOT EXISTS lunch_sessions (id TEXT PRIMARY KEY, state TEXT NOT NULL, revision INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS lunch_usage (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL);
`);
const readSession=db.prepare("SELECT state,revision FROM lunch_sessions WHERE id=?");
const insertSession=db.prepare("INSERT OR IGNORE INTO lunch_sessions (id,state,revision) VALUES (?,?,0)");
const updateSession=db.prepare("UPDATE lunch_sessions SET state=?, revision=revision+1 WHERE id=? AND revision=?");
const spendBudget=db.prepare(
  "INSERT INTO lunch_usage (bucket,count) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<?"
);
const api=createLunchHttp({
  LUNCH_PROVIDER:"dashscope",
  DASHSCOPE_API_KEY:process.env.DASHSCOPE_API_KEY?.trim(),
  LUNCH_BASE_URL:process.env.LUNCH_BASE_URL,
  LUNCH_TEXT_MODEL:process.env.LUNCH_TEXT_MODEL||omniModel,
  LUNCH_SPEECH_MODEL:process.env.LUNCH_SPEECH_MODEL||omniModel,
  LUNCH_EMBED_MODEL:process.env.LUNCH_EMBED_MODEL,
},{
  async load(id) {return readSession.get(id) as SessionRow|undefined ?? null;},
  async save(id,row,state) {
    const serialized=JSON.stringify(state);
    return Boolean(row?updateSession.run(serialized,id,row.revision).changes:insertSession.run(id,serialized).changes);
  },
  async spend(bucket,limit) {return Boolean(spendBudget.run(bucket,limit).changes);},
});
const mediaTypes:Record<string,string>={
  ".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",".svg":"image/svg+xml",".webp":"image/webp",
  ".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".woff2":"font/woff2",
};

async function send(response:ServerResponse,result:Response) {
  response.writeHead(result.status,Object.fromEntries(result.headers));
  if(result.body) await pipeline(Readable.fromWeb(result.body as import("node:stream/web").ReadableStream),response);
  else response.end();
}

async function serveApi(request:IncomingMessage,response:ServerResponse,url:URL) {
  const headers=new Headers();
  for(const [name,value] of Object.entries(request.headers)) {
    if(value!==undefined) headers.set(name,Array.isArray(value)?value.join(", "):value);
  }
  const path=url.pathname.slice("/api/".length);
  let body:Uint8Array<ArrayBuffer>|undefined;
  if(request.method==="POST") {
    const limit=path==="transcriptions"?3_200_000:12_000;
    const chunks:Buffer[]=[];
    let size=0;
    for await(const chunk of request.iterator({destroyOnReturn:false})) {
      const bytes=Buffer.from(chunk);
      size+=bytes.length;
      if(size>limit) {
        request.resume();
        return send(response,Response.json({error:"请求内容过长。"},{status:413}));
      }
      chunks.push(bytes);
    }
    body=new Uint8Array(Buffer.concat(chunks,size));
  }
  await send(response,await api(new Request(url,{method:request.method,headers,body}),path));
}

function requestOrigin(request:IncomingMessage) {
  const studioHost=process.env.STUDIO_HOST?.trim();
  if(studioHost) return new URL(studioHost.includes("://")?studioHost:`https://${studioHost}`).origin;

  // The Studio proxy may replace the host with an internal address. Fetch
  // Metadata is browser-controlled and only marks same-origin browser requests.
  const browserOrigin=request.headers.origin;
  if(request.headers["sec-fetch-site"]==="same-origin" && typeof browserOrigin==="string") {
    const origin=new URL(browserOrigin);
    if(origin.protocol==="https:" && origin.hostname.endsWith(".ms.show") && origin.origin===browserOrigin) return browserOrigin;
  }

  const protocol=request.headers["x-forwarded-proto"];
  const scheme=typeof protocol==="string" && protocol.split(",")[0].trim()==="https"?"https":"http";
  const forwardedHost=request.headers["x-forwarded-host"];
  const host=typeof forwardedHost==="string"?forwardedHost.split(",")[0].trim():request.headers.host||"localhost";
  return new URL(`${scheme}://${host}`).origin;
}

async function serve(request:IncomingMessage,response:ServerResponse) {
  const url=new URL(requestOrigin(request));
  const target=new URL(request.url||"/","http://localhost");
  url.pathname=target.pathname;
  url.search=target.search;
  if(url.pathname==="/healthz") return send(response,Response.json({status:"ok"}));
  if(url.pathname.startsWith("/api/")) return serveApi(request,response,url);
  if(request.method!=="GET"&&request.method!=="HEAD") return send(response,new Response(null,{status:405}));
  const filename=resolve(siteRoot,"."+decodeURIComponent(url.pathname==="/"?"/index.html":url.pathname));
  if(!filename.startsWith(siteRoot+sep)) return send(response,new Response(null,{status:404}));
  const stats=statSync(filename,{throwIfNoEntry:false});
  if(!stats?.isFile()) return send(response,new Response(null,{status:404}));
  response.writeHead(200,{
    "Content-Type":mediaTypes[extname(filename)]||"application/octet-stream",
    "Content-Length":stats.size,
    "X-Content-Type-Options":"nosniff",
    "Cache-Control":url.pathname.startsWith("/assets/")?"public, max-age=31536000, immutable":"no-cache",
  });
  if(request.method==="HEAD") response.end();
  else await pipeline(createReadStream(filename),response);
}

const port=Number(process.env.PORT||7860);
createServer((request,response)=>{
  void serve(request,response).catch(error=>{
    if(response.headersSent) {response.destroy();return;}
    const status=error instanceof URIError||error instanceof TypeError?400:500;
    if(status===500) console.error("Lunch HTTP request failed",error instanceof Error?error.name:"Unknown");
    void send(response,Response.json({error:"无法处理此请求。"},{status}));
  });
}).listen(port,"0.0.0.0",()=>console.log(`Lunch Studio is listening on port ${port}.`));
