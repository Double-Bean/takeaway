import { categories, dishById, feedbackReasons, menu } from "./lunch-data";
import { activeCategory, categoryPreference, choose, compareFeedback, dayAt, effective, eligible, refreshRanking, interpret, seed, uuid, validPatch } from "./lunch-engine";
import type { Models } from "./lunch-models";
import type { Message, Pref, Selection, Session } from "./lunch-types";

export function isLegacyDailyPreview(session:Session) {
  return session.messages.length===1 && session.messages[0].text==="午饭时间到了。按你平时的口味，今天可以试试这份。";
}

export class ActionError extends Error {
  constructor(message:string,public status=400) {super(message);}
}
function add(session:Session, message:Omit<Message,"id">) {
  session.messages=[...session.messages,{...message,id:uuid()}].slice(-24);
}
function noResult(session:Session) {
  const selection=session.selection??{};
  const category=activeCategory(session);
  const {budget,avoid,servings,maxEta}=effective(session);
  const labels=[
    selection.noSpice?"不辣":selection.flavor,
    selection.ingredient?"含"+selection.ingredient:undefined,
    selection.staple==="无"?"不含主食":selection.staple?"含"+selection.staple:undefined,
    selection.lowOil?"少油":undefined,
    selection.noFry?"非油炸":undefined,
    selection.meatless?"不含肉类":undefined,
    servings?servings+" 人份":undefined,
    maxEta?maxEta+" 分钟内送达":undefined,
    budget===null?undefined:budget+" 元以内",
    avoid.length?"避开"+avoid.join("、"):undefined,
  ].filter(Boolean);
  const budgetIsLimiting=budget!==null&&menu.some(dish=>eligible({...session,today:{...session.today,budget:null}},dish));
  const conditions=labels.length?"（"+labels.join("、")+"）":"";
  return "模拟菜单里暂无符合条件的"+category+conditions+"。"
    +(budgetIsLimiting?"可以提高一点预算，我会继续保留忌口。":"可以调整一个条件，我会继续保留忌口。");
}
function mergeSelection(current:Selection, incoming:Selection) {
  if(incoming.category && incoming.category!==(current.category??"主食")) {
    return {...incoming};
  }
  const selection={...current,...incoming};
  if ("staple" in incoming && !("preferredStaple" in incoming)) delete selection.preferredStaple;
  if(incoming.noSpice&&current.ingredient==="辣椒") delete selection.ingredient;
  return selection;
}
async function recommend(session:Session,models:Models,query="",intro="",mode="预设偏好",reuse=false) {
  const batch=reuse?session.batch:null;
  const card=await choose(session,models,query,batch?.seen,mode,batch?.id);
  if (card && batch?.card?.dish.id===card.dish.id) {
    const previous=session.messages.findLastIndex(message=>message.card?.id===card.id && message.card.dish.id===card.dish.id);
    if (previous>=0) {
      session.messages[previous]={...session.messages[previous],card,text:intro};
      return;
    }
  }
  add(session,{role:"assistant",text:card ? intro : batch
    ? `这轮符合条件的 ${batch.seen.length} 道菜都看过了。可以调整本轮条件，再找一轮。`
    : noResult(session),
    ...(card?{card}:{})});
}
function remember(session:Session,text:string) {
  const key=text.normalize("NFKC").replace(/\s+/g,"");
  session.quick=[{id:uuid(),text},...session.quick.filter(q=>q.text.normalize("NFKC").replace(/\s+/g,"")!==key)].slice(0,10);
}
function attachAvoid(current:Partial<Pref>,patch:Partial<Pref>,restore:string[]=[]) {
  const merged={...current,...patch};
  if (patch.avoid || current.avoid) {
    merged.avoid=[...new Set([...(current.avoid??[]),...(patch.avoid??[])])].filter(food=>!restore.includes(food));
  }
  return merged;
}
export async function freshen(session:Session,models:Models) {
  const day=dayAt(session.offset);
  const legacy=session.preferencesVersion!==2;
  if(legacy||session.day!==day) {
    if (session.day!==day) session.messages=[];
    session.day=day;
    session.preferencesVersion=2;
    session.today={};
    session.selection=undefined;
    session.batch=null;
    delete session.ranking;
    session.pending=null;
    session.comparison=null;
  }
  session.mode=models.provider;
  if (isLegacyDailyPreview(session)) {
    session.messages=[];
    session.batch=null;
    delete session.ranking;
  }
  if(!session.ranking) await refreshRanking(session,models);
  return session;
}

export async function applyAction(session:Session,models:Models,path:string,body:Record<string,unknown>) {
  switch (path) {
    case "recommendations/daily":
      if (!session.messages.length) await recommend(session,models,"","按你平时的口味，今天可以试试这份。");
      return session;
    case "messages": {
      const text=typeof body.text==="string"?body.text.trim():"";
      if (!text || text.length>240) throw new ActionError("请输入 1–240 字的午餐需求。");
      if (isLegacyDailyPreview(session)) {
        session.messages=[];
        session.batch=null;
      }
      remember(session,text);
      add(session,{role:"user",text});
      const interpreted=await interpret(text,session,models,body.modelPatch);
      if (interpreted.conflict) {
        add(session,{role:"assistant",text:`「${interpreted.conflict}」在你的忌口里。你可以在「我的偏好」调整这项设置。`});
        return session;
      }
      const pending=interpreted.newRequest?null:session.pending;
      const patch=attachAvoid(pending?.patch??{},interpreted.patch,interpreted.restoreAvoid);
      const selection=mergeSelection(
        interpreted.newRequest?{}:pending?.selection??session.selection??{},
        {...interpreted.selection,category:interpreted.category}
      );
      if (interpreted.question) {
        if (interpreted.newRequest) {
          session.today={};
          session.selection={category:interpreted.category};
          session.batch=null;
          await refreshRanking(session,models);
        }
        session.pending={patch,selection,question:interpreted.question};
        add(session,{role:"assistant",text:interpreted.question});
        return session;
      }
      if (pending?.question.includes("多少元") && /^\d+(\.\d+)?$/.test(text) && Number(text)>=1 && Number(text)<=300) patch.budget=Number(text);
      session.pending=null;
      session.selection=selection;
      session.today=attachAvoid(interpreted.newRequest?{}:session.today,patch,interpreted.restoreAvoid);
      session.comparison=null;
      const reference=session.orders.find(o=>o.id===interpreted.historical);
      await recommend(session,models,text,reference ? `查到${reference.sample?"样例订单":"历史订单"}里的${reference.dish.name}。我按相近口味另挑了一道。` : "按你刚才的要求，我找到了这份。",interpreted.mode);
      if (interpreted.longTerm && Object.keys(interpreted.patch).length) {
        add(session,{role:"assistant",text:"可以把本句提到的改动保存到「"+interpreted.category+"」长期偏好。",proposal:{category:interpreted.category,patch:interpreted.patch}});
      }
      return session;
    }
    case "preferences/today":
    case "preferences/profile": {
      const patch=validPatch(body.patch);
      if (path.endsWith("/today")) {
        const category=activeCategory(session);
        if (body.reset) {
          session.today={};
          session.selection={category};
        } else {
          session.today={...session.today,...patch};
          session.selection={...session.selection,category};
          if (patch.flavor) {
            session.selection.flavor=patch.flavor==="不限"?undefined:patch.flavor;
            session.selection.noSpice=undefined;
          }
          if (patch.staple) {
            session.selection.staple=patch.staple==="无主食"?"无":undefined;
            delete session.selection.preferredStaple;
          }
          if (patch.lowOil===false) session.selection.lowOil=undefined;
          if (patch.noFry===false) session.selection.noFry=undefined;
        }
      } else if (body.scope==="global") {
        if (patch.avoid) session.profile={...session.profile,avoid:patch.avoid};
        if (typeof body.hideQuick==="boolean") session.hideQuick=body.hideQuick;
      } else {
        const category=categories.find(name=>name===body.category)??"主食";
        const stored=categoryPreference(session,category);
        const preference=body.merge?attachAvoid(stored,patch):{...stored,...patch};
        session.categoryProfiles={...session.categoryProfiles,[category]:preference};
        if (category!==activeCategory(session)) {
          await refreshRanking(session,models);
          return session;
        }
      }
      session.pending=null;
      session.comparison=null;
      await recommend(session,models,"","已按更新后的偏好重新找了一份。");
      return session;
    }
    case "quick-inputs": {
      session.quick=typeof body.id==="string"?session.quick.filter(q=>q.id!==body.id):[];
      return session;
    }
    case "recommendations/next": {
      const batch=session.batch;
      if (!batch?.card || batch.id!==body.batchId || batch.card.dish.id!==body.dishId) throw new ActionError("这张卡已更新，请使用最新推荐。",409);
      const event={dishId:batch.card.dish.id,batchId:batch.id,day:session.day,kind:"skip" as const};
      session.feedback=[...session.feedback,event].slice(-200);
      session.comparison=await compareFeedback(session,event,models);
      batch.seen=[...batch.seen,event.dishId];
      await recommend(session,models,batch.query,"再看看这份。",batch.card.mode.intent,true);
      return session;
    }
    case "feedback": {
      const batch=session.batch;
      const event=session.feedback.find(e=>e.kind==="skip"&&e.batchId===body.batchId&&e.dishId===body.dishId&&e.day===session.day);
      if (!event || !batch || batch.id!==body.batchId || !feedbackReasons.some(reason=>reason===body.reason)) throw new ActionError("找不到这次换菜的反馈，请使用最新推荐。",409);
      if (event.reason) return session;
      event.reason=String(body.reason);
      session.comparison=await compareFeedback(session,event,models);
      if (batch.card) await recommend(session,models,batch.query,"记下了，我重新排了一下剩下的午餐。",batch.card.mode.intent,true);
      else await refreshRanking(session,models);
      return session;
    }
    case "orders": {
      if (session.orders.some(order=>order.batchId===body.batchId&&order.dish.id===body.dishId)) return session;
      const batch=session.batch;
      const dish=typeof body.dishId==="string"?dishById(body.dishId):undefined;
      if (!batch?.card || !dish || batch.id!==body.batchId || batch.card.dish.id!==dish.id || !eligible(session,dish)) throw new ActionError("这道菜已不在当前推荐中，请刷新后再试。",409);
      const order={id:uuid(),dish,day:session.day,batchId:batch.id};
      const event={dishId:dish.id,batchId:batch.id,day:session.day,kind:"order" as const};
      session.feedback=[...session.feedback,event].slice(-200);
      session.comparison=await compareFeedback(session,event,models);
      session.orders=[order,...session.orders].slice(0,100);
      await refreshRanking(session,models);
      batch.card=null;
      batch.query="";
      session.today={};
      session.selection=undefined;
      session.pending=null;
      add(session,{role:"assistant",text:"这份已加入模拟订单。",order});
      return session;
    }
    case "demo/clock":
      session.offset+=1;
      if(session.offset>365) throw new ActionError("演示日期已到上限，请恢复样例。");
      return freshen(session,models);
    case "demo/reset":
      return freshen(seed(),models);
    default:
      throw new ActionError("找不到此功能。",404);
  }
}
