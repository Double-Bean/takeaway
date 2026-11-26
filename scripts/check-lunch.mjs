import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const target = mkdtempSync(join(tmpdir(), "lunch-check-"));
try {
  execFileSync("./node_modules/.bin/tsc", [
    "lib/lunch-actions.ts", "--outDir", target, "--target", "es2023", "--module", "commonjs", "--types", "node", "--strict", "--skipLibCheck"
  ], {stdio:"inherit"});
  const require = createRequire(import.meta.url);
  const { categories, foods, menu } = require(join(target,"lunch-data.js"));
  const { categoryPreference, compareFeedback, seed, eligible, effective, moveDay, ruleIntent } = require(join(target,"lunch-engine.js"));
  const { omniModel, normalizeBailianKey } = require(join(target,"lunch-byok.js"));
  const { ask, connectionError, embeddings, models, personalModels, transcribe } = require(join(target,"lunch-models.js"));
  const { applyAction, freshen } = require(join(target,"lunch-actions.js"));
  const local=models({});
  const start=async()=>freshen(seed(),local);
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
  await check("首屏生成有效推荐并提供订单来源",async()=>{
    const s=await start(); assert(eligible(s,card(s).dish)); assert(card(s).orders.length>0);
    assert(card(s).orders.every(o=>s.orders.some(order=>o.id===order.id))); console.log("首推 | "+card(s).dish.name);
  });
  await check("30 元硬预算、清爽口味、米饭偏好",async()=>{
    const s=await send(await start(),"30 元以内，清爽一点，最好有米饭");
    assert.equal(effective(s).budget,30); assert.equal(effective(s).flavor,"清淡"); assert.equal(card(s).dish.staple,"米饭");
    assert(card(s).dish.price<=30 && card(s).dish.flavor==="清淡");
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
  await check("历史指代使用真实种子订单，跨店主菜仍排除",async()=>{
    const s=await start();
    assert.equal(ruleIntent("像昨天那种",s).historical,s.orders[0].id);
    const duplicates=menu.filter(d=>d.main===s.orders[0].dish.main);
    assert(duplicates.length===2&&duplicates.every(d=>!eligible(s,d)));
    await send(s,"想吃像昨天那种");
    assert.notEqual(card(s).dish.main,s.orders[0].dish.main);
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
  await check("下单幂等、推进日期后昨日主菜排除且临时偏好过期",async()=>{
    const s=await send(await start(),"今天想吃辣，最好米饭");
    const orderDish=card(s).dish, action=args(s);
    await applyAction(s,local,"orders",action); await applyAction(s,local,"orders",action);
    assert.equal(simulated(s).length,1);
    const previous=s.day;
    await applyAction(s,local,"demo/clock",{});
    assert.equal(s.day,moveDay(previous,1)); assert.equal(effective(s).flavor,"清淡");
    assert(!eligible(s,orderDish));
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
      assert(card(s).mode.reason.includes("降级"));
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
    assert.equal(effective(session).staple,"无主食");
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
        error=>connectionError(error).includes("没接受这把 Key"));
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
  await check("分品类长期偏好、通用忌口和本轮条件互不写入",async()=>{
    const s=await start();
    await applyAction(s,local,"preferences/profile",{category:"水果",patch:{budget:13,flavor:"甜味",avoid:["西瓜"]}});
    await applyAction(s,local,"preferences/profile",{scope:"global",patch:{avoid:["花生","香菜"]}});
    await send(s,"来份水果");
    assert.equal(effective(s).budget,13);
    assert.deepEqual(effective(s).avoid,["花生","香菜","西瓜"]);
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
    assert.equal(card(s).dish.category,"主食");
    assert.equal(effective(s).flavor,"鲜香");
    assert.equal(s.orders,orders);
  });
  await check("默认百炼路径使用检索证据，模型越界选据不进入说明",async()=>{
    const original=globalThis.fetch;
    let selected=[0,2];
    globalThis.fetch=async (_url,options)=>{
      const request=JSON.parse(options.body);
      const input=JSON.parse(request.messages.at(-1).content[0].text);
      const result=input.facts?{factIds:selected}:{patch:{flavor:"香辣"}};
      if (input.facts) assert(input.facts.every(fact=>typeof fact==="string"));
      return new Response("data: "+JSON.stringify({choices:[{delta:{content:JSON.stringify(result)}}]})+"\n\ndata: [DONE]\n\n");
    };
    try {
      const model=models({LUNCH_DEFAULT_BAILIAN_KEY:"fixture-default"});
      assert.equal(model.vector,"");
      const s=await start();
      await applyAction(s,model,"messages",{text:"今天想吃一点辣的面条"});
      assert.equal(card(s).mode.reason,"检索增强 · 核验选据");
      assert(card(s).reason.includes(card(s).evidence[0]));
      selected=[999];
      await applyAction(s,model,"messages",{text:"今天想吃一点辣的面条"});
      assert.equal(card(s).mode.reason,"事实模板");
    } finally {globalThis.fetch=original;}
  });
  await check("完整 Key 和常见粘贴包装通过，脱敏值及 AccessKey ID 被拒绝",async()=>{
    const key="sk-fixture-key_123";
    assert.equal(normalizeBailianKey(key),key);
    assert.equal(normalizeBailianKey("   "+key+"\n"),key);
    assert.equal(normalizeBailianKey("Authorization: Bearer "+key),key);
    assert.equal(normalizeBailianKey('export DASHSCOPE_API_KEY="'+key+'"\n'),key);
    assert.equal(normalizeBailianKey("API Key：“sk-fix\u200Bture-key_123”"),key);
    assert.equal(normalizeBailianKey("sk-"+ "a".repeat(250)),"sk-"+ "a".repeat(250));
    for(const bad of ["sk-****1234","sk-abc...def","sk-abc…def","LTAI-fake-id",key+" extra",""])assert.equal(normalizeBailianKey(bad),null);
  });
  console.log(`完成 | ${passed} 个固定场景`);
} finally {rmSync(target,{recursive:true,force:true});}
