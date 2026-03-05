import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { pool } from "../db/pool";
import { createId } from "../utils/id";
import { requireAuth, signAuthToken } from "../middlewares/auth";

const registerSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  monthlyIncome: z.coerce.number().min(0).default(0),
  riskProfile: z.enum(["conservador", "moderado", "arrojado"]).default("moderado")
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

export const authRouter = Router();

authRouter.post("/auth/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const existing = await pool.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);

  if (existing.rowCount) {
    res.status(409).json({ error: "Este email ja esta cadastrado" });
    return;
  }

  const userId = createId();
  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, monthly_income, risk_profile)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      userId,
      parsed.data.fullName.trim(),
      email,
      passwordHash,
      parsed.data.monthlyIncome,
      parsed.data.riskProfile
    ]
  );

  await pool.query(
    `INSERT INTO accounts (id, user_id, name, type, currency, balance)
     VALUES ($1, $2, 'Conta corrente', 'checking', 'BRL', 0),
            ($3, $2, 'Corretora', 'brokerage', 'BRL', 0)`,
    [createId(), userId, createId()]
  );

  const token = signAuthToken(userId, email);

  res.status(201).json({
    data: {
      token,
      user: {
        id: userId,
        fullName: parsed.data.fullName,
        email,
        monthlyIncome: parsed.data.monthlyIncome,
        riskProfile: parsed.data.riskProfile
      }
    }
  });
});

authRouter.post("/auth/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Dados invalidos", details: parsed.error.flatten() });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const result = await pool.query<{
    id: string;
    full_name: string;
    email: string;
    password_hash: string;
    monthly_income: string;
    risk_profile: string;
  }>(
    `SELECT id, full_name, email, password_hash, monthly_income, risk_profile
     FROM users
     WHERE email = $1`,
    [email]
  );

  if (!result.rowCount) {
    res.status(401).json({ error: "Credenciais invalidas" });
    return;
  }

  const user = result.rows[0];
  const passwordMatch = await bcrypt.compare(parsed.data.password, user.password_hash);

  if (!passwordMatch) {
    res.status(401).json({ error: "Credenciais invalidas" });
    return;
  }

  const token = signAuthToken(user.id, user.email);

  res.json({
    data: {
      token,
      user: {
        id: user.id,
        fullName: user.full_name,
        email: user.email,
        monthlyIncome: Number(user.monthly_income),
        riskProfile: user.risk_profile
      }
    }
  });
});

authRouter.get("/auth/me", requireAuth, async (req, res) => {
  const userId = req.userId as string;
  const result = await pool.query<{
    id: string;
    full_name: string;
    email: string;
    monthly_income: string;
    risk_profile: string;
    created_at: string;
  }>(
    `SELECT id, full_name, email, monthly_income, risk_profile, created_at
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (!result.rowCount) {
    res.status(404).json({ error: "Usuario nao encontrado" });
    return;
  }

  const user = result.rows[0];
  res.json({
    data: {
      id: user.id,
      fullName: user.full_name,
      email: user.email,
      monthlyIncome: Number(user.monthly_income),
      riskProfile: user.risk_profile,
      createdAt: user.created_at
    }
  });
});
