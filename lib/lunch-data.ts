export const flavors = ["清淡", "鲜香", "香辣", "酸甜", "甜味"] as const;
export const staples = ["不限", "优先米饭", "优先有主食", "不含米饭", "无主食"] as const;
export const foods = ["花生", "香菜", "虾", "鸡蛋", "牛肉", "猪肉", "大豆", "小麦", "奶", "鱼", "芝麻", "坚果", "鸡肉", "辣椒", "菌菇", "葱", "蒜", "洋葱", "番茄", "青菜", "土豆", "芒果", "草莓", "香蕉", "苹果", "菠萝", "西瓜", "橙子", "蓝莓", "奇异果", "牛油果", "燕麦", "红豆", "椰子", "南瓜", "玉米", "黄瓜", "西兰花", "白菜", "腰果", "杏仁", "贝类", "鱿鱼", "羊肉", "鸭肉", "红薯", "莲藕", "木耳", "海带", "鹰嘴豆", "豌豆", "胡萝卜", "西芹", "山药", "葡萄", "菠菜", "茄子", "西米"];
export const categories = ["主食", "甜点", "零食", "蔬菜", "水果"] as const;
export type Category = typeof categories[number];
export type Flavor = "不限" | typeof flavors[number];
export type Staple = typeof staples[number];

const shops = ["小满厨房", "饭点食堂", "山间小馆", "日常便当", "好一碗", "原味餐桌"];
type Row = [string, string, number, number, Flavor, string, "米饭"|"面"|"杂粮"|"无", string, boolean?, Category?];
const rows: Row[] = [
  ["香菇蒸鸡饭","steam-chicken",26,0,"清淡","清蒸","米饭","鸡肉 菌菇 大豆 青菜"],
  ["砂锅番茄牛腩饭","tomato-beef",29,1,"酸甜","炖煮","米饭","牛肉 番茄 葱"],
  ["番茄牛腩盖饭","tomato-beef",28,2,"酸甜","炖煮","米饭","牛肉 番茄 洋葱"],
  ["剁椒鸡丁饭","spicy-chicken",27,1,"香辣","小炒","米饭","鸡肉 辣椒 大豆 蒜"],
  ["豆豉蒸鸡饭","blackbean-chicken",27,2,"鲜香","清蒸","米饭","鸡肉 大豆 葱 青菜"],
  ["手撕椒麻鸡饭","pepper-chicken",25,2,"香辣","白切","米饭","鸡肉 辣椒 芝麻 香菜"],
  ["姜葱蒸鸡饭","ginger-chicken",25,3,"清淡","清蒸","米饭","鸡肉 葱 青菜"],
  ["三文鱼杂粮碗","salmon-grain",35,3,"清淡","烘烤","杂粮","鱼 芝麻 青菜"],
  ["照烧三文鱼饭","teriyaki-salmon",38,5,"鲜香","烘烤","米饭","鱼 大豆 小麦 青菜"],
  ["清蒸三文鱼饭","steam-salmon",32,0,"清淡","清蒸","米饭","鱼 葱 青菜"],
  ["菌菇豆腐饭","mushroom-tofu",23,5,"清淡","炖煮","米饭","大豆 菌菇 青菜"],
  ["麻婆豆腐饭","mapo-tofu",22,1,"香辣","小炒","米饭","大豆 辣椒 猪肉"],
  ["家常豆腐饭","home-tofu",24,0,"鲜香","炖煮","米饭","大豆 小麦 青菜"],
  ["青菜豆腐汤面","tofu-noodle",21,4,"清淡","汤煮","面","大豆 小麦 青菜"],
  ["菌菇鸡汤面","chicken-noodle",25,4,"鲜香","汤煮","面","鸡肉 菌菇 小麦 葱"],
  ["鲜虾清汤面","shrimp-noodle",29,4,"清淡","汤煮","面","虾 小麦 葱 鸡蛋"],
  ["番茄牛肉汤面","tomato-beef-noodle",29,4,"酸甜","汤煮","面","牛肉 番茄 小麦 葱"],
  ["宫保鸡丁饭","kungpao",25,1,"香辣","小炒","米饭","鸡肉 辣椒 花生 大豆"],
  ["炸鸡块盖饭","fried-chicken",24,3,"鲜香","油炸","米饭","鸡肉 小麦 鸡蛋 芝麻"],
  ["辣子鸡盖饭","hot-chicken",28,3,"香辣","油炸","米饭","鸡肉 辣椒 小麦"],
  ["蒜香三文鱼沙拉","salmon-salad",33,5,"清淡","烘烤","无","鱼 蒜 芝麻 青菜"],
  ["香菇豆腐青菜碗","tofu-veg",19,5,"清淡","炖煮","无","大豆 菌菇 青菜"],
  ["番茄烧豆腐饭","tomato-tofu",24,2,"酸甜","炖煮","米饭","番茄 大豆 青菜"],
  ["酸辣豆腐汤面","hot-tofu-noodle",23,4,"香辣","汤煮","面","小麦 辣椒 大豆 香菜"],
  ["小炒牛肉盖饭","spicy-beef",33,2,"香辣","小炒","米饭","牛肉 辣椒 蒜"],
  ["清炖牛腩饭","stew-beef",34,0,"清淡","炖煮","米饭","牛肉 青菜 葱"],
  ["味噌豆腐杂粮饭","miso-tofu",26,3,"鲜香","炖煮","杂粮","大豆 芝麻 青菜"],
  ["藤椒鸡杂粮饭","chili-grain",29,3,"香辣","小炒","杂粮","鸡肉 辣椒 青菜"],
  ["秘制鸡肉饭","secret-chicken",20,5,"清淡","清蒸","米饭","?"],
  ["香煎鱼排饭","pan-fish",22,3,"鲜香","香煎","米饭","鱼 葱 青菜",false],
  ["番茄鸡蛋盖饭","egg-tomato-rice",18,0,"酸甜","小炒","米饭","鸡蛋 番茄 葱"],
  ["辣椒炒肉饭","pepper-pork",24,1,"香辣","小炒","米饭","猪肉 辣椒 大豆 蒜"],
  ["香辣青椒鸡丝饭","pepper-chicken-rice",22,3,"香辣","小炒","米饭","鸡肉 青菜 辣椒 大豆"],
  ["剁椒蒸鱼饭","pepper-steamed-fish",28,2,"香辣","清蒸","米饭","鱼 辣椒 葱"],
  ["酸辣番茄米线","hot-tomato-noodle",19,4,"香辣","汤煮","面","辣椒 番茄 青菜 蒜"],
  ["椒麻鸡汤面","pepper-chicken-noodle",24,4,"香辣","汤煮","面","鸡肉 小麦 辣椒 葱"],
  ["香辣茄子豆腐饭","pepper-eggplant-rice",19,5,"香辣","炖煮","米饭","茄子 大豆 辣椒 蒜"],
  ["黑椒牛肉杂粮碗","black-pepper-beef",28,3,"鲜香","小炒","杂粮","牛肉 青菜 玉米 洋葱"],
  ["南瓜鹰嘴豆杂粮饭","pumpkin-grains",20,5,"清淡","清蒸","杂粮","南瓜 鹰嘴豆 胡萝卜 玉米"],
  ["菌菇鸡蛋炒面","mushroom-egg-noodle",20,4,"鲜香","小炒","面","鸡蛋 菌菇 小麦 大豆"],
  ["清蒸鲈鱼配饭","bass-rice",29,2,"清淡","清蒸","米饭","鱼 葱 蒜"],
  ["红烧鸭腿盖饭","duck-rice",26,0,"鲜香","炖煮","米饭","鸭肉 大豆 葱"],
  ["孜然羊肉饭","cumin-lamb",27,2,"鲜香","小炒","米饭","羊肉 洋葱 大豆"],
  ["番茄土豆炖牛腩","tomato-beef-pot",27,1,"酸甜","炖煮","无","牛肉 番茄 土豆"],
  ["香辣蒜蓉炒虾","chili-shrimp",28,2,"香辣","小炒","无","虾 辣椒 蒜"],
  ["白灼虾配青菜","poached-shrimp",27,2,"清淡","汤煮","无","虾 青菜"],
  ["红豆双皮奶","redbean-milk",12,5,"甜味","清蒸","无","红豆 奶 鸡蛋",true,"甜点"],
  ["芒果椰奶布丁","mango-pudding",14,0,"甜味","冷藏","无","芒果 椰子 奶 西米",true,"甜点"],
  ["草莓酸奶杯","strawberry-yogurt",13,5,"酸甜","冷藏","无","草莓 奶",true,"甜点"],
  ["焦糖鸡蛋布丁","caramel-pudding",10,1,"甜味","清蒸","无","鸡蛋 奶",true,"甜点"],
  ["香蕉燕麦松饼","banana-muffin",11,0,"甜味","烘烤","无","香蕉 燕麦 小麦 鸡蛋 奶",true,"甜点"],
  ["烤南瓜蛋挞","pumpkin-tart",9,1,"甜味","烘烤","无","南瓜 小麦 鸡蛋 奶",true,"甜点"],
  ["蓝莓芝士杯","blueberry-cheese",16,5,"酸甜","冷藏","无","蓝莓 奶 小麦",true,"甜点"],
  ["红豆椰奶冻","redbean-coconut",10,1,"甜味","冷藏","无","红豆 椰子",true,"甜点"],
  ["香辣海带结","spicy-kelp",8,0,"香辣","凉拌","无","海带 辣椒 芝麻 大豆",true,"零食"],
  ["孜然烤鹰嘴豆","roasted-chickpea",9,1,"鲜香","烘烤","无","鹰嘴豆",true,"零食"],
  ["酥脆烤红薯条","sweet-potato-bites",8,3,"甜味","烘烤","无","红薯",true,"零食"],
  ["香辣脆藕片","chili-lotus-chips",10,2,"香辣","烘烤","无","莲藕 辣椒 大豆",true,"零食"],
  ["芝麻海苔脆片","seaweed-chips",7,0,"鲜香","烘烤","无","海带 芝麻",true,"零食"],
  ["腰果杏仁小罐","roasted-nuts",15,5,"清淡","烘烤","无","坚果 腰果 杏仁",true,"零食"],
  ["炸鱿鱼圈","fried-squid",17,4,"鲜香","油炸","无","鱿鱼 小麦 鸡蛋",true,"零食"],
  ["烤玉米段","roasted-corn",7,1,"清淡","烘烤","无","玉米",true,"零食"],
  ["蒜蓉清炒西兰花","broccoli-side",12,0,"清淡","小炒","无","西兰花 蒜",true,"蔬菜"],
  ["凉拌拍黄瓜","cucumber-side",9,2,"鲜香","凉拌","无","黄瓜 蒜 大豆 辣椒",true,"蔬菜"],
  ["剁椒蒸茄子","pepper-eggplant",13,1,"香辣","清蒸","无","茄子 辣椒 蒜 大豆",true,"蔬菜"],
  ["香辣手撕包菜","spicy-cabbage",12,1,"香辣","小炒","无","白菜 辣椒 蒜",true,"蔬菜"],
  ["清蒸贝贝南瓜","pumpkin-side",11,5,"清淡","清蒸","无","南瓜",true,"蔬菜"],
  ["白灼菜心","greens-side",10,3,"清淡","汤煮","无","青菜",true,"蔬菜"],
  ["西芹木耳拌山药","celery-side",13,2,"清淡","凉拌","无","西芹 木耳 山药",true,"蔬菜"],
  ["玉米豌豆胡萝卜丁","corn-pea-side",11,3,"清淡","清蒸","无","玉米 豌豆 胡萝卜",true,"蔬菜"],
  ["时令西瓜盒","watermelon-box",9,5,"甜味","鲜切","无","西瓜",true,"水果"],
  ["苹果橙子拼盒","apple-orange-box",12,0,"酸甜","鲜切","无","苹果 橙子",true,"水果"],
  ["芒果菠萝拼盒","mango-pineapple-box",16,5,"酸甜","鲜切","无","芒果 菠萝",true,"水果"],
  ["草莓蓝莓小盒","berry-box",20,3,"酸甜","鲜切","无","草莓 蓝莓",true,"水果"],
  ["香蕉奇异果拼盒","banana-kiwi-box",14,0,"酸甜","鲜切","无","香蕉 奇异果",true,"水果"],
  ["牛油果鲜果杯","avocado-box",18,5,"清淡","鲜切","无","牛油果",true,"水果"],
  ["青提小盒","grape-box",15,3,"甜味","鲜切","无","葡萄",true,"水果"],
  ["鲜切苹果盒","apple-box",8,0,"甜味","鲜切","无","苹果",true,"水果"],
  ["日式炸猪排饭","pork-katsu-rice",28,3,"鲜香","油炸","米饭","猪肉 小麦 鸡蛋 白菜"],
  ["红烧肉盖饭","braised-pork-rice",27,0,"鲜香","炖煮","米饭","猪肉 大豆 青菜"],
  ["脆皮烤鸭饭","roast-duck-rice",29,2,"鲜香","烘烤","米饭","鸭肉 大豆 青菜"],
  ["孜然烤羊肉串","grilled-lamb-skewers",19,2,"鲜香","烧烤","无","羊肉",true,"零食"],
  ["黑椒牛柳盖饭","black-pepper-steak-rice",30,4,"鲜香","小炒","米饭","牛肉 洋葱 大豆 辣椒"],
  ["炸虾天妇罗","shrimp-tempura",18,4,"鲜香","油炸","无","虾 小麦 鸡蛋",true,"零食"],
  ["椒盐炸豆腐","salt-pepper-fried-tofu",12,5,"鲜香","油炸","无","大豆 葱",true,"蔬菜"],
  ["脆皮炸鸡腿","crispy-fried-drumsticks",16,3,"鲜香","油炸","无","鸡肉 小麦 鸡蛋",true,"零食"],
  ["黄金炸薯角","fried-potato-wedges",9,1,"鲜香","油炸","无","土豆",true,"零食"]
];
const portions:Record<Category,string>={"主食":"1 人份","甜点":"1 份","零食":"1 份","蔬菜":"1 小份","水果":"1 盒"};
const sharedPortions:Record<string,2|3|4>={
  "stew-beef":2,"tomato-beef-pot":2,"chili-shrimp":4,"tofu-veg":2,"poached-shrimp":3,
  "redbean-coconut":2,"pumpkin-tart":3,"roasted-nuts":2,"roasted-corn":3,
  "broccoli-side":2,"corn-pea-side":3,"cucumber-side":4,
  "mango-pineapple-box":2,"berry-box":2,"watermelon-box":3,"banana-kiwi-box":4,
};
export const menu = rows.map(([name,main,price,shop,flavor,method,staple,ingredients,available,category="主食"],i)=>{
  const servings=sharedPortions[main]??1;
  return {
    id: `D${String(i+1).padStart(2,"0")}`, name, main, price, category, shop:shops[shop], flavor, method, staple,
    ingredients:ingredients.split(" "), servings, portion:servings>1?servings+" 人份":portions[category], image:`catalog/d${String(i+1).padStart(2,"0")}`, available:available !== false, deliverable: true,
    lowOil:["清蒸","炖煮","汤煮","烘烤","白切","鲜切","凉拌","冷藏"].includes(method), eta:22 + shop*3 + i%3
  };
});
export type Dish = typeof menu[number];
export const dishById = (id:string) => menu.find(d=>d.id===id);
export const samplePrompts = ["30 元以内，清爽一点","想吃辣，最好有米饭","想吃得清淡，25 元以内"];
export const feedbackReasons = ["太贵","今天不想吃这个口味","不想吃这道"] as const;
