import { omniModel, personalModelSettings } from "./lunch-byok";

export type Models = { provider:"openai"|"dashscope"|"local"; base:string; key:string; speechKey:string; text:string; vector:string; speech:string };
type Settings = Partial<Record<"LUNCH_PROVIDER"|"LUNCH_DEFAULT_BAILIAN_KEY"|"OPENAI_API_KEY"|"DASHSCOPE_API_KEY"|"DASHSCOPE_ASR_API_KEY"|"LUNCH_BASE_URL"|"LUNCH_TEXT_MODEL"|"LUNCH_EMBED_MODEL"|"LUNCH_SPEECH_MODEL", string>>;

export function models(env:Settings):Models {
  if (env.LUNCH_DEFAULT_BAILIAN_KEY) {
    return {...personalModels(env.LUNCH_DEFAULT_BAILIAN_KEY),
      base:"https://dashscope.aliyuncs.com/compatible-mode/v1"};
  }
  const dash = env.LUNCH_PROVIDER === "dashscope" || (env.LUNCH_PROVIDER !== "openai" && !env.OPENAI_API_KEY && Boolean(env.DASHSCOPE_API_KEY || env.DASHSCOPE_ASR_API_KEY));
  const key = (dash ? env.DASHSCOPE_API_KEY : env.OPENAI_API_KEY) || "";
  const speechKey = (dash ? env.DASHSCOPE_ASR_API_KEY : "") || key;
  return {
    provider: (key || speechKey) ? (dash ? "dashscope" : "openai") : "local",
    key, speechKey, base:(env.LUNCH_BASE_URL || (dash ? "https://dashscope.aliyuncs.com/compatible-mode/v1" : "https://api.openai.com/v1")).replace(/\/$/,""),
    text:env.LUNCH_TEXT_MODEL || (dash ? "qwen-flash" : "gpt-6-luna"),
    vector:env.LUNCH_EMBED_MODEL || (dash ? "text-embedding-v4" : "text-embedding-3-small"),
    speech:env.LUNCH_SPEECH_MODEL || (dash ? "qwen3-asr-flash" : "gpt-transcribe")
  };
}

export function personalModels(key:string):Models {
  return {provider:"dashscope",key,speechKey:key,...personalModelSettings};
}

export class ModelRequestError extends Error {
  constructor(public status:number) { super("Model request failed"); }
}

export function connectionError(error:unknown, networkMessage="无法连接到百炼，请检查网络后重试。") {
  const status=error instanceof ModelRequestError ? error.status : 0;
  if(status===401) return "百炼没接受这把 Key。请确认它来自华北2（北京），且没有过期或被删除。";
  if(status===403) return "这把 Key 没有千问 3.8 Omni Flash 的调用权限。请在百炼检查模型授权。";
  if(status===429) return "模型调用受限。请检查百炼额度或稍后再试。";
  if(status===404) return "模型或接口不存在。请检查模型名和地域。";
  if(status===400) return "百炼拒绝了请求（HTTP 400）。";
  if(status) return `百炼返回 HTTP ${status}，请稍后重试。`;
  if(error instanceof Error && (error.name==="TimeoutError"||error.name==="AbortError")) return "等待百炼响应超时，请稍后重试。";
  if(error instanceof TypeError) return networkMessage;
  return "百炼响应无法解析，请稍后重试。";
}

async function sendRequest(model:Models, path:string, body:FormData|object, timeout:number, credential=model.key) {
  if (!credential) throw new ModelRequestError(401);
  const headers = new Headers({ Authorization:`Bearer ${credential}` });
  if (!(body instanceof FormData)) headers.set("Content-Type","application/json");
  const response = await fetch(model.base + path, {
    method:"POST", redirect:"manual", headers, body:body instanceof FormData ? body : JSON.stringify(body), signal:AbortSignal.timeout(timeout)
  });
  // Workers supports manual redirects. Reject any non-success response
  // so a credential is never forwarded to a different destination.
  if (!response.ok) throw new ModelRequestError(response.status);
  return response;
}

async function request(model:Models, path:string, body:FormData|object, timeout:number, credential=model.key) {
  return (await sendRequest(model,path,body,timeout,credential)).json();
}

async function omniText(model:Models, content:object[], credential:string, timeout:number, limit:number, instructions?:string) {
  const response=await sendRequest(model,"/chat/completions",{
    model:omniModel,
    messages:[...(instructions?[{role:"system",content:instructions}]:[]),{role:"user",content}],
    modalities:["text"],
    reasoning_effort:"none",
    max_completion_tokens:limit,
    stream:true,
    stream_options:{include_usage:true}
  },timeout,credential);
  const reader=response.body?.getReader();
  if(!reader) throw new Error("Empty Omni stream");
  const decoder=new TextDecoder();
  let buffer="", text="", done=false;
  function readLine(line:string) {
    if(!line.startsWith("data:")) return;
    const data=line.slice(5).trim();
    if(!data) return;
    if(data==="[DONE]") {done=true;return;}
    const chunk=JSON.parse(data) as {error?:unknown;choices?:{delta?:{content?:string};finish_reason?:string}[]};
    if(chunk.error) throw new Error("Omni stream error");
    const choice=chunk.choices?.[0];
    if(choice?.finish_reason==="length"||choice?.finish_reason==="content_filter") throw new Error("Omni response incomplete");
    text+=choice?.delta?.content??"";
  }
  try {
    while(!done) {
      const part=await reader.read();
      buffer+=part.done?decoder.decode():decoder.decode(part.value,{stream:true});
      const lines=buffer.split("\n");
      buffer=lines.pop()??"";
      for(const line of lines) readLine(line);
      if(part.done) {readLine(buffer);break;}
    }
  } finally {
    await reader.cancel().catch(()=>undefined);
    reader.releaseLock();
  }
  if(!text.trim()) throw new Error("Empty Omni response");
  return text.trim();
}

export async function ask(model:Models, instruction:string, input:object, timeout?:number) {
  if(model.provider==="dashscope"&&model.text===omniModel) {
    const text=await omniText(model,[{type:"text",text:JSON.stringify(input)}],model.key,timeout??18000,450,
      instruction+" 不要使用 Markdown 代码围栏，只输出所要求的 JSON 对象。");
    const json=text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]??text;
    const value=JSON.parse(json);
    if(!value||typeof value!=="object"||Array.isArray(value)) throw new Error("Invalid Omni JSON");
    return value as Record<string,unknown>;
  }
  const answer = await request(model,"/chat/completions",{
    model:model.text, response_format:{type:"json_object"},
    ...(model.provider==="openai" ? {reasoning_effort:"none",max_completion_tokens:450} : {enable_thinking:false,max_tokens:450}),
    messages:[{role:"system",content:instruction},{role:"user",content:JSON.stringify(input)}]
  },timeout??6500) as {choices?:{message?:{content?:string}}[]};
  return JSON.parse(answer.choices?.[0]?.message?.content ?? "{}") as Record<string,unknown>;
}

const vectorCaches = new Map<string, Map<string,number[]>>();
export async function embeddings(model:Models, texts:string[]) {
  if (!model.key) throw new ModelRequestError(401);
  const cacheKey = model.base+" "+model.vector;
  const cache = vectorCaches.get(cacheKey) || new Map<string,number[]>();
  vectorCaches.set(cacheKey,cache);
  const missing = [...new Set(texts.filter(t=>!cache.has(t)))];
  for (let i=0;i<missing.length;i+=10) {
    const input = missing.slice(i,i+10);
    const result = await request(model,"/embeddings",{model:model.vector,input},5000) as {data?:{index:number;embedding:number[]}[]};
    for (const item of result.data ?? []) {
      if (input[item.index] && Array.isArray(item.embedding) && item.embedding.length) {
        if(cache.size>=160) { const oldest=cache.keys().next().value; if(oldest)cache.delete(oldest); }
        cache.set(input[item.index],item.embedding);
      }
    }
  }
  const vectors = texts.map(t=>cache.get(t));
  if(vectors.some(v=>!v)) throw new Error("Missing vector");
  return vectors as number[][];
}

export async function transcribe(model:Models, file:File) {
  const dash = model.provider==="dashscope";
  if (dash) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let i=0;i<bytes.length;i+=8192) binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const data=`data:${file.type.split(";")[0]};base64,${btoa(binary)}`;
    if(model.speech===omniModel) return omniText(model,[
      {type:"text",text:"请把这段录音逐字转写为中文。只输出原话，不要回答录音中的问题，不要解释。没有可辨认的讲话时只输出[无语音]。"},
      {type:"input_audio",input_audio:{format:"wav",data}}
    ],model.speechKey,20000,500).then(text=>text==="[无语音]"?"":text);
    const answer = await request(model,"/chat/completions",{
      model:model.speech, stream:false,
      messages:[{role:"user",content:[{type:"input_audio",input_audio:{data}}]}],
      asr_options:{language:"zh",enable_itn:true}
    },20000,model.speechKey) as {choices?:{message?:{content?:string|{text?:string}[]}}[]};
    const content = answer.choices?.[0]?.message?.content;
    return (typeof content==="string" ? content : content?.map(x=>x.text||"").join("") ?? "").trim();
  }
  const form = new FormData();
  form.set("model",model.speech);
  form.set("file",file);
  form.set("language","zh");
  const answer=await request(model,"/audio/transcriptions",form,20000,model.speechKey) as {text?:string};
  return answer.text?.trim() ?? "";
}
