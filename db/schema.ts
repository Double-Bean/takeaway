import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const lunchSessions = sqliteTable("lunch_sessions", {
  id: text("id").primaryKey(),
  revision: integer("revision").notNull(),
  state: text("state").notNull()
});

export const lunchUsage = sqliteTable("lunch_usage", {
  bucket: text("bucket").primaryKey(),
  count: integer("count").notNull()
});
