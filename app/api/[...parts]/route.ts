import { env } from "cloudflare:workers";
import { ActionError } from "@/lib/lunch-actions";
import { createLunchHttp, type SessionRow } from "@/lib/lunch-http";
import type { Session } from "@/lib/lunch-types";

export const dynamic = "force-dynamic";

type Context={params:Promise<{parts:string[]}>};

const database=()=>{ if(!env.DB) throw new ActionError("演示数据库暂不可用。",503); return env.DB; };

async function spend(bucket:string,limit:number) {
  const result=await database().prepare(
    "INSERT INTO lunch_usage (bucket,count) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<?"
  ).bind(bucket,limit).run();
  return Boolean(result.meta.changes);
}
async function load(id:string) {
  return database().prepare("SELECT state,revision FROM lunch_sessions WHERE id=?").bind(id).first<SessionRow>();
}
async function save(id:string,row:SessionRow|null,state:Session) {
  const db=database();
  const serialized=JSON.stringify(state);
  const operation=row?
    db.prepare("UPDATE lunch_sessions SET state=?, revision=revision+1 WHERE id=? AND revision=?").bind(serialized,id,row.revision):
    db.prepare("INSERT OR IGNORE INTO lunch_sessions (id,state,revision) VALUES (?,?,0)").bind(id,serialized);
  return Boolean((await operation.run()).meta.changes);
}
async function handle(request:Request,{params}:Context) {
  const {parts}=await params;
  return createLunchHttp(env,{spend,load,save})(request,parts.join("/"));
}

export {handle as GET,handle as POST,handle as OPTIONS};
