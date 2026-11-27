import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = mkdtempSync(join(tmpdir(), "lunch-check-"));
try {
  execFileSync("./node_modules/.bin/tsc", [
    "lib/lunch-actions.ts", "lib/lunch-pages-transport.ts", "lib/lunch-http.ts", "--outDir", target, "--target", "es2023", "--module", "commonjs", "--types", "node", "--strict", "--skipLibCheck"
  ], {stdio:"inherit"});
  const require = createRequire(import.meta.url);
  const { categories, foods, menu } = require(join(target,"lunch-data.js"));
  const { categoryPreference, compareFeedback, seed, eligible, effective, moveDay, ruleIntent } = require(join(target,"lunch-engine.js"));
  const { omniModel, normalizeApiKey } = require(join(target,"lunch-byok.js"));
  const { ask, connectionError, embeddings, models, personalModels, transcribe } = require(join(target,"lunch-models.js"));
  const { applyAction, freshen } = require(join(target,"lunch-actions.js"));
  const { createPagesTransport } = require(join(target,"lunch-pages-transport.js"));
  const local=models({});
  const start=async()=>applyAction(await freshen(seed(),local),local,"recommendations/daily",{});
  const send=(s,text)=>applyAction(s,local,"messages",{text});
  const card=s=>s.batch.card;
  const args=s=>({batchId:card(s).id,dishId:card(s).dish.id});
  const simulated=(s)=>s.orders.filter(o=>!o.sample);
  let passed=0;
  async function check(name,run) {
    try { await run(); passed++; console.log("通过 | "+name); }
    catch(e) {console.error("失败 | "+name);throw e;}
  }
  await check("每道模拟菜都有独立配图和可展示的菜单资料",async()=>{
    assert.equal(new Set(menu.map(dish=>dish.image)).size,menu.length);
    for (const category of categories) assert(menu.filter(dish=>dish.category===category).length>=8);
    for (const dish of menu) {
      assert(dish.name&&dish.shop&&dish.portion&&dish.method&&dish.price>0&&dish.eta>0);
      assert(dish.ingredients.length>0&&dish.ingredients.every(food=>foods.includes(food)||food==="?"));
      assert(statSync(join("public","food",dish.image+".webp")).size>1000,dish.image);
    }
  });
  await check("查看今日推荐生成有效推荐并提供订单来源",async()=>{
    const s=await start(); assert(eligible(s,card(s).dish)); assert(card(s).orders.length>0);
    assert(card(s).orders.every(o=>s.orders.some(order=>o.id===order.id))); console.log("首推 | "+card(s).dish.name);
  });
  await check("直接发送时没有预置卡片，主动查看时才生成今日推荐",async()=>{
    const s=await freshen(seed(),local);
    assert.deepEqual(s.messages,[]);
    assert.equal(s.batch,null);
    await send(s,"今天想吃一点辣的面条");
    assert.deepEqual(s.messages.map(message=>message.role),["user","assistant"]);
    assert.equal(card(s).dish.staple,"面");
    assert.equal(card(s).dish.flavor,"香辣");
    await applyAction(s,local,"recommendations/daily",{});
    assert.equal(s.messages.length,2);

    const legacy=await start();
    legacy.messages[0].text="午饭时间到了。按你平时的口味，今天可以试试这份。";
    await freshen(legacy,local);
    assert.deepEqual(legacy.messages,[]);
    await send(legacy,"再便宜点");
    assert.match(legacy.messages.at(-1).text,/多少元以内/);
  });
  await check("指定餐厅可直接推荐，旧会话的澄清回复和后续调价都保留店名",async()=>{
    const s=await freshen(seed(),local);
    await send(s,"我想吃小满厨房的饭");
    assert.equal(card(s).dish.shop,"小满厨房");
    await send(s,"再便宜一点");
    assert.equal(card(s).dish.shop,"小满厨房");
    await send(s,"这家有甜点吗？");
    assert.equal(card(s).dish.shop,"小满厨房");
    assert.equal(card(s).dish.category,"甜点");

    const legacy=await freshen(seed(),local);
    legacy.messages=[
      {role:"user",text:"我想吃小满厨房的",id:"user"},
      {role:"assistant",text:"小满厨房是餐厅名称还是菜品风格？",id:"assistant"}
    ];
    legacy.pending={patch:{budget:25},question:legacy.messages[1].text};
    await send(legacy,"餐厅名称");
    assert.equal(card(legacy).dish.shop,"小满厨房");
    assert(card(legacy).dish.price<=25);
    assert.equal(legacy.pending,null);
    await send(legacy,"小满厨房是餐厅名称");
    assert.equal(card(legacy).dish.shop,"小满厨房");
  });
  await check("菜名缺失时不替用户换菜，明确同意后可继续推荐",async()=>{
    const s=await send(await start(),"我想吃小满厨房的饭");
    for (const request of ["我要吃佛跳墙","佛跳墙","有佛跳墙吗？"]) {
      await send(s,request);
      assert.equal(card(s),null);
      assert.match(s.messages.at(-1).text,/没有「佛跳墙」.*暂无符合条件/);
    }
    await send(s,"看看别的菜");
    assert(card(s));
  });
  await check("模型读取会话和菜品详情，可回答追问且不会捏造缺失菜品",async()=>{
    const s=await send(await start(),"想吃小满厨房的饭，28元以内");
    const previous=globalThis.fetch;
    const initial=card(s).dish;
    let calls=0;
    globalThis.fetch=async (_url,options)=>{
      const payload=JSON.parse(options.body);
      const input=JSON.parse(payload.messages.at(-1).content);
      calls++;
      assert(input.history.some(turn=>turn.dish===initial.name));
      assert.equal(input.conditions.budget,28);
      assert.equal(input.dish.shop,"小满厨房");
      const result=input.text==="这道适合带去公司吃吗？"
        ? {reply:"可以放在午休时吃，模拟菜单标注为 1 人份。"}
        : {dish:"桂花糯米藕"};
      return Response.json({choices:[{message:{content:JSON.stringify(result)}}]});
    };
    try {
      const model=personalModels("fixture","qwen-flash");
      await applyAction(s,model,"messages",{text:"这道适合带去公司吃吗？"});
      assert.match(s.messages.at(-1).text,/午休/);
      assert.equal(card(s).dish,initial);
      await applyAction(s,model,"messages",{text:"我要吃桂花糯米藕"});
      assert.equal(card(s),null);
      assert.match(s.messages.at(-1).text,/没有「桂花糯米藕」/);
      assert.equal(calls,2);
    } finally {globalThis.fetch=previous;}
  });
  await check("30 元硬预算、清爽口味、米饭偏好",async()=>{
    const s=await send(await start(),"30 元以内，清爽一点，最好有米饭");
    assert.equal(effective(s).budget,30); assert.equal(effective(s).flavor,"清淡"); assert.equal(card(s).dish.staple,"米饭");
    assert(card(s).dish.price<=30 && card(s).dish.flavor==="清淡");
  });
  await check("口味程度词不被当成菜名，显式菜名仍然可识别",async()=>{
    for (const text of ["清淡一点","想吃清淡一点","想吃清淡一点的","想吃清淡些的","想吃清淡一点的米饭"]) {
      const s=await send(await start(),text);
      assert.equal(s.selection.requestedDish,undefined,text);
      assert.equal(card(s).dish.flavor,"清淡",text);
    }
    const named=await send(await start(),"想吃清淡一点的清蒸鲈鱼配饭");
    assert.equal(named.selection.requestedDish,undefined);
    assert.equal(card(named).dish.name,"清蒸鲈鱼配饭");
  });
  await check("连续追问保留条件并以当前餐价格为参照",async()=>{
    const s=await send(await start(),"30 元以内，清爽一点，最好有米饭");
    const reference=card(s).dish.price;
    await send(s,"再便宜点");
    assert(effective(s).budget<reference);
    assert(!card(s)||card(s).dish.price<reference);
    assert.equal(effective(s).staple,"优先米饭");
  });
  await check("口语数字和否定词不会变成相反条件",async()=>{
    const s=await send(await start(),"二十五块以内，不要辣椒，最好有米饭");
    assert.equal(effective(s).budget,25); assert(effective(s).avoid.includes("辣椒"));
    assert(!card(s).dish.ingredients.includes("辣椒"));
  });
  await check("左右是软目标，和硬预算不同",async()=>{
    const s=await send(await start(),"三十元左右，吃点清爽的");
    assert.equal(effective(s).budget,null); assert.equal(effective(s).target,30);
  });
  await check("历史指代识别种子订单，同主菜的跨店版本不再推荐",async()=>{
    const s=await start();
    assert.equal(ruleIntent("像昨天那种",s).historical,s.orders[0].id);
    const duplicates=menu.filter(d=>d.main===s.orders[0].dish.main);
    assert(duplicates.length===2&&duplicates.every(d=>!eligible(s,d)));
    await send(s,"想吃像昨天那种");
    assert(card(s));
    assert.notEqual(card(s).dish.main,s.orders[0].dish.main);
    assert.match(s.messages.at(-1).text,/查到样例订单/);
  });
  await check("忌口、未知成分和下架状态是硬边界",async()=>{
    const s=await start();
    for(const dish of menu.filter(d=>d.ingredients.includes("花生")||d.ingredients.includes("?")||!d.available)) assert(!eligible(s,dish));
    await send(s,"这次可以吃花生");
    assert(effective(s).avoid.includes("花生"));
    assert(s.messages.at(-1).text.includes("忌口"));
  });
  await check("没有合格候选时保持硬预算",async()=>{
    const s=await send(await start(),"5 元以内");
    assert.equal(card(s),null); assert.equal(effective(s).budget,5);
  });
  await check("明确跳过原因用相同候选比较同类降权",async()=>{
    const s=await start(), prior=args(s);
    await applyAction(s,local,"recommendations/next",prior);
    assert.notEqual(card(s).dish.id,prior.dishId);
    assert(!s.comparison.rows.some(x=>x.id!==prior.dishId&&x.delta!==0));
    await applyAction(s,local,"feedback",{...prior,reason:"今天不想吃这个口味"});
    const affected=s.comparison.rows.find(row=>row.id!==prior.dishId&&row.delta<0);
    assert(affected); assert.equal(s.feedback.length,1);
    console.log("反馈实测 | "+affected.name+" "+affected.before+"→"+affected.after+"，分数 "+affected.delta);
  });
  await check("推进后昨日实单及同主菜从推荐和排名排除，隔天恢复",async()=>{
    const s=await send(await start(),"今天想吃辣，最好米饭");
    const orderDish=card(s).dish, action=args(s);
    await applyAction(s,local,"orders",action); await applyAction(s,local,"orders",action);
    assert.equal(simulated(s).length,1);
    const previous=s.day;
    await applyAction(s,local,"demo/clock",{});
    assert.equal(s.day,moveDay(previous,1)); assert.equal(effective(s).flavor,"清淡");
    assert(!eligible(s,orderDish));
    const yesterday=new Set(menu.filter(dish=>dish.main===orderDish.main).map(dish=>dish.id));
    assert(s.ranking.ids.every(id=>!yesterday.has(id)));
    await send(s,"想吃像昨天那种");
    assert.notEqual(card(s)?.dish.main,orderDish.main);
    await applyAction(s,local,"demo/clock",{});
    assert(eligible(s,orderDish));
  });
  await check("快捷输入去重、清空和会话隔离",async()=>{
    const a=await send(await start(),"十八块以内"), b=await start();
    await send(a,"十八块以内"); assert.equal(a.quick.filter(q=>q.text==="十八块以内").length,1);
    assert(!b.quick.some(q=>q.text==="十八块以内"));
    await applyAction(a,local,"quick-inputs",{}); assert.equal(a.quick.length,0);
  });
  await check("模拟上游故障后文字仍能推荐并标记降级",async()=>{
    const prior=globalThis.fetch;
    globalThis.fetch=async()=>new Response("",{status:503});
    try {
      const s=await start();
      await applyAction(s,models({OPENAI_API_KEY:"test-only"}),"messages",{text:"想吃清淡，25 元以内"});
      assert(card(s).dish.price<=25);
      assert(card(s).mode.intent.includes("暂不可用"));
      assert(card(s).mode.menu.includes("降级"));
      assert.equal(card(s).mode.reason,"菜单与推荐排序");
    } finally {globalThis.fetch=prior;}
  });
  await check("替身语音服务返回转写文本，校验服务端文件上传协议",async()=>{
    const prior=globalThis.fetch;
    globalThis.fetch=async(url,options)=>{
      assert(String(url).endsWith("/audio/transcriptions"));
      assert(options.body instanceof FormData);
      assert.equal(options.body.get("file").name,"meal.webm");
      return Response.json({text:"三十元以内，不要辣"});
    };
    try {assert.equal(await transcribe(models({OPENAI_API_KEY:"test-only"}),new File(["sample"],"meal.webm",{type:"audio/webm"})),"三十元以内，不要辣");}
    finally {globalThis.fetch=prior;}
  });
  await check("百炼同一把密钥可调用三个模型，并允许单独配置语音",async()=>{
    const prior=globalThis.fetch, requests=[];
    globalThis.fetch=async(url,options)=>{
      const body=JSON.parse(options.body);
      requests.push([body.model,options.headers.get("Authorization")]);
      if(body.model==="text-embedding-v4") return Response.json({data:[{index:0,embedding:[1,0]}]});
      if(body.model==="qwen3-asr-flash") {
        assert(body.messages[0].content[0].input_audio.data.startsWith("data:audio/wav;base64,"));
        return Response.json({choices:[{message:{content:"少放辣椒"}}]});
      }
      assert(String(url).endsWith("chat/completions") && body.max_tokens===450);
      return Response.json({choices:[{message:{content:'{"ok":true}'}}]});
    };
    try {
      const shared=models({DASHSCOPE_API_KEY:"fixture-shared"});
      assert.equal(shared.speechKey,shared.key);
      const mixed=models({DASHSCOPE_API_KEY:"fixture-shared",DASHSCOPE_ASR_API_KEY:"fixture-speech"});
      const file=new File(["sample"],"meal.wav",{type:"audio/wav"});
      assert.equal((await ask(mixed,"Return JSON",{})).ok,true);
      await embeddings(mixed,["测试检索"]);
      assert.equal(await transcribe(mixed,file),"少放辣椒");
      assert.deepEqual(requests,[
        ["qwen-flash","Bearer fixture-shared"],["text-embedding-v4","Bearer fixture-shared"],
        ["qwen3-asr-flash","Bearer fixture-speech"]
      ]);
      const speechOnly=models({DASHSCOPE_ASR_API_KEY:"fixture-speech"});
      assert.equal(speechOnly.provider,"dashscope");
      assert.equal((await freshen(seed(),speechOnly)).mode,"dashscope");
      await assert.rejects(()=>embeddings(speechOnly,["测试检索"]));
    } finally {globalThis.fetch=prior;}
  });
  await check("Omni 用同一 Key 接收文字与 WAV，关闭云端向量",async()=>{
    const model=personalModels("fixture-omni");
    assert.equal(model.vector,"");
    const previous=globalThis.fetch;
    let calls=0;
    globalThis.fetch=async(url,options)=>{
      const body=JSON.parse(options.body);
      assert(String(url).includes(".cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions"));
      assert.equal(options.headers.get("Authorization"),"Bearer fixture-omni");
      assert.equal(body.model,omniModel);
      assert.deepEqual(body.modalities,["text"]);
      assert.equal(body.stream,true);
      calls++;
      const audio=body.messages.at(-1).content.find(x=>x.type==="input_audio");
      if(audio) {assert.equal(audio.input_audio.format,"wav"); assert(audio.input_audio.data.startsWith("data:audio/wav;base64,"));}
      const parts=audio?["二十五","元以内"]:['{"ok":','true}'];
      const sse=parts.map(content=>"data: "+JSON.stringify({choices:[{delta:{content}}]})+"\r\n\r\n").join("")+"data: [DONE]\n\n";
      const bytes=new TextEncoder().encode(sse);
      const bodyStream=new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close();}});
      return new Response(bodyStream,{headers:{"content-type":"text/event-stream"}});
    };
    try {
      assert.equal((await ask(model,"Return JSON",{})).ok,true);
      assert.equal(await transcribe(model,new File(["fixture"],"test.wav",{type:"audio/wav"})),"二十五元以内");
      assert.equal(calls,2);
    } finally {globalThis.fetch=previous;}
  });
  await check("浏览器模型建议只提供可校验的补充条件",async()=>{
    const session=await start();
    await applyAction(session,local,"messages",{
      text:"二十五元以内，不要辣椒",
      modelPatch:{budget:null,staple:"无主食",avoid:["未知食材"],order:"fake"}
    });
    assert.equal(effective(session).budget,25);
    assert.equal(effective(session).staple,"优先有主食");
    assert.deepEqual(effective(session).avoid,["花生","辣椒"]);
  });
  await check("托管环境接受请求配置且不会把 Key 转发到重定向地址",async()=>{
    const previous=globalThis.fetch;
    let calls=0;
    globalThis.fetch=async (_url, options)=>{
      calls++;
      assert.equal(options.redirect,"manual");
      return new Response(null,{status:307,headers:{Location:"https://example.invalid/"}});
    };
    try {
      await assert.rejects(()=>ask(personalModels("sk-fixture"),"Return JSON",{}),
        error=>error.status===307);
      assert.equal(calls,1);
    } finally {globalThis.fetch=previous;}
  });
  await check("百炼拒绝无效 Key 时显示鉴权错误",async()=>{
    const previous=globalThis.fetch;
    globalThis.fetch=async()=>new Response(null,{status:401});
    try {
      await assert.rejects(()=>ask(personalModels("sk-fixture-invalid"),"Return JSON",{}),
        error=>connectionError(error).includes("未接受此 API Key"));
    } finally {globalThis.fetch=previous;}
  });
  await check("明确想吃辣时，历史偏好和模型输出都不能排出清淡菜",async()=>{
    const s=await start();
    await applyAction(s,local,"messages",{text:"我今天想吃辣的。",modelPatch:{flavor:"清淡"}});
    assert.equal(card(s).dish.flavor,"香辣");
    await applyAction(s,local,"recommendations/next",args(s));
    assert.equal(card(s).dish.flavor,"香辣");
    await send(s,"再便宜一点");
    assert.equal(card(s).dish.flavor,"香辣");
    await send(s,"现在不吃辣了");
    assert(card(s) && !card(s).dish.ingredients.includes("辣椒"));
    await send(s,"还是想吃辣的");
    assert.equal(card(s).dish.flavor,"香辣");
  });
  await check("改主意可重设口味、主食和预算，保留无关条件",async()=>{
    const s=await send(await freshen(seed(),local),"想吃辣的面条，30元以内，不要香菜");
    assert.equal(card(s).dish.staple,"面");
    await send(s,"改主意了，还是不辣，改吃米饭吧，预算改成25元以内");
    assert.equal(card(s).dish.staple,"米饭");
    assert.notEqual(card(s).dish.flavor,"香辣");
    assert(!card(s).dish.ingredients.includes("辣椒"));
    assert.equal(effective(s).budget,25);
    assert(effective(s).avoid.includes("香菜"));
    await send(s,"可以吃香菜了");
    assert.deepEqual(effective(s).avoid,["花生"]);
    assert.equal(effective(s).budget,25);
    assert.equal(card(s).dish.staple,"米饭");
    assert.deepEqual(categoryPreference(s,"主食").avoid,[]);
    await send(s,"不是米饭，而是面条，还是想吃辣的，预算不限");
    assert.equal(card(s).dish.staple,"面");
    assert.equal(card(s).dish.flavor,"香辣");
    assert.equal(effective(s).budget,null);
  });
  await check("逐一换完所有合格菜，软偏好和反馈只改排名，昨日主菜全程排除",async()=>{
    const s=await start();
    const sameMain=s.orders.find(order=>eligible(s,order.dish));
    assert(sameMain);
    s.orders=[{...sameMain,sample:false,day:moveDay(s.day,-1)},...s.orders];
    await send(s,"想吃主食，不限预算，最好是面条，尽量少油，少炸");
    const expected=menu.filter(dish=>eligible(s,dish)).map(dish=>dish.id);
    assert(expected.length>5);
    assert(!expected.includes(sameMain.dish.id));
    assert(menu.some(dish=>expected.includes(dish.id)&&dish.staple==="米饭"));
    assert(menu.some(dish=>expected.includes(dish.id)&&!dish.lowOil));
    const actual=[];
    while(card(s) && actual.length<=expected.length) {
      assert.equal(s.ranking.ids.length,10);
      assert.equal(s.ranking.matchCount,Math.min(expected.length-actual.length,10));
      assert.equal(s.ranking.ids[0],card(s).dish.id);
      assert(s.ranking.ids.slice(0,s.ranking.matchCount).every(id=>expected.includes(id)&&!actual.includes(id)));
      assert(s.ranking.ids.every(id=>menu.find(d=>d.id===id).main!==sameMain.dish.main));
      actual.push(card(s).dish.id);
      const previous=args(s);
      await applyAction(s,local,"recommendations/next",previous);
      if (actual.length===1) await applyAction(s,local,"feedback",{...previous,reason:"今天不想吃这个口味"});
    }
    assert.deepEqual(actual.slice().sort(),expected.slice().sort());
    assert.equal(s.ranking.ids.length,0);
    assert.equal(s.ranking.matchCount,0);
    assert.match(s.messages.at(-1).text,new RegExp("本轮|这轮符合条件的 "+expected.length+" 道菜都看过了"));
    console.log("换菜穷尽 | "+actual.length+" 道，全部可达");
  });
  await check("甜点、零食、蔬菜、水果均可按品类和约束推荐",async()=>{
    const s=await start();
    const prompts=[
      ["15 元以内的水果，不要芒果","水果",15],
      ["想吃甜点，不要奶，15 元以内","甜点",15],
      ["10 元以内，来点香辣零食","零食",10],
      ["15 元以内，推荐香辣蔬菜","蔬菜",15],
      ["我还是想吃香辣米饭，必须有米饭，25 元以内","主食",25],
    ];
    for (const [text,category,budget] of prompts) {
      await send(s,text);
      assert.equal(card(s)?.dish.category,category,text);
      assert(card(s).dish.price<=budget);
      assert(!card(s).dish.ingredients.some(food=>effective(s).avoid.includes(food)));
    }
    assert.equal(card(s).dish.staple,"米饭");
  });
  await check("无法同时满足明确条件时展示真实无结果及预算建议",async()=>{
    const s=await send(await start(),"5 元以内的香辣主食");
    assert.equal(card(s),null);
    assert.match(s.messages.at(-1).text,/暂无符合条件的主食.*香辣.*5 元以内/);
    assert.match(s.messages.at(-1).text,/提高一点预算/);
    assert.equal(effective(s).budget,5);
  });
  await check("菜名只调整排序，缺菜与硬约束仍准确",async()=>{
    const s=await start();
    await send(s,"想吃炸猪排饭");
    assert.equal(card(s).dish.name,"日式炸猪排饭");
    assert(s.ranking.ids.length>1);
    await send(s,"想吃牛肉汉堡");
    assert.equal(card(s),null);
    assert.match(s.messages.at(-1).text,/牛肉汉堡.*暂无符合条件/);
    assert.deepEqual(s.ranking.ids,[]);
    await send(s,"清淡一点");
    assert.equal(card(s).dish.flavor,"清淡");
    await send(s,"想吃牛肉面");
    assert(card(s).dish.ingredients.includes("牛肉"));
    assert.equal(card(s).dish.staple,"面");
    await send(s,"想吃点油炸小吃");
    assert.equal(card(s).dish.method,"油炸");
    assert.equal(card(s).dish.category,"零食");
    await send(s,"想吃炸虾天妇罗，不吃虾");
    assert(!card(s).dish.ingredients.includes("虾"));
    assert.notEqual(card(s).dish.name,"炸虾天妇罗");
  });
  await check("旧版按品类存放的忌口合并并跨类别生效",async()=>{
    const s=await start();
    s.preferencesVersion=2;
    s.categoryProfiles={水果:{avoid:["芒果"]},甜点:{avoid:["奶","芒果"],budget:20}};
    await freshen(s,local);
    assert.equal(s.preferencesVersion,3);
    assert.deepEqual(effective(s).avoid,["花生","芒果","奶"]);
    assert.equal(categoryPreference(s,"甜点").budget,20);
    assert.deepEqual(s.categoryProfiles.水果,{});
    await send(s,"想吃芒果");
    assert.match(s.messages.at(-1).text,/芒果.*忌口/);
  });
  await check("默认百炼 Key 为文字和语音使用北京地域端点",async()=>{
    const backend=models({LUNCH_DEFAULT_BAILIAN_KEY:"fixture-default"});
    assert.deepEqual(backend,{
      ...personalModels("fixture-default"),base:"https://dashscope.aliyuncs.com/compatible-mode/v1"
    });
  });
  await check("截图复现：果盒下单之后，辣的面条走主食且上一单临时条件不叠加",async()=>{
    const s=await send(await start(),"想吃水果，10元以内，不要辣椒");
    assert.equal(card(s).dish.category,"水果");
    await applyAction(s,local,"orders",args(s));
    assert.deepEqual(s.today,{});
    await send(s,"今天想吃一点辣的面条。");
    assert.equal(card(s).dish.category,"主食");
    assert.equal(card(s).dish.staple,"面");
    assert.equal(card(s).dish.flavor,"香辣");
    assert.equal(effective(s).budget,30);
    assert(!effective(s).avoid.includes("辣椒"));
    assert(card(s).orders.every(o=>s.orders.find(order=>order.id===o.id).dish.category==="主食"));
    const fruitEvent=s.feedback.at(-1);
    assert.deepEqual((await compareFeedback(s,fruitEvent,local)).rows,[]);
  });
  await check("同品类明确新请求也清除预算，追问则保留条件",async()=>{
    const s=await send(await start(),"想吃清淡的米饭，10元以内");
    assert.equal(card(s),null);
    await send(s,"今天想吃一点辣的面条");
    assert.equal(card(s).dish.staple,"面");
    await send(s,"预算改成25元以内");
    assert.equal(card(s).dish.staple,"面");
    assert.equal(card(s).dish.flavor,"香辣");
    assert(card(s).dish.price<=25);
  });
  await check("长期忌口适用于所有类别，更新列表后不保留已删除项",async()=>{
    const s=await start();
    await applyAction(s,local,"preferences/profile",{category:"水果",patch:{budget:13,flavor:"甜味",avoid:["西瓜"]}});
    assert.deepEqual(effective(s).avoid,["西瓜"]);
    await applyAction(s,local,"preferences/profile",{scope:"global",patch:{avoid:["花生","香菜"]}});
    await send(s,"来份水果");
    assert.equal(effective(s).budget,13);
    assert.deepEqual(effective(s).avoid,["花生","香菜"]);
    await send(s,"不要苹果");
    assert(!categoryPreference(s,"水果").avoid.includes("苹果"));
    await send(s,"以后水果的预算12元");
    const proposal=s.messages.at(-1).proposal;
    assert.equal(proposal.category,"水果");
    assert.deepEqual(proposal.patch,{budget:12,target:null});
    await applyAction(s,local,"preferences/profile",{...proposal,merge:true});
    await send(s,"今天想吃一点辣的面条");
    assert.equal(effective(s).budget,30);
    assert.deepEqual(effective(s).avoid,["花生","香菜"]);
    await applyAction(s,local,"demo/clock",{});
    assert.equal(categoryPreference(s,"水果").budget,12);
  });
  await check("旧会话迁移保留订单和长期偏好，清除可能串品类的临时条件",async()=>{
    const s=await send(await start(),"来份水果，15元以内");
    delete s.preferencesVersion;
    s.profile.flavor="鲜香";
    const orders=s.orders;
    await freshen(s,local);
    assert.deepEqual(s.today,{});
    assert.equal(s.batch,null);
    await send(s,"想吃主食");
    assert.equal(card(s).dish.category,"主食");
    assert.equal(effective(s).flavor,"鲜香");
    assert.equal(s.orders,orders);
  });
  await check("最快送达先过滤确定的条件，再按菜单 ETA 排序，换菜保留速度优先",async()=>{
    const s=await freshen(seed(),local);
    const prior=globalThis.fetch;
    globalThis.fetch=async()=>Response.json({choices:[{message:{content:JSON.stringify({
      question:"你想要哪个餐馆？",reply:"你想要哪个餐馆？",dish:"最快送到"
    })}}]});
    try {
      await applyAction(s,personalModels("fixture","qwen-flash"),"messages",{text:"给我最快送到的，24元以内"});
    } finally {globalThis.fetch=prior;}
    assert.equal(s.pending,null);
    const candidates=menu.filter(dish=>eligible(s,dish)).sort((a,b)=>a.eta-b.eta);
    assert.equal(card(s).dish.eta,candidates[0].eta);
    assert(card(s).dish.price<=24);
    assert.match(card(s).reason,new RegExp(`预计 ${candidates[0].eta} 分钟.*最快`));
    const etas=s.ranking.ids.slice(0,s.ranking.matchCount).map(id=>menu.find(dish=>dish.id===id).eta);
    assert.deepEqual(etas,candidates.slice(0,10).map(dish=>dish.eta));
    await send(s,"随便");
    assert.equal(card(s).dish.eta,candidates[0].eta);
    const skipped=card(s).dish.id;
    await send(s,"换一道");
    assert.notEqual(card(s).dish.id,skipped);
    assert.equal(card(s).dish.eta,candidates[1].eta);
    assert.match(card(s).reason,/剩余.*最快/);
  });
  await check("旧会话被追问餐馆时回复随便，恢复最快送达意图",async()=>{
    const s=await freshen(seed(),local);
    s.messages=[
      {role:"user",text:"给我最快送到的",id:"user"},
      {role:"assistant",text:"你想要哪个餐馆？",id:"assistant"},
    ];
    s.pending={patch:{},question:s.messages[1].text};
    await send(s,"随便");
    assert.equal(s.pending,null);
    assert.equal(s.selection.shop,undefined);
    assert.equal(card(s).dish.eta,Math.min(...menu.filter(dish=>eligible(s,dish)).map(dish=>dish.eta)));
  });
  await check("普通推荐忽略模型的可选条件追问，必要的澄清仍可保留",async()=>{
    const s=await freshen(seed(),local);
    await applyAction(s,local,"messages",{text:"随便推荐一个午餐",modelResult:{question:"请提供餐馆和预算。",reply:"哪家餐馆？"}});
    assert.equal(s.pending,null);
    assert(card(s));
    await send(s,"不加松露");
    assert.match(s.pending.question,/忌口/);
  });
  await check("推荐说明直接使用已执行的排序和菜单条件，样例订单不出现在说明中",async()=>{
    const s=await send(await start(),"今天想吃一点辣的面条，25元以内");
    assert.equal(card(s).mode.reason,"菜单与推荐排序");
    assert(card(s).evidence.some(fact=>fact.includes("香辣")));
    assert(card(s).evidence.some(fact=>fact.includes("¥25")));
    assert(card(s).evidence.some(fact=>fact.includes("搭配面")));
    assert(!card(s).evidence.join("").includes("订单"));
    assert(!card(s).reason.includes("订单"));
  });
  await check("人数与预计送达时间同时参与推荐、榜单和下单，保留忌口",async()=>{
    const s=await freshen(seed(),local);
    await applyAction(s,local,"preferences/today",{patch:{servings:2,maxEta:30}});
    assert.equal(card(s).dish.servings,2);
    assert(card(s).dish.eta<=30 && !card(s).dish.ingredients.includes("花生"));
    for(const id of s.ranking.ids.slice(0,s.ranking.matchCount)) {
      const dish=menu.find(option=>option.id===id);
      assert.equal(dish.servings,2);
      assert(dish.eta<=30);
    }
    await applyAction(s,local,"orders",args(s));
    assert.equal(simulated(s)[0].dish.servings,2);
    assert.equal(effective(s).servings,undefined);
    await send(s,"想吃主食，三人份，三十分钟内送达");
    assert.equal(card(s).dish.servings,3);
    assert(card(s).dish.eta<=30);
    await applyAction(s,local,"preferences/today",{patch:{maxEta:10}});
    assert.equal(card(s),null);
    assert.match(s.messages.at(-1).text,/10 分钟内送达/);
  });
  await check("匿名打开时的网络错误可恢复，云端写入重试沿用原请求ID",async()=>{
    let sessionRequests=0,writeRequests=0;
    const bodies=[];
    const cloud=await freshen(seed(),models({LUNCH_DEFAULT_BAILIAN_KEY:"fixture"}));
    const fetcher=async(url,options)=>{
      if(url.includes("/session?")) {
        sessionRequests++;
        if(sessionRequests<=2) throw new TypeError("Temporary browser network error");
        return Response.json(cloud,{headers:{"X-Lunch-Session":"fixture-session"}});
      }
      assert.equal(options.credentials,"omit");
      assert.equal(options.headers.get("X-Lunch-Session"),"fixture-session");
      bodies.push(options.body);
      if(++writeRequests===1) return new Response("Gateway Timeout",{status:504});
      return Response.json(cloud);
    };
    const transport=createPagesTransport("https://lunch.example/api/",fetcher,()=>{throw Error("Storage denied");});
    assert.equal((await transport.load()).mode,"local");
    assert.equal((await transport.act("messages",{text:"想吃饭",requestId:"fixture-id"})).mode,"dashscope");
    assert.equal(sessionRequests,3);
    assert.equal(writeRequests,2);
    assert.equal(bodies[0],bodies[1]);
  });
  await check("GitHub Pages 与魔搭共用后端，跨域会话可恢复，推荐结果一致",async()=>{
    const {createLunchHttp}=require(join(target,"lunch-http.js"));
    const {studioApiOrigin}=require(join(target,"lunch-network.js"));
    const rows=new Map();
    const handle=createLunchHttp({},{
      spend:async()=>true,
      load:async id=>rows.get(id)??null,
      save:async(id,row,state)=>{rows.set(id,{state:JSON.stringify(state),revision:(row?.revision??-1)+1});return true;},
    });
    const storage=new Map();
    const browserStorage=()=>({getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)});
    const pagesFetch=async(url,options)=>{
      assert.equal(options.credentials,"omit");
      assert.equal(options.headers.has("X-Lunch-Session"),false);
      const headers=new Headers(options.headers);
      headers.set("Origin","https://double-bean.github.io");
      return handle(new Request(url,{...options,headers}),new URL(url).pathname.slice(5));
    };
    const pagesTransport=()=>createPagesTransport(studioApiOrigin+"/api/",pagesFetch,browserStorage);
    const initial=await pagesTransport().load();
    assert.deepEqual(initial.messages,[]);
    const payload={requestId:crypto.randomUUID(),text:"想吃清淡一点的"};
    const resumed=pagesTransport();
    assert.deepEqual((await resumed.load()).messages,[]);
    assert.equal(rows.size,1);
    const pages=await resumed.act("messages",payload);
    const native=await handle(new Request(studioApiOrigin+"/api/session"),"session");
    const cookie=native.headers.get("set-cookie").split(";")[0];
    const direct=await handle(new Request(studioApiOrigin+"/api/messages",{
      method:"POST",headers:{cookie,"Content-Type":"application/json",Origin:studioApiOrigin},body:JSON.stringify(payload),
    }),"messages");
    assert.equal(direct.status,200);
    const theSame=await direct.json();
    assert.deepEqual(pages.selection,theSame.selection);
    assert.equal(card(pages).dish.id,card(theSame).dish.id);
    const audio=new FormData();
    audio.set("audio",new Blob([new Uint8Array(256)],{type:"audio/wav"}),"sample.wav");
    const speech=await resumed.transcribe(audio,new AbortController().signal);
    assert.equal(speech.status,503);
    assert.match((await speech.json()).error,/尚未启用/);
    const foreign=await handle(new Request(studioApiOrigin+"/api/messages",{
      method:"POST",headers:{Origin:"https://example.com"},body:JSON.stringify(payload),
    }),"messages");
    assert.equal(foreign.status,403);
  });
  await check("开场无消息即有十道排名，筛选后匹配菜优先且数量固定",async()=>{
    const s=await freshen(seed(),local);
    assert.deepEqual(s.messages,[]);
    assert.equal(s.batch,null);
    assert.equal(s.ranking.ids.length,10);
    assert.equal(new Set(s.ranking.ids).size,10);
    const initial=s.ranking.ids;
    const differentPreference=seed();
    differentPreference.profile.flavor="香辣";
    await freshen(differentPreference,local);
    assert.notDeepEqual(differentPreference.ranking.ids,initial);
    const noHistory=seed();
    noHistory.orders=[];
    await freshen(noHistory,local);
    assert.notDeepEqual(noHistory.ranking.ids,initial);
    await send(s,"想吃水果，12 元以内");
    const matches=menu.filter(dish=>eligible(s,dish));
    assert(matches.length>0&&matches.length<10);
    assert.equal(s.ranking.ids.length,10);
    assert.equal(s.ranking.matchCount,matches.length);
    assert.deepEqual(new Set(s.ranking.ids.slice(0,s.ranking.matchCount)),new Set(matches.map(dish=>dish.id)));
    assert.equal(s.ranking.ids[0],card(s).dish.id);
    await send(s,"想吃主食，1 元以内");
    assert.equal(card(s),null);
    assert.equal(s.ranking.ids.length,0);
    assert.equal(s.ranking.matchCount,0);
  });
  await check("已保存的旧会话补齐排名，未触发新推荐",async()=>{
    const s=await send(await start(),"想吃水果");
    const current=card(s).dish.id;
    const count=s.messages.length;
    delete s.ranking;
    await freshen(s,local);
    assert.equal(s.ranking.ids[0],current);
    assert.equal(s.ranking.ids.length,10);
    assert.equal(s.messages.length,count);
  });
  await check("选择模型时切换文本和语音接口，OpenAI 兼容请求不携带推理参数",async()=>{
    const original=globalThis.fetch;
    try {
      assert.equal(personalModels("fixture","qwen-flash").speech,"qwen3-asr-flash");
      const model=personalModels("fixture","gpt-4.1-mini");
      globalThis.fetch=async (url,options)=>{
        assert.equal(options.headers.get("Authorization"),"Bearer fixture");
        if(String(url).endsWith("/audio/transcriptions")) {
          assert.equal(options.body.get("model"),"gpt-4o-mini-transcribe");
          return Response.json({text:"想吃米饭"});
        }
        assert.equal(String(url),"https://api.openai.com/v1/chat/completions");
        const body=JSON.parse(options.body);
        assert.equal(body.model,"gpt-4.1-mini");
        assert.equal("reasoning_effort" in body,false);
        return Response.json({choices:[{message:{content:'{"ok":true}'}}]});
      };
      assert.equal((await ask(model,"Return JSON",{})).ok,true);
      assert.equal(await transcribe(model,new File(["fixture"],"speech.wav")),"想吃米饭");
    } finally {globalThis.fetch=original;}
  });
  await check("完整 Key 和常见粘贴包装通过，脱敏值及 AccessKey ID 被拒绝",async()=>{
    const key="sk-fixture-key_123";
    assert.equal(normalizeApiKey(key),key);
    assert.equal(normalizeApiKey("   "+key+"\n"),key);
    assert.equal(normalizeApiKey("Authorization: Bearer "+key),key);
    assert.equal(normalizeApiKey('export DASHSCOPE_API_KEY="'+key+'"\n'),key);
    assert.equal(normalizeApiKey("API Key：“sk-fix\u200Bture-key_123”"),key);
    assert.equal(normalizeApiKey("sk-"+ "a".repeat(250)),"sk-"+ "a".repeat(250));
    for(const bad of ["sk-****1234","sk-abc...def","sk-abc…def","LTAI-fake-id",key+" extra",""])assert.equal(normalizeApiKey(bad),null);
  });
  console.log(`完成 | ${passed} 个固定场景`);
} finally {rmSync(target,{recursive:true,force:true});}
