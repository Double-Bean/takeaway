import type { models } from "../lib/lunch-models";
import { createScfServer } from "./http";
import { createMysqlStore, mysqlPool } from "./mysql-store";

const server=createScfServer(createMysqlStore(mysqlPool(process.env)),process.env as Parameters<typeof models>[0]);
server.listen(9000,"0.0.0.0");
