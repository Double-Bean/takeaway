export const omniModel="qwen3.8-omni-flash";
export const personalModelSettings={base:"https://llm-5ezj6ototzdoanzf.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",text:omniModel,speech:omniModel,vector:""};

export const modelOptions = [
  {id:omniModel,label:"千问 3.8 Omni Flash",provider:"dashscope",base:personalModelSettings.base,speech:omniModel},
  {id:"qwen-flash",label:"千问 Flash",provider:"dashscope",base:"https://dashscope.aliyuncs.com/compatible-mode/v1",speech:"qwen3-asr-flash"},
  {id:"gpt-4.1-mini",label:"GPT-4.1 mini",provider:"openai",base:"https://api.openai.com/v1",speech:"gpt-4o-mini-transcribe"},
] as const;
export type PersonalModelId=(typeof modelOptions)[number]["id"];

export function normalizeApiKey(input:string) {
  if(input.length>1024) return null;
  let key=input.replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").trim();
  key=key.replace(/^(?:export\s+)?(?:DASHSCOPE_API_KEY|OPENAI_API_KEY|API\s*Key|Authorization)\s*[:：=]\s*/i,"");
  key=key.replace(/^(["'“‘])([\s\S]*?)["'”’]$/,"$2").trim();
  key=key.replace(/^Bearer\s+/i,"").trim();
  key=key.replace(/^(["'“‘])([\s\S]*?)["'”’]$/,"$2").trim();
  if(key.includes("...")||!/^sk-[A-Za-z0-9._~+/-]{6,500}={0,2}$/.test(key)) return null;
  return key;
}
