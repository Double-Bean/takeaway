"use client";

import { useRef, useState } from "react";
import { normalizeBailianKey } from "@/lib/lunch-byok";

export function LunchApiSettings({active,hasDefault,onApply}:{active:boolean;hasDefault:boolean;onApply:(key:string|null)=>Promise<void>}) {
  const keyInput=useRef<HTMLInputElement>(null);
  const [editing,setEditing]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const clearing=active&&!editing;

  return <form className="api-key-form" autoComplete="off" onSubmit={async event=>{
    event.preventDefault();
    if(busy)return;
    setError("");
    const key=clearing?null:normalizeBailianKey(keyInput.current?.value??"");
    if(!clearing&&!key){setError("请复制以 sk- 开头的完整百炼 Key。带星号或省略号的列表值无法使用。");return;}
    setBusy(true);
    try {
      await onApply(key);
      if(keyInput.current)keyInput.current.value="";
      setEditing(false);
    } catch(err) {
      setError(err instanceof Error?err.message:"连接失败，请稍后再试。");
    } finally {setBusy(false);}
  }}>
    <p className="muted">{active?"当前使用你的 Key":hasDefault?"已配置默认百炼 API":"可以连接你的百炼 API"}</p>
    <label htmlFor="lunch-bailian-key">百炼 API Key</label>
    <div className="api-key-row">
      <input id="lunch-bailian-key" ref={keyInput} type="password" readOnly={busy} autoComplete="off" autoCapitalize="none" spellCheck={false}
        placeholder={active||hasDefault?"粘贴新 Key 以更换":"粘贴完整的 sk-…"}
        onInput={event=>{setEditing(Boolean(event.currentTarget.value.trim()));setError("");}}
        onPaste={event=>{
          const key=normalizeBailianKey(event.clipboardData.getData("text"));
          if(!key)return;
          event.preventDefault();
          event.currentTarget.value=key;
          setEditing(true);
          setError("");
        }}/>
      <button className="primary" type="submit" disabled={busy}>{busy?"连接中…":clearing?(hasDefault?"恢复默认":"清除"):(hasDefault||active)?"更换":"连接"}</button>
    </div>
    {error&&<p className="api-key-error" role="alert">{error}</p>}
    <p className="muted">北京地域 · 千问 3.8 Omni Flash · 自定义 Key 仅本次会话有效</p>
  </form>;
}
