// Meryem Esma Eröz, 2200005798
// Bonus 5: fill a fresh database with two demo users and their tasks. Safe to run twice.
//   deno task seed
import { count, eq, inArray } from "drizzle-orm";
import { createDb, type Db, migrate } from "../src/db.ts";
import { hashPassword } from "../src/auth.ts";
import { type Task, tasks, users } from "../src/schema.ts";

type NewTask = Pick<Task, "title" | "status" | "priority" | "dueDate">;

export const DEMO_PASSWORD = "demo-password-1";

export const DEMO_USERS: { email: string; tasks: NewTask[] }[] = [
  {
    email: "demo.esma@example.com",
    tasks: [
      {
        title: "Calculus homework 6",
        status: "todo",
        priority: "high",
        dueDate: "2026-11-24",
      },
      {
        title: "Read Meteoroloji unit 6",
        status: "todo",
        priority: "medium",
        dueDate: null,
      },
      {
        title: "OOP lab 05: Vehicle class",
        status: "in-progress",
        priority: "high",
        dueDate: "2026-11-21",
      },
      {
        title: "Unity racing game: lap timer",
        status: "in-progress",
        priority: "low",
        dueDate: null,
      },
      {
        title: "AutoTrack AI: lane detection test",
        status: "todo",
        priority: "high",
        dueDate: "2026-11-28",
      },
      {
        title: "SEN0415 Assignment 4",
        status: "done",
        priority: "high",
        dueDate: "2026-11-20",
      },
      {
        title: "SEN0415 Assignment 5",
        status: "in-progress",
        priority: "high",
        dueDate: "2026-11-30",
      },
      {
        title: "Economics team report",
        status: "todo",
        priority: "medium",
        dueDate: "2026-11-26",
      },
      {
        title: "Parallel programming exercises",
        status: "todo",
        priority: "medium",
        dueDate: null,
      },
      {
        title: "Update LinkedIn certificates",
        status: "done",
        priority: "low",
        dueDate: null,
      },
      {
        title: "Prepare for the internship",
        status: "todo",
        priority: "medium",
        dueDate: "2026-12-14",
      },
    ],
  },
  {
    email: "demo.mery@example.com",
    tasks: [
      {
        title: "Datathon: clean the data",
        status: "in-progress",
        priority: "high",
        dueDate: "2026-11-25",
      },
      { title: "Datathon: first model", status: "todo", priority: "high", dueDate: null },
      {
        title: "Grafana dashboard panels",
        status: "todo",
        priority: "medium",
        dueDate: null,
      },
      { title: "Buy a new notebook", status: "done", priority: "low", dueDate: null },
      { title: "Read the BFMC rules", status: "todo", priority: "medium", dueDate: null },
      { title: "Plan the weekend", status: "todo", priority: "low", dueDate: null },
      {
        title: "Fix the Jetson camera mount",
        status: "in-progress",
        priority: "high",
        dueDate: "2026-11-22",
      },
      {
        title: "Write the meeting notes",
        status: "done",
        priority: "medium",
        dueDate: null,
      },
      {
        title: "Book the lab for Friday",
        status: "todo",
        priority: "low",
        dueDate: "2026-11-20",
      },
    ],
  },
];

/** Insert the demo data. Returns how many users and tasks were added this time. */
export async function seed(database: Db) {
  const { db } = database;
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  // A user that is already there is skipped (UNIQUE email + onConflictDoNothing).
  const inserted = await db.insert(users)
    .values(DEMO_USERS.map((u) => ({ email: u.email, passwordHash })))
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });

  const rows = await db.select({ id: users.id, email: users.email }).from(users)
    .where(inArray(users.email, DEMO_USERS.map((u) => u.email)));

  let addedTasks = 0;
  for (const demo of DEMO_USERS) {
    const user = rows.find((r) => r.email === demo.email);
    if (!user) continue;
    // Only give tasks to a demo user who has none yet, so a second run adds nothing.
    const [{ n }] = await db.select({ n: count() }).from(tasks).where(
      eq(tasks.userId, user.id),
    );
    if (n > 0) continue;
    await db.insert(tasks).values(demo.tasks.map((t) => ({ ...t, userId: user.id })));
    addedTasks += demo.tasks.length;
  }
  return { users: inserted.length, tasks: addedTasks };
}

if (import.meta.main) {
  if (Deno.env.get("APP_ENV") === "production") {
    console.error("seed: refusing to run with APP_ENV=production");
    Deno.exit(1);
  }
  const url = Deno.env.get("DATABASE_URL") ?? "file:./tasks.db";
  const database = createDb(url);
  await migrate(database);
  const added = await seed(database);
  console.log(`seed: ${url} -> added ${added.users} users and ${added.tasks} tasks`);
  console.log(
    `seed: log in as demo.esma@example.com or demo.mery@example.com, password ${DEMO_PASSWORD}`,
  );
}
