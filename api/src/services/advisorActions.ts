import { pool } from "../db/pool";
import { createId } from "../utils/id";

type GoalStatus = "active" | "completed" | "paused";
type TransactionType = "income" | "expense" | "transfer";

export type GoalSnapshot = {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  status: GoalStatus;
};

export type AccountSnapshot = {
  id: string;
  name: string;
  type: "checking" | "savings" | "wallet" | "brokerage";
  currency: string;
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

type GoalSavedAction = {
  type: "goal_saved";
  mode: "created" | "updated";
  goalId: string;
  goalName: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string | null;
  status: GoalStatus;
  progressPercent: number;
};

type BudgetUpsertAction = {
  type: "budget_upsert";
  category: string;
  monthRef: string;
  monthlyLimit: number;
};

type TransactionCreatedAction = {
  type: "transaction_created";
  transactionId: string;
  transactionType: TransactionType;
  category: string;
  description: string;
  amount: number;
  occurredOn: string;
  accountId: string | null;
  accountName: string | null;
};

export type AdvisorAction =
  | GoalContributionAction
  | GoalSavedAction
  | BudgetUpsertAction
  | TransactionCreatedAction;

type AdvisorActionResolution = {
  handled: boolean;
  action?: AdvisorAction;
  message?: string;
};

const goalIntentKeywords = /(adicion|acrescent|coloc|som|deposit|aument|aportar|juntar|transfer)/;
const createGoalKeywords = /(criar|crie|nova|novo|defin|estabelec|montar|cadastrar|configurar)/;
const budgetKeywords = /(criar|defin|ajust|atualiz|limite|configur|salvar|registrar|set)/;
const transactionVerbKeywords = /(lanc|registr|adicion|inser|salv|cadastr|anot|inclu|paguei|gastei|recebi|ganhei|comprei)/;
const transactionContextKeywords = /(transac|despes|gasto|receit|pagament|compra|entrada|salario|pix|lancamento)/;

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\w\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(value);
}

function truncate(value: string, size: number): string {
  return normalizeSpaces(value).slice(0, size).trim();
}

function titleCase(value: string): string {
  return normalizeSpaces(value)
    .split(" ")
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

function parseBrlToken(raw: string): number | null {
  const cleaned = raw.replace(/[^\d,.\-]/g, "");
  if (!cleaned) {
    return null;
  }

  let normalized = cleaned;
  const commas = (normalized.match(/,/g) || []).length;
  const dots = (normalized.match(/\./g) || []).length;

  if (commas > 0) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (dots > 1) {
    normalized = normalized.replace(/\./g, "");
  }

  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

function extractAmountFromPatterns(message: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = message.match(pattern);
    const value = parseBrlToken(match?.[1] ?? "");
    if (value) {
      return value;
    }
  }
  return null;
}

function extractAmountTokens(message: string): Array<{ value: number; index: number; score: number }> {
  const tokens: Array<{ value: number; index: number; score: number }> = [];
  const regex = /(?:r\$\s*)?(\d{1,3}(?:[. ]\d{3})*(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s*(?:reais?|rs))?/gi;

  let match: RegExpExecArray | null = regex.exec(message);
  while (match) {
    const parsed = parseBrlToken(match[1]);
    const index = match.index ?? 0;

    if (parsed) {
      const prev = message[index - 1] ?? "";
      const next = message[index + match[0].length] ?? "";
      const hasCurrency = /r\$/i.test(match[0]) || /\b(reais?|rs)\b/i.test(match[0]);

      const looksLikeDateFragment = !hasCurrency && (prev === "/" || prev === "-" || next === "/" || next === "-");
      if (!looksLikeDateFragment) {
        const score = (hasCurrency ? 3 : 0) + (parsed >= 1900 && parsed <= 2200 ? -2 : 0);
        tokens.push({ value: parsed, index, score });
      }
    }

    match = regex.exec(message);
  }

  return tokens;
}

function extractPrimaryAmount(message: string): number | null {
  const tokens = extractAmountTokens(message).sort((a, b) => b.score - a.score || a.index - b.index);
  return tokens[0]?.value ?? null;
}

function parseDateParts(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return null;
  }

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function extractExplicitDate(message: string): string | null {
  const iso = message.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const value = parseDateParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (value) {
      return value;
    }
  }

  const br = message.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/);
  if (br) {
    const value = parseDateParts(Number(br[3]), Number(br[2]), Number(br[1]));
    if (value) {
      return value;
    }
  }

  return null;
}

function extractOccurredOn(message: string): string {
  const explicit = extractExplicitDate(message);
  if (explicit) {
    return explicit;
  }

  const normalized = normalizeText(message);
  const base = new Date();
  base.setHours(0, 0, 0, 0);

  if (normalized.includes("ontem")) {
    base.setDate(base.getDate() - 1);
  } else if (normalized.includes("amanha")) {
    base.setDate(base.getDate() + 1);
  }

  return toIsoDate(base);
}

function extractMonthRef(message: string, fallback: string): string {
  const iso = message.match(/\b(\d{4})-(\d{2})\b/);
  if (iso) {
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) {
      return `${iso[1]}-${iso[2]}`;
    }
  }

  const br = message.match(/\b(\d{1,2})[/-](\d{4})\b/);
  if (br) {
    const month = Number(br[1]);
    const year = Number(br[2]);
    if (month >= 1 && month <= 12 && year >= 1970) {
      return `${year}-${String(month).padStart(2, "0")}`;
    }
  }

  const normalized = normalizeText(message);
  if (normalized.includes("mes que vem") || normalized.includes("proximo mes")) {
    const next = new Date();
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  }

  if (normalized.includes("mes passado") || normalized.includes("ultimo mes")) {
    const previous = new Date();
    previous.setDate(1);
    previous.setMonth(previous.getMonth() - 1);
    return `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
  }

  return fallback;
}

function detectGoalContributionIntent(message: string): boolean {
  const text = normalizeText(message);
  if (!text.includes("meta")) {
    return false;
  }
  return goalIntentKeywords.test(text);
}

function detectGoalCreationIntent(message: string): boolean {
  const text = normalizeText(message);
  if (!text.includes("meta")) {
    return false;
  }
  if (detectGoalContributionIntent(message)) {
    return false;
  }
  return (
    createGoalKeywords.test(text) ||
    /quero\s+uma\s+meta/.test(text) ||
    /(alvo|objetivo|valor|juntar|guardar)/.test(text)
  );
}

function detectBudgetIntent(message: string): boolean {
  const text = normalizeText(message);
  return text.includes("orcament") && (budgetKeywords.test(text) || extractPrimaryAmount(message) !== null);
}

function detectTransactionIntent(message: string): boolean {
  const text = normalizeText(message);
  if (/(paguei|gastei|recebi|ganhei|comprei)/.test(text)) {
    return true;
  }
  return transactionVerbKeywords.test(text) && transactionContextKeywords.test(text);
}

const tokenStopWords = new Set([
  "meta",
  "minha",
  "meu",
  "na",
  "no",
  "de",
  "da",
  "do",
  "para",
  "com",
  "valor",
  "alvo",
  "reais",
  "real",
  "r",
  "rs",
  "orcamento",
  "novo",
  "nova"
]);

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length > 1 && !tokenStopWords.has(token));
}

function resolveGoalByName(message: string, goals: GoalSnapshot[]): GoalSnapshot | null {
  const normalizedMessage = normalizeText(message);
  const byContains = goals.find((goal) => normalizedMessage.includes(normalizeText(goal.name)));
  if (byContains) {
    return byContains;
  }

  const messageTokens = new Set(tokenize(normalizedMessage));
  let best: GoalSnapshot | null = null;
  let bestScore = 0;

  for (const goal of goals) {
    const goalTokens = tokenize(goal.name);
    if (!goalTokens.length) {
      continue;
    }

    const overlap = goalTokens.filter((token) => messageTokens.has(token)).length;
    if (!overlap) {
      continue;
    }

    const score = overlap / goalTokens.length;
    if (score > bestScore) {
      bestScore = score;
      best = goal;
    }
  }

  if (best && bestScore >= 0.5) {
    return best;
  }

  return null;
}

function extractGoalName(message: string): string | null {
  const quoted = message.match(/["“](.+?)["”]/);
  if (quoted?.[1]) {
    const value = truncate(quoted[1], 120);
    return value.length >= 2 ? value : null;
  }

  const patterns = [
    /meta\s+(?:de|para)?\s*(.+?)\s+(?:de|com|no valor de|valor de|alvo de)\s*(?:r\$\s*)?\d/i,
    /(?:crie|criar|defina|definir|nova|novo)\s+(?:uma\s+)?meta\s+(.+?)(?:\s+(?:de|com|no valor|alvo|ate|até|prazo|r\$)\b|$)/i
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const value = truncate(match[1].replace(/[.,;:!?]+$/g, ""), 120);
    if (value.length >= 2) {
      return value;
    }
  }

  return null;
}

function extractGoalTargetAmount(message: string): number | null {
  const patterns = [
    /meta.+?(?:de|no valor de|valor de|alvo de)\s*(?:r\$\s*)?(\d[\d.,\s]*)/i,
    /(?:juntar|guardar|atingir)\s*(?:r\$\s*)?(\d[\d.,\s]*)/i
  ];

  return extractAmountFromPatterns(message, patterns) ?? extractPrimaryAmount(message);
}

function extractGoalCurrentAmount(message: string, targetAmount: number): number {
  const direct = extractAmountFromPatterns(message, [
    /(?:ja tenho|tenho|inicial(?:mente)?|comecando com|partindo de|com)\s*(?:r\$\s*)?(\d[\d.,\s]*)/i
  ]);

  if (direct && Math.abs(direct - targetAmount) > 0.01) {
    return direct;
  }

  const values = extractAmountTokens(message)
    .map((token) => token.value)
    .filter((value) => Math.abs(value - targetAmount) > 0.01);

  const secondary = values.find((value) => value < 1_000_000);
  return secondary ?? 0;
}

function extractBudgetCategory(message: string): string | null {
  const patterns = [
    /orcament(?:o)?\s+(?:de|para)\s+(.+?)\s+(?:de|para|em|no valor de|limite(?:\s+de)?)\s*(?:r\$\s*)?\d/i,
    /categoria\s+(.+?)\s+(?:de|para|em|com)\s*(?:r\$\s*)?\d/i
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const value = truncate(match[1].replace(/[.,;:!?]+$/g, ""), 80).toLowerCase();
    if (value.length >= 2) {
      return value;
    }
  }

  const normalized = normalizeText(message);
  const knownCategories = [
    "alimentacao",
    "moradia",
    "transporte",
    "saude",
    "lazer",
    "educacao",
    "viagem",
    "mercado",
    "contas",
    "investimentos"
  ];

  return knownCategories.find((item) => normalized.includes(item)) ?? null;
}

function extractBudgetAmount(message: string): number | null {
  return (
    extractAmountFromPatterns(message, [
      /(?:limite|orcament(?:o)?(?:\s+mensal)?)(?:\s+de|\s+em|\s+para)?\s*(?:r\$\s*)?(\d[\d.,\s]*)/i
    ]) ?? extractPrimaryAmount(message)
  );
}

function extractTransactionType(message: string): TransactionType {
  const normalized = normalizeText(message);
  if (/(receita|recebi|entrada|ganhei|salario|pix recebido|reembolso)/.test(normalized)) {
    return "income";
  }
  if (/(transferenc|transferir|transferi)/.test(normalized)) {
    return "transfer";
  }
  return "expense";
}

function extractTransactionCategory(message: string, transactionType: TransactionType): string {
  const patterns = [
    /categoria\s+([a-zA-Z0-9\s_-]{2,80})(?:$|[.,;:!?])/i,
    /(?:despesa|gasto|receita|lancamento|transacao|pagamento|compra)\s+(?:de\s+)?(?:r\$\s*)?\d[\d.,\s]*\s+(?:em|na|no)\s+([a-zA-Z0-9\s_-]{2,80})/i
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (!match?.[1]) {
      continue;
    }

    const value = truncate(match[1], 80).toLowerCase();
    const normalized = normalizeText(value);
    if (/^conta\b|^corretora\b|^poupanca\b|^carteira\b/.test(normalized)) {
      continue;
    }

    if (value.length >= 2) {
      return value;
    }
  }

  const normalized = normalizeText(message);
  const knownCategories = [
    "alimentacao",
    "moradia",
    "transporte",
    "saude",
    "lazer",
    "educacao",
    "mercado",
    "assinaturas",
    "investimentos",
    "salario",
    "freelance",
    "impostos"
  ];

  const known = knownCategories.find((item) => normalized.includes(item));
  if (known) {
    return known;
  }

  if (transactionType === "income") {
    return "receitas";
  }
  if (transactionType === "transfer") {
    return "transferencias";
  }
  return "geral";
}

function extractTransactionDescription(message: string, transactionType: TransactionType, category: string): string {
  const quoted = message.match(/["“](.+?)["”]/);
  if (quoted?.[1]) {
    return truncate(quoted[1], 180);
  }

  const explicit = message.match(/(?:descricao|descrição)\s*[:\-]?\s*(.+)$/i);
  if (explicit?.[1]) {
    return truncate(explicit[1], 180);
  }

  const prefix = transactionType === "income" ? "Receita" : transactionType === "transfer" ? "Transferencia" : "Despesa";
  return truncate(`${prefix} - ${titleCase(category)}`, 180);
}

function resolveAccount(message: string, accounts: AccountSnapshot[]): AccountSnapshot | null {
  if (!accounts.length) {
    return null;
  }

  const normalized = normalizeText(message);
  const byName = accounts.find((account) => normalized.includes(normalizeText(account.name)));
  if (byName) {
    return byName;
  }

  if (/(conta corrente|corrente|banco)/.test(normalized)) {
    return accounts.find((account) => account.type === "checking") ?? null;
  }

  if (/poupanca/.test(normalized)) {
    return accounts.find((account) => account.type === "savings") ?? null;
  }

  if (/carteira/.test(normalized)) {
    return accounts.find((account) => account.type === "wallet") ?? null;
  }

  if (/corretora/.test(normalized)) {
    return accounts.find((account) => account.type === "brokerage") ?? null;
  }

  if (accounts.length === 1) {
    return accounts[0];
  }

  return accounts.find((account) => account.type === "checking") ?? null;
}

async function adjustAccountBalance(
  userId: string,
  accountId: string | null,
  transactionType: TransactionType,
  amount: number
): Promise<void> {
  if (!accountId) {
    return;
  }

  let delta = 0;
  if (transactionType === "income") {
    delta = amount;
  } else if (transactionType === "expense") {
    delta = -amount;
  }

  if (!delta) {
    return;
  }

  await pool.query(
    `UPDATE accounts
     SET balance = balance + $1
     WHERE id = $2
       AND user_id = $3`,
    [delta, accountId, userId]
  );
}

function createDisambiguationMessage(goals: GoalSnapshot[], amount: number): string {
  const goalList = goals.map((goal) => `- **${goal.name}**`).join("\n");

  return [
    "## Preciso de um detalhe para executar",
    `Entendi que voce quer adicionar **${formatCurrency(amount)}** em uma meta, mas existem varias metas ativas.`,
    "",
    "Me diga o nome da meta. Exemplo:",
    `> Adicione ${formatCurrency(amount)} na meta Reserva de emergencia`,
    "",
    "Metas ativas:",
    goalList
  ].join("\n");
}

function createMissingAmountMessage(example: string): string {
  return [
    "## Falta o valor da acao",
    "Consigo executar agora, mas preciso do valor em reais.",
    "",
    "Exemplo:",
    example
  ].join("\n");
}

function createNoGoalsMessage(): string {
  return [
    "## Nenhuma meta ativa encontrada",
    "Voce ainda nao tem metas ativas para atualizar.",
    "",
    "Posso criar uma agora se voce enviar algo como:",
    "> Crie a meta Reserva de emergencia com alvo de 30000"
  ].join("\n");
}

function createGoalContributionDoneMessage(action: GoalContributionAction): string {
  const remaining = Math.max(action.targetAmount - action.updatedAmount, 0);

  return [
    "## Acao executada",
    `Adicionei **${formatCurrency(action.amount)}** na meta **${action.goalName}**.`,
    "",
    "### Atualizacao da meta",
    `- Valor anterior: **${formatCurrency(action.previousAmount)}**`,
    `- Valor atual: **${formatCurrency(action.updatedAmount)}**`,
    `- Progresso: **${action.progressPercent.toFixed(1)}%**`,
    `- Falta para concluir: **${formatCurrency(remaining)}**`,
    "",
    "Salvei esta atualizacao em **Orcamentos e Metas**."
  ].join("\n");
}

function createGoalSavedMessage(action: GoalSavedAction): string {
  return [
    "## Meta salva com sucesso",
    action.mode === "created"
      ? `Criei a meta **${action.goalName}**.`
      : `Atualizei a meta **${action.goalName}**.`,
    "",
    "### Dados da meta",
    `- Alvo: **${formatCurrency(action.targetAmount)}**`,
    `- Valor atual: **${formatCurrency(action.currentAmount)}**`,
    `- Progresso: **${action.progressPercent.toFixed(1)}%**`,
    `- Status: **${action.status}**`,
    action.targetDate ? `- Data alvo: **${action.targetDate}**` : "- Data alvo: **nao definida**",
    "",
    "Salvei em **Orcamentos e Metas**."
  ].join("\n");
}

function createBudgetSavedMessage(action: BudgetUpsertAction): string {
  return [
    "## Orcamento salvo com sucesso",
    `Categoria: **${titleCase(action.category)}**`,
    `Limite mensal: **${formatCurrency(action.monthlyLimit)}**`,
    `Mes de referencia: **${action.monthRef}**`,
    "",
    "Salvei em **Orcamentos e Metas**."
  ].join("\n");
}

function createTransactionSavedMessage(action: TransactionCreatedAction): string {
  const typeLabel = action.transactionType === "income" ? "Receita" : action.transactionType === "expense" ? "Despesa" : "Transferencia";
  return [
    "## Transacao registrada com sucesso",
    `- Tipo: **${typeLabel}**`,
    `- Categoria: **${titleCase(action.category)}**`,
    `- Descricao: **${action.description}**`,
    `- Valor: **${formatCurrency(action.amount)}**`,
    `- Data: **${action.occurredOn}**`,
    action.accountName ? `- Conta: **${action.accountName}**` : "- Conta: **sem conta vinculada**",
    "",
    "Salvei em **Lancamentos e Extratos**."
  ].join("\n");
}

async function executeGoalContribution(params: {
  userId: string;
  message: string;
  goals: GoalSnapshot[];
}): Promise<AdvisorActionResolution> {
  const { message, goals, userId } = params;
  const activeGoals = goals.filter((goal) => goal.status !== "completed");

  if (!activeGoals.length) {
    return {
      handled: true,
      message: createNoGoalsMessage()
    };
  }

  const amount =
    extractAmountFromPatterns(message, [
      /(?:adicion(?:e|ar|ei)?|acrescent(?:e|ar|ei)?|coloc(?:a|ar|ei)?|aporte(?:i|r|e)?|deposit(?:e|ar|ei)?|junt(?:e|ar|ei)?|som(?:e|ar|ei)?|transfer(?:i|ir|e)?)(?:\s+de)?\s*(?:r\$\s*)?(\d[\d.,\s]*)/i
    ]) ?? extractPrimaryAmount(message);

  if (!amount) {
    return {
      handled: true,
      message: createMissingAmountMessage("> Adicione 200 reais na meta Reserva de emergencia")
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
           WHEN status = 'paused' THEN 'active'
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
    message: createGoalContributionDoneMessage(action)
  };
}

async function executeGoalSave(params: {
  userId: string;
  message: string;
  goals: GoalSnapshot[];
}): Promise<AdvisorActionResolution> {
  const { message, goals, userId } = params;
  const goalName = extractGoalName(message);

  if (!goalName) {
    return {
      handled: true,
      message: [
        "## Falta o nome da meta",
        "Consigo criar sua meta agora, mas preciso do nome.",
        "",
        "Exemplo:",
        "> Crie a meta Reserva de emergencia com alvo de 30000"
      ].join("\n")
    };
  }

  const targetAmount = extractGoalTargetAmount(message);
  if (!targetAmount) {
    return {
      handled: true,
      message: createMissingAmountMessage(`> Crie a meta ${goalName} com alvo de 30000`)
    };
  }

  const currentAmount = Math.max(0, extractGoalCurrentAmount(message, targetAmount));
  const targetDate = extractExplicitDate(message);
  const progressPercent = targetAmount > 0 ? (currentAmount / targetAmount) * 100 : 0;
  const status: GoalStatus = currentAmount >= targetAmount ? "completed" : "active";

  const existingGoal = goals.find((goal) => normalizeText(goal.name) === normalizeText(goalName));
  const goalId = existingGoal?.id ?? createId();
  const mode: GoalSavedAction["mode"] = existingGoal ? "updated" : "created";

  if (existingGoal) {
    await pool.query(
      `UPDATE goals
       SET name = $1,
           target_amount = $2,
           current_amount = $3,
           target_date = $4,
           status = $5
       WHERE id = $6
         AND user_id = $7`,
      [goalName, targetAmount, currentAmount, targetDate, status, existingGoal.id, userId]
    );
  } else {
    await pool.query(
      `INSERT INTO goals (id, user_id, name, target_amount, current_amount, target_date, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [goalId, userId, goalName, targetAmount, currentAmount, targetDate, status]
    );
  }

  const action: GoalSavedAction = {
    type: "goal_saved",
    mode,
    goalId,
    goalName,
    targetAmount,
    currentAmount,
    targetDate,
    status,
    progressPercent: Number(Math.min(progressPercent, 999).toFixed(1))
  };

  return {
    handled: true,
    action,
    message: createGoalSavedMessage(action)
  };
}

async function executeBudgetUpsert(params: {
  userId: string;
  message: string;
  defaultMonthRef: string;
}): Promise<AdvisorActionResolution> {
  const { userId, message, defaultMonthRef } = params;
  const category = extractBudgetCategory(message);

  if (!category) {
    return {
      handled: true,
      message: [
        "## Falta a categoria do orcamento",
        "Consigo salvar o orcamento agora, mas preciso da categoria.",
        "",
        "Exemplo:",
        "> Defina o orcamento de alimentacao para 1200"
      ].join("\n")
    };
  }

  const monthlyLimit = extractBudgetAmount(message);
  if (!monthlyLimit) {
    return {
      handled: true,
      message: createMissingAmountMessage(`> Defina o orcamento de ${category} para 1200`)
    };
  }

  const monthRef = extractMonthRef(message, defaultMonthRef);

  await pool.query(
    `INSERT INTO budgets (id, user_id, category, month_ref, monthly_limit)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, category, month_ref)
     DO UPDATE SET monthly_limit = EXCLUDED.monthly_limit`,
    [createId(), userId, truncate(category, 80), monthRef, monthlyLimit]
  );

  const action: BudgetUpsertAction = {
    type: "budget_upsert",
    category: truncate(category, 80),
    monthRef,
    monthlyLimit
  };

  return {
    handled: true,
    action,
    message: createBudgetSavedMessage(action)
  };
}

async function executeTransactionCreate(params: {
  userId: string;
  message: string;
  accounts: AccountSnapshot[];
}): Promise<AdvisorActionResolution> {
  const { message, userId, accounts } = params;
  const amount =
    extractAmountFromPatterns(message, [
      /(?:valor|de|por)\s*(?:r\$\s*)?(\d[\d.,\s]*)/i,
      /(?:r\$\s*)?(\d[\d.,\s]*)\s*(?:reais?)?/i
    ]) ?? extractPrimaryAmount(message);

  if (!amount) {
    return {
      handled: true,
      message: createMissingAmountMessage("> Lance uma despesa de 59,90 em alimentacao")
    };
  }

  const transactionType = extractTransactionType(message);
  const category = truncate(extractTransactionCategory(message, transactionType), 80);
  const description = truncate(extractTransactionDescription(message, transactionType, category), 180);
  const occurredOn = extractOccurredOn(message);
  const account = resolveAccount(message, accounts);
  const transactionId = createId();

  await pool.query(
    `INSERT INTO transactions (id, user_id, account_id, type, category, description, amount, occurred_on)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [transactionId, userId, account?.id ?? null, transactionType, category, description, amount, occurredOn]
  );

  await adjustAccountBalance(userId, account?.id ?? null, transactionType, amount);

  const action: TransactionCreatedAction = {
    type: "transaction_created",
    transactionId,
    transactionType,
    category,
    description,
    amount,
    occurredOn,
    accountId: account?.id ?? null,
    accountName: account?.name ?? null
  };

  return {
    handled: true,
    action,
    message: createTransactionSavedMessage(action)
  };
}

export async function tryExecuteAdvisorAction(params: {
  userId: string;
  message: string;
  goals: GoalSnapshot[];
  accounts: AccountSnapshot[];
  monthRef: string;
}): Promise<AdvisorActionResolution> {
  const { message, goals, userId, accounts, monthRef } = params;

  if (detectGoalContributionIntent(message)) {
    return executeGoalContribution({ userId, message, goals });
  }

  if (detectGoalCreationIntent(message)) {
    return executeGoalSave({ userId, message, goals });
  }

  if (detectBudgetIntent(message)) {
    return executeBudgetUpsert({ userId, message, defaultMonthRef: monthRef });
  }

  if (detectTransactionIntent(message)) {
    return executeTransactionCreate({ userId, message, accounts });
  }

  return { handled: false };
}
