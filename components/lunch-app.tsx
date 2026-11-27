"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, ChefHat, Menu as MenuIcon, ChevronDown, ChevronRight, Clock3, Flame, History, KeyRound, Leaf, Mic, RefreshCw, Send, Settings2, Sparkles, Square, Wallet, X } from "lucide-react";
import { categories, dishById, feedbackReasons, flavors, foods, menu, staples, type Category, type Dish } from "@/lib/lunch-data";
import type { Card, Pref, Session } from "@/lib/lunch-types";
import type { PersonalModelId } from "@/lib/lunch-byok";
import { LunchApiSettings } from "@/components/lunch-api-settings";
import { isLegacyDailyPreview } from "@/lib/lunch-actions";
import { toSpeechWav } from "@/lib/lunch-audio";
import { activeCategory, categoryPreference, effective, requestInterpretation, uuid } from "@/lib/lunch-engine";
import { timeoutSignal } from "@/lib/lunch-network";
import { ask, connectionError, personalModels, transcribe, type Models } from "@/lib/lunch-models";

type Panel = "profile"|"today"|"evidence"|"orders"|"compare"|"confirm"|"microphone"|"api"|"menu";
type Recording = "off"|"recording"|"transcribing";
type NativeSpeech = {
  lang:string; continuous:boolean; interimResults:boolean;
  onresult:((e:{results:ArrayLike<ArrayLike<{transcript:string}>>})=>void)|null;
  onerror:(()=>void)|null; onend:(()=>void)|null;
  start:()=>void; stop:()=>void; abort:()=>void;
};
function browserSpeech() {
  const speechWindow=window as unknown as {SpeechRecognition?:new()=>NativeSpeech;webkitSpeechRecognition?:new()=>NativeSpeech};
  return speechWindow.SpeechRecognition??speechWindow.webkitSpeechRecognition;
}
const dateLabel=(date:string)=>date.slice(5).replace("-"," 月 ")+" 日";
const displayPrice=(price:number)=>Number(price.toFixed(2));
function PrefChips({value,category,staple,onClick}:{value:Pref;category:Category;staple?:Dish["staple"];onClick:()=>void}) {
  const tags=[
    category,
    value.budget!==null?`¥${displayPrice(value.budget)} 内`:value.target!==null?`约 ¥${value.target}`:"预算不限",
    value.flavor==="不限"?"不限口味":`偏${value.flavor}`,
    ...(category==="主食"?(staple&&staple!=="无"?[staple]:staple==="无"?["不含主食"]:value.staple!=="不限"?[value.staple]:[]):[]),
    ...(value.servings?[value.servings+" 人份"]:[]),
    ...(value.maxEta?[value.maxEta+" 分钟内"]:[]),
    ...(value.avoid.length?[`避开${value.avoid.join("、")}`]:[])
  ];
  return <div className="condition-chips">{tags.map(tag=><button key={tag} type="button" onClick={onClick}>{tag}</button>)}</div>;
}

function Drawer({title,children,onClose}:{title:string;children:ReactNode;onClose:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return ()=>dialog?.close();},[]);
  return <dialog ref={ref} className="drawer" aria-labelledby="drawer-title" onCancel={onClose}
    onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="drawer-inner">
      <header><h2 id="drawer-title">{title}</h2><button aria-label="关闭" className="icon-btn" onClick={onClose}><X size={20}/></button></header>
      <div className="drawer-body">{children}</div>
    </div>
  </dialog>;
}

function Preferences({value,hideQuick,scope,category,quick,onSave,onReset,onDelete,busy}:{
  value:Pref;hideQuick:boolean;scope:"global"|"category"|"current";category:Category;quick:Session["quick"];onSave:(patch:Partial<Pref>,hideQuick:boolean)=>void;
  onReset:()=>void;onDelete:(id?:string)=>void;busy:boolean;
}) {
  const [draft,setDraft]=useState(value);
  const [hidden,setHidden]=useState(hideQuick);
  const [ingredient,setIngredient]=useState("");
  const update=<K extends keyof Pref>(key:K,value:Pref[K])=>setDraft(old=>({...old,[key]:value}));
  return <form className="prefs" onSubmit={event=>{
    event.preventDefault();
    const patch=Object.fromEntries(Object.entries(draft).filter(([key,val])=>val!==value[key as keyof Pref])) as Partial<Pref>;
    onSave(patch,hidden);
  }}>
    <p className="muted">{scope==="global"?"适用于所有菜品类别。":scope==="category"?`保存后用于之后的${category}推荐。`:`只用于这轮${category}推荐，下单或改点其他菜时清除。`}</p>
    {scope!=="global"&&<><div className="fields">
      <label>预算上限（元）<input type="number" min="1" max="300" step="0.01" placeholder="不限" value={draft.budget??""} onChange={e=>setDraft(old=>({...old,budget:e.target.value?Number(e.target.value):null,target:null}))}/></label>
      <label>口味<select value={draft.flavor} onChange={e=>update("flavor",e.target.value as Pref["flavor"])}>{["不限",...flavors].map(x=><option key={x}>{x}</option>)}</select></label>
      {category==="主食"&&<label>主食<select value={draft.staple} onChange={e=>update("staple",e.target.value as Pref["staple"])}>{staples.map(x=><option key={x}>{x}</option>)}</select></label>}
        <label>用餐人数<select value={draft.servings??""} onChange={e=>update("servings",e.target.value?Number(e.target.value):null)}>
          <option value="">不限</option>{[1,2,3,4].map(n=><option key={n} value={n}>{n} 人份</option>)}
        </select></label>
        <label>送达时间<select value={draft.maxEta??""} onChange={e=>update("maxEta",e.target.value?Number(e.target.value):null)}>
          <option value="">不限</option>{[...new Set([25,30,35,40,45,...(draft.maxEta?[draft.maxEta]:[])])].sort((a,b)=>a-b).map(n=><option key={n} value={n}>{n} 分钟内</option>)}
        </select></label>
    </div>
    <div className="checks">
      <label><input type="checkbox" checked={draft.lowOil} onChange={e=>update("lowOil",e.target.checked)}/>优先少油</label>
      <label><input type="checkbox" checked={draft.noFry} onChange={e=>update("noFry",e.target.checked)}/>优先非油炸</label>
    </div></>}
    {scope==="global"&&<>
      <div className="avoid-head"><strong>忌口</strong><input aria-label="搜索食材" placeholder="搜索食材" value={ingredient} onChange={e=>setIngredient(e.target.value)}/></div>
      <div className="ingredient-list">{foods.filter(x=>x.includes(ingredient)).map(food=><button className={draft.avoid.includes(food)?"chosen":""} type="button" key={food} aria-pressed={draft.avoid.includes(food)}
        onClick={()=>update("avoid",draft.avoid.includes(food)?draft.avoid.filter(x=>x!==food):[...draft.avoid,food])}>{food}</button>)}
        {!foods.some(x=>x.includes(ingredient))&&<p className="muted">没有匹配的食材。</p>}
      </div>
      <div className="quick-prefs">
        <label><input type="checkbox" checked={!hidden} onChange={e=>setHidden(!e.target.checked)}/> 显示快捷输入</label>
        <button type="button" className="text-btn" disabled={busy||!quick.length} onClick={()=>onDelete()}>清空记录</button>
      </div>
      {quick.filter(q=>!q.sample).slice(0,10).map(q=><div className="quick-row" key={q.id}><span>{q.text}</span><button type="button" className="text-btn" disabled={busy} onClick={()=>onDelete(q.id)}>删除</button></div>)}
    </>}
    <div className="drawer-actions">
      {scope==="current"&&<button type="button" className="secondary" disabled={busy} onClick={onReset}>清除本轮条件</button>}
      <button className="primary" disabled={busy} type="submit">{scope==="current"?"更新本轮推荐":"保存长期偏好"}</button>
    </div>
  </form>;
}

function DishVisual({dish,hero=false,lazy=false}:{dish:Dish;hero?:boolean;lazy?:boolean}) {
  const image=dishById(dish.id)?.image??dish.image;
  return <img src={"./food/"+image+".webp"} alt={hero?dish.name+"示意图":""} loading={lazy?"lazy":"eager"} decoding="async"/>;
}

function MenuBrowser() {
  const [category,setCategory]=useState<Category>("主食");
  const dishes=menu.filter(dish=>dish.category===category);
  return <>
    <div className="menu-filters" role="group" aria-label="菜品分类">
      {categories.map(name=><button type="button" key={name} aria-pressed={name===category} onClick={()=>setCategory(name)}>{name}</button>)}
    </div>
    <div className="menu-grid">
      {dishes.map(dish=><article className="menu-item" key={dish.id}>
        <div className="menu-photo"><DishVisual dish={dish} hero lazy/>
          {!dish.available&&<span>今日售罄</span>}
        </div>
        <div className="menu-item-body">
          <h3>{dish.name}</h3>
          <p className="menu-shop">{dish.shop} · {dish.eta} 分钟</p>
          <p className="menu-meta">{dish.flavor} · {dish.portion} <strong>¥{displayPrice(dish.price)}</strong></p>
        </div>
      </article>)}
    </div>
  </>;
}

function DishCard({card,active,onOrder,onNext,onEvidence,busy}:{card:Card;active:boolean;onOrder:()=>void;onNext:()=>void;onEvidence:()=>void;busy:boolean}) {
  const dish=card.dish;
  const tags=[...(dish.servings>1?[dish.portion]:[]),dish.flavor,dish.category&&dish.category!=="主食"?dish.category:dish.lowOil?"少油":dish.method,dish.staple==="无"?"不含主食":`含${dish.staple}`];
  return <article className={"dish-card"+(active?"":" previous")}>
    <div className="dish-top">
      <div className="dish-photo"><DishVisual dish={dish} hero/><span>菜品示意图</span></div>
      <div className="dish-info">
        <div className="pick"><Sparkles size={14}/> 为你推荐</div>
        <h3>{dish.name}</h3>
        <div className="shop">{dish.shop}<span/> <Clock3 size={15}/>{dish.eta} 分钟</div>
        <div className="dish-tags">{tags.map((tag,i)=><span key={tag+i}>{tag}</span>)}</div>
        <div className="price">¥<strong>{displayPrice(dish.price)}</strong><span>模拟到手价</span></div>
      </div>
    </div>
    <div className="dish-reason">
      <p>{card.reason}</p>
      <button className="reason-btn" onClick={onEvidence}>为什么推荐 <ChevronDown size={15}/></button>
    </div>
    {active&&<div className="card-actions">
      <button type="button" className="primary" onClick={onOrder} disabled={busy}>就吃这份</button>
      <button type="button" className="secondary" onClick={onNext} disabled={busy}><RefreshCw size={16}/> 换一道</button>
    </div>}
  </article>;
}

const suggestions=[
  {label:"清爽少油",text:"今天想吃清爽少油一点，最好有米饭",icon:Leaf,tone:"green"},
  {label:"25 元以内",text:"今天午饭想控制在 25 元以内",icon:Wallet,tone:"gold"},
  {label:"香辣配饭",text:"今天想吃辣，最好有米饭",icon:Flame,tone:"red"},
  {label:"参考上一餐",text:"想吃像上次那种，帮我换一道",icon:History,tone:"blue"},
];

const names:Record<Panel,string>={api:"API 设置",profile:"我的偏好",today:"本轮条件",orders:"午饭订单",evidence:"为什么推荐这道",compare:"本轮排序",confirm:"确认模拟下单",microphone:"用语音说说今天想吃什么",menu:"查看模拟菜单"};
export type LunchTransport = {
  load():Promise<Session>;
  act(path:string, body:Record<string,unknown>):Promise<Session>;
  transcribe?(audio:FormData,signal:AbortSignal):Promise<Response>;
};

export default function LunchApp({transport}:{transport?:LunchTransport}) {
  const [session,setSession]=useState<Session>();
  const customConnection=useRef<Models|null>(null);
  const [activeModel,setActiveModel]=useState<PersonalModelId|null>(null);
  const [speechFallback,setSpeechFallback]=useState(false);
  const [welcome,setWelcome]=useState(true);
  const shell=useRef<HTMLDivElement>(null);
  const [panel,setPanel]=useState<Panel|null>(null);
  const [profileCategory,setProfileCategory]=useState<Category|"global">("主食");
  const [selected,setSelected]=useState<Card|null>(null);
  const [draft,setDraft]=useState("");
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [hint,setHint]=useState("");
  const [recording,setRecording]=useState<Recording>("off");
  const [elapsed,setElapsed]=useState(0);
  const [skipped,setSkipped]=useState<{batchId:string;dishId:string}|null>(null);
  const [draggingDraft,setDraggingDraft]=useState<string|null>(null);
  const [pendingUser,setPendingUser]=useState("");
  const feed=useRef<HTMLDivElement>(null);
  const input=useRef<HTMLTextAreaElement>(null);
  const recorder=useRef<MediaRecorder|null>(null);
  const streamRef=useRef<MediaStream|null>(null);
  const recognition=useRef<NativeSpeech|null>(null);
  const timer=useRef<ReturnType<typeof setInterval>|null>(null);
  const cancelled=useRef(false);
  const lock=useRef(false);
  const scrollToEnd=useRef(false);
  const microphoneConsent=useRef(false);

  async function setConnection(key:string|null,id:PersonalModelId) {
    const connection=key?personalModels(key,id):null;
    if(connection) {
      try {
        const result=await ask(connection,'请只返回 JSON 对象 {"ok":true}。',{test:true});
        if(result.ok!==true) throw new Error("Invalid connection response");
      } catch(error) {
        throw new Error(connectionError(error));
      }
    }
    customConnection.current=connection;
    setActiveModel(connection?id:null);
    microphoneConsent.current=false;
  }

  async function load() {
    if(lock.current)return;
    lock.current=true;
    setBusy(true);
    setError("");
    try {
      if (transport) {
        setSession(await transport.load());
        return;
      }
      const response=await fetch("/api/session",{cache:"no-store"});
      const data=await response.json() as Session & {error?:string};
      if(!response.ok) throw new Error(data.error);
      setSession(data);
    } catch(e) {setError(e instanceof Error?e.message:"连接失败，请重试。");}
    finally {lock.current=false;setBusy(false);}
  }

  useEffect(()=>{void load();},[]);
  useEffect(()=>{
    const viewport=window.visualViewport;
    if(!viewport)return;
    const update=()=>{
      if(viewport.scale===1) shell.current?.style.setProperty("--usable-height",Math.floor(viewport.height)+"px");
      else shell.current?.style.removeProperty("--usable-height");
    };
    update();
    viewport.addEventListener("resize",update);
    return()=>viewport.removeEventListener("resize",update);
  },[]);
  useEffect(()=>{
    if(scrollToEnd.current && feed.current) {
      feed.current.scrollTo({top:feed.current.scrollHeight,behavior:"smooth"});
      scrollToEnd.current=false;
    }
  },[session,pendingUser,welcome]);
  useEffect(()=>{
    const el=input.current;
    if(el){el.style.height="auto";el.style.height=Math.min(el.scrollHeight,98)+"px";}
  },[draft]);
  useEffect(()=>{
    const stop=()=>{
      cancelled.current=true;
      if(timer.current)clearInterval(timer.current);
      if(recorder.current?.state==="recording")recorder.current.stop();
      recognition.current?.abort();
      streamRef.current?.getTracks().forEach(t=>t.stop());
    };
    window.addEventListener("pagehide",stop);
    return()=>{stop();window.removeEventListener("pagehide",stop);};
  },[]);

  async function act(path:string,body:Record<string,unknown>={},scroll=true) {
    if(lock.current) return;
    lock.current=true;
    setBusy(true);
    setError("");
    try {
      let modelPatch:unknown;
      if(path==="messages"&&customConnection.current&&session&&typeof body.text==="string") {
        try {
          const result=await requestInterpretation(body.text,session,customConnection.current);
          modelPatch=result.patch??{};
        } catch(error) {
          setHint(connectionError(error)+" 本次按基础规则推荐。");
        }
      }
      const payload={...body,modelPatch,usePersonalModel:Boolean(customConnection.current),requestId:uuid()};
      let data:Session;
      if (transport) data=await transport.act(path,payload);
      else {
        const response=await fetch("/api/"+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
        const result=await response.json() as Session & {error?:string};
        if(!response.ok) throw new Error(result.error||"操作失败，请重试。");
        data=result;
      }
      scrollToEnd.current=scroll;
      setSession(data);
      return data as Session;
    } catch(e) {
      setError(e instanceof Error?e.message:"连接失败，请重试。");
    } finally {lock.current=false;setBusy(false);}
  }

  async function send(event?:FormEvent) {
    event?.preventDefault();
    const text=draft.trim();
    if(!session||!text||lock.current||recording!=="off")return;
    input.current?.blur();
    setWelcome(false);setSkipped(null);setHint("");scrollToEnd.current=true;setPendingUser(text);
    const next=await act("messages",{text});
    setPendingUser("");
    if(next)setDraft("");
  }

  function tick(toStop:()=>void) {
    let count=0;
    setElapsed(0);
    if(timer.current)clearInterval(timer.current);
    timer.current=setInterval(()=>{
      count++;
      setElapsed(count);
      if(count>=30){stopTimer();toStop();}
    },1000);
  }
  function stopTimer(){if(timer.current)clearInterval(timer.current);timer.current=null;}
  function stopVoice(cancel=false) {
    cancelled.current=cancel;
    stopTimer();
    if(recorder.current?.state==="recording")recorder.current.stop();
    if(recognition.current) {
      if(cancel)recognition.current.abort();
      else recognition.current.stop();
    }
    if(cancel)setRecording("off");
  }
  function finishVoice(text:string) {
    if(!text.trim()){setHint("没有识别到内容，可以重录或打字。");return;}
    setDraft(text.slice(0,240));
    setHint("已转写。检查后点发送。");
    requestAnimationFrame(()=>input.current?.focus());
  }
  async function beginVoice() {
    setPanel(null);
    setError("");
    setHint("");
    cancelled.current=false;
    const personal=customConnection.current;
    if(!personal&&(speechFallback||session?.mode==="local")) {
      const Speech=browserSpeech();
      if(!Speech){setHint("当前浏览器没有语音转写，云端模型也未配置。可以直接打字。");return;}
      const service=new Speech();
      let transcript="";
      recognition.current=service;
      service.lang="zh-CN";
      service.continuous=true;
      service.interimResults=false;
      service.onresult=e=>{transcript=Array.from(e.results,result=>result[0]?.transcript??"").join("");};
      service.onerror=()=>{if(!cancelled.current)setHint("浏览器语音转写不可用，请检查麦克风权限或直接打字。");};
      service.onend=()=>{recognition.current=null;stopTimer();setRecording("off");if(!cancelled.current&&transcript)finishVoice(transcript);};
      try{service.start();setRecording("recording");tick(()=>stopVoice());}
      catch{recognition.current=null;setHint("无法打开麦克风，可以直接打字。");}
      return;
    }
    if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==="undefined"){
      setHint("当前浏览器无法录音，可以直接打字。");return;
    }
    try {
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      streamRef.current=stream;
      const mime=["audio/webm;codecs=opus","audio/mp4","audio/webm","audio/ogg"].find(type=>MediaRecorder.isTypeSupported(type));
      const media=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
      const parts:BlobPart[]=[];
      recorder.current=media;
      media.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
      media.onstop=async ()=>{
        stream.getTracks().forEach(t=>t.stop());streamRef.current=null;recorder.current=null;
        if(cancelled.current){setRecording("off");return;}
        setRecording("transcribing");
        try {
          const type=media.mimeType||"audio/webm";
          const file=new Blob(parts,{type});
          if(file.size<128)throw new Error("没有录到内容，可以重录。");
          if(personal) {
            const wav=await toSpeechWav(file);
            const text=await transcribe(personal,wav).catch(error=>{throw new Error(connectionError(error));});
            if(!cancelled.current)finishVoice(text);
            return;
          }
          const form=new FormData();
          const extension=type.includes("mp4")?"m4a":type.includes("ogg")?"ogg":"webm";
          if(session?.mode==="dashscope") form.set("audio",await toSpeechWav(file));
          else form.set("audio",file,`lunch.${extension}`);
          const signal=timeoutSignal(23000);
          const result=transport?.transcribe?await transport.transcribe(form,signal):
            await fetch("/api/transcriptions",{method:"POST",body:form,signal});
          const data=await result.json().catch(()=>null) as {error?:string;text?:string}|null;
          if (!result.ok) {
            if ([429,502,503,504].includes(result.status) && !cancelled.current && browserSpeech()) {
              setSpeechFallback(true);
              microphoneConsent.current=false;
              setHint("云端语音暂时不可用。再点一次麦克风，可改用浏览器转写。");
              return;
            }
            throw new Error(data?.error||"转写失败，可以重录。");
          }
          if(!cancelled.current)finishVoice(data?.text??"");
        } catch(error) {
          if(cancelled.current)return;
          const networkOrDecode=error instanceof TypeError||error instanceof Error&&["AbortError","TimeoutError","EncodingError","NotSupportedError"].includes(error.name);
          if (!personal&&networkOrDecode&&browserSpeech()) {
            setSpeechFallback(true);
            microphoneConsent.current=false;
            setHint("云端录音暂时不可用。再点一次麦克风，可改用浏览器转写。");
          } else setHint(networkOrDecode?"录音转写暂时不可用，可以重录或打字。":error instanceof Error?error.message:"转写失败，可以重录或打字。");
        }
        finally{setRecording("off");}
      };
      media.onerror=()=>{setHint("录音出错，可以重录。");stopVoice(true);};
      media.start();setRecording("recording");tick(()=>stopVoice());
    } catch {streamRef.current?.getTracks().forEach(track=>track.stop());streamRef.current=null;setHint("没有获得麦克风权限。你可以在浏览器设置中开启，或直接打字。");}
  }
  function usePrompt(text:string) {
    if(draft.trim()&&draft!==text){setDraggingDraft(text);return;}
    setDraft(text);input.current?.focus();
  }
  const messages=session&&!isLegacyDailyPreview(session)?session.messages:[];
  const current=session?.batch?.card??null;
  const rankedDishes=(session?.ranking?.ids??(current?[current.dish.id]:[])).flatMap(id=>{const dish=dishById(id);return dish?[dish]:[];});
  const category=session?activeCategory(session):"主食";
  const conditions=session?effective(session):null;
  const visibleQuick=session?.quick.slice(0,3)??[];
  const lastMessage=messages[messages.length-1];
  const showInitial=messages.length===1 && messages[0].role==="assistant" && Boolean(messages[0].card);
  const activeCardId=[...messages].reverse().find(m=>m.card?.id===current?.id&&m.card?.dish.id===current?.dish.id)?.id;
  return <div className="shell" ref={shell}>
    <header className="topbar"><div className="top-inner">
      <button className="brand" type="button" aria-label="午餐助手首页" onClick={()=>{setWelcome(true);feed.current?.scrollTo(0,0);}}><span className="brand-icon"><ChefHat size={21}/></span><strong>午餐助手</strong></button>
      <div className="top-actions">
        <button className="prefs-button api-top-button" type="button" disabled={!session} onClick={()=>setPanel("api")}><KeyRound size={16}/> API 设置</button>
        <button className="prefs-button" type="button" disabled={!session} onClick={()=>setPanel("profile")} aria-label="我的偏好"><Settings2 size={18}/> <span>我的偏好</span></button>
      </div>
    </div></header>
    <main className={welcome?"feed welcome-feed":"feed thread-feed"} ref={feed} aria-label={welcome?"午餐助手首页":"午餐对话"}>
      {welcome? <section className="welcome">
        <h1>今天中午吃什么<span>？</span></h1>
        <p className="welcome-note">说说你今天的口味，我帮你挑一份。</p>
        <div className="welcome-choices" aria-label="快捷需求">
          {suggestions.map(({label,text,icon:Icon,tone})=><button type="button" key={label} className="welcome-chip" onClick={()=>usePrompt(text)} disabled={busy||recording!=="off"}><span className={`chip-icon ${tone}`}><Icon size={16}/></span>{label}</button>)}
        </div>
        {!session&&error?<button className="welcome-action" type="button" onClick={load}>重新连接</button>:
          <button className="welcome-action" type="button" disabled={!session||busy} onClick={async()=>{if(!messages.length&&!(await act("recommendations/daily",{},false)))return;scrollToEnd.current=messages.length>1;setWelcome(false);}}>
            {session ? (messages.length ? "继续午餐对话" : "查看今日推荐") : "正在准备推荐…"}
          </button>}
        <div className="welcome-links">
          <button className="browse-menu" type="button" onClick={()=>setPanel("menu")}><MenuIcon size={16}/> 浏览菜单</button>
          <button className="browse-menu" type="button" disabled={!session} onClick={()=>setPanel("compare")}>排序</button>
        </div>
        {!session&&error&&<p className="welcome-error" role="alert">{error}</p>}
      </section>:<div className="conversation">
        <div className="intro-line"><span>{session?dateLabel(session.day):"今天"} · 午餐对话</span><div className="intro-actions"><button type="button" className="demo-pill" disabled={!session} onClick={()=>setPanel("menu")}>菜单</button><button onClick={()=>setPanel("compare")} disabled={!session} className="demo-pill">排序</button></div></div>
        {conditions&&<div className="current-conditions"><button className="condition-caption" onClick={()=>setPanel("today")}>本轮条件 <ChevronRight size={13}/></button><PrefChips value={conditions} category={category} staple={session?.selection?.staple} onClick={()=>setPanel("today")}/></div>}
        {!session&&!error&&<div className="loading-card" role="status">正在准备今天的推荐…</div>}
        {!session&&error&&<div className="error-card"><p>{error}</p><button className="secondary" onClick={load}>重新加载</button></div>}
        {session&&!messages.length&&!pendingUser&&!busy&&!error&&<button type="button" className="welcome-action" onClick={()=>void act("recommendations/daily",{},false)}>查看今日推荐</button>}
        {messages.map(message=>{
          const card=message.card;
          const latest=message.id===activeCardId;
          return message.role==="user" ? <div className="user-line" key={message.id}><p>{message.text}</p></div> :
            <div className="assistant-line" key={message.id}>
              <span className="assistant-icon"><Sparkles size={16}/></span>
              <div className="assistant-body">
                <div className="assistant-name">午餐助手</div>
                <p className="assistant-text">{message.text}</p>
                {card&&latest&&!showInitial&&<div className="turn-conditions"><PrefChips value={card.conditions} category={card.dish.category} staple={session?.selection?.staple} onClick={()=>setPanel("today")}/></div>}
                {card&&<DishCard card={card} active={latest} busy={busy} onOrder={()=>{setSelected(card);setPanel("confirm");}}
                  onEvidence={()=>{setSelected(card);setPanel("evidence");}}
                  onNext={async()=>{const data={batchId:card.id,dishId:card.dish.id};if(await act("recommendations/next",data))setSkipped(data);}}/>}
                {message.order&&<div className="success-row"><span className="success-icon"><Check size={17}/></span><div><strong>{message.order.dish.name}</strong><small>模拟下单成功 · ¥{message.order.dish.price}</small></div><button type="button" onClick={()=>setPanel("orders")} className="text-btn">查看订单</button></div>}
                {message.proposal?.patch&&message===lastMessage&&<button className="secondary proposal" disabled={busy} onClick={()=>void act("preferences/profile",{patch:message.proposal?.patch,category:message.proposal?.category,merge:true})}>保存为长期偏好</button>}
              </div>
            </div>;
        })}
        {skipped&&<div className="feedback-strip"><span>为什么换一道？</span>
          <div>{feedbackReasons.map(reason=><button key={reason} disabled={busy} onClick={async()=>{if(await act("feedback",{...skipped,reason}))setSkipped(null);}}>{reason}</button>)}
          <button className="text-btn dismiss" disabled={busy} onClick={()=>setSkipped(null)}>跳过</button></div></div>}
        {pendingUser&&<><div className="user-line"><p>{pendingUser}</p></div><div role="status" className="pending">正在找符合条件的午饭…</div></>}
      </div>}
    </main>
    <footer className="composer">
      <div className="composer-inner">
        {transport&&session?.mode==="local"&&<div className="composer-hint">本地推荐模式<button type="button" className="text-btn" disabled={busy||recording!=="off"} onClick={()=>void load()}>重连 AI</button></div>}
        {error&&session&&<div role="alert" className="inline-error">{error}</div>}
        {draggingDraft&&<div className="composer-hint">替换当前草稿？ <button className="text-btn" onClick={()=>{setDraft(draggingDraft);setDraggingDraft(null);input.current?.focus();}}>替换</button> <button className="text-btn" onClick={()=>setDraggingDraft(null)}>取消</button></div>}
        {hint&&<div className="composer-hint" role="status">{hint}<button className="text-btn" aria-label="关闭提示" onClick={()=>setHint("")}><X size={15}/></button></div>}
        {!!visibleQuick.length&&!session?.hideQuick&&recording==="off"&&!welcome&&
          <div className="quick"><span>{visibleQuick.some(q=>!q.sample)?"最近用过":"示例输入"}</span>{visibleQuick.map(q=><button type="button" key={q.id} onClick={()=>usePrompt(q.text)} title={q.text}>{q.text}</button>)}</div>}
        {recording==="off" ? <form className="input-box" onSubmit={send}>
          <textarea ref={input} placeholder="说说今天想吃什么…" aria-label="今天想吃什么" maxLength={240} rows={1} value={draft} onChange={e=>setDraft(e.target.value)}
            onKeyDown={event=>{if(event.key==="Enter"&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();void send();}}}/>
          <button type="button" className="icon-btn mic" aria-label="语音输入" title="语音输入" disabled={!session||busy} onClick={()=>microphoneConsent.current?void beginVoice():setPanel("microphone")}><Mic size={22}/></button>
          <button type="submit" className="send" aria-label="发送" title="发送" disabled={!session||!draft.trim()||busy}><Send size={19}/></button>
        </form> : <div className="input-box voice-box" role="status">
          <span><span className="record-dot"/> {recording==="recording"?`录音中  00:${String(elapsed).padStart(2,"0")}`:"正在转写语音…"}</span>
          {recording==="recording"&&<><button className="text-btn" onClick={()=>stopVoice(true)}>取消</button><button className="send stop" aria-label="结束录音" onClick={()=>stopVoice()}><Square size={17}/></button></>}
        </div>}
        <div className="composer-footer">菜品、价格和订单均为模拟数据</div>
      </div>
    </footer>
    {panel==="menu"&&<Drawer title={names.menu} onClose={()=>setPanel(null)}><MenuBrowser/></Drawer>}
    {panel&&panel!=="menu"&&session&&<Drawer title={names[panel]} onClose={()=>setPanel(null)}>
      {(panel==="profile"||panel==="today")&&<>
        {panel==="profile"&&<div className="menu-filters" role="group" aria-label="长期偏好品类">
          {categories.map(name=><button type="button" key={name} aria-pressed={name===profileCategory} onClick={()=>setProfileCategory(name)}>{name}</button>)}
          <button type="button" aria-pressed={profileCategory==="global"} onClick={()=>setProfileCategory("global")}>忌口</button>
        </div>}
        <Preferences key={panel+profileCategory}
          value={panel==="today"?effective(session):profileCategory==="global"?session.profile:categoryPreference(session,profileCategory)}
          scope={panel==="today"?"current":profileCategory==="global"?"global":"category"}
          category={panel==="today"?category:profileCategory==="global"?"主食":profileCategory}
          hideQuick={session.hideQuick} quick={session.quick} busy={busy}
          onDelete={id=>void act("quick-inputs",{id},false)}
          onReset={async()=>{if(await act("preferences/today",{reset:true}))setPanel(null);}}
          onSave={async(patch,hideQuick)=>{if(await act(`preferences/${panel}`,{patch,hideQuick,category:profileCategory,scope:profileCategory==="global"?"global":"category"})){if(panel==="today")setWelcome(false);setPanel(null);}}}/>
        {panel==="profile"&&<div className="drawer-links"><button type="button" onClick={()=>setPanel("today")}><Clock3 size={17}/> 调整本轮条件 <ChevronRight size={17}/></button><button type="button" onClick={()=>setPanel("orders")}><History size={17}/> 历史订单 <ChevronRight size={17}/></button></div>}
      </>}
      {panel==="api"&&<LunchApiSettings active={activeModel} onApply={setConnection}/>}
      {panel==="microphone"&&<>
        <p className="muted">{activeModel?"这一段录音将由浏览器直接发送给所选模型服务。":(speechFallback||session.mode==="local")?"当前使用浏览器提供的语音转写，音频可能发送给浏览器的转写服务。":"这一段录音将发送给配置的语音转写服务。" }转写结果会先到输入框，请检查后再发送。</p>
        <div className="drawer-actions"><button className="secondary" onClick={()=>setPanel(null)}>继续打字</button><button className="primary" onClick={()=>{microphoneConsent.current=true;void beginVoice();}}>继续录音</button></div>
      </>}
      {panel==="evidence"&&selected&&<>
        <div className="evidence-section"><h3>菜品详情</h3><p>{selected.dish.method} · {selected.dish.flavor} · {dishById(selected.dish.id)?.portion??"1 份"}</p>
          <p>{selected.dish.ingredients.includes("?")?"模拟配料待确认":"模拟配料 · "+selected.dish.ingredients.join("、")}</p></div>
        <div className="evidence-section"><h3>菜单与条件</h3>{selected.evidence.map(fact=><p key={fact}><Check size={15}/>{fact}</p>)}<small>已排除 {selected.excluded} 个不满足硬条件的菜单条目</small></div>
        <div className="evidence-section"><h3>相关历史订单</h3>{selected.orders.length?selected.orders.map(o=><p className="order-evidence" key={o.id}><span>{o.name} · {o.flavor}{o.sample?" · 样例":""}</span><small>{o.day}</small></p>):<p>这次没有匹配到相关历史订单。</p>}</div>
        <div className="mode-list"><span>需求 · {selected.mode.intent}</span><span>菜品 · {selected.mode.menu}</span><span>订单 · {selected.mode.orders}</span><span>理由 · {selected.mode.reason}</span></div>
        {rankedDishes.length>0&&<button className="secondary proposal" onClick={()=>setPanel("compare")}>查看本轮排序</button>}
      </>}
      {panel==="confirm"&&selected&&<>
        <div className="confirmation"><DishVisual dish={selected.dish}/><div><strong>{selected.dish.name}</strong><p>{selected.dish.shop} · {selected.dish.eta} 分钟 · {dishById(selected.dish.id)?.portion??"1 份"}</p></div><strong>¥{selected.dish.price}</strong></div>
        <p className="muted">本次仅写入演示订单，不会实际付款或配送。</p>
        <div className="drawer-actions"><button className="primary" disabled={busy} onClick={async()=>{if(await act("orders",{batchId:selected.id,dishId:selected.dish.id})){setPanel(null);setSkipped(null);}}}>确认模拟下单</button></div>
      </>}
      {panel==="orders"&&<div className="order-list">{session.orders.map(order=><div key={order.id}><DishVisual dish={order.dish}/><div><strong>{order.dish.name}</strong><small>{order.day} · {order.dish.flavor} · {order.sample?"样例":"模拟下单"}</small></div><strong>¥{order.dish.price}</strong></div>)}</div>}
      {panel==="compare"&&<>
        {rankedDishes.length?
          <table className="compare-table"><thead><tr><th scope="col">排名</th><th scope="col">菜品</th><th scope="col">到手价</th></tr></thead>
            <tbody>{rankedDishes.map((dish,index)=><tr key={dish.id}><td>{index+1}</td><td>{dish.name}{index>=(session.ranking?.matchCount??rankedDishes.length)&&<small className="rank-context">本轮未入选</small>}</td><td>¥{displayPrice(dish.price)}</td></tr>)}</tbody>
          </table>:<p className="muted">本轮暂无可推荐菜品。</p>}
        {session.comparison?.rows.length ? <details className="ranking-feedback">
          <summary>反馈前后排序</summary>
          <p className="muted">「{session.comparison.reference}」· {session.comparison.reason}</p>
          <table className="compare-table"><thead><tr><th scope="col">菜品</th><th scope="col">原排名</th><th scope="col">新排名</th><th scope="col">分数变化</th></tr></thead>
            <tbody>{session.comparison.rows.map(row=><tr key={row.id}><td>{row.name}</td><td>{row.before}</td><td>{row.after}</td><td>{row.delta>0?"+":""}{row.delta.toFixed(3)}</td></tr>)}</tbody>
          </table>
        </details> : null}
        <div className="drawer-actions"><button className="secondary" disabled={busy} onClick={async()=>{if(await act("demo/reset",{},false)){setSkipped(null);setDraft("");setPanel(null);feed.current?.scrollTo(0,0);}}}>恢复样例</button><button className="primary" disabled={busy} onClick={async()=>{if(await act("demo/clock",{},false)){setSkipped(null);setPanel(null);feed.current?.scrollTo(0,0);}}}>推进到明天</button></div>
      </>}
      {error&&<p className="inline-error" role="alert">{error}</p>}
    </Drawer>}
  </div>;
}
