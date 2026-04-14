import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

const APP_NAME = "econ-ai";

const envApiBase = String(import.meta.env.VITE_API_BASE_URL || "").trim();
const defaultApiBase = (envApiBase || (window.location.port === "5173"
  ? "http://localhost:4010/api"
  : `${window.location.origin}/api`)).replace(/\/$/, "");

type AuthTab = "login" | "register";
type AppPage = "dashboard" | "transactions" | "planning" | "investments" | "advisor";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type User = {
  id: string;
  fullName: string;
  email: string;
  monthlyIncome: number;
  riskProfile: string;
};

type Account = {
  id: string;
  name: string;
  type: string;
  currency: string;
  balance: number;
};

type TransactionItem = {
  id: string;
  accountId: string | null;
  accountName: string | null;
  type: "income" | "expense" | "transfer";
  category: string;
  description: string;
  amount: number;
  occurredOn: string;
};

type Budget = {
  id?: string;
  category: string;
  monthRef: string;
  monthlyLimit: number;
};

type Goal = {
  id: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  targetDate: string | null;
  status: "active" | "completed" | "paused";
  progressPercent: number;
};

type DashboardSummary = {
  monthRef: string;
  totals: {
    income: number;
    expense: number;
    savings: number;
    savingsRate: number;
  };
  patrimony: {
    totalCash: number;
    totalInvested: number;
    estimatedNetWorth: number;
  };
  categories: Array<{ category: string; total: number }>;
  budgets: Array<{
    category: string;
    spent: number;
    monthlyLimit: number;
    percentUsed: number;
    isOverLimit: boolean;
  }>;
  goals: Array<{
    id: string;
    name: string;
    status: string;
    targetAmount: number;
    currentAmount: number;
    progressPercent: number;
  }>;
};

type Position = {
  id: string;
  symbol: string;
  name: string | null;
  quantity: number;
  avgPrice: number;
  currency: string;
  costBasis: number;
  marketPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  quoteSource: string | null;
};

type WatchlistItem = {
  id: string;
  symbol: string;
  thesis: string | null;
  riskLevel: "baixo" | "moderado" | "alto";
};

type Opportunity = {
  symbol: string;
  signal: string;
  score: number;
  risk: string;
  reasons: string[];
  metrics: {
    price: number;
    sma20: number;
    sma50: number;
    momentum30d: number;
    volatilityAnnualized: number;
  };
  quote: {
    currency: string;
  };
};

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown | FormData;
  auth?: boolean;
};

function getMonthRef(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function formatCurrency(value: number, currency = "BRL"): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency
  }).format(Number(value || 0));
}

function formatPercent(value: number): string {
  return `${Number(value || 0).toFixed(1)}%`;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  if (/[",\n;]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function downloadCsvFile(filename: string, rows: string[][]): void {
  const content = rows.map((row) => row.map((cell) => csvCell(cell)).join(";")).join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function inlineMarkdown(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  return html;
}

function markdownToSafeHtml(markdown: string): string {
  const lines = String(markdown || "").split("\n");
  const output: string[] = [];
  let inUl = false;
  let inOl = false;

  const closeLists = () => {
    if (inUl) {
      output.push("</ul>");
      inUl = false;
    }

    if (inOl) {
      output.push("</ol>");
      inOl = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      closeLists();
      continue;
    }

    if (line.startsWith("### ")) {
      closeLists();
      output.push(`<h4 class="md-h3">${inlineMarkdown(line.slice(4))}</h4>`);
      continue;
    }

    if (line.startsWith("## ")) {
      closeLists();
      output.push(`<h3 class="md-h2">${inlineMarkdown(line.slice(3))}</h3>`);
      continue;
    }

    if (line.startsWith("> ")) {
      closeLists();
      output.push(`<blockquote class="md-quote">${inlineMarkdown(line.slice(2))}</blockquote>`);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      if (inOl) {
        output.push("</ol>");
        inOl = false;
      }

      if (!inUl) {
        output.push('<ul class="md-list">');
        inUl = true;
      }

      output.push(`<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      if (inUl) {
        output.push("</ul>");
        inUl = false;
      }

      if (!inOl) {
        output.push('<ol class="md-list">');
        inOl = true;
      }

      output.push(`<li>${inlineMarkdown(line.replace(/^\d+\.\s+/, ""))}</li>`);
      continue;
    }

    closeLists();
    output.push(`<p class="md-p">${inlineMarkdown(line)}</p>`);
  }

  closeLists();
  return output.join("");
}

function readPublicMessages(): ChatMessage[] {
  try {
    const raw = JSON.parse(localStorage.getItem("econai_public_messages") || "[]") as unknown;
    if (!Array.isArray(raw)) {
      return [];
    }

    const messages: ChatMessage[] = [];

    for (const entry of raw) {
      if (!entry || typeof entry !== "object") {
        continue;
      }

      const item = entry as Record<string, unknown>;
      const role = item.role;
      if (role !== "user" && role !== "assistant") {
        continue;
      }

      messages.push({
        role,
        content: String(item.content || "")
      });
    }

    return messages.slice(-30);
  } catch {
    return [];
  }
}

function MessageBubble({ item }: { item: ChatMessage }) {
  if (item.role === "user") {
    return (
      <div className="chat-item user">
        <p className="md-p">{item.content}</p>
      </div>
    );
  }

  return (
    <div
      className="chat-item assistant"
      dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(item.content) }}
    />
  );
}

function AuthForm({
  tab,
  onSwitch,
  onClose,
  onLogin,
  onRegister,
  errorMessage,
  loading
}: {
  tab: AuthTab;
  onSwitch: (tab: AuthTab) => void;
  onClose: () => void;
  onLogin: (formData: FormData) => Promise<void>;
  onRegister: (formData: FormData) => Promise<void>;
  errorMessage: string;
  loading: boolean;
}) {
  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    if (tab === "login") {
      await onLogin(formData);
      return;
    }

    await onRegister(formData);
  };

  return (
    <div className="auth-modal-backdrop" onMouseDown={onClose}>
      <div className="auth-modal card" onMouseDown={(event) => event.stopPropagation()}>
        <div className="auth-modal-top">
          <div className="tabs">
            <button type="button" className={`tab ${tab === "login" ? "active" : ""}`} onClick={() => onSwitch("login")}>Entrar</button>
            <button type="button" className={`tab ${tab === "register" ? "active" : ""}`} onClick={() => onSwitch("register")}>Criar conta</button>
          </div>
          <button type="button" className="btn secondary" onClick={onClose}>Fechar</button>
        </div>

        <form className="stack" onSubmit={handleSubmit}>
          {tab === "register" && (
            <label>
              Nome completo
              <input name="fullName" required disabled={loading} />
            </label>
          )}

          <label>
            Email
            <input name="email" type="email" required disabled={loading} />
          </label>

          <label>
            Senha
            <input name="password" type="password" minLength={8} required disabled={loading} />
          </label>

          {tab === "register" && (
            <>
              <label>
                Renda mensal (R$)
                <input name="monthlyIncome" type="number" min="0" step="0.01" defaultValue="0" disabled={loading} />
              </label>
              <label>
                Perfil de risco
                <select name="riskProfile" defaultValue="moderado" disabled={loading}>
                  <option value="conservador">Conservador</option>
                  <option value="moderado">Moderado</option>
                  <option value="arrojado">Arrojado</option>
                </select>
              </label>
            </>
          )}

          <button className="btn" type="submit" disabled={loading}>
            {loading ? "Processando..." : tab === "login" ? "Entrar" : "Criar conta"}
          </button>

          {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
          <p className="kbd">Seu login libera dashboard, metas, investimentos e acoes executaveis via IA.</p>
        </form>
      </div>
    </div>
  );
}

function PublicHome({
  messages,
  onSend,
  onOpenLogin,
  onOpenRegister,
  loading
}: {
  messages: ChatMessage[];
  onSend: (message: string) => Promise<void>;
  onOpenLogin: () => void;
  onOpenRegister: () => void;
  loading: boolean;
}) {
  const [message, setMessage] = useState("");
  const chatRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!chatRef.current) {
      return;
    }

    chatRef.current.scrollTo({
      top: chatRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [messages, loading]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || loading) {
      return;
    }

    setMessage("");
    await onSend(text);
  };

  return (
    <div className="shell public-app">
      <aside className={`sidebar sidebar-public ${menuOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-row">
            <img src="/econ-ai-logo.svg" alt="Logo econ-ai" className="sidebar-logo" />
            <h2>{APP_NAME}</h2>
          </div>
          <p>Modo visitante</p>
          <p>Chat livre com orientacoes financeiras por IA.</p>
        </div>

        <nav className="nav">
          <button type="button" className="active" disabled>Chat Publico</button>
        </nav>

        <div className="sidebar-public-cta">
          <p className="meta">Crie conta para liberar dashboard, metas, investimentos e acoes executaveis.</p>
          <button type="button" className="btn secondary" onClick={() => { setMenuOpen(false); onOpenLogin(); }}>Entrar</button>
          <button type="button" className="btn" onClick={() => { setMenuOpen(false); onOpenRegister(); }}>Criar conta</button>
        </div>

        <p className="leal-credit">Desenvolvido por <a href="https://lealsystems.com.br" target="_blank" rel="noopener noreferrer"><span>Leal Systems</span></a></p>
      </aside>
      <button
        type="button"
        className={`sidebar-backdrop ${menuOpen ? "open" : ""}`}
        onClick={() => setMenuOpen(false)}
        aria-label="Fechar menu"
      />

      <main className="main main-public">
        <header className="topbar card">
          <button
            type="button"
            className="menu-toggle"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label="Abrir menu"
          >
            Menu
          </button>
          <div>
            <h3>Chat publico econ-ai</h3>
            <p className="meta">Converse com o consultor virtual e receba analises educacionais.</p>
          </div>
        </header>

        <section className="main-content public-main">
          <section className="public-hero">
            <h2>Inteligência que transforma suas finanças</h2>
            <p className="meta">
              Converse com o consultor de IA mais avançado para planejamento financeiro pessoal. Analise gastos, defina metas e descubra oportunidades de mercado em linguagem natural.
            </p>
          </section>

          <section className="public-highlights">
            <article className="card highlight">
              <p className="highlight-kicker">Planejamento</p>
              <h3>Diagnóstico financeiro preciso</h3>
              <p className="meta">Entenda exatamente para onde seu dinheiro vai. Orçamentos inteligentes, metas com progresso real e insights personalizados.</p>
            </article>
            <article className="card highlight">
              <p className="highlight-kicker">Mercado</p>
              <h3>Radar quantitativo de ativos</h3>
              <p className="meta">Sinais, momentum e volatilidade processados por algoritmos. Encontre oportunidades antes do mercado perceber.</p>
            </article>
            <article className="card highlight">
              <p className="highlight-kicker">Execução via IA</p>
              <h3>Ações por linguagem natural</h3>
              <p className="meta">Diga "crie meta de viagem com R$8.000" e a IA executa. Sem formulários, sem fricção — só resultados.</p>
            </article>
          </section>

          <section className="card stack">
            <div className="chat public-chat-box" ref={chatRef}>
              {messages.length ? (
                messages.map((item, index) => <MessageBubble item={item} key={`${item.role}-${index}`} />)
              ) : (
                <div className="chat-item assistant">
                  <h3 className="md-h2">Olá! Sou o consultor econ-ai</h3>
                  <p className="md-p">Posso te ajudar com planejamento financeiro, estratégias de economia, análise de investimentos e muito mais. O que você quer resolver hoje?</p>
                </div>
              )}
            </div>

            <form className="stack" onSubmit={handleSubmit}>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Ex.: Como montar uma reserva de emergência? Quais ativos têm bom momentum agora? Como reduzir gastos fixos?"
                required
              />
              <button className="btn" type="submit" disabled={loading}>
                {loading ? "Analisando..." : "Enviar mensagem"}
              </button>
            </form>

            <p className="kbd">Dica: crie uma conta para desbloquear dashboard completo, carteira de investimentos e ações executadas pela IA.</p>
          </section>
        </section>
      </main>
    </div>
  );
}

function DashboardPage({
  summary,
  loading
}: {
  summary: DashboardSummary | null;
  loading: boolean;
}) {
  if (loading) {
    return <div className="card"><p className="empty">Carregando dashboard...</p></div>;
  }

  if (!summary) {
    return <div className="card"><p className="empty">Nao foi possivel carregar o dashboard.</p></div>;
  }

  const topCategory = summary.categories[0];
  const overBudgetCount = summary.budgets.filter((item) => item.isOverLimit).length;
  const completedGoals = summary.goals.filter((goal) => goal.status === "completed").length;
  const activeGoals = summary.goals.filter((goal) => goal.status === "active").length;

  return (
    <>
      <div className="grid-4">
        <article className="card"><p className="meta">Receita do mes</p><p className="metric">{formatCurrency(summary.totals.income)}</p></article>
        <article className="card"><p className="meta">Gastos do mes</p><p className="metric">{formatCurrency(summary.totals.expense)}</p></article>
        <article className="card"><p className="meta">Poupanca estimada</p><p className="metric">{formatCurrency(summary.totals.savings)}</p><span className="badge">Taxa: {formatPercent(summary.totals.savingsRate)}</span></article>
        <article className="card"><p className="meta">Patrimonio estimado</p><p className="metric">{formatCurrency(summary.patrimony.estimatedNetWorth)}</p><span className="badge">Caixa + carteira</span></article>
      </div>

      <div className="grid-3">
        <article className="card insight-card">
          <p className="meta">Maior categoria de gasto</p>
          <strong>{topCategory ? topCategory.category : "Sem dados"}</strong>
          <p className="meta">{topCategory ? formatCurrency(topCategory.total) : "Adicione transacoes para gerar insights"}</p>
        </article>
        <article className="card insight-card">
          <p className="meta">Orcamentos acima do limite</p>
          <strong>{overBudgetCount}</strong>
          <p className="meta">{summary.budgets.length ? `de ${summary.budgets.length} categorias monitoradas` : "Sem orcamentos cadastrados"}</p>
        </article>
        <article className="card insight-card">
          <p className="meta">Metas concluidas</p>
          <strong>{completedGoals}</strong>
          <p className="meta">{activeGoals ? `${activeGoals} metas ativas em andamento` : "Crie metas para acompanhar aportes"}</p>
        </article>
      </div>

      <div className="grid-2">
        <article className="card stack">
          <h4>Top categorias de gastos</h4>
          {summary.categories.length ? (
            summary.categories.map((item) => (
              <div key={item.category} className="row-split"><span>{item.category}</span><strong>{formatCurrency(item.total)}</strong></div>
            ))
          ) : <p className="empty">Sem transacoes no mes.</p>}
        </article>

        <article className="card stack">
          <h4>Uso de orcamento</h4>
          {summary.budgets.length ? (
            summary.budgets.map((item) => (
              <div key={item.category}>
                <div className="row-split"><span>{item.category}</span><strong>{formatCurrency(item.spent)} / {formatCurrency(item.monthlyLimit)}</strong></div>
                <p className="meta">{formatPercent(item.percentUsed)} {item.isOverLimit ? "(acima do limite)" : ""}</p>
                <div className={`progress-line ${item.isOverLimit ? "over" : ""}`}>
                  <span style={{ width: `${Math.min(item.percentUsed, 100)}%` }} />
                </div>
              </div>
            ))
          ) : <p className="empty">Nenhum orcamento cadastrado.</p>}
        </article>
      </div>

      <article className="card stack">
        <h4>Metas financeiras</h4>
        {summary.goals.length ? (
          summary.goals.map((goal) => (
            <div className="row-split" key={goal.id}>
              <div>
                <strong>{goal.name}</strong>
                <p className="meta">{formatCurrency(goal.currentAmount)} de {formatCurrency(goal.targetAmount)} ({formatPercent(goal.progressPercent)})</p>
                <div className="progress-line">
                  <span style={{ width: `${Math.min(goal.progressPercent, 100)}%` }} />
                </div>
              </div>
              <span className="badge">{goal.status}</span>
            </div>
          ))
        ) : <p className="empty">Nenhuma meta cadastrada.</p>}
      </article>
    </>
  );
}

function TransactionsPage({
  monthRef,
  request,
  onToast
}: {
  monthRef: string;
  request: <T>(path: string, options?: RequestOptions) => Promise<T>;
  onToast: (message: string, kind?: "success" | "error") => void;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | TransactionItem["type"]>("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [accountsData, txData] = await Promise.all([
        request<Account[]>("/finance/accounts"),
        request<TransactionItem[]>(`/finance/transactions?month=${monthRef}`)
      ]);
      setAccounts(accountsData);
      setTransactions(txData);
    } finally {
      setLoading(false);
    }
  }, [monthRef, request]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredTransactions = useMemo(() => {
    const query = search.trim().toLowerCase();
    return transactions.filter((item) => {
      const typeMatch = typeFilter === "all" || item.type === typeFilter;
      if (!typeMatch) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        item.description,
        item.category,
        item.accountName || "",
        item.occurredOn
      ].join(" ").toLowerCase().includes(query);
    });
  }, [search, transactions, typeFilter]);

  const submitTransaction = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    try {
      await request("/finance/transactions", {
        method: "POST",
        body: {
          type: form.get("type"),
          accountId: form.get("accountId") || undefined,
          category: form.get("category"),
          description: form.get("description"),
          amount: Number(form.get("amount")),
          occurredOn: form.get("occurredOn")
        }
      });
      onToast("Lancamento salvo", "success");
      event.currentTarget.reset();
      await loadData();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Falha ao salvar", "error");
    }
  };

  const submitCsv = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    try {
      await request("/finance/transactions/import-csv", {
        method: "POST",
        body: form
      });
      onToast("CSV importado", "success");
      event.currentTarget.reset();
      await loadData();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Falha ao importar", "error");
    }
  };

  const exportFilteredCsv = () => {
    if (!filteredTransactions.length) {
      onToast("Nenhuma transacao para exportar", "error");
      return;
    }

    downloadCsvFile(`econ-ai-transacoes-${monthRef}.csv`, [
      ["data", "descricao", "categoria", "conta", "tipo", "valor"],
      ...filteredTransactions.map((item) => [
        item.occurredOn,
        item.description,
        item.category,
        item.accountName || "",
        item.type,
        item.amount.toFixed(2)
      ])
    ]);
    onToast("CSV exportado", "success");
  };

  return (
    <>
      <div className="grid-2">
        <article className="card stack">
          <h4>Novo lancamento</h4>
          <form className="form-grid" onSubmit={submitTransaction}>
            <label>
              Tipo
              <select name="type" defaultValue="expense" required>
                <option value="income">Receita</option>
                <option value="expense">Despesa</option>
                <option value="transfer">Transferencia</option>
              </select>
            </label>
            <label>
              Conta
              <select name="accountId">
                <option value="">Sem conta</option>
                {accounts.map((account) => (
                  <option value={account.id} key={account.id}>{account.name} ({account.type})</option>
                ))}
              </select>
            </label>
            <label>
              Categoria
              <input name="category" required />
            </label>
            <label>
              Valor
              <input name="amount" type="number" step="0.01" min="0.01" required />
            </label>
            <label className="full">
              Descricao
              <input name="description" required />
            </label>
            <label>
              Data
              <input name="occurredOn" type="date" required />
            </label>
            <div className="actions-end"><button className="btn" type="submit">Salvar</button></div>
          </form>
        </article>

        <article className="card stack">
          <h4>Importar extrato CSV</h4>
          <p className="meta">Colunas: type, category, description, amount, occurredOn, accountId.</p>
          <form className="stack" onSubmit={submitCsv}>
            <input name="file" type="file" accept=".csv,text/csv" required />
            <button className="btn secondary" type="submit">Importar CSV</button>
          </form>

          <h4>Contas</h4>
          {accounts.length ? accounts.map((account) => (
            <div className="row-split" key={account.id}><span>{account.name} ({account.type})</span><strong>{formatCurrency(account.balance, account.currency)}</strong></div>
          )) : <p className="empty">Nenhuma conta cadastrada.</p>}
        </article>
      </div>

      <article className="card stack">
        <div className="row-split">
          <h4>Transacoes do mes</h4>
          <div className="inline-actions wrap">
            <input
              placeholder="Filtrar por descricao, categoria..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "all" | TransactionItem["type"])}>
              <option value="all">Todos os tipos</option>
              <option value="income">Receita</option>
              <option value="expense">Despesa</option>
              <option value="transfer">Transferencia</option>
            </select>
            <button type="button" className="btn secondary" onClick={exportFilteredCsv}>Exportar CSV</button>
          </div>
        </div>

        {loading ? <p className="empty">Carregando...</p> : filteredTransactions.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th><th>Descricao</th><th>Categoria</th><th>Conta</th><th>Tipo</th><th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {filteredTransactions.map((item) => (
                  <tr key={item.id}>
                    <td>{item.occurredOn}</td>
                    <td>{item.description}</td>
                    <td>{item.category}</td>
                    <td>{item.accountName || "-"}</td>
                    <td>{item.type}</td>
                    <td>{formatCurrency(item.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="empty">Nenhuma transacao encontrada com esse filtro.</p>}
      </article>
    </>
  );
}

function PlanningPage({
  monthRef,
  request,
  onToast
}: {
  monthRef: string;
  request: <T>(path: string, options?: RequestOptions) => Promise<T>;
  onToast: (message: string, kind?: "success" | "error") => void;
}) {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [budgetData, goalData] = await Promise.all([
        request<Budget[]>(`/finance/budgets?month=${monthRef}`),
        request<Goal[]>("/finance/goals")
      ]);
      setBudgets(budgetData);
      setGoals(goalData);
    } finally {
      setLoading(false);
    }
  }, [monthRef, request]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const submitBudget = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    try {
      await request("/finance/budgets", {
        method: "PUT",
        body: {
          category: form.get("category"),
          monthlyLimit: Number(form.get("monthlyLimit")),
          monthRef: form.get("monthRef")
        }
      });
      onToast("Orcamento salvo", "success");
      event.currentTarget.reset();
      await loadData();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Falha ao salvar", "error");
    }
  };

  const submitGoal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    try {
      await request("/finance/goals", {
        method: "POST",
        body: {
          name: form.get("name"),
          targetAmount: Number(form.get("targetAmount")),
          currentAmount: Number(form.get("currentAmount")),
          targetDate: form.get("targetDate") || undefined,
          status: form.get("status")
        }
      });
      onToast("Meta criada", "success");
      event.currentTarget.reset();
      await loadData();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Falha ao criar", "error");
    }
  };

  const updateGoal = async (goalId: string, currentAmount: number, status: Goal["status"]) => {
    try {
      await request(`/finance/goals/${goalId}`, {
        method: "PATCH",
        body: {
          currentAmount,
          status
        }
      });
      onToast("Meta atualizada", "success");
      await loadData();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Falha ao atualizar", "error");
    }
  };

  return (
    <>
      <div className="grid-2">
        <article className="card stack">
          <h4>Adicionar/Atualizar Orcamento</h4>
          <form className="form-grid" onSubmit={submitBudget}>
            <label>
              Categoria
              <input name="category" required />
            </label>
            <label>
              Limite mensal (R$)
              <input name="monthlyLimit" type="number" min="1" step="0.01" required />
            </label>
            <label>
              Mes
              <input name="monthRef" type="month" defaultValue={monthRef} required />
            </label>
            <div className="actions-end"><button className="btn" type="submit">Salvar</button></div>
          </form>

          <h4>Orcamentos do mes</h4>
          {budgets.length ? budgets.map((budget) => (
            <div className="row-split" key={`${budget.category}-${budget.monthRef}`}>
              <span>{budget.category}</span><strong>{formatCurrency(budget.monthlyLimit)}</strong>
            </div>
          )) : <p className="empty">Sem orcamentos.</p>}
        </article>

        <article className="card stack">
          <h4>Nova meta financeira</h4>
          <form className="form-grid" onSubmit={submitGoal}>
            <label className="full">
              Nome da meta
              <input name="name" required />
            </label>
            <label>
              Valor alvo (R$)
              <input name="targetAmount" type="number" min="1" step="0.01" required />
            </label>
            <label>
              Valor atual (R$)
              <input name="currentAmount" type="number" min="0" step="0.01" defaultValue="0" required />
            </label>
            <label>
              Data alvo
              <input name="targetDate" type="date" />
            </label>
            <label>
              Status
              <select name="status" defaultValue="active">
                <option value="active">Ativa</option>
                <option value="paused">Pausada</option>
                <option value="completed">Concluida</option>
              </select>
            </label>
            <div className="actions-end"><button className="btn" type="submit">Criar meta</button></div>
          </form>
        </article>
      </div>

      <article className="card stack">
        <h4>Metas cadastradas</h4>
        {loading ? <p className="empty">Carregando...</p> : goals.length ? goals.map((goal) => (
          <GoalRow key={goal.id} goal={goal} onUpdate={updateGoal} />
        )) : <p className="empty">Nenhuma meta cadastrada.</p>}
      </article>
    </>
  );
}

function GoalRow({
  goal,
  onUpdate
}: {
  goal: Goal;
  onUpdate: (goalId: string, currentAmount: number, status: Goal["status"]) => Promise<void>;
}) {
  const [currentAmount, setCurrentAmount] = useState(goal.currentAmount);
  const [status, setStatus] = useState<Goal["status"]>(goal.status);
  const [contribution, setContribution] = useState(0);

  const applyContribution = () => {
    if (contribution <= 0) {
      return;
    }

    const nextAmount = Number((currentAmount + contribution).toFixed(2));
    setCurrentAmount(nextAmount);
    setContribution(0);
    void onUpdate(goal.id, nextAmount, status);
  };

  return (
    <form
      className="form-grid soft"
      onSubmit={(event) => {
        event.preventDefault();
        void onUpdate(goal.id, currentAmount, status);
      }}
    >
      <label className="full">
        {goal.name}
        <span className="meta">{formatCurrency(goal.currentAmount)} de {formatCurrency(goal.targetAmount)} ({formatPercent(goal.progressPercent)})</span>
      </label>
      <label>
        Atualizar progresso (R$)
        <input
          type="number"
          min="0"
          step="0.01"
          value={currentAmount}
          onChange={(event) => setCurrentAmount(Number(event.target.value || 0))}
          required
        />
      </label>
      <label>
        Status
        <select value={status} onChange={(event) => setStatus(event.target.value as Goal["status"])}>
          <option value="active">Ativa</option>
          <option value="paused">Pausada</option>
          <option value="completed">Concluida</option>
        </select>
      </label>
      <label>
        Aporte rapido (R$)
        <div className="inline-actions">
          <input
            type="number"
            min="0"
            step="0.01"
            value={contribution}
            onChange={(event) => setContribution(Number(event.target.value || 0))}
          />
          <button type="button" className="btn secondary" onClick={applyContribution}>Somar</button>
        </div>
      </label>
      <div className="actions-end"><button className="btn secondary" type="submit">Atualizar</button></div>
    </form>
  );
}

function InvestmentsPage({
  request,
  onToast
}: {
  request: <T>(path: string, options?: RequestOptions) => Promise<T>;
  onToast: (message: string, kind?: "success" | "error") => void;
}) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [symbols, setSymbols] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingOpps, setLoadingOpps] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [positionData, watchData] = await Promise.all([
        request<Position[]>("/investments/positions"),
        request<WatchlistItem[]>("/investments/watchlist")
      ]);
      setPositions(positionData);
      setWatchlist(watchData);
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const portfolioSummary = useMemo(() => {
    return positions.reduce(
      (acc, item) => {
        acc.costBasis += Number(item.costBasis || 0);
        acc.marketValue += Number(item.marketValue || 0);
        acc.unrealizedPnl += Number(item.unrealizedPnl || 0);
        return acc;
      },
      { costBasis: 0, marketValue: 0, unrealizedPnl: 0 }
    );
  }, [positions]);

  const savePosition = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    try {
      await request("/investments/positions", {
        method: "PUT",
        body: {
          symbol: form.get("symbol"),
          name: form.get("name") || undefined,
          quantity: Number(form.get("quantity")),
          avgPrice: Number(form.get("avgPrice")),
          currency: "BRL"
        }
      });
      onToast("Posicao atualizada", "success");
      event.currentTarget.reset();
      await loadData();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Falha ao salvar posicao", "error");
    }
  };

  const saveWatchlist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    try {
      await request("/investments/watchlist", {
        method: "PUT",
        body: {
          symbol: form.get("symbol"),
          thesis: form.get("thesis") || undefined,
          riskLevel: form.get("riskLevel")
        }
      });
      onToast("Watchlist atualizada", "success");
      event.currentTarget.reset();
      await loadData();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Falha ao atualizar", "error");
    }
  };

  const removeWatchItem = async (symbolToRemove: string) => {
    try {
      await request(`/investments/watchlist/${symbolToRemove}`, { method: "DELETE" });
      onToast("Ativo removido", "success");
      await loadData();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Falha ao remover", "error");
    }
  };

  const analyzeOpportunities = async () => {
    setLoadingOpps(true);
    try {
      const query = symbols.trim() ? `?symbols=${encodeURIComponent(symbols.trim())}` : "";
      const data = await request<Opportunity[]>(`/investments/opportunities${query}`);
      setOpportunities(data);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "Falha ao analisar", "error");
      setOpportunities([]);
    } finally {
      setLoadingOpps(false);
    }
  };

  return (
    <>
      <div className="grid-3">
        <article className="card insight-card">
          <p className="meta">Custo total investido</p>
          <strong>{formatCurrency(portfolioSummary.costBasis)}</strong>
        </article>
        <article className="card insight-card">
          <p className="meta">Valor de mercado</p>
          <strong>{formatCurrency(portfolioSummary.marketValue)}</strong>
        </article>
        <article className="card insight-card">
          <p className="meta">P/L nao realizado</p>
          <strong className={portfolioSummary.unrealizedPnl >= 0 ? "success-text" : "error-text"}>
            {formatCurrency(portfolioSummary.unrealizedPnl)}
          </strong>
        </article>
      </div>

      <div className="grid-2">
        <article className="card stack">
          <h4>Adicionar posicao</h4>
          <form className="form-grid" onSubmit={savePosition}>
            <label>
              Ativo
              <input name="symbol" placeholder="PETR4" required />
            </label>
            <label>
              Nome
              <input name="name" placeholder="Petrobras PN" />
            </label>
            <label>
              Quantidade
              <input name="quantity" type="number" min="0.0001" step="0.0001" required />
            </label>
            <label>
              Preco medio
              <input name="avgPrice" type="number" min="0.0001" step="0.0001" required />
            </label>
            <div className="actions-end"><button className="btn" type="submit">Salvar</button></div>
          </form>
        </article>

        <article className="card stack">
          <h4>Watchlist</h4>
          <form className="form-grid" onSubmit={saveWatchlist}>
            <label>
              Ativo
              <input name="symbol" placeholder="VALE3" required />
            </label>
            <label>
              Risco
              <select name="riskLevel" defaultValue="moderado">
                <option value="baixo">Baixo</option>
                <option value="moderado">Moderado</option>
                <option value="alto">Alto</option>
              </select>
            </label>
            <label className="full">
              Tese
              <textarea name="thesis" placeholder="Motivo de observacao" />
            </label>
            <div className="actions-end"><button className="btn secondary" type="submit">Salvar</button></div>
          </form>

          {watchlist.length ? watchlist.map((item) => (
            <div className="watch-row" key={item.id}>
              <div>
                <strong>{item.symbol}</strong>
                <p className="meta">{item.riskLevel}{item.thesis ? ` | ${item.thesis}` : ""}</p>
              </div>
              <button type="button" className="btn danger" onClick={() => void removeWatchItem(item.symbol)}>Remover</button>
            </div>
          )) : <p className="empty">Nenhum ativo na watchlist.</p>}
        </article>
      </div>

      <article className="card stack">
        <h4>Posicoes da carteira</h4>
        {loading ? <p className="empty">Carregando...</p> : positions.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Ativo</th><th>Quantidade</th><th>Preco medio</th><th>Preco mercado</th><th>Valor mercado</th><th>P/L</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((item) => (
                  <tr key={item.id}>
                    <td>{item.symbol}</td>
                    <td>{item.quantity}</td>
                    <td>{formatCurrency(item.avgPrice, item.currency)}</td>
                    <td>{formatCurrency(item.marketPrice, item.currency)}</td>
                    <td>{formatCurrency(item.marketValue, item.currency)}</td>
                    <td className={item.unrealizedPnl >= 0 ? "success-text" : "error-text"}>{formatCurrency(item.unrealizedPnl, item.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="empty">Nenhuma posicao cadastrada.</p>}
      </article>

      <article className="card stack">
        <div className="row-split">
          <h4>Radar de oportunidades</h4>
          <div className="inline-actions">
            <input
              placeholder="PETR4,VALE3 (opcional)"
              value={symbols}
              onChange={(event) => setSymbols(event.target.value)}
            />
            <button type="button" className="btn" onClick={() => void analyzeOpportunities()} disabled={loadingOpps}>
              {loadingOpps ? "Analisando..." : "Analisar"}
            </button>
          </div>
        </div>

        {opportunities.length ? opportunities.map((item) => (
          <article className="opportunity-card" key={item.symbol}>
            <div className="row-split">
              <h4>{item.symbol} - score {item.score}/100</h4>
              <span className="badge">{item.signal} | risco {item.risk}</span>
            </div>
            <p className="meta">Preco: {formatCurrency(item.metrics.price, item.quote.currency)} | Momentum 30d: {formatPercent(item.metrics.momentum30d)} | Volatilidade: {formatPercent(item.metrics.volatilityAnnualized)}</p>
            <div className="meta" dangerouslySetInnerHTML={{ __html: item.reasons.map((reason) => `- ${escapeHtml(reason)}`).join("<br />") }} />
          </article>
        )) : <p className="empty">Sem analise carregada. Clique em "Analisar".</p>}

        <p className="meta">Analise quantitativa educacional. Nao constitui recomendacao individual.</p>
      </article>
    </>
  );
}

function AdvisorPage({
  request,
  onActionApplied,
  onToast
}: {
  request: <T>(path: string, options?: RequestOptions) => Promise<T>;
  onActionApplied: () => void;
  onToast: (message: string, kind?: "success" | "error") => void;
}) {
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const chatRef = useRef<HTMLDivElement | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request<Array<{ role: ChatRole; content: string }>>("/advisor/history?limit=25");
      setHistory(data.map((item) => ({ role: item.role, content: item.content })));
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (!chatRef.current) {
      return;
    }

    chatRef.current.scrollTo({
      top: chatRef.current.scrollHeight,
      behavior: "smooth"
    });
  }, [history, loading, sending]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = message.trim();
    if (!text || sending) {
      return;
    }

    const optimistic: ChatMessage = { role: "user", content: text };
    setHistory((prev) => [...prev, optimistic, { role: "assistant", content: "Analisando seu comando..." }]);
    setMessage("");
    setSending(true);

    try {
      const data = await request<{ message: string; action?: { type?: string } | null }>("/advisor/chat", {
        method: "POST",
        body: { message: text }
      });

      setHistory((prev) => {
        const next = [...prev];
        next[next.length - 1] = { role: "assistant", content: data.message };
        return next;
      });

      if (data.action?.type) {
        const actionLabels: Record<string, string> = {
          goal_contribution: "Meta atualizada pela IA",
          goal_saved: "Meta criada/atualizada pela IA",
          budget_upsert: "Orcamento salvo pela IA",
          transaction_created: "Transacao registrada pela IA"
        };

        onActionApplied();
        onToast(actionLabels[data.action.type] || "Acao executada pela IA", "success");
      }
    } catch (error) {
      setHistory((prev) => {
        const next = [...prev];
        next[next.length - 1] = {
          role: "assistant",
          content: error instanceof Error ? error.message : "Falha ao conversar com IA"
        };
        return next;
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <article className="card stack">
      <h4>Agente financeiro {APP_NAME}</h4>
      <p className="meta">Use comandos em linguagem natural para criar metas, salvar orcamentos e registrar transacoes.</p>

      <div className="chat" ref={chatRef}>
        {loading ? <p className="empty">Carregando historico...</p> : history.length ? (
          history.map((item, index) => <MessageBubble item={item} key={`${item.role}-${index}`} />)
        ) : <p className="empty">Sem mensagens ainda.</p>}
      </div>

      <form className="stack" onSubmit={handleSubmit}>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Ex.: Crie meta Viagem com alvo de 8000 | Defina orcamento de alimentacao para 1200 | Lance despesa de 59,90 em transporte"
          required
        />
        <button className="btn" type="submit" disabled={sending}>
          {sending ? "Enviando..." : "Enviar para IA"}
        </button>
      </form>

      <p className="meta">Aviso: conteudo educacional, sem promessa de retorno.</p>
    </article>
  );
}

export function App() {
  const [token, setToken] = useState(() => localStorage.getItem("econai_token") || "");
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<AppPage>("dashboard");
  const [monthRef, setMonthRef] = useState(getMonthRef());
  const [authTab, setAuthTab] = useState<AuthTab>("login");
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [publicMessages, setPublicMessages] = useState<ChatMessage[]>(readPublicMessages);
  const [publicSending, setPublicSending] = useState(false);
  const [refreshTick, setRefreshTick] = useState(0);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ message: string; kind: "success" | "error" } | null>(null);

  useEffect(() => {
    if (token) {
      localStorage.setItem("econai_token", token);
    } else {
      localStorage.removeItem("econai_token");
    }
  }, [token]);

  useEffect(() => {
    localStorage.setItem("econai_public_messages", JSON.stringify(publicMessages.slice(-30)));
  }, [publicMessages]);

  useEffect(() => {
    if (!toast) {
      return;
    }

    const timeout = window.setTimeout(() => setToast(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const showToast = useCallback((message: string, kind: "success" | "error" = "success") => {
    setToast({ message, kind });
  }, []);

  const forceLogoutToPublic = useCallback((message?: string) => {
    setToken("");
    setUser(null);
    setPage("dashboard");
    setAuthError(message || "Sua sessao expirou. Entre novamente.");
    setAuthTab("login");
    setAuthModalOpen(true);
    setSessionLoading(false);
  }, []);

  const request = useCallback(
    async <T,>(path: string, options: RequestOptions = {}): Promise<T> => {
      const { method = "GET", body, auth = true } = options;
      const headers: Record<string, string> = {};

      if (!(body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
      }

      if (auth && token) {
        headers.Authorization = `Bearer ${token}`;
      }

      const response = await fetch(`${defaultApiBase}${path}`, {
        method,
        headers,
        body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined
      });

      const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string };

      if (!response.ok) {
        if (response.status === 401 && auth) {
          forceLogoutToPublic("Sua sessao expirou. Entre novamente para continuar.");
        }

        throw new Error(payload.error || `Erro ${response.status}`);
      }

      return payload.data as T;
    },
    [forceLogoutToPublic, token]
  );

  const loadMe = useCallback(async () => {
    const data = await request<User>("/auth/me");
    setUser(data);
  }, [request]);

  useEffect(() => {
    const bootstrap = async () => {
      if (!token) {
        setSessionLoading(false);
        return;
      }

      try {
        await loadMe();
      } catch {
        // request already handles 401 and state reset
      } finally {
        setSessionLoading(false);
      }
    };

    void bootstrap();
  }, [loadMe, token]);

  const login = async (formData: FormData) => {
    setAuthLoading(true);
    setAuthError("");

    try {
      const data = await request<{ token: string; user: User }>("/auth/login", {
        method: "POST",
        body: {
          email: formData.get("email"),
          password: formData.get("password")
        },
        auth: false
      });

      setToken(data.token);
      setUser(data.user);
      setAuthModalOpen(false);
      setAuthError("");
      showToast("Login realizado", "success");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Falha no login");
    } finally {
      setAuthLoading(false);
    }
  };

  const register = async (formData: FormData) => {
    setAuthLoading(true);
    setAuthError("");

    try {
      const data = await request<{ token: string; user: User }>("/auth/register", {
        method: "POST",
        body: {
          fullName: formData.get("fullName"),
          email: formData.get("email"),
          password: formData.get("password"),
          monthlyIncome: Number(formData.get("monthlyIncome") || 0),
          riskProfile: formData.get("riskProfile")
        },
        auth: false
      });

      setToken(data.token);
      setUser(data.user);
      setAuthModalOpen(false);
      setAuthError("");
      showToast("Conta criada com sucesso", "success");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Falha no cadastro");
    } finally {
      setAuthLoading(false);
    }
  };

  const sendPublicMessage = async (message: string) => {
    const newMessages = [...publicMessages, { role: "user", content: message } as ChatMessage];
    setPublicMessages(newMessages);
    setPublicSending(true);

    try {
      const data = await request<{ message: string }>("/public/chat", {
        method: "POST",
        body: { message },
        auth: false
      });

      setPublicMessages((prev) => [...prev, { role: "assistant", content: data.message }]);
    } catch (error) {
      setPublicMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: error instanceof Error ? error.message : "Falha no chat publico"
        }
      ]);
    } finally {
      setPublicSending(false);
    }
  };

  const logout = () => {
    setToken("");
    setUser(null);
    setPage("dashboard");
    setAuthTab("login");
    setAuthModalOpen(false);
    showToast("Sessao encerrada", "success");
  };

  const pageTitle = useMemo(() => {
    const map: Record<AppPage, string> = {
      dashboard: "Dashboard Financeiro",
      transactions: "Lancamentos e Extratos",
      planning: "Orcamentos e Metas",
      investments: "Investimentos e Oportunidades",
      advisor: "Agente IA econ-ai"
    };
    return map[page];
  }, [page]);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  useEffect(() => {
    if (!user || page !== "dashboard") {
      return;
    }

    const loadSummary = async () => {
      setSummaryLoading(true);
      try {
        const data = await request<DashboardSummary>(`/dashboard/summary?month=${monthRef}`);
        setSummary(data);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Falha ao carregar dashboard", "error");
        setSummary(null);
      } finally {
        setSummaryLoading(false);
      }
    };

    void loadSummary();
  }, [monthRef, page, refreshTick, request, showToast, user]);

  if (sessionLoading) {
    return (
      <div className="public-shell">
        <div className="card" style={{textAlign:"center",padding:"32px 48px",display:"grid",gap:16,justifyItems:"center"}}>
          <div style={{width:44,height:44,borderRadius:14,background:"linear-gradient(135deg,#00e887,#38bfff)",boxShadow:"0 0 32px rgba(0,232,135,0.4)",animation:"pulse-glow 1.4s ease-in-out infinite"}} />
          <p className="meta" style={{letterSpacing:"0.12em",textTransform:"uppercase",fontSize:12}}>Inicializando econ-ai...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <PublicHome
          messages={publicMessages}
          loading={publicSending}
          onSend={sendPublicMessage}
          onOpenLogin={() => {
            setAuthTab("login");
            setAuthModalOpen(true);
            setAuthError("");
          }}
          onOpenRegister={() => {
            setAuthTab("register");
            setAuthModalOpen(true);
            setAuthError("");
          }}
        />

        {authModalOpen ? (
          <AuthForm
            tab={authTab}
            onSwitch={setAuthTab}
            onClose={() => setAuthModalOpen(false)}
            onLogin={login}
            onRegister={register}
            errorMessage={authError}
            loading={authLoading}
          />
        ) : null}

        {toast ? <div className={`toast ${toast.kind}`}>{toast.message}</div> : null}
      </>
    );
  }

  return (
    <>
      <div className="shell">
        <aside className={`sidebar ${mobileMenuOpen ? "open" : ""}`}>
          <div className="brand">
            <div className="brand-row">
              <img src="/econ-ai-logo.svg" alt="Logo econ-ai" className="sidebar-logo" />
              <h2>{APP_NAME}</h2>
            </div>
            <p>{user.fullName}</p>
            <p>{user.email}</p>
          </div>

          <nav className="nav">
            <button type="button" className={page === "dashboard" ? "active" : ""} onClick={() => { setPage("dashboard"); setMobileMenuOpen(false); }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline",marginRight:8,verticalAlign:"middle",opacity:0.8}}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              Dashboard
            </button>
            <button type="button" className={page === "transactions" ? "active" : ""} onClick={() => { setPage("transactions"); setMobileMenuOpen(false); }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline",marginRight:8,verticalAlign:"middle",opacity:0.8}}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              Transações
            </button>
            <button type="button" className={page === "planning" ? "active" : ""} onClick={() => { setPage("planning"); setMobileMenuOpen(false); }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline",marginRight:8,verticalAlign:"middle",opacity:0.8}}><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
              Orçamentos e Metas
            </button>
            <button type="button" className={page === "investments" ? "active" : ""} onClick={() => { setPage("investments"); setMobileMenuOpen(false); }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline",marginRight:8,verticalAlign:"middle",opacity:0.8}}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
              Investimentos
            </button>
            <button type="button" className={page === "advisor" ? "active" : ""} onClick={() => { setPage("advisor"); setMobileMenuOpen(false); }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline",marginRight:8,verticalAlign:"middle",opacity:0.8}}><path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z"/></svg>
              Agente IA
            </button>
          </nav>

          <button type="button" className="btn secondary sidebar-logout" onClick={() => { setMobileMenuOpen(false); logout(); }}>Sair</button>

          <p className="leal-credit">Desenvolvido por <a href="https://lealsystems.com.br" target="_blank" rel="noopener noreferrer"><span>Leal Systems</span></a></p>
        </aside>
        <button
          type="button"
          className={`sidebar-backdrop ${mobileMenuOpen ? "open" : ""}`}
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Fechar menu"
        />

        <main className="main">
          <header className="topbar">
            <button
              type="button"
              className="menu-toggle"
              onClick={() => setMobileMenuOpen((value) => !value)}
              aria-label="Abrir menu"
            >
              Menu
            </button>
            <div>
              <h3>{pageTitle}</h3>
              <p className="meta">Olá, {user.fullName.split(" ")[0]} · {user.riskProfile}</p>
            </div>
            <div className="inline-actions">
              <input type="month" value={monthRef} onChange={(event) => setMonthRef(event.target.value)} />
              <button type="button" className="btn secondary" onClick={() => setRefreshTick((value) => value + 1)}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{display:"inline",marginRight:6,verticalAlign:"middle"}}><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                Atualizar
              </button>
            </div>
          </header>

          <section className="main-content">
            {page === "dashboard" ? <DashboardPage summary={summary} loading={summaryLoading} /> : null}
            {page === "transactions" ? (
              <TransactionsPage monthRef={monthRef} request={request} onToast={showToast} />
            ) : null}
            {page === "planning" ? (
              <PlanningPage monthRef={monthRef} request={request} onToast={showToast} />
            ) : null}
            {page === "investments" ? (
              <InvestmentsPage request={request} onToast={showToast} />
            ) : null}
            {page === "advisor" ? (
              <AdvisorPage
                request={request}
                onActionApplied={() => setRefreshTick((value) => value + 1)}
                onToast={showToast}
              />
            ) : null}
          </section>
        </main>

        <nav className="mobile-tabbar">
          <button type="button" className={page === "dashboard" ? "active" : ""} onClick={() => setPage("dashboard")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",margin:"0 auto 2px"}}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            Inicio
          </button>
          <button type="button" className={page === "transactions" ? "active" : ""} onClick={() => setPage("transactions")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",margin:"0 auto 2px"}}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            Gastos
          </button>
          <button type="button" className={page === "planning" ? "active" : ""} onClick={() => setPage("planning")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",margin:"0 auto 2px"}}><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            Metas
          </button>
          <button type="button" className={page === "investments" ? "active" : ""} onClick={() => setPage("investments")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",margin:"0 auto 2px"}}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>
            Carteira
          </button>
          <button type="button" className={page === "advisor" ? "active" : ""} onClick={() => setPage("advisor")}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{display:"block",margin:"0 auto 2px"}}><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            IA
          </button>
        </nav>
      </div>

      {toast ? <div className={`toast ${toast.kind}`}>{toast.message}</div> : null}
    </>
  );
}
