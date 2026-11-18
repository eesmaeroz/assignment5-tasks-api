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
    // Bonus 9: whoever registers with this email becomes an admin.
    ADMIN_EMAIL: z.email().optional(),
  })
  .superRefine((c, ctx) => {
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
