// Meryem Esma Eröz, 2200005798
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Worked example: the users table.
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // Bonus 9: what the user may do. Everybody is "user"; see ADMIN_EMAIL in config.ts.
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  // A SQL default runs for every row. A JavaScript Date.now() here would run once.
  createdAt: integer("created_at").notNull().default(sql`(strftime('%s','now'))`),
}, (t) => [
  // Bonus 1: the CHECK that my hand-written SQL had; now Drizzle Kit writes it.
  check("users_role_check", sql`${t.role} IN ('user', 'admin')`),
]);

// Bonus 7: the given sessions table was removed; login now returns a signed token (JWT).

export const STATUSES = ["todo", "in-progress", "done"] as const;
export const PRIORITIES = ["low", "medium", "high"] as const;

// A task belongs to one user. Bonus 1: this file is the only description of the tables;
// Drizzle Kit writes the SQL in drizzle/ from it (deno task db:generate).
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  status: text("status", { enum: STATUSES }).notNull().default("todo"),
  priority: text("priority", { enum: PRIORITIES }).notNull().default("medium"),
  // My own field: an optional due date as "YYYY-MM-DD" (null = no deadline).
  dueDate: text("due_date"),
  createdAt: integer("created_at").notNull().default(sql`(strftime('%s','now'))`),
  // Bonus 2: soft delete. null = visible, a time (seconds) = deleted at that moment.
  deletedAt: integer("deleted_at"),
  // Bonus 14: when the task became "done" (seconds), null while it is not done. The purge
  // job needs this; created_at would delete an old task that was finished only yesterday.
  doneAt: integer("done_at"),
  // Bonus 12: the generated file name of the attached image (uploads/<uuid>.png), or null.
  attachment: text("attachment"),
  // Bonus 1 (the second migration): when the task was last changed, null if never.
  updatedAt: integer("updated_at"),
}, (t) => [
  // Bonus 4: every task query starts with "WHERE user_id = ?", often "AND status = ?".
  index("idx_tasks_user_status").on(t.userId, t.status),
  // Bonus 1: the CHECKs repeat the Zod rules in the database, so even a bad INSERT written
  // by hand cannot store an unknown status or priority. (My hand-written SQL had them;
  // without these two lines the generated migration would have lost them.)
  check("tasks_status_check", sql`${t.status} IN ('todo', 'in-progress', 'done')`),
  check("tasks_priority_check", sql`${t.priority} IN ('low', 'medium', 'high')`),
]);

export type Task = typeof tasks.$inferSelect;
export type Role = typeof users.$inferSelect["role"];
