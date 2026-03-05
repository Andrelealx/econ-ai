import OpenAI from "openai";
import { env } from "../config";

type AdvisorContext = {
  monthRef: string;
  income: number;
  expenses: number;
  savingsRate: number;
  topExpenseCategories: Array<{ category: string; total: number }>;
  budgetsOverLimit: Array<{ category: string; spent: number; limit: number }>;
  goals: Array<{ name: string; targetAmount: number; currentAmount: number; status: string }>;
  opportunities: Array<{ symbol: string; score: number; signal: string; risk: string }>;
};

const baseSystemPrompt = `
Voce e um consultor financeiro pessoal para pessoas fisicas no Brasil.
Objetivo: gerar orientacoes praticas para controle de gastos, reserva de emergencia, quitacao de dividas e estrategia de investimentos.

Regras:
- Nunca prometa retorno garantido.
- Sempre inclua aviso breve de risco.
- Prefira recomendacoes acionaveis em ate 30 dias.
- Se falar de acoes, use linguagem educacional e de cenarios, nao recomendacao categórica.
- Considere perfil moderado por padrao se o usuario nao informar.
`.trim();

let client: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!env.OPENAI_API_KEY) {
    return null;
  }
  if (!client) {
    client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  }
  return client;
}

function createFallbackAdvice(message: string, context: AdvisorContext): string {
  const projectedSavings = context.income - context.expenses;
  const overspending = context.budgetsOverLimit
    .slice(0, 3)
    .map((item) => `- ${item.category}: gasto ${item.spent.toFixed(2)} vs limite ${item.limit.toFixed(2)}`)
    .join("\n");

  const opportunities = context.opportunities
    .slice(0, 3)
    .map((item) => `- ${item.symbol}: score ${item.score}/100, sinal ${item.signal}, risco ${item.risk}`)
    .join("\n");

  return [
    `Pergunta recebida: ${message}`,
    "",
    `Resumo financeiro (${context.monthRef}): renda ${context.income.toFixed(2)}, gastos ${context.expenses.toFixed(2)}, poupanca estimada ${projectedSavings.toFixed(2)} (${context.savingsRate.toFixed(1)}%).`,
    "",
    "Plano pratico para os proximos 30 dias:",
    "1. Defina transferencia automatica para reserva no dia do recebimento (meta: 10% a 20% da renda).",
    "2. Corte 1 ou 2 categorias mais pressionadas e redirecione o valor para metas prioritarias.",
    "3. Se houver dividas caras, priorize amortizacao antes de aumentar risco na carteira.",
    "",
    overspending ? `Categorias acima do orcamento:\n${overspending}` : "Nenhuma categoria acima do orcamento neste mes.",
    "",
    opportunities
      ? `Radar de oportunidades (educacional, sem recomendacao direta):\n${opportunities}`
      : "Sem oportunidades com dados suficientes no momento.",
    "",
    "Aviso: isso nao e recomendacao de investimento individual. Use como apoio para decidir com responsabilidade."
  ].join("\n");
}

export async function generateAdvisorReply(message: string, context: AdvisorContext): Promise<string> {
  const openai = getOpenAIClient();
  if (!openai) {
    return createFallbackAdvice(message, context);
  }

  const prompt = `
Contexto do usuario:
${JSON.stringify(context, null, 2)}

Pergunta do usuario:
${message}

Responda em portugues do Brasil, objetivo e pratico.
`.trim();

  const response = await openai.responses.create({
    model: env.OPENAI_MODEL,
    input: [
      { role: "system", content: baseSystemPrompt },
      { role: "user", content: prompt }
    ]
  });

  if (response.output_text && response.output_text.trim().length > 0) {
    return response.output_text.trim();
  }

  return createFallbackAdvice(message, context);
}
