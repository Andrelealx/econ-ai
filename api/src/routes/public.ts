import { Router } from "express";
import { z } from "zod";
import { generatePublicAdvisorReply } from "../services/advisorService";

const publicMessageSchema = z.object({
  message: z.string().min(2).max(2000)
});

export const publicRouter = Router();

publicRouter.post("/public/chat", async (req, res) => {
  const parsed = publicMessageSchema.safeParse(req.body);

  if (!parsed.success) {
    res.status(400).json({ error: "Mensagem invalida", details: parsed.error.flatten() });
    return;
  }

  const message = parsed.data.message.trim();
  const reply = await generatePublicAdvisorReply(message);

  res.json({
    data: {
      message: reply
    }
  });
});
