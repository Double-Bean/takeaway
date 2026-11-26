import { env } from "cloudflare:workers";
import { ActionError } from "@/lib/lunch-actions";
import { handleLunchRequest, type LunchStore, type SessionRow } from "@/lib/lunch-api";

export const dynamic = "force-dynamic";
type Context={params:Promise<{parts:string[]}>};

function database() {
  if (!env.DB) throw new ActionError("演示数据库暂不可用。",503);
  return env.DB;
}

const store:LunchStore={
  async load(id) {
    return database().prepare("SELECT state,revision FROM lunch_sessions WHERE id=?").bind(id).first<SessionRow>();
  },
  async save(id,revision,state) {
    const db=database();
    const operation=revision===null
      ? db.prepare("INSERT OR IGNORE INTO lunch_sessions (id,state,revision) VALUES (?,?,0)").bind(id,state)
      : db.prepare("UPDATE lunch_sessions SET state=?, revision=revision+1 WHERE id=? AND revision=?").bind(state,id,revision);
    return Boolean((await operation.run()).meta.changes);
  },
  async spend(bucket,limit) {
    const result=await database().prepare(
      "INSERT INTO lunch_usage (bucket,count) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<?"
    ).bind(bucket,limit).run();
    return Boolean(result.meta.changes);
  }
};

export function OPTIONS(request:Request) {
  return handleLunchRequest(request,"",store,env);
}

async function handle(request:Request,{params}:Context) {
  return handleLunchRequest(request,(await params).parts.join("/"),store,env);
}

export { handle as GET, handle as POST };
