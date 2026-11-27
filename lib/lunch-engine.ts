import { feedbackReasons, flavors, foods, menu, samplePrompts, staples, type Category, type Dish } from "./lunch-data";
import { ask, embeddings, type Models } from "./lunch-models";
import type { Card, Comparison, Feedback, Pref, Score, Selection, Session } from "./lunch-types";

export const defaults:Pref = {budget:30,target:null,flavor:"清淡",staple:"优先有主食",avoid:["花生"],lowOil:true,noFry:true};
const todayFormat = new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Shanghai"});
export const dayAt = (offset=0) => moveDay(todayFormat.format(new Date()),offset);
export function moveDay(day:string,offset:number) {
  const date=new Date(day+"T12:00:00Z");
  date.setUTCDate(date.getUTCDate()+offset);
  return date.toISOString().slice(0,10);
}
export function uuid() {
  if (typeof crypto.randomUUID==="function") return crypto.randomUUID();
  const bytes=crypto.getRandomValues(new Uint8Array(16));
  bytes[6]=(bytes[6]&15)|64;
  bytes[8]=(bytes[8]&63)|128;
  const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
}

export function seed(offset=0):Session {
  const day=dayAt(offset);
  const history=[1,0,10,3,14,6,8,16].map((index,i)=>({id:`O${i+1}`,day:moveDay(day,-1-i*2),dish:menu[index],sample:true}));
  return {day,offset,profile:{...defaults,avoid:[...defaults.avoid]},categoryProfiles:{},preferencesVersion:3,today:{},batch:null,messages:[],orders:history,feedback:[],
    quick:samplePrompts.map((text,i)=>({id:`example-${i}`,text,sample:true})),hideQuick:false,comparison:null,pending:null,seenActions:[],mode:"local"};
}
const neutral:Pref={budget:null,target:null,flavor:"不限",staple:"不限",avoid:[],lowOil:false,noFry:false};
export const activeCategory = (session:Session):Category => session.selection?.category??"主食";

export function categoryPreference(session:Session, category:Category):Pref {
  const {avoid:_globalAvoid,...legacy}=session.profile;
  const {avoid:_categoryAvoid,...saved}=session.categoryProfiles?.[category]??{};
  return {...(category==="主食"?{...neutral,...legacy}:neutral),...saved};
}

export function effective(session:Session,category=activeCategory(session),today=session.today):Pref {
  const stored=categoryPreference(session,category);
  return {...stored,...today,avoid:[...new Set([...session.profile.avoid,...(today.avoid??[])])]};
}

function startsRequest(query:string,session:Session,category?:Category) {
  const current=session.pending?.selection?.category??activeCategory(session);
  return Boolean(category&&category!==current) ||
    /^(?:我)?(?:今天|这次|现在)?(?:中午|午休|午饭)?(?:想吃|想要|想来|要吃|给我|推荐|来一?份|来一?碗)/.test(query) ||
    /重新推荐|换个品类|另来一份|再来一份/.test(query);
}

export function validPatch(input:unknown):Partial<Pref> {
  if (!input || typeof input!=="object") return {};
  const raw=input as Record<string,unknown>;
  const patch:Partial<Pref>={};
  for (const key of ["budget","target"] as const) {
    const value=raw[key];
    if (value===null || (typeof value==="number" && Number.isFinite(value) && value>=1 && value<=300)) patch[key]=value;
  }
  if(raw.servings===null || typeof raw.servings==="number" && [1,2,3,4].includes(raw.servings)) patch.servings=raw.servings;
  if(raw.maxEta===null || typeof raw.maxEta==="number" && Number.isInteger(raw.maxEta) && raw.maxEta>=1 && raw.maxEta<=120) patch.maxEta=raw.maxEta;
  if (raw.flavor==="不限" || flavors.some(f=>f===raw.flavor)) patch.flavor=raw.flavor as Pref["flavor"];
  if (staples.some(f=>f===raw.staple)) patch.staple=raw.staple as Pref["staple"];
  if (Array.isArray(raw.avoid)) patch.avoid=foods.filter(food=>(raw.avoid as unknown[]).includes(food));
  if (typeof raw.lowOil==="boolean") patch.lowOil=raw.lowOil;
  if (typeof raw.noFry==="boolean") patch.noFry=raw.noFry;
  return patch;
}

const concepts = [
  ["清淡","清爽","不重口","清蒸","白切","少油","清汤","不油腻","轻一点","清淡点"],
  ["香辣","辣味","辣椒","麻辣","川味","重口","剁椒","辣一点","吃辣","椒麻"],
  ["鲜香","鲜味","菌菇","鸡汤","豆豉","味噌"],
  ["酸甜","番茄","酸一点"],
  ["米饭","盖饭","蒸饭","饭"], ["面条","汤面","面"], ["杂粮","粗粮"], ["主食","米饭","汤面","杂粮"],
  ["蒸","清蒸"],["炖","炖煮","砂锅"],["炸","油炸"], ["拌","沙拉"],
  ["鸡肉","鸡丁","蒸鸡","鸡饭","鸡汤","鸡"], ["牛肉","牛腩","牛"],["豆腐","大豆"],["鱼","三文鱼"],["虾","鲜虾"],
  ["青菜","蔬菜","菜心"],["鸡蛋","蛋"]
];
const tokens = (text:string) => [...new Set(text.toLowerCase().replace(/[\s\p{P}]/gu,"").match(/[\p{Script=Han}]{1,2}|[a-z0-9]+/gu)??[])];
const localVector = (text:string) => concepts.map(group=>group.reduce((score,word)=>Math.max(score,text.includes(word)?(word.length>1?1:0.45):0),0));
function cosine(a:number[],b:number[]) {
  let ab=0,aa=0,bb=0;
  for (let i=0;i<a.length;i++) {const x=a[i],y=b[i]??0; ab+=x*y; aa+=x*x; bb+=y*y;}
  return aa && bb ? Math.max(0,ab/Math.sqrt(aa*bb)) : 0;
}
function lexical(a:string,b:string) {
  const query=tokens(a), doc=new Set(tokens(b));
  return query.length ? query.filter(t=>doc.has(t)).length/Math.sqrt(query.length*Math.max(doc.size,1)) : 0;
}
const document = (dish:Dish) => [dish.name,dish.category,dish.flavor,dish.method,dish.staple,dish.lowOil?"少油":"",...dish.ingredients].join(" ");
const money:Record<string,number>={"零":0,"〇":0,"一":1,"二":2,"两":2,"三":3,"四":4,"五":5,"六":6,"七":7,"八":8,"九":9};
function amount(value:string) {
  if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
  const [left,right]=value.split("十");
  return value.includes("十") ? (money[left]??1)*10+(money[right]??0) : money[left];
}

const menuShops=[...new Set(menu.map(dish=>dish.shop))];
const knownMissingDish=/^(?:佛跳墙|北京烤鸭|东坡肉|水煮鱼|酸菜鱼|麻婆豆腐|宫保鸡丁|鱼香肉丝|红烧狮子头)$/;
const dishAliases:Record<string,string>={"天妇罗虾":"炸虾天妇罗","炸猪扒":"炸猪排"};
const genericMeats:Record<string,string>={"鱼肉":"鱼"};
const genericFood=/^(?:午饭|午餐|正餐|主食|饭|米饭|盖饭|配饭|杂粮|面|面条|汤面|米线|面食|炒面|拌面|甜点|甜品|甜的|零食|小吃|蔬菜|素菜|素食|配菜|水果|果盘|果切|好吃的|吃的|什么|东西|都行|随便|换一道|一道菜|肉|荤菜|菜|今天的推荐)$/;
const cookingMethods=new Set(menu.map(dish=>dish.method));

function dishRequest(query:string,category:Category):{selection:Selection; name?:string; ids?:string[]}|undefined {
  const direct=query.match(/(?:^|[，,。；！？])(?:我)?(?:今天|这次|现在|中午|午休|午饭|还是)*(?:(?:想|要)吃|想来|来|给我|推荐|改吃|换成|改成|有没有|有没|有(?=[^，。！？]+[吗么][？?]?$))([^，,。；！？]+)/)?.[1];
  const bare=query.split(/[，,。；！？]/)[0];
  const clause=direct??(knownMissingDish.test(bare) || menu.some(dish=>dish.name===bare) || /^(?!不要|不吃|别)[\p{Script=Han}]{1,16}(?:汉堡|饺子|烧麦|披萨|火锅|寿司|包子|薯条|排骨|肠粉|烧饼|粉丝|盖饭)$/u.test(bare)?bare:"");
  const name=clause.replace(/^(?:一?[份碗盒个道]|点|一些|一点|一下|是)+/,"")
    .replace(/^(?:(?:清淡|清爽|鲜香|香辣|麻辣|辣|酸甜|不辣|少油|不油腻|甜味)(?:一点儿?|一些|点儿?|些)?的?)+/,"")
    .split(/(?:不超过|预算|最好|优先|不要|不吃|不加|别放|[0-9一二两三四五六七八九十]+(?:块|元))/)[0]
    .replace(/(?:吧|呀|呢|哈|吗|么|谢谢)+$/,"");
  if (!name || genericFood.test(name) || /^(?:像|类似|不|更|再|[0-9一二两三四五六七八九十]+[元块人]|什么|口味|预算|少炸|油多)/.test(name)) return;
  const method=name.replace(/(?:的?(?:食品|食物|菜|小吃|东西)|的)$/,"");
  if (method==="炸") return {selection:{method:"油炸"}};
  if (cookingMethods.has(method)) return {selection:{method}};
  if (foods.includes(name) || genericMeats[name]) return {selection:{ingredient:genericMeats[name]??name}};
  if (/^(?:辣的|清淡的|咸的|甜的|[^的]{1,6}一点)$/.test(name)) return;
  const lookup=dishAliases[name]??name;
  const matching=menu.filter(dish=>dish.name.includes(lookup));
  const stapleSuffix=/^(.+?)(汤面|拌面|炒面|面条|面|米线|盖饭|配饭|饭)$/.exec(name);
  const ingredient=stapleSuffix&&foods.includes(stapleSuffix[1])?stapleSuffix[1]:undefined;
  if (!matching.length && ingredient && stapleSuffix) {
    const staple=/饭$/.test(stapleSuffix[2])?"米饭":"面";
    return {selection:{category:"主食",ingredient,staple}};
  }
  // Only use confident dish phrases for a missing-menu response.
  if (!matching.length && !knownMissingDish.test(name) && !/^(?!.*的)[\p{Script=Han}]{0,14}(?:汉堡|饺子|烧麦|披萨|火锅|寿司|包子|薯条|排骨|肠粉|烧饼|粉丝|盖饭|肉丝|肉片|鸡翅|牛排|拉面|卷饼|蛋糕|沙拉|三明治|炸鸡)$/u.test(name)) return;
  const matchedCategory=matching.some(dish=>dish.category===category)?category:matching[0]?.category;
  return {selection:matchedCategory?{category:matchedCategory}:{},name,ids:matching.map(dish=>dish.id)};
}

const fastestDelivery=/最快|(?:配送|送到|送达)(?:要|能|尽量)?(?:更快|快一点|快点|快一些)|(?:尽快|快一点|快点|更快)(?:送到|送达|配送)|(?:配送|送到|送达)(?:时间|耗时)?(?:最短|最少)/;
const optionalChoice=/^(?:随便(?:吧|选|挑)?|都(?:行|可以)|不限|不挑|无所谓|你(?:决定|看着办)|(?:哪家|什么)都(?:行|可以))[。！!]?$/;
export const recommendationFactMode="菜单与推荐排序";

export function ruleIntent(text:string,session:Session) {
  const raw=text.normalize("NFKC").replace(/\s+/g,"");
  const revising=/改主意|反悔|还是|改吃|改喝|改要|改成|改到|换成|不是.+而是|可以.+了|也可以|不限了|不用再|取消.*限制/.test(raw);
  const query=raw.replace(/不是[^，。；]+[，,]?而是/g,"")
    .replace(/(?:不吃|不想吃|不要吃?)[^，。；]+?了[，,]?(?=改吃|改成|换成|还是)/g,"");
  let patch:Partial<Pref>={};
  const selection:Selection={};
  let question="";
  let historical="";
  const anyChoice=optionalChoice.test(query);
  const pendingShopChoice=anyChoice && /餐馆|餐厅|饭店|店铺|商家|哪家/.test(session.pending?.question??"");
  const previousQuery=pendingShopChoice
    ? session.messages.filter(message=>message.role==="user").findLast(message=>!optionalChoice.test(message.text.normalize("NFKC").replace(/\s+/g,"")))?.text
    : undefined;
  if (fastestDelivery.test(query)||previousQuery&&fastestDelivery.test(previousQuery)) selection.orderBy="eta";
  if (/不着急|配送时间随意|(?:不用|不必|不要)(?:再)?(?:选)?最快|(?:不用|取消)(?:按)?(?:配送|送达)(?:时间)?(?:排序|优先)/.test(query)) selection.orderBy=undefined;
  if (selection.orderBy) selection.unavailableDish=undefined;
  const rejectedShops=menuShops.filter(name=>new RegExp(
    `(?:不要|不吃|不想吃|别推荐|别选|排除)(?:再)?(?:吃|选)?${name}`
  ).test(raw));
  const shopText=query.replace(/(?:不要|不吃|不想吃|别推荐|别选|排除)(?:吃)?[^，,。；;！？!?]+/g,"");
  const previousShop=/^(?:是|指的是)?(?:餐厅|饭店|店铺|商家|店)(?:的)?(?:名(?:称|字))?(?:[。！]?$)/.test(query)
    ? session.messages.filter(message=>message.role==="user"&&message.text!==text).slice(-4).reverse()
        .map(message=>menuShops.find(shop=>message.text.includes(shop))).find(Boolean)
    : undefined;
  const shop=menuShops.find(name=>shopText.includes(name))??previousShop;
  const replaceShop=/换(?:一|另|个)?家|换个(?:店|餐厅|餐馆|商家)|别家|(?:其他|别的|另外一?)(?:家|餐厅|餐馆|店铺|商家)|(?:不要|不吃|不想吃|别推荐|别选)(?:再)?(?:吃|选)?(?:这|那)家|(?:这|那)家(?:就)?算了/.test(query);
  const currentShop=session.pending?.selection?.shop??session.selection?.shop??session.batch?.card?.dish.shop;
  const excluded=session.pending?.selection?.excludedShops??session.selection?.excludedShops??[];
  const relaxShop=pendingShopChoice || /不限(?:制)?(?:餐厅|餐馆|店铺)|别只看这家|(?:餐厅|餐馆|店铺|商家)(?:随便|不限|都行)|哪家都(?:行|可以)/.test(query);
  const shopRevision=replaceShop||rejectedShops.length>0;
  if (shop) {
    selection.shop=shop;
    selection.excludedShops=excluded.filter(name=>name!==shop);
  } else if (shopRevision) {
    const skipCurrent=replaceShop&&currentShop?[currentShop]:[];
    selection.shop=undefined;
    selection.excludedShops=[...new Set([...excluded,...rejectedShops,...skipCurrent])];
    selection.preferredDish=undefined;
    selection.unavailableDish=undefined;
  } else if (relaxShop) {
    selection.shop=undefined;
    selection.excludedShops=undefined;
  } else if (/^(?:这家|那家|这间|那间)/.test(query) && session.selection?.shop) {
    selection.shop=session.selection.shop;
  }
  const alternatives=/别的|其他菜|替代|换一道|换一个|换个菜|随便推荐/.test(query);
  if(alternatives) selection.unavailableDish=undefined;

  const prices=[...query.matchAll(/(?:预算(?:是|为)?|¥|不到|低于|少于|不超过|最多)?(\d+(?:\.\d+)?|[零〇一二两三四五六七八九十]{1,3})(?:块钱|块|元|以内|左右|以下|封顶)/g)];
  const price=prices.at(-1);
  const manualPrice=query.match(/预算(?:是|为|改成|改到|调到|调整到|放宽到|提高到)?(\d+(?:\.\d+)?|[一二两三四五六七八九十]{1,3})(?:[。！!]?$)/);
  if (price||manualPrice) {
    const hit=(price??manualPrice)!;
    const parsed=amount(hit[1]);
    const after=query.slice(hit.index!+hit[0].length);
    if (parsed>=1&&parsed<=300) patch = /左右|上下|差不多/.test(hit[0]) || /^(左右|上下|差不多)/.test(after) ? {target:parsed,budget:null} : {budget:parsed,target:null};
    else question="预算想设在多少元？可以直接回复金额。";
  }
  if (/不限(制)?预算|预算不限|不设预算|取消预算限制/.test(query)) Object.assign(patch,{budget:null,target:null});
  const flavorClauses=query.split(/[，。；、！？]/);
  const softFlavor=flavorClauses.some(clause=>/^(?:最好|优先|尽量|偏向)(?:吃|来点)?(?:清淡|清爽|香辣|麻辣|辣|鲜香|酸甜|甜味)/.test(clause));
  const people=query.match(/(\d+|[一二两三四])个?人(?:份|(?:一起)?吃)/);
  const eta=query.match(/(\d+|[一二两三四五六七八九十]{1,3})分钟(?:以内|之内|内|送到|送达)/);
  if (people && [1,2,3,4].includes(amount(people[1]))) patch.servings=amount(people[1]);
  if (eta && amount(eta[1])>=1 && amount(eta[1])<=120) patch.maxEta=amount(eta[1]);
  if (/人数不限|份数不限/.test(query)) patch.servings=null;
  if (/不限送达时间|送达时间不限/.test(query)) patch.maxEta=null;
  const noSpice=/不辣|别太辣|不(?:要|想|能)?吃(?:太|很)?辣|(?:不要|别放|不加)辣/.test(query);
  if (noSpice) {
    selection.noSpice=true;
    selection.flavor=undefined;
    patch.flavor="清淡";
  } else if (/想吃.{0,3}辣|(?:改吃|改成|换成|还是)辣|(?:要|来点|来个|来份)辣|香辣|吃辣|辣一点|辣(?:的)?(?:面(?:条)?|拌面|汤面|米线)|麻辣|川味/.test(query)) {
    patch.flavor="香辣";
    selection.flavor="香辣";
    selection.noSpice=undefined;
  } else if (/清淡鲜香|鲜香|鲜一点/.test(query)) patch.flavor=selection.flavor="鲜香";
  else if (/清爽|清淡|轻一点|不重口/.test(query)) patch.flavor=selection.flavor="清淡";
  else if (/酸甜|酸一点|番茄味/.test(query)) patch.flavor=selection.flavor="酸甜";
  else if (/吃点甜|想吃甜的|甜一点/.test(query)) patch.flavor=selection.flavor="甜味";
  if (softFlavor && !noSpice) selection.flavor=undefined;
  if (/口味不限|什么口味都行|取消口味限制/.test(query)) {
    patch.flavor="不限";
    selection.flavor=undefined;
    selection.noSpice=undefined;
  }
  if (/不要主食|无主食|不吃主食/.test(query)) {
    patch.staple="无主食";
    selection.staple="无";
  } else if (/米饭|配饭/.test(query) && !/不要米饭|不吃米饭/.test(query)) patch.staple="优先米饭";
  else if (/有主食|带主食/.test(query)) patch.staple="优先有主食";
  const mainFood=query.replace(/(?:不要|不吃|不想吃|不加|别推荐)(?:吃)?(?:面条|汤面|米线|面食|炒面|拌面|米饭|杂粮|面)/g,"");
  if (/(?:必须|一定要|只吃|就要|改吃|改成|换成|还是要)(?:吃|有|带)?(?:米饭|盖饭|配饭)/.test(mainFood)) selection.staple="米饭";
  else if (/面条|汤面|米线|面食|炒面|拌面|来碗面|(?:吃|的|一碗)面(?:$|[，。！？])/.test(mainFood)) {
    if (/(?:最好|优先|偏向|尽量)[^，。；]{0,6}(?:面条|汤面|米线|面食|炒面|拌面)/.test(mainFood)) {
      selection.staple=undefined;
      selection.preferredStaple="面";
    } else selection.staple="面";
    patch.staple="不限";
  } else if (/(?:想吃|要吃|只吃|来[碗份])(?:点|个)?杂粮/.test(mainFood)) selection.staple="杂粮";
  if (/少油|不油腻/.test(query)) {
    patch.lowOil=true;
    selection.lowOil=/(?:优先|最好|尽量)[^，。；]{0,6}(?:少油|不油腻)/.test(query)?undefined:true;
  }
  if (/少炸|优先非油炸|最好非油炸/.test(query)) {
    patch.noFry=true;
    selection.noFry=undefined;
  } else if (/不吃炸|不要油炸|非油炸/.test(query)) patch.noFry=selection.noFry=true;
  if (/不用(?:再)?少油|油多一点也可以|取消少油限制/.test(query)) {patch.lowOil=false;selection.lowOil=undefined;}
  if (/油炸也可以|也可以吃炸|不用避开油炸|取消非油炸限制/.test(query)) {patch.noFry=false;selection.noFry=undefined;}
  if (/吃素|素食|不要肉|不吃肉|不要荤|不吃荤/.test(query)) selection.meatless=true;
  if (/可以吃肉|肉也可以|不用吃素/.test(query)) selection.meatless=undefined;
  if (selection.meatless) selection.ingredient=undefined;
  if (/主食不限|主食随意|取消主食限制/.test(query)) {
    patch.staple="不限";selection.staple=undefined;selection.preferredStaple=undefined;
  }
  const requestedCategory=(shop?query.replaceAll(shop,""):query).replace(/(?:不要|不吃|不想吃|别推荐|别加)(?:吃)?(?:主食|甜点|甜品|零食|小吃|蔬菜|水果|米饭)/g,"");
  if (/甜点|甜品|布丁|蛋挞/.test(requestedCategory)) selection.category="甜点";
  else if (/零食|小吃|解馋/.test(requestedCategory)) selection.category="零食";
  else if (/水果|果盘|鲜切|果切/.test(requestedCategory)) selection.category="水果";
  else if (/蔬菜|素菜|配菜/.test(requestedCategory)) selection.category="蔬菜";
  else if (/午[饭餐]|主食|盖饭|吃正餐|米饭/.test(requestedCategory) || (selection.staple&&selection.staple!=="无") || selection.preferredStaple) selection.category="主食";
  const positiveIngredient=requestedCategory
      .split(/[，。；、！？]/)
      .filter(clause=>!/(?:不想吃|不能吃|不要|不吃|不加|别放|过敏|忌口)/.test(clause))
      .map(clause=>[...foods].sort((a,b)=>b.length-a.length).find(food=>clause.includes(food)&&(clause.includes("想吃")||clause.includes("来份")||clause.includes("要有")||/改吃|改成|换成|还是要/.test(clause))))
      .find(Boolean);
  if (positiveIngredient) {
    selection.ingredient=positiveIngredient;
    if (!selection.category && ["芒果","草莓","香蕉","苹果","菠萝","西瓜","橙子","蓝莓","奇异果","牛油果","葡萄"].includes(positiveIngredient)) selection.category="水果";
  }
  const dish=dishRequest(query,selection.category??activeCategory(session));
  Object.assign(selection,dish?.selection);
  if(dish?.ids?.length) {
    selection.preferredDish=dish.name;
    selection.unavailableDish=undefined;
  } else if (dish?.name) {
    selection.unavailableDish=dish.name;
    selection.preferredDish=undefined;
  }
  const negativeStart=query.search(/不要|不吃|不能吃|不想吃|别放|别加|去掉|忌口|不加|过敏/);
  if (negativeStart>=0) {
    const avoid=foods.filter(food=>new RegExp(`(?:不要|不吃|不能吃|不想吃|别放|别加|去掉|忌口(?:是)?|不加)(?:吃|放|加)?${food}|(?:不要|不吃|不能吃|不想吃)[^，。；、]{0,6}[、和及跟]${food}`).test(query) || query.includes(food+"过敏"));
    if (avoid.length) patch.avoid=avoid;
  }
  const restoreAvoid=foods.filter(food=>new RegExp(
    "(?:可以(?:吃|放|加)|能吃)"+food+"(?:了|也行|[，。；]|$)|"+food+"(?:可以(?:吃|放|加)|也可以|不用避开)"
  ).test(query));
  if (revising && !positiveIngredient && /不(?:想)?吃|不要|去掉/.test(query) &&
    session.selection?.ingredient && patch.avoid?.includes(session.selection.ingredient)) selection.ingredient=undefined;
  if (patch.avoid) patch.avoid=patch.avoid.filter(food=>!restoreAvoid.includes(food));
  const isHistorical=/昨天.{0,5}(那|类似)|上次.{0,5}(那|类似)|之前.{0,8}(一样|那种|套餐)/.test(query);
  if (isHistorical) {
    const yesterday=moveDay(session.day,-1);
    const source=session.orders.find(order=>(!selection.category||order.dish.category===selection.category) &&
      (query.includes("昨天")?order.day===yesterday:order.day<=session.day));
    if (source) {
      selection.category??=source.dish.category;
      patch.flavor??=source.dish.flavor;
      historical=source.id;
    } else question="没查到对应的订单。你还记得大概是什么口味吗？";
  }
  const changesStaple=Boolean(selection.staple && session.selection?.staple &&
    selection.staple!==session.selection.staple);
  const contextCategory=session.pending?.selection?.category??activeCategory(session);
  const continuation=Boolean(previousShop || shopRevision || relaxShop || anyChoice || selection.orderBy || /^(?:那|这家|上一份|刚才|再|也|它|这道|这个|能不能|有没有)/.test(query) || alternatives);
  const newRequest=isHistorical || (!shopRevision&&selection.category!==undefined&&selection.category!==contextCategory) ||
    (!revising&&!continuation&&(changesStaple||startsRequest(query,session,selection.category)));
  const category=selection.category??(newRequest?"主食":session.pending?.selection?.category??activeCategory(session));
  const ongoing=effective(session,category,newRequest?{}:session.today);
  if (/再便宜|更便宜|便宜点|便宜一点|便宜些/.test(query) && !price && !manualPrice) {
    const reference=newRequest?undefined:session.batch?.card?.dish.price;
    if (reference && reference>1) Object.assign(patch,{budget:Math.min(ongoing.budget??300,reference-0.01),target:null});
    else question="这顿想控制在多少元以内？";
  }
  const exclusion=effective(session,category,{}).avoid;
  const conflict=exclusion.find(food=>selection.ingredient===food || restoreAvoid.includes(food) ||
    query.split(/[，。；、！？]/).some(clause=>!/(?:不可以|不能|不想|不要)/.test(clause) &&
      new RegExp("(?:可以吃|想吃|能吃)"+food).test(clause)));
  if(!dish?.name && (Object.keys(patch).length || selection.category || selection.shop || selection.ingredient || selection.method)) {
    selection.unavailableDish=undefined;
  }
  const longTerm=/以后|长期|今后|从今往后|一直不吃/.test(query);
  const unknownAvoid = !patch.avoid?.length && [...query.matchAll(/(?:别放|不加|忌口是|不吃)([\p{Script=Han}]{1,10})/gu)]
    .some(([,food])=>!shopRevision||!(/^(?:这家|那家)/.test(food)||menuShops.some(name=>food.startsWith(name))));
  if (unknownAvoid && !/不吃(?:炸|主食|米饭|油炸|肉|荤|辣)/.test(query)) question ||= "这项忌口没有匹配菜单食材标签。请在「我的偏好」确认食材后再推荐。";
  if (anyChoice && session.pending?.question.includes("忌口没有匹配")) question=session.pending.question;
  if (/^(?:我)?(?:改主意了|反悔了?|算了(?:吧)?)[。！!？?]*$/.test(raw)) question="想改哪一项？可以直接告诉我新的口味、主食或预算。";
  return {patch,selection,category,newRequest,question,conflict,historical,longTerm,restoreAvoid,meaning:query,mentionedDish:dish?.name,alternatives,anyChoice,shopRevision};
}

export function requestInterpretation(text:string,session:Session,context:Models) {
  const rule=ruleIntent(text,session);
  const current=session.batch?.card?.dish;
  return ask(context,
    "你是中文午餐助手。只输出 JSON {patch,reply,dish,shop,newRequest}，省略不用的字段。最新消息是本轮输入，结合近期对话、当前条件和待澄清问题理解指代与省略。patch 仅含用户明确新增或修改的 budget、target、flavor、staple、avoid、lowOil、noFry。dish 只填明确要求的具体菜名，可以不在菜单中。泛指食材、口味、餐厅或菜品类别时留空。shop 只填菜单餐厅中的指定店名。明确要换一个全新的餐饮需求才填 newRequest:true。对当前菜品的价格、食材等问题按给出的菜品事实用 reply 回答。闲聊或询问使用方法也可以用 reply。推荐或修改条件走 patch 等结构化字段，不在 reply 里编造菜、库存、价格或订单。餐厅、口味、预算等可选条件缺失时直接进入推荐流程，省略相应字段。最快送达是排序要求，省略 reply 和 dish。换家店是对当前推荐的调整，不能把「别家」「其他家的」填成菜名或设为全新的需求。菜单及忌口以系统核验为准。",
    {text,history:session.messages.filter((_,i)=>i!==session.messages.length-1||session.messages[i].role!=="user"||session.messages[i].text!==text).slice(-10).map(({role,text,card})=>({role,text,...(card?{dish:card.dish.name}:{})})),
      category:rule.category,conditions:effective(session),selection:session.selection,pending:session.pending,
      dish:current&&{name:current.name,shop:current.shop,price:current.price,eta:current.eta,ingredients:current.ingredients,flavor:current.flavor,method:current.method,staple:current.staple,servings:current.servings},
      menuShops,allowedIngredients:foods});
}

function localReply(text:string,session:Session) {
  const dish=session.batch?.card?.dish;
  if(!dish) return "";
  const question=/[吗么呢？?]|什么|多少|几|哪|多久|有没有/.test(text);
  if(!question) return "";
  if(/配料|食材|里面有/.test(text) || /^(?:它|这份|这道|这个|刚才那份).*(?:有|含|放)/.test(text)) {
    return dish.ingredients.includes("?") ? `模拟菜单未记录「${dish.name}」的完整食材。`
      : `「${dish.name}」的模拟菜单食材有${dish.ingredients.join("、")}。`;
  }
  if(/多少钱|什么价|价格多少|几[块元]/.test(text)) return `「${dish.name}」的模拟到手价是 ¥${dish.price}。`;
  if(/多久|几分钟/.test(text)) return `「${dish.name}」预计 ${dish.eta} 分钟送达。`;
  if(/哪家|哪个店/.test(text)) return `「${dish.name}」来自${dish.shop}。`;
  return "";
}

export async function interpret(text:string,session:Session,context:Models,clientProposal:unknown) {
  const rule=ruleIntent(text,session);
  const fallback=rule.mentionedDish||rule.selection.orderBy||rule.anyChoice||rule.shopRevision?"":localReply(text,session);
  const base={...rule,reply:fallback,mode:"规则解析"};
  if (rule.anyChoice || !context.key && clientProposal===undefined) return base;
  try {
    const result=clientProposal===undefined
      ? await requestInterpretation(text,session,context)
      : clientProposal && typeof clientProposal==="object" ? clientProposal as Record<string,unknown> : {};
    const proposal=validPatch(result.patch);
    // Model-only preferences can refine ranking, while explicit rules control eligibility.
    if (!("budget" in rule.patch)) delete proposal.budget;
    delete proposal.servings;
    delete proposal.maxEta;
    if (!("avoid" in rule.patch)) delete proposal.avoid;
    if (!/主食|米饭|配饭|面条|杂粮/.test(rule.meaning)) delete proposal.staple;
    if (!/便宜|价格|预算|元|块/.test(rule.meaning)) delete proposal.target;
    const patch={...proposal,...rule.patch};
    const selection=rule.selection;
    if (!("shop" in selection) && typeof result.shop==="string" && text.includes(result.shop) && menuShops.includes(result.shop)) selection.shop=result.shop;
    const dish=typeof result.dish==="string"?result.dish.trim():"";
    if (!rule.mentionedDish && !selection.shop && !fallback && dish && dish.length<=32 && text.includes(dish) && !fastestDelivery.test(dish)
        && (!rule.shopRevision || menu.some(item=>item.name.includes(dishAliases[dish]??dish)))
        && !genericFood.test(dish) && !menuShops.includes(dish) && !foods.includes(dish)) {
      const matches=menu.filter(item=>item.name.includes(dishAliases[dish]??dish));
      if (matches.length) {
        selection.preferredDish=dishAliases[dish]??dish;
        selection.unavailableDish=undefined;
        selection.category??=matches[0].category;
      } else selection.unavailableDish=dish;
    }
    if (patch.flavor==="香辣" && !("noSpice" in selection) && /辣/.test(rule.meaning)) selection.noSpice=undefined;
    const hasSelection=Object.keys(selection).length>0;
    const wantsRecommendation=rule.newRequest||rule.alternatives||rule.anyChoice||
      /^(?:请|帮我)?(?:推荐|找|挑|选)|^(?:吃什么|有啥好吃)/.test(rule.meaning);
    const canReply=!wantsRecommendation&&!hasSelection&&!rule.question&&!rule.conflict&&!Object.keys(rule.patch).length&&!session.pending;
    const reply=fallback||(canReply&&typeof result.reply==="string"?result.reply.slice(0,300).trim():"");
    return {...base,selection,category:selection.category??rule.category,patch,reply,
      newRequest:rule.newRequest||Boolean(!rule.shopRevision&&result.newRequest===true&&(selection.shop||selection.preferredDish||selection.unavailableDish)),mode:"模型解析"};
  } catch {
    return {...base,mode:"规则解析 · 模型暂不可用"};
  }
}

function yesterdayMains(session:Session) {
  const yesterday=moveDay(session.day,-1);
  return new Set(session.orders.filter(order=>order.day===yesterday).map(order=>order.dish.main));
}

function inService(dish:Dish,blockedMains:Set<string>) {
  return dish.available && dish.deliverable && !blockedMains.has(dish.main);
}

export function eligible(session:Session,dish:Dish,blockedMains=yesterdayMains(session)) {
  const p=effective(session);
  const selection=session.selection??{};
  const category=activeCategory(session);
  const meat=["牛肉","猪肉","鸡肉","羊肉","鸭肉","鱼","虾","贝类","鱿鱼"];
  return !selection.unavailableDish && (!selection.shop || dish.shop===selection.shop) && !selection.excludedShops?.includes(dish.shop) && dish.category===category && (!selection.flavor || dish.flavor===selection.flavor)
    && (!selection.noSpice || dish.flavor!=="香辣" && !dish.ingredients.includes("辣椒"))
    && (!selection.staple || dish.staple===selection.staple)
    && (!selection.ingredient || dish.ingredients.includes(selection.ingredient))
    && (!selection.method || dish.method===selection.method)
    && (!selection.lowOil || dish.lowOil)
    && (!selection.noFry || dish.method!=="油炸")
    && (!selection.meatless || !dish.ingredients.includes("?") && !dish.ingredients.some(food=>meat.includes(food)))
    && (!p.servings || dish.servings===p.servings) && (!p.maxEta || dish.eta<=p.maxEta)
    && inService(dish,blockedMains) && (p.budget===null || dish.price<=p.budget)
    && (!p.avoid.length || !dish.ingredients.includes("?") && !dish.ingredients.some(food=>p.avoid.includes(food)));
}

function feedbackScore(events:Feedback[],dish:Dish,day:string) {
  let score=0.5;
  for (const event of events) {
    const subject=menu.find(item=>item.id===event.dishId);
    if (!subject || subject.category!==dish.category || event.kind==="skip"&&event.day!==day) continue;
    let target:number|undefined;
    let weight=0.2;
    if (event.kind==="order") {
      if (subject.id===dish.id) target=1;
      else if (subject.flavor===dish.flavor || subject.method===dish.method) {target=0.75;weight=0.08;}
    } else {
      if (subject.id===dish.id) target=event.reason==="不想吃这道"?0:0.375;
      if (event.day===day && event.reason===feedbackReasons[0] && Math.floor(subject.price/5)===Math.floor(dish.price/5)) {target=0;weight=0.5;}
      if (event.day===day && event.reason===feedbackReasons[1] && subject.flavor===dish.flavor) {target=0;weight=0.68;}
    }
    if (target!==undefined) score+=weight*(target-score);
  }
  return score;
}

type Ranking = {scores:Score[]; orders:Card["orders"]; menuMode:string; orderMode:string; excluded:number};
async function rank(session:Session, query:string, context:Models, fullMenu=false):Promise<Ranking> {
  const p=effective(session);
  const blockedMains=yesterdayMains(session);
  const options=menu.filter(dish=>fullMenu?inService(dish,blockedMains):eligible(session,dish,blockedMains));
  const history=session.orders.filter(o=>o.dish.category===activeCategory(session)&&o.day>=moveDay(session.day,-30)&&o.day<=session.day);
  const queryText=[query, activeCategory(session), session.selection?.staple??session.selection?.preferredStaple, p.flavor==="不限"?"":p.flavor,p.staple,p.lowOil?"少油":"",p.noFry?"清蒸 炖煮":""].filter(Boolean).join(" ");
  const docs=[queryText,...options.map(document),...history.map(o=>document(o.dish))];
  let vectors=docs.map(localVector);
  let mode="关键词 + 本地标签向量";
  if (context.key && context.vector && query) {
    try { vectors=await embeddings(context,docs); mode="关键词 + 模型向量"; }
    catch { mode="关键词 + 本地标签向量 · 降级"; }
  }
  const similarity=(i:number)=>0.42*lexical(queryText,docs[i])+0.58*cosine(vectors[0],vectors[i]);
  const relevant=history.map((order,i)=>({order,score:similarity(1+options.length+i)}))
    .filter(x=>x.score>0.08).sort((a,b)=>b.score-a.score||b.order.day.localeCompare(a.order.day)).slice(0,3);
  const preferredDish=session.selection?.preferredDish;
  const preferredDishes=new Set(preferredDish?menu.filter(dish=>dish.name.includes(preferredDish)).map(dish=>dish.id):dishRequest(query,activeCategory(session))?.ids);
  const scores=options.map((dish,i)=>{
    const preference=[
      p.flavor==="不限"?0.5:Number(dish.flavor===p.flavor),
      session.selection?.preferredStaple?Number(dish.staple===session.selection.preferredStaple):p.staple==="不限"?0.5:Number(p.staple==="优先米饭"?dish.staple==="米饭":p.staple==="无主食"?dish.staple==="无":dish.staple!=="无"),
      p.lowOil?Number(dish.lowOil):0.5,p.noFry?Number(dish.method!=="油炸"):0.5,
      p.target ? Math.max(0,1-Math.abs(p.target-dish.price)/p.target) : 0.5
    ];
    const historyScore=relevant.length?relevant.reduce((sum,{order})=>sum+0.65*Number(order.dish.flavor===dish.flavor)+0.35*Number(order.dish.method===dish.method),0)/relevant.length:0.5;
    const feedback=feedbackScore(session.feedback,dish,session.day);
    const explicit=(preference[0]*2+preference.slice(1).reduce((sum,x)=>sum+x,0))/6;
    return {id:dish.id,total:0.35*similarity(i+1)+0.35*explicit+0.15*historyScore+0.15*feedback,feedback};
  });
  const etaById=new Map(options.map(dish=>[dish.id,dish.eta]));
  const prioritizeEta=session.selection?.orderBy==="eta";
  scores.sort((a,b)=>(prioritizeEta?etaById.get(a.id)!-etaById.get(b.id)!:0)||
    Number(preferredDishes.has(b.id))-Number(preferredDishes.has(a.id))||b.total-a.total||a.id.localeCompare(b.id));
  return {scores,orders:relevant.map(({order})=>({id:order.id,day:order.day,name:order.dish.name,flavor:order.dish.flavor,sample:order.sample})),
    menuMode:mode,orderMode:mode,excluded:menu.length-options.length};
}

const rankingLimit=10;

async function setRanking(session:Session,context:Models,query:string,matches:string[],seen:string[]) {
  const leading=matches.slice(0,rankingLimit);
  const ids=[...leading];
  if (ids.length && ids.length<rankingLimit) {
    const other=await rank(session,query,{...context,key:""},true);
    const excluded=new Set([...leading,...seen]);
    ids.push(...other.scores.filter(score=>!excluded.has(score.id)).slice(0,rankingLimit-ids.length).map(score=>score.id));
  }
  session.ranking={ids,matchCount:leading.length};
}

export async function refreshRanking(session:Session,context:Models) {
  const batch=session.batch;
  const query=batch?.query??"";
  const ranking=await rank(session,query,{...context,key:""});
  const seen=batch?.seen??[];
  const matches=ranking.scores.filter(score=>!seen.includes(score.id)).map(score=>score.id);
  const current=batch?.card?.dish.id;
  if (current && matches.includes(current)) {
    matches.splice(matches.indexOf(current),1);
    matches.unshift(current);
  } else if (batch?.card && !eligible(session,batch.card.dish)) {
    batch.card=null;
  }
  await setRanking(session,context,query,matches,seen);
}

export async function choose(session:Session,context:Models,query="",seen:string[]=[],intentMode="预设偏好",batchId:string=uuid()) {
  const ranking=await rank(session,query,context);
  const ordered=ranking.scores.filter(score=>!seen.includes(score.id)).map(score=>score.id);
  const dish=menu.find(candidate=>candidate.id===ordered[0]);
  const conditions=effective(session);
  let card:Card|null=null;
  if (dish) {
    const selection=session.selection??{};
    const speedReason=selection.orderBy==="eta"
      ? `预计 ${dish.eta} 分钟送达，是${seen.length?"剩余":""}符合当前条件的${dish.category}中最快的。`
      : "";
    const evidence=[
      ...(speedReason?[speedReason]:[]),
      ...(selection.shop?[`来自你指定的「${dish.shop}」。`]:[]),
      ...(!selection.shop&&selection.excludedShops?.length?[`已换到「${dish.shop}」，避开本轮排除的店。`]:[]),
      ...(selection.preferredDish&&dish.name.includes(selection.preferredDish)?[`菜名匹配你想吃的「${selection.preferredDish}」。`]:[]),
      ...(conditions.maxEta?[`预计 ${dish.eta} 分钟送达，符合 ${conditions.maxEta} 分钟内的要求。`]:[]),
      ...(conditions.budget!==null?[`模拟到手价 ¥${dish.price}，在当前 ¥${conditions.budget} 的预算内。`]:[]),
      ...(conditions.servings?[`菜单标注 ${dish.servings} 人份，符合人数要求。`]:[]),
      ...(selection.noSpice?["菜单口味和配料标签均未标注辣味。"]:selection.flavor===dish.flavor?[`符合「${dish.flavor}」口味要求。`]:[]),
      ...(selection.ingredient?[`菜单配料包含「${selection.ingredient}」。`]:[]),
      ...(selection.staple?[`符合${dish.staple==="无"?"不含主食":`搭配${dish.staple}`}的要求。`]:[]),
      ...(selection.method?[`菜单烹饪方式为${dish.method}。`]:[]),
      ...(selection.lowOil?["菜单标注少油。"]:[]),
      ...(selection.noFry?["菜单烹饪方式为非油炸。"]:[]),
      ...(conditions.avoid.length?[`模拟配料记录未列出当前忌口的${conditions.avoid.join("、")}。`]:[])
    ];
    const sentence=evidence[0]??`这份${dish.category}是${dish.flavor}口味，模拟到手价 ¥${dish.price}。`;
    card={id:batchId,dish,conditions,reason:sentence,evidence,orders:ranking.orders,
      mode:{intent:intentMode,menu:ranking.menuMode,orders:ranking.orderMode,reason:recommendationFactMode},excluded:ranking.excluded};
  }
  session.batch={id:batchId,query,seen,card};
  await setRanking(session,context,query,ordered,seen);
  return card;
}

export async function compareFeedback(session:Session,event:Feedback,context:Models):Promise<Comparison> {
  const before={...session,feedback:session.feedback.filter(e=>e!==event && !(e.batchId===event.batchId&&e.dishId===event.dishId&&e.kind===event.kind))};
  // A reason changes the existing skip; compare against an otherwise identical skip.
  if (event.kind==="skip"&&event.reason) before.feedback.push({...event,reason:undefined});
  const query=session.batch?.query??"";
  const oldRanking=await rank(before,query,context);
  const newRanking=await rank(session,query,context);
  const rows=oldRanking.scores.map((old,i)=>{
    const index=newRanking.scores.findIndex(s=>s.id===old.id);
    return {id:old.id,name:menu.find(d=>d.id===old.id)!.name,before:i+1,after:index+1,delta:Number((newRanking.scores[index].total-old.total).toFixed(4))};
  }).filter(row=>row.delta!==0).sort((a,b)=>Math.abs(b.after-b.before)-Math.abs(a.after-a.before)||Math.abs(b.delta)-Math.abs(a.delta)).slice(0,8);
  return {reference:menu.find(d=>d.id===event.dishId)?.name??"",reason:event.reason??(event.kind==="order"?"成功下单":"换一道"),rows};
}
