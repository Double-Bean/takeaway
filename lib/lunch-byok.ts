export const omniModel="qwen3.8-omni-flash";
export const personalModelSettings={base:"https://llm-5ezj6ototzdoanzf.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",text:omniModel,speech:omniModel,vector:""};

export function normalizeBailianKey(input:string) {
  if(input.length>1024) return null;
  let key=input.replace(/[\u200B-\u200D\u2060\uFEFF]/g,"").trim();
  key=key.replace(/^(?:export\s+)?(?:DASHSCOPE_API_KEY|API\s*Key|Authorization)\s*[:：=]\s*/i,"");
  key=key.replace(/^(["'“‘])([\s\S]*?)["'”’]$/,"$2").trim();
  key=key.replace(/^Bearer\s+/i,"").trim();
  key=key.replace(/^(["'“‘])([\s\S]*?)["'”’]$/,"$2").trim();
  if(key.includes("...")||!/^sk-[A-Za-z0-9._~+/-]{6,500}={0,2}$/.test(key)) return null;
  return key;
}
