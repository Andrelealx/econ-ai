import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4010),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgresql://postgres:postgres@localhost:5432/finance_advisor"),
  JWT_SECRET: z.string().min(16).default("change-this-jwt-secret"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default("gpt-4.1-mini"),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  BRAPI_TOKEN: z.string().optional(),
  AUTO_MIGRATE: z
    .enum(["true", "false"]) 
    .default("true")
    .transform((value) => value === "true")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Variaveis de ambiente invalidas", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
