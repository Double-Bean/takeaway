import { createRoot } from "react-dom/client";
import LunchApp, { type LunchTransport } from "@/components/lunch-app";
import { applyAction, freshen } from "@/lib/lunch-actions";
import { seed } from "@/lib/lunch-engine";
import { models } from "@/lib/lunch-models";
import type { Session } from "@/lib/lunch-types";
import "@/app/globals.css";

const storageKey="takeaway-lunch-session-v2";
const localModel=models({});
const backend="https://lunch-chat-5529.cladswan16.chatgpt.site/api/";
const remoteKey="takeaway-pages-session";
const sessionHeader="X-Lunch-Session";
let token:string|null=null;
let usingBackend=false;
let current:Session|undefined;

function restore():Session {
  try {
    const saved=localStorage.getItem(storageKey);
    if (saved) {
      const session=JSON.parse(saved) as Session;
      if (session.preferencesVersion===2 && session.profile && Array.isArray(session.orders)) return session;
    }
  } catch {
    // Private browsing or a corrupted value can still start a fresh session.
  }
  return seed();
}

function save(session:Session):Session {
  current=session;
  try {
    localStorage.setItem(storageKey,JSON.stringify(session));
  } catch {
    // If storage is unavailable, keep the current tab functional in memory.
  }
  return session;
}

function storedToken() {
  try { return localStorage.getItem(remoteKey); }
  catch { return null; }
}

async function remote(path:string,options:RequestInit={}) {
  const headers=new Headers(options.headers);
  if (token) headers.set(sessionHeader,token);
  return fetch(backend+path,{...options,headers,credentials:"omit"});
}

async function sessionResponse(response:Response) {
  const data=await response.json() as Session&{error?:string};
  if (!response.ok) throw new Error(data.error||"云端午餐服务暂不可用。");
  return data;
}

const transport:LunchTransport={
  async load() {
    try {
      token=token??storedToken();
      const reply=await remote("session",{signal:AbortSignal.timeout(7000)});
      const data=await sessionResponse(reply);
      const id=reply.headers.get(sessionHeader);
      if (!id) throw new Error("云端会话尚未建立。");
      token=id;
      try { localStorage.setItem(remoteKey,id); } catch { /* Continue in this tab. */ }
      usingBackend=true;
      return data;
    } catch {
      usingBackend=false;
      return save(await freshen(current??restore(),localModel));
    }
  },
  async act(path, body) {
    if (usingBackend) return sessionResponse(await remote(path,{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
      signal:AbortSignal.timeout(30000),
    }));
    const session=await freshen(structuredClone(current??restore()),localModel);
    return save(await applyAction(session,localModel,path,body));
  },
  transcribe(audio,signal) {
    return remote("transcriptions",{method:"POST",body:audio,signal});
  },
};

const root=document.getElementById("root");
if (!root) throw new Error("Missing application root.");
createRoot(root).render(<LunchApp transport={transport} />);
