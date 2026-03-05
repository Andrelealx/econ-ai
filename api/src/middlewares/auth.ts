import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config";

type TokenPayload = {
  sub: string;
  email: string;
};

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Token ausente" });
    return;
  }

  const token = header.slice("Bearer ".length);

  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    req.userId = payload.sub;
    req.userEmail = payload.email;
    next();
  } catch {
    res.status(401).json({ error: "Token invalido ou expirado" });
  }
}

export function signAuthToken(userId: string, email: string): string {
  return jwt.sign({ sub: userId, email }, env.JWT_SECRET, { expiresIn: "7d" });
}
