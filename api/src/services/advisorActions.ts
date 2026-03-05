import { pool } from "../db/pool";

export type GoalSnapshot = {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  status: string;
};

type GoalContributionAction = {
  type: "goal_contribution";
  goalId: string;
  goalName: string;
  amount: number;
  previousAmount: number;
  updatedAmount: number;
  targetAmount: number;
  progressPercent: number;
};

type GoalActionResolution = {
  handled: boolean;
  action?: GoalContributionAction;
  message?: string;
};

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value);
}

function extractBrlAmount(message: string): number | null {
  const normalized = message.replace(/\s+/g, " ");
  const match = normalized.match(/(?:r\$\s*)?(\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)/i);

  if (!match) {
    return null;
  }

  const raw = match[1].replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const amount = Number(raw);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return Number(amount.toFixed(2));
}

function detectGoalContributionIntent(message: string): boolean {
  const text = normalizeText(message);

  if (!text.includes("meta")) {
    return false;
  }

  return /(adicion|acrescent|coloc|som|deposit|aument|aportar|juntar)/.test(text);
}

function resolveGoalByName(message: string, goals: GoalSnapshot[]): GoalSnapshot | null {
  const normalizedMessage = normalizeText(message);

  const exact = goals.find((goal) => normalizedMessage.includes(normalizeText(goal.name)));
  if (exact) {
    return exact;
  }

  const metaMention = normalizedMessage.match(/meta\s+([a-z0-9\s]+)/i)?.[1]?.trim();
  if (!metaMention) {
    return null;
  }

  const fuzzy = goals.find((goal) => normalizeText(goal.name).includes(metaMention));
  return fuzzy ?? null;
}

function createDisambiguationMessage(goals: GoalSnapshot[], amount: number): string {
  const goalList = goals.map((goal) => `- **${goal.name}**`).join("\n");

  return [
    "## Preciso de um detalhe para executar a acao",
    `Entendi que voce quer adicionar **${formatCurrency(amount)}** em uma meta, mas voce tem mais de uma ativa.`,
    "",
    "Me diga o nome exato da meta. Exemplo:",
    `> Adicione ${formatCurrency(amount)} na meta Reserva de emergencia`,
    "",
    "Metas ativas:",
    goalList
  ].join("\n");
}

function createMissingAmountMessage(): string {
  return [
    "## Falta o valor da acao",
    "Consigo executar isso agora, mas preciso do valor.",
    "",
    "Exemplo:",
    "> Adicione 200 reais na minha meta Reserva de emergencia"
  ].join("\n");
}

function createNoGoalsMessage(): string {
  return [
    "## Nenhuma meta ativa encontrada",
    "Voce ainda nao tem metas financeiras ativas para eu atualizar.",
    "",
    "Crie uma meta em **Orcamentos e Metas** e depois me peça algo como:",
    "> Adicione 200 reais na minha meta"
  ].join("\n");
}

function createActionDoneMessage(action: GoalContributionAction): string {
  const remaining = Math.max(action.targetAmount - action.updatedAmount, 0);

  return [
    "## Acao executada com sucesso",
    `Adicionei **${formatCurrency(action.amount)}** na meta **${action.goalName}**.`,
    "",
    "### Atualizacao da meta",
    `- Valor anterior: **${formatCurrency(action.previousAmount)}**`,
    `- Valor atual: **${formatCurrency(action.updatedAmount)}**`,
    `- Progresso: **${action.progressPercent.toFixed(1)}%**`,
    `- Falta para concluir: **${formatCurrency(remaining)}**`,
    "",
    "### Proximo passo sugerido",
    "- Se quiser, eu tambem posso programar uma cadencia mensal para acelerar essa meta."
  ].join("\n");
}

export async function tryExecuteGoalAction(params: {
  userId: string;
  message: string;
  goals: GoalSnapshot[];
}): Promise<GoalActionResolution> {
  const { message, goals, userId } = params;

  if (!detectGoalContributionIntent(message)) {
    return { handled: false };
  }

  const activeGoals = goals.filter((goal) => goal.status !== "completed");

  if (!activeGoals.length) {
    return {
      handled: true,
      message: createNoGoalsMessage()
    };
  }

  const amount = extractBrlAmount(message);
  if (!amount) {
    return {
      handled: true,
      message: createMissingAmountMessage()
    };
  }

  let goal = resolveGoalByName(message, activeGoals);

  if (!goal && activeGoals.length === 1) {
    goal = activeGoals[0];
  }

  if (!goal) {
    return {
      handled: true,
      message: createDisambiguationMessage(activeGoals, amount)
    };
  }

  const updatedAmount = Number((goal.currentAmount + amount).toFixed(2));

  await pool.query(
    `UPDATE goals
     SET current_amount = $1,
         status = CASE
           WHEN $1 >= target_amount THEN 'completed'
           ELSE status
         END
     WHERE id = $2
       AND user_id = $3`,
    [updatedAmount, goal.id, userId]
  );

  const progressPercent = goal.targetAmount > 0 ? (updatedAmount / goal.targetAmount) * 100 : 0;

  const action: GoalContributionAction = {
    type: "goal_contribution",
    goalId: goal.id,
    goalName: goal.name,
    amount,
    previousAmount: goal.currentAmount,
    updatedAmount,
    targetAmount: goal.targetAmount,
    progressPercent: Number(Math.min(progressPercent, 999).toFixed(1))
  };

  return {
    handled: true,
    action,
    message: createActionDoneMessage(action)
  };
}
