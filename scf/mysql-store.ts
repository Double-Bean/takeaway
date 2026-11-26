import { createPool, type Pool, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import type { LunchStore, SessionRow } from "../lib/lunch-api";

function duplicateKey(error:unknown) {
  return error instanceof Error && "code" in error && error.code==="ER_DUP_ENTRY";
}

export function createMysqlStore(pool:Pool):LunchStore {
  async function updateUsage(bucket:string,limit:number) {
    const [result]=await pool.execute<ResultSetHeader>(
      "UPDATE lunch_usage SET count=count+1 WHERE bucket=? AND count<?",[bucket,limit]
    );
    return result.affectedRows===1;
  }

  return {
    async load(id) {
      const [rows]=await pool.execute<(SessionRow & RowDataPacket)[]>(
        "SELECT state,revision FROM lunch_sessions WHERE id=?",[id]
      );
      return rows[0]??null;
    },
    async save(id,revision,state) {
      if (revision!==null) {
        const [result]=await pool.execute<ResultSetHeader>(
          "UPDATE lunch_sessions SET state=?, revision=revision+1 WHERE id=? AND revision=?",[state,id,revision]
        );
        return result.affectedRows===1;
      }
      try {
        await pool.execute("INSERT INTO lunch_sessions (id,state,revision) VALUES (?,?,0)",[id,state]);
        return true;
      } catch (error) {
        if (duplicateKey(error)) return false;
        throw error;
      }
    },
    async spend(bucket,limit) {
      if (await updateUsage(bucket,limit)) return true;
      try {
        await pool.execute("INSERT INTO lunch_usage (bucket,count) VALUES (?,1)",[bucket]);
        return true;
      } catch (error) {
        if (!duplicateKey(error)) throw error;
        return updateUsage(bucket,limit);
      }
    }
  };
}

export function mysqlPool(env:NodeJS.ProcessEnv) {
  const {MYSQL_HOST,MYSQL_USER,MYSQL_PASSWORD,MYSQL_DATABASE,MYSQL_PORT="3306",MYSQL_SSL_CA}=env;
  if (!MYSQL_HOST || !MYSQL_USER || !MYSQL_PASSWORD || !MYSQL_DATABASE) {
    throw new Error("Set MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD and MYSQL_DATABASE.");
  }
  const port=Number(MYSQL_PORT);
  if (!Number.isInteger(port) || port<1 || port>65535) throw new Error("MYSQL_PORT must be a valid TCP port.");
  return createPool({
    host:MYSQL_HOST,
    port,
    user:MYSQL_USER,
    password:MYSQL_PASSWORD,
    database:MYSQL_DATABASE,
    charset:"utf8mb4",
    connectionLimit:2,
    queueLimit:8,
    connectTimeout:4000,
    ...(MYSQL_SSL_CA?{ssl:{ca:MYSQL_SSL_CA.replace(/\\n/g,"\n"),rejectUnauthorized:true}}:{})
  });
}
