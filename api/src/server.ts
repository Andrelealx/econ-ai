import "express-async-errors";
import fs from "node:fs";
import path from "node:path";
import cors from "cors";
import express, { Request, Response, NextFunction } from "express";
import { env } from "./config";
import { runMigrations } from "./db/migrate";
import { pool } from "./db/pool";
import { requireAuth } from "./middlewares/auth";
import { authRouter } from "./routes/auth";
import { advisorRouter } from "./routes/advisor";
import { dashboardRouter } from "./routes/dashboard";
import { financeRouter } from "./routes/finance";
import { healthRouter } from "./routes/health";
import { investmentsRouter } from "./routes/investments";
import { publicRouter } from "./routes/public";

async function bootstrap(): Promise<void> {
  if (env.AUTO_MIGRATE) {
    await runMigrations();
    console.log("Migrations aplicadas com sucesso.");
  }

  const app = express();

  const allowedOrigin = env.WEB_ORIGIN === "*" ? true : env.WEB_ORIGIN;
  app.use(
    cors({
      origin: allowedOrigin,
      credentials: true
    })
  );

  app.use(express.json({ limit: "2mb" }));

  app.use("/api", healthRouter);
  app.use("/api", publicRouter);
  app.use("/api", authRouter);

  app.use("/api", requireAuth, financeRouter);
  app.use("/api", requireAuth, dashboardRouter);
  app.use("/api", requireAuth, investmentsRouter);
  app.use("/api", requireAuth, advisorRouter);

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Rota da API nao encontrada" });
  });

  const webDistPath = path.resolve(__dirname, "../../web/dist");
  const indexPath = path.join(webDistPath, "index.html");
  const hasWebDist = fs.existsSync(indexPath);

  if (hasWebDist) {
    app.use(express.static(webDistPath));
    app.get("*", (_req, res) => {
      res.sendFile(indexPath);
    });
  } else {
    app.get("/", (_req, res) => {
      res.json({
        service: "finance-advisor-api",
        docs: "Execute npm run build no workspace web para servir o frontend aqui.",
        health: "/api/health"
      });
    });
  }

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    res.status(500).json({ error: "Erro interno do servidor" });
  });

  const server = app.listen(env.PORT, () => {
    console.log(`API rodando em http://localhost:${env.PORT}`);
  });

  const shutdown = async () => {
    console.log("Encerrando servidor...");
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap().catch((error) => {
  console.error("Falha ao iniciar a API", error);
  process.exit(1);
});
