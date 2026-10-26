import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("production"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().url().startsWith("postgresql://"),
  CORS_ORIGINS: z.string().optional(),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(168),
  BLOCKCHAIN_RPC_URL: z.string().url().optional(),
  BLOCKCHAIN_CHAIN_ID: z.coerce.number().int().min(1).optional(),
  BLOCKCHAIN_REGISTRY_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  BLOCKCHAIN_RELAYER_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  BLOCKCHAIN_CONFIRMATIONS: z.coerce.number().int().min(1).max(100).default(1)
}).superRefine((environment, context) => {
  const networkConfigured = [
    environment.BLOCKCHAIN_RPC_URL,
    environment.BLOCKCHAIN_CHAIN_ID,
    environment.BLOCKCHAIN_REGISTRY_ADDRESS
  ].filter(Boolean).length;
  if ((networkConfigured !== 0 && networkConfigured !== 3) || (environment.BLOCKCHAIN_RELAYER_PRIVATE_KEY && networkConfigured !== 3)) {
    context.addIssue({
      code: "custom",
      message: "BLOCKCHAIN_RPC_URL, BLOCKCHAIN_CHAIN_ID, and BLOCKCHAIN_REGISTRY_ADDRESS must be configured together",
      path: ["BLOCKCHAIN_RPC_URL"]
    });
  }
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
