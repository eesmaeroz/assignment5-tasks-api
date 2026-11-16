// Meryem Esma Eröz, 2200005798
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Worked example: the users table.
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // A SQL default runs for every row. A JavaScript Date.now() here would run once.
  createdAt: integer("created_at").notNull().default(sql`(strftime('%s','now'))`),
});

// The sessions table is given: a login makes a row, a token finds it.
export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  expiresAt: integer("expires_at").notNull(),
});

export const STATUSES = ["todo", "in-progress", "done"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;

// A task belongs to one user. Keep this in sync with the SQL in migrate() (db.ts).
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  status: text("status", { enum: STATUSES }).notNull().default("todo"),
  priority: text("priority", { enum: PRIORITIES }).notNull().default("medium"),
  // My own field: an optional due date as "YYYY-MM-DD" (null = no deadline).
  dueDate: text("due_date"),
  createdAt: integer("created_at").notNull().default(sql`(strftime('%s','now'))`),
});

export type Task = typeof tasks.$inferSelect;
