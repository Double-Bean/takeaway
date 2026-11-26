import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import type { LunchStore, SessionRow } from "../lib/lunch-api";
import type { Session } from "../lib/lunch-types";
import { createScfServer } from "../scf/http";

test("GitHub Pages establishes a session, retries a chat write and uploads audio to SCF",async()=>{
  const rows=new Map<string,SessionRow>();
  const store:LunchStore={
    async load(id) {return rows.get(id)??null;},
    async save(id,revision,state) {
      const current=rows.get(id)?.revision??null;
      if (current!==revision) return false;
      rows.set(id,{state,revision:revision===null?0:revision+1});
      return true;
    },
    async spend() {return true;}
  };
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async (input,init)=>{
    if (!String(input).startsWith("https://dashscope.aliyuncs.com/")) return originalFetch(input,init);
    const upstream=JSON.parse(String(init?.body));
    const audio=upstream.messages.at(-1).content.some((part:{type:string})=>part.type==="input_audio");
    const content=audio?"今天想吃炸猪排饭":'{}';
    return new Response("data: "+JSON.stringify({choices:[{delta:{content}}]})+"\n\ndata: [DONE]\n\n");
  };
  const server=createScfServer(store,{LUNCH_DEFAULT_BAILIAN_KEY:"fixture"});
  try {
    server.listen(0,"127.0.0.1");
    await once(server,"listening");
    const origin="https://double-bean.github.io";
    const api=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/`;
    const preflight=await fetch(api+"messages",{method:"OPTIONS",headers:{Origin:origin,"Access-Control-Request-Headers":"content-type,x-lunch-session","Access-Control-Request-Method":"POST"}});
    assert.equal(preflight.status,204);
    assert.equal(preflight.headers.get("access-control-allow-origin"),origin);
    assert.match(preflight.headers.get("access-control-allow-headers")??"",/X-Lunch-Session/i);

    const session=await fetch(api+"session?daily=manual",{headers:{Origin:origin}});
    assert.equal(session.status,200);
    assert.equal(session.headers.get("access-control-expose-headers"),"X-Lunch-Session");
    const token=session.headers.get("x-lunch-session");
    assert.ok(token);
    assert.equal(((await session.json()) as Session).mode,"dashscope");

    const body=JSON.stringify({requestId:crypto.randomUUID(),text:"想吃炸猪排饭"});
    const chat=()=>fetch(api+"messages?daily=manual",{method:"POST",headers:{Origin:origin,"X-Lunch-Session":token,"Content-Type":"application/json"},body});
    const message=await chat();
    assert.equal(message.status,200);
    const state=await message.json() as Session;
    assert.equal(state.batch?.card?.dish.name,"日式炸猪排饭");
    assert.deepEqual(await (await chat()).json(),state);
    assert.equal(rows.get(token)?.revision,1);

    const form=new FormData();
    form.set("audio",new File([new Uint8Array(256)],"lunch.wav",{type:"audio/wav"}));
    const speech=await fetch(api+"transcriptions",{method:"POST",headers:{Origin:origin,"X-Lunch-Session":token},body:form});
    assert.equal(speech.status,200);
    assert.deepEqual(await speech.json(),{text:"今天想吃炸猪排饭"});

    const oversized=await fetch(api+"messages",{method:"POST",headers:{Origin:origin},body:"a".repeat(12_001)});
    assert.equal(oversized.status,413);
    assert.equal(oversized.headers.get("access-control-allow-origin"),origin);
    const forbidden=await fetch(api+"messages",{method:"POST",headers:{Origin:"https://untrusted.invalid"},body});
    assert.equal(forbidden.status,403);
    assert.equal(forbidden.headers.get("access-control-allow-origin"),null);
  } finally {
    globalThis.fetch=originalFetch;
    if (server.listening) await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  }
});
