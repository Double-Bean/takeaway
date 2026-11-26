import type { Category, Dish, Flavor, Staple } from "./lunch-data";

export type Pref = { budget:number|null; target:number|null; flavor:Flavor; staple:Staple; avoid:string[]; lowOil:boolean; noFry:boolean; servings?:number|null; maxEta?:number|null };
export type Selection = {
  category?:Category; flavor?:Exclude<Flavor,"不限">; staple?:Dish["staple"]; preferredStaple?:Dish["staple"]; ingredient?:string;
  lowOil?:true; noFry?:true; noSpice?:true; meatless?:true;
};
export type Order = { id:string; dish:Dish; day:string; sample?:boolean; batchId?:string };
export type Feedback = { dishId:string; batchId:string; day:string; kind:"skip"|"order"; reason?:string };
export type Score = { id:string; total:number; feedback:number };
export type Comparison = { reference:string; reason:string; rows:{id:string; name:string; before:number; after:number; delta:number}[] };
export type Card = {
  id:string; dish:Dish; conditions:Pref; reason:string; evidence:string[];
  orders:{id:string; day:string; name:string; flavor:Flavor; sample?:boolean}[];
  mode:{intent:string; menu:string; orders:string; reason:string}; excluded:number;
};
export type Batch = { id:string; query:string; seen:string[]; card:Card|null };
export type Message = { id:string; role:"user"|"assistant"; text:string; card?:Card; order?:Order; proposal?:{category:Category; patch:Partial<Pref>} };
export type Session = {
  day:string; offset:number; profile:Pref; categoryProfiles?:Partial<Record<Category,Partial<Pref>>>; preferencesVersion?:2; today:Partial<Pref>; selection?:Selection; batch:Batch|null; ranking?:{ids:string[];matchCount:number};
  messages:Message[]; orders:Order[]; feedback:Feedback[];
  quick:{id:string; text:string; sample?:boolean}[]; hideQuick:boolean;
  comparison:Comparison|null; pending:{ patch:Partial<Pref>; selection?:Selection; question:string }|null;
  seenActions:string[]; mode:"openai"|"dashscope"|"local";
};
