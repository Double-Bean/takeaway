import { env } from "cloudflare:workers";
import { ActionError, applyAction, freshen } from "@/lib/lunch-actions";
import { dayAt, seed, uuid } from "@/lib/lunch-engine";
import { connectionError, models, transcribe } from "@/lib/lunch-models";
import type { Session } from "@/lib/lunch-types";

export const dynamic = "force-dynamic";
const cookieName="lunch_visitor";
const pagesOrigin="https://double-bean.github.io";
const sessionHeader="X-Lunch-Session";
const fromPages=(request:Request)=>request.headers.get("Origin")===pagesOrigin;
const idPattern=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
type Context={params:Promise<{parts:string[]}>};
type Row={state:string;revision:number};

function visitor(request:Request) {
  if (fromPages(request)) {
    const token=request.headers.get(sessionHeader);
    return token&&idPattern.test(token) ? {id:token,created:false} : {id:uuid(),created:true};
  }
  const known=request.headers.get("cookie")?.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`))?.[1];
  return known&&idPattern.test(known) ? {id:known,created:false} : {id:uuid(),created:true};
}
const database=()=>{ if(!env.DB) throw new ActionError("演示数据库暂不可用。",503); return env.DB; };
const json = (data:unknown,status=200,sessionCookie?:string,secure=true) => Response.json(data,{status,headers:{
  "Cache-Control":"no-store",
  ...(sessionCookie?{"Set-Cookie":`${cookieName}=${sessionCookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure?"; Secure":""}`}:{})
}});
const respond=(error:unknown)=>error instanceof ActionError
  ? json({error:error.message},error.status)
  : json({error:"午餐助手暂时不可用，请稍后再试。"},500);

async function spend(bucket:string,limit:number) {
  const result=await database().prepare(
    "INSERT INTO lunch_usage (bucket,count) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<?"
  ).bind(bucket,limit).run();
  if(!result.meta.changes) throw new ActionError("本次演示的调用次数已用完，可以稍后再试。",429);
}
async function budgetFor(visitorId:string,kind:"speech"|"chat") {
  const day=dayAt();
  await spend(`${day}:${kind}:${visitorId}`,kind==="speech"?12:40);
  await spend(`${day}:${kind}:global`,kind==="speech"?120:300);
}
async function load(id:string) {
  return database().prepare("SELECT state,revision FROM lunch_sessions WHERE id=?").bind(id).first<Row>();
}
async function save(id:string,row:Row|null,state:Session) {
  const db=database();
  const serialized=JSON.stringify(state);
  const operation=row?
    db.prepare("UPDATE lunch_sessions SET state=?, revision=revision+1 WHERE id=? AND revision=?").bind(serialized,id,row.revision):
    db.prepare("INSERT OR IGNORE INTO lunch_sessions (id,state,revision) VALUES (?,?,0)").bind(id,serialized);
  return Boolean((await operation.run()).meta.changes);
}
function browserResponse(request:Request,response:Response) {
  response.headers.append("Vary","Origin");
  if (fromPages(request)) {
    response.headers.set("Access-Control-Allow-Origin",pagesOrigin);
    response.headers.set("Access-Control-Expose-Headers",sessionHeader);
  }
  return response;
}

export function OPTIONS(request:Request) {
  if (!fromPages(request)) return new Response(null,{status:403,headers:{"Vary":"Origin"}});
  return browserResponse(request,new Response(null,{status:204,headers:{
    "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":"Content-Type, "+sessionHeader,
    "Access-Control-Max-Age":"600",
  }}));
}

export async function GET(request:Request,context:Context) {
  return browserResponse(request,await get(request,context));
}

async function get(request:Request,{params}:Context) {
  try {
    const path=(await params).parts.join("/");
    if(!["session","orders"].includes(path)) throw new ActionError("找不到此功能。",404);
    let identity=visitor(request);
    const row=await load(identity.id);
    if (fromPages(request)&&!row&&!identity.created) identity={id:uuid(),created:true};
    const model=models(env);
    const state:Session=row?JSON.parse(row.state):seed();
    const refresh=!row||state.preferencesVersion!==2||state.day!==dayAt(state.offset)||state.mode!==model.provider;
    await freshen(state,model);
    if(refresh) await save(identity.id,row,state);
    const response=json(path==="orders"?{orders:state.orders}:state,200,
      identity.created&&!fromPages(request)?identity.id:undefined,new URL(request.url).protocol==="https:");
    if (fromPages(request)) response.headers.set(sessionHeader,identity.id);
    return response;
  } catch(error) {return respond(error);}
}
export async function POST(request:Request,context:Context) {
  return browserResponse(request,await post(request,context));
}

async function post(request:Request,{params}:Context) {
  try {
    if (!fromPages(request) && (request.headers.get("sec-fetch-site")==="cross-site"
      || (request.headers.has("Origin") && request.headers.get("Origin")!==new URL(request.url).origin))) throw new ActionError("请从午餐助手页面发起操作。",403);
    const path=(await params).parts.join("/");
    const identity=visitor(request);
    if(identity.created) throw new ActionError("会话已过期，请刷新后重试。",409);
    const model=models(env);
    if(path==="transcriptions") {
      if (fromPages(request)&&!await load(identity.id)) throw new ActionError("会话已过期，请刷新后重试。",409);
      if(!model.speechKey) throw new ActionError("云端语音尚未启用，请使用文字输入。",503);
      const length=Number(request.headers.get("content-length")??0);
      if(length>3_200_000) throw new ActionError("录音过大，请缩短后重试。",413);
      const file=(await request.formData()).get("audio");
      if(!(file instanceof File)||file.size<128||file.size>3_000_000||! /^(audio|video)\/(webm|mp4|mpeg|wav|ogg|x-m4a)(;|$)/i.test(file.type)) throw new ActionError("录音为空或格式不支持，请重新录制。");
      await budgetFor(identity.id,"speech");
      let text:string;
      try {
        text=await transcribe(model,file);
      } catch(error) {
        if (error instanceof Error) {
          const detail=error.message.replace(/sk-[A-Za-z0-9._~+/=-]+/g,"[redacted]").slice(0,160);
          console.warn("Lunch transcription upstream failed",error.name,detail);
        }
        throw new ActionError(connectionError(error),503);
      }
      if(!text) throw new ActionError("没有识别到内容，请重录。");
      return json({text:text.slice(0,240)});
    }
    if(Number(request.headers.get("content-length")??0)>12_000) throw new ActionError("请求内容过长。",413);
    const body=await request.json() as Record<string,unknown>;
    if(!body || typeof body!=="object"||typeof body.requestId!=="string"||!idPattern.test(body.requestId)) throw new ActionError("请求格式不正确。");
    let actionModel=body.usePersonalModel===true?models({}):model;
    let charged=false;
    for(let attempt=0;attempt<3;attempt++) {
      const row=await load(identity.id);
      if(!row) throw new ActionError("请先打开午餐助手。",409);
      const state=await freshen(JSON.parse(row.state) as Session,model);
      if(state.seenActions.includes(body.requestId)) return json(state);
      if(!charged && actionModel.key && (path==="messages" || actionModel.vector && ["feedback","recommendations/next","orders"].includes(path))) {
        try {
          await budgetFor(identity.id,"chat");
        } catch(error) {
          if (!(error instanceof ActionError) || error.status!==429) throw error;
          actionModel=models({});
        }
        charged=true;
      }
      const result=await applyAction(state,actionModel,path,body);
      result.mode=model.provider;
      result.seenActions=[...result.seenActions,body.requestId].slice(-120);
      if(await save(identity.id,row,result)) return json(result);
    }
    throw new ActionError("刚才有另一笔操作，请重试。",409);
  } catch(error) {
    if(error instanceof SyntaxError) return json({error:"请求内容无效。"},400);
    return respond(error);
  }
}
