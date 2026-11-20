// Meryem Esma Eröz, 2200005798
// Bonus 1: Drizzle Kit reads schema.ts and writes the migration files into drizzle/.
//   deno task db:generate   (after a change in schema.ts)
//   deno task db:migrate    (apply them to tasks.db; the server also does it at start)
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: "file:./tasks.db" },
});
