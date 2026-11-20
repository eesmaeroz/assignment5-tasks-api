// Meryem Esma Eröz, 2200005798
// Bonus 11: one validated configuration object instead of loose Deno.env.get calls.
import { z } from "zod";

/** Secrets that are only good enough for a laptop. */
const DEV_SECRETS = ["change-me", "dev-secret"];

const ConfigSchema = z
  .object({
    APP_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().min(1).max(65535).default(8000),
    DATABASE_URL: z
      .string()
      .regex(/^(file:|libsql:|https?:)/, "must start with file:, libsql: or http(s):")
      .default("file:./tasks.db"),
    JWT_SECRET: z.string().min(1).default("change-me"),
    // Bonus 19: the token of a hosted libSQL database (Turso). Only from the environment.
    DATABASE_AUTH_TOKEN: z.string().optional(),
    // Bonus 9: whoever registers with this email becomes an admin.
    ADMIN_EMAIL: z.email().optional(),
    // Bonus 14: when the purge job runs (five cron fields). Every night at 03:00 by
    // default; "* * * * *" (every minute) only to watch it work.
    PURGE_CRON: z.string().trim()
      .regex(/^\S+( \S+){4}$/, "must be a cron expression with five fields")
      .default("0 3 * * *"),
    // Bonus 16: where Deno KV keeps the cache (empty = Deno's default place).
    KV_PATH: z.string().optional(),
    // Bonus 12: the folder for attached images (kept out of Git by .gitignore).
    UPLOAD_DIR: z.string().default("./uploads"),
    // Bonus 6: how many database clients the pool opens (see the README for why 4).
    POOL_SIZE: z.coerce.number().int().min(1).max(32).default(4),
  })
  .superRefine((c, ctx) => {
    // Bonus 19: a hosted database (Turso) answers 401 without its token, so say it now.
    if (c.DATABASE_URL.startsWith("libsql:") && !c.DATABASE_AUTH_TOKEN) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_AUTH_TOKEN"],
        message: "a libsql: database needs its token",
      });
    }
    if (c.APP_ENV !== "production") return;
    if (DEV_SECRETS.includes(c.JWT_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_SECRET"],
        message: "the default development secret is not allowed in production",
      });
    } else if (c.JWT_SECRET.length < 32) {
      ctx.addIssue({
        code: "custom",
        path: ["JWT_SECRET"],
        message: "must have at least 32 characters in production",
      });
    }
  });

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigError extends Error {}

/**
 * Read the settings once and check them. Takes the environment as a plain object, so a
 * test can pass any values without touching the real environment.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  // An empty string in a .env file means "not set", so the default applies.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value !== ""),
  );
  const parsed = ConfigSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new ConfigError(`invalid configuration:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
