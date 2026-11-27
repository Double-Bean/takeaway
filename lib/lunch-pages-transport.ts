import { applyAction, freshen } from "./lunch-actions";
import { seed } from "./lunch-engine";
import { models } from "./lunch-models";
import { studioApiOrigin, timeoutSignal } from "./lunch-network";
import type { Session } from "./lunch-types";

const storageKey="takeaway-lunch-session-v2";
const remoteKey="takeaway-pages-session";
const sessionHeader="X-Lunch-Session";

class CloudError extends Error {
  constructor(message:string,readonly status:number) {super(message);}
}

function isTransient(error:unknown) {
  return error instanceof CloudError ? [502,503,504].includes(error.status)
    : error instanceof TypeError || error instanceof Error && ["AbortError","TimeoutError"].includes(error.name);
}

async function retry<T>(request:()=>Promise<T>) {
  try { return await request(); }
  catch(error) {
    if (!isTransient(error)) throw error;
    return request();
  }
}

async function sessionResponse(response:Response) {
  const data=await response.json().catch(()=>null) as (Session&{error?:string})|null;
  if (!response.ok) throw new CloudError(data?.error||"云端服务暂时无法连接，请稍后重试。",response.status);
  if (!Array.isArray(data?.messages)) throw new CloudError("云端会话响应异常，请稍后重试。",502);
  return data;
}

export function createPagesTransport(backend:string|undefined,fetcher:typeof fetch=fetch,storage=()=>localStorage) {
  const sameOrigin=backend?.startsWith("/")&&!backend.startsWith("//");
  const bodySession=backend===studioApiOrigin+"/api/";
  const sessionKey=bodySession?remoteKey+"-modelscope":remoteKey;
  const localModel=models({});
  let token:string|null=null;
  let usingBackend=false;
  let localChanged=false;
  let localSession:Session|undefined;

  function readStorage(key:string) {
    try { return storage().getItem(key); }
    catch { return null; }
  }

  function writeStorage(key:string,value:string) {
    try { storage().setItem(key,value); }
    catch { /* Use the in-memory session in restricted browser contexts. */ }
  }

  function restore():Session {
    try {
      const saved=readStorage(storageKey);
      const parsed=saved?JSON.parse(saved) as Session:undefined;
      if ((parsed?.preferencesVersion===2 || parsed?.preferencesVersion===3) && parsed.profile && Array.isArray(parsed.orders)) {localChanged=true;return parsed;}
    } catch { /* A corrupted session can be replaced with the sample state. */ }
    return seed();
  }

  function remote(path:string,options:RequestInit={}) {
    const headers=new Headers(options.headers);
    if (token&&!bodySession) headers.set(sessionHeader,token);
    return fetcher(backend+path+"?daily=manual",{...options,headers,credentials:sameOrigin?"same-origin":"omit"});
  }

  function jsonBody(body:Record<string,unknown>) {
    return {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)};
  }

  async function connect() {
    if(!sameOrigin) token=token??readStorage(sessionKey);
    const resume=bodySession&&token?jsonBody({sessionId:token}):{};
    const response=await remote("session",{...resume,signal:timeoutSignal(12000)});
    const data=await sessionResponse(response);
    if(!sameOrigin) {
      const id=response.headers.get(sessionHeader);
      if (!id) throw new CloudError("云端会话尚未建立。",502);
      token=id;
      writeStorage(sessionKey,id);
    }
    usingBackend=true;
    return data;
  }

  return {
    async load() {
      try {if (backend) return await retry(connect); }
      catch { /* Keep the local session usable when the cloud is unreachable. */ }
      usingBackend=false;
      localSession=await freshen(localSession??restore(),localModel);
      return localSession;
    },
    async act(path:string,body:Record<string,unknown>) {
      if (backend && !usingBackend && !localChanged && ["messages","recommendations/daily","preferences/today"].includes(path)) {
        // A cold-start timeout can clear while the visitor chooses what to eat.
        // Once offline work exists, reconnect explicitly so it is not discarded silently.
        try {await connect();} catch { /* Continue in the existing local session. */ }
      }
      if (usingBackend) {
        const request=jsonBody(bodySession?{...body,sessionId:token}:body);
        try {
          return await retry(async()=>sessionResponse(await remote(path,{
            ...request,
            signal:timeoutSignal(30000),
          })));
        } catch(error) {
          if (isTransient(error)) throw new Error("云端请求超时或网络暂时不可用，请重试。");
          throw error;
        }
      }
      const session=await freshen(JSON.parse(JSON.stringify(localSession??restore())) as Session,localModel);
      localSession=await applyAction(session,localModel,path,body);
      localChanged=true;
      writeStorage(storageKey,JSON.stringify(localSession));
      return localSession;
    },
    transcribe(audio:FormData,signal:AbortSignal) {
      if (bodySession&&token) audio.set("sessionId",token);
      return remote("transcriptions",{method:"POST",body:audio,signal});
    },
  };
}
