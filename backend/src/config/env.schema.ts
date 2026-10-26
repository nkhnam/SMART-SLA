import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  CORS_ORIGINS: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168)
});

export type AppEnvironment = Omit<z.infer<typeof environmentSchema>, "CORS_ORIGINS"> & {
  CORS_ORIGINS: string[];
};

export function validateEnvironment(environment: Record<string, unknown>): AppEnvironment {
  const validation = environmentSchema.safeParse(environment);
  if (!validation.success) {
    throw new Error(`Invalid environment configuration: ${validation.error.issues.map((issue) => `${issue.path.join(".") || "environment"}: ${issue.message}`).join("; ")}`);
  }
  const parsed = validation.data;
  const configuredOrigins = parsed.CORS_ORIGINS?.split(",").map((origin) => origin.trim()).filter(Boolean);

  if (parsed.NODE_ENV === "production" && (!configuredOrigins || configuredOrigins.length === 0)) {
    throw new Error("CORS_ORIGINS must be configured in production.");
  }

  const corsOrigins = configuredOrigins ?? ["http://localhost:3000"];
  for (const origin of corsOrigins) {
    const parsedOrigin = new URL(origin);
    if (parsed.NODE_ENV === "production" && parsedOrigin.protocol !== "https:") {
      throw new Error("Production CORS origins must use HTTPS.");
    }
  }

  return { ...parsed, CORS_ORIGINS: corsOrigins };
}
