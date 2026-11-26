"use client";

import { useRef, useState } from "react";
import { modelOptions, normalizeApiKey, omniModel, type PersonalModelId } from "@/lib/lunch-byok";

export function LunchApiSettings({active,onApply}:{active:PersonalModelId|null;onApply:(key:string|null,model:PersonalModelId)=>Promise<void>}) {
  const keyInput=useRef<HTMLInputElement>(null);
  const [model,setModel]=useState<PersonalModelId>(active??omniModel);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");

  async function apply(key:string|null) {
    setError("");
    setBusy(true);
    try {
      await onApply(key,model);
      if(keyInput.current)keyInput.current.value="";
    } catch(err) {
      setError(err instanceof Error?err.message:"连接失败，请稍后再试。");
    } finally {setBusy(false);}
  }

  return <form className="api-key-form" autoComplete="off" onSubmit={event=>{
    event.preventDefault();
    if(busy)return;
    const key=normalizeApiKey(keyInput.current?.value??"");
    if(!key){setError("请输入完整的 API Key。");return;}
    void apply(key);
  }}>
    <label htmlFor="lunch-api-model">模型</label>
    <select id="lunch-api-model" value={model} disabled={busy} onChange={event=>{setModel(event.target.value as PersonalModelId);setError("");}}>
      {modelOptions.map(option=><option key={option.id} value={option.id}>{option.label}</option>)}
    </select>
    <label htmlFor="lunch-api-key">API Key</label>
    <div className="api-key-row">
      <input id="lunch-api-key" ref={keyInput} type="password" readOnly={busy} autoComplete="off" autoCapitalize="none" spellCheck={false}
        placeholder={active?"输入新的 API Key":"输入 API Key"} onInput={()=>setError("")}/>
      <button className="primary" type="submit" disabled={busy}>{busy?"连接中…":"连接"}</button>
    </div>
    {error&&<p className="api-key-error" role="alert">{error}</p>}
    {active&&<button className="text-btn api-reset" type="button" disabled={busy} onClick={()=>void apply(null)}>恢复默认</button>}
  </form>;
}
