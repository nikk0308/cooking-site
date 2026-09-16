import { z } from "zod";
export const runtimeConfigSchema = z.object({
  MEDIA_ROOT: z.string().min(1).default(".local-media"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z
    .string()
    .url()
    .refine(
      (value) =>
        value.startsWith("postgresql://") || value.startsWith("postgres://"),
      { message: "DATABASE_URL must use a PostgreSQL scheme" },
    ),
  DATABASE_QUERY_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .positive()
    .max(10_000)
    .default(2_000),
});
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export function parseRuntimeConfig(
  environment: Record<string, string | undefined>,
): RuntimeConfig {
  return runtimeConfigSchema.parse(environment);
}
let cachedConfig: RuntimeConfig | undefined;
export function getRuntimeConfig(): RuntimeConfig {
  cachedConfig ??= parseRuntimeConfig(process.env);
  return cachedConfig;
}
