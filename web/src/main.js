import "./styles.css";

const APP_NAME = "econ-ai";

const defaultApiBase = window.location.port === "5173"
  ? "http://localhost:4010/api"
  : `${window.location.origin}/api`;

const state = {
  token: localStorage.getItem("econai_token") || "",
  apiBase: defaultApiBase,
  user: null,
  monthRef: getMonthRef(),
  page: "dashboard",
  authTab: "login"
};

const root = document.getElementById("app");

function getMonthRef() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function saveSession() {
  localStorage.setItem("econai_token", state.token);
}

function clearSession() {
  state.token = "";
  state.user = null;
  localStorage.removeItem("econai_token");
}

function formatCurrency(value, currency = "BRL") {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency
  }).format(Number(value || 0));
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function request(path, options = {}) {
  const {
    method = "GET",
    body,
    headers = {}
  } = options;

  const response = await fetch(`${state.apiBase}${path}`, {
    method,
    headers: {
      ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...headers
    },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Erro ${response.status}`);
  }

  return payload;
}

function showToast(message, kind = "info") {
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.position = "fixed";
  toast.style.right = "16px";
  toast.style.bottom = "16px";
  toast.style.zIndex = "50";
  toast.style.padding = "10px 12px";
  toast.style.borderRadius = "10px";
  toast.style.fontWeight = "700";
  toast.style.color = "#fff";
  toast.style.background = kind === "error" ? "rgba(239,68,68,0.88)" : "rgba(22,163,74,0.88)";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2400);
}

function renderAuth(errorMessage = "") {
  root.innerHTML = `
    <div class="auth-wrap">
      <div class="auth-card">
        <aside class="auth-highlight">
          <div>
            <h1>${APP_NAME}</h1>
            <p style="margin-top:8px; color: var(--muted);">
              Seu sistema financeiro com IA para executar acoes reais, planejar metas e encontrar oportunidades de mercado.
            </p>
            <ul>
              <li>Comando via chat: \"adicione R$ 200 na minha meta\"</li>
              <li>Resumo automatico de renda, gastos e poupanca</li>
              <li>Orcamentos por categoria com alertas</li>
              <li>Radar de oportunidades de mercado com score</li>
              <li>Chat de consultoria financeira com plano de acao</li>
            </ul>
          </div>
          <div class="stack">
            <button id="guest-login-btn" class="btn ghost" type="button">Testar agora sem cadastro</button>
            <p class="kbd">Modo experimental com dados simulados.</p>
          </div>
        </aside>

        <section class="stack">
          <div class="tabs">
            <button class="tab ${state.authTab === "login" ? "active" : ""}" data-tab="login">Entrar</button>
            <button class="tab ${state.authTab === "register" ? "active" : ""}" data-tab="register">Criar conta</button>
          </div>

          ${state.authTab === "login" ? renderLoginForm() : renderRegisterForm()}
          <p class="kbd">A conexao com API e automatica neste ambiente.</p>
          ${errorMessage ? `<p style="color:#fecaca; font-size:13px;">${escapeHtml(errorMessage)}</p>` : ""}
        </section>
      </div>
    </div>
  `;

  root.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.authTab = button.dataset.tab;
      renderAuth();
    });
  });

  const guestLoginButton = document.getElementById("guest-login-btn");
  guestLoginButton?.addEventListener("click", handleGuestSession);

  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", handleLogin);
  }

  const registerForm = document.getElementById("register-form");
  if (registerForm) {
    registerForm.addEventListener("submit", handleRegister);
  }
}

function renderLoginForm() {
  return `
    <form id="login-form" class="stack">
      <label>
        Email
        <input name="email" type="email" placeholder="voce@email.com" required />
      </label>
      <label>
        Senha
        <input name="password" type="password" required />
      </label>
      <button class="btn" type="submit">Entrar</button>
      <p class="kbd">Dica: se quiser apenas testar, use \"Testar agora sem cadastro\".</p>
    </form>
  `;
}

function renderRegisterForm() {
  return `
    <form id="register-form" class="stack">
      <label>
        Nome completo
        <input name="fullName" required />
      </label>
      <label>
        Email
        <input name="email" type="email" required />
      </label>
      <label>
        Senha
        <input name="password" type="password" minlength="8" required />
      </label>
      <label>
        Renda mensal (R$)
        <input name="monthlyIncome" type="number" min="0" step="0.01" value="0" />
      </label>
      <label>
        Perfil de risco
        <select name="riskProfile">
          <option value="conservador">Conservador</option>
          <option value="moderado" selected>Moderado</option>
          <option value="arrojado">Arrojado</option>
        </select>
      </label>
      <button class="btn" type="submit">Criar conta</button>
    </form>
  `;
}

async function handleLogin(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);

  try {
    const response = await request("/auth/login", {
      method: "POST",
      body: {
        email: form.get("email"),
        password: form.get("password")
      }
    });

    state.token = response.data.token;
    state.user = response.data.user;
    saveSession();
    await bootstrapApp();
  } catch (error) {
    renderAuth(error.message || "Falha no login");
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);

  try {
    const response = await request("/auth/register", {
      method: "POST",
      body: {
        fullName: form.get("fullName"),
        email: form.get("email"),
        password: form.get("password"),
        monthlyIncome: Number(form.get("monthlyIncome") || 0),
        riskProfile: form.get("riskProfile")
      }
    });

    state.token = response.data.token;
    state.user = response.data.user;
    saveSession();
    await bootstrapApp();
  } catch (error) {
    renderAuth(error.message || "Falha no cadastro");
  }
}

async function handleGuestSession() {
  try {
    const response = await request("/auth/guest-session", {
      method: "POST"
    });

    state.token = response.data.token;
    state.user = response.data.user;
    saveSession();
    await bootstrapApp();
  } catch (error) {
    renderAuth(error.message || "Falha ao iniciar modo experimental");
  }
}

async function loadMe() {
  const response = await request("/auth/me");
  state.user = response.data;
}

function renderShell() {
  root.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <h2>${APP_NAME}</h2>
          <p>${escapeHtml(state.user?.fullName || "Usuario")}</p>
          <p>${escapeHtml(state.user?.email || "")}</p>
          ${
            state.user?.email?.endsWith("@econ-ai.local")
              ? '<span class="badge" style="margin-top:8px;">Modo experimental</span>'
              : ""
          }
        </div>

        <nav class="nav" id="nav">
          <button data-page="dashboard" class="${state.page === "dashboard" ? "active" : ""}">Dashboard</button>
          <button data-page="transactions" class="${state.page === "transactions" ? "active" : ""}">Transacoes</button>
          <button data-page="planning" class="${state.page === "planning" ? "active" : ""}">Orcamentos e Metas</button>
          <button data-page="investments" class="${state.page === "investments" ? "active" : ""}">Investimentos</button>
          <button data-page="advisor" class="${state.page === "advisor" ? "active" : ""}">Agente IA</button>
        </nav>

        <button id="logout-btn" class="btn secondary">Sair</button>
      </aside>

      <main class="main">
        <header class="topbar">
          <div>
            <h3 id="page-title">${pageTitle(state.page)}</h3>
            <p class="meta">Mes de referencia</p>
          </div>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="month-ref" type="month" value="${escapeHtml(state.monthRef)}" />
            <button id="refresh-btn" class="btn secondary">Atualizar</button>
          </div>
        </header>

        <section id="main-content" class="main-content"></section>
      </main>
    </div>
  `;

  document.getElementById("nav").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-page]");
    if (!button) {
      return;
    }

    state.page = button.dataset.page;
    renderShell();
    await renderPage();
  });

  document.getElementById("month-ref").addEventListener("change", (event) => {
    state.monthRef = event.target.value;
  });

  document.getElementById("refresh-btn").addEventListener("click", async () => {
    await renderPage();
  });

  document.getElementById("logout-btn").addEventListener("click", () => {
    clearSession();
    renderAuth();
  });
}

function pageTitle(page) {
  const titles = {
    dashboard: "Dashboard Financeiro",
    transactions: "Lancamentos e Extratos",
    planning: "Orcamentos e Metas",
    investments: "Investimentos e Oportunidades",
    advisor: "Agente IA econ-ai"
  };

  return titles[page] || "Painel";
}

async function renderPage() {
  const content = document.getElementById("main-content");
  content.innerHTML = `<div class="card"><p class="empty">Carregando...</p></div>`;

  try {
    if (state.page === "dashboard") {
      await renderDashboard();
      return;
    }

    if (state.page === "transactions") {
      await renderTransactions();
      return;
    }

    if (state.page === "planning") {
      await renderPlanning();
      return;
    }

    if (state.page === "investments") {
      await renderInvestments();
      return;
    }

    if (state.page === "advisor") {
      await renderAdvisor();
      return;
    }

    content.innerHTML = `<div class="card"><p class="empty">Pagina desconhecida.</p></div>`;
  } catch (error) {
    content.innerHTML = `<div class="card"><p class="empty">${escapeHtml(error.message || "Falha ao carregar pagina")}</p></div>`;
  }
}

async function renderDashboard() {
  const content = document.getElementById("main-content");
  const response = await request(`/dashboard/summary?month=${state.monthRef}`);
  const data = response.data;

  content.innerHTML = `
    <div class="grid-4">
      <article class="card">
        <p class="meta">Receita do mes</p>
        <p class="metric">${formatCurrency(data.totals.income)}</p>
      </article>
      <article class="card">
        <p class="meta">Gastos do mes</p>
        <p class="metric">${formatCurrency(data.totals.expense)}</p>
      </article>
      <article class="card">
        <p class="meta">Poupanca estimada</p>
        <p class="metric">${formatCurrency(data.totals.savings)}</p>
        <span class="badge">Taxa: ${formatPercent(data.totals.savingsRate)}</span>
      </article>
      <article class="card">
        <p class="meta">Patrimonio estimado</p>
        <p class="metric">${formatCurrency(data.patrimony.estimatedNetWorth)}</p>
        <span class="badge">Caixa + carteira</span>
      </article>
    </div>

    <div class="grid-2">
      <article class="card stack">
        <h4>Top categorias de gastos</h4>
        ${
          data.categories.length
            ? data.categories
                .map(
                  (item) => `
                    <div style="display:flex; justify-content:space-between; gap:8px;">
                      <span>${escapeHtml(item.category)}</span>
                      <strong>${formatCurrency(item.total)}</strong>
                    </div>
                  `
                )
                .join("")
            : '<p class="empty">Sem transacoes no mes selecionado.</p>'
        }
      </article>

      <article class="card stack">
        <h4>Uso de orcamento</h4>
        ${
          data.budgets.length
            ? data.budgets
                .map(
                  (item) => `
                    <div>
                      <div style="display:flex; justify-content:space-between; gap:8px;">
                        <span>${escapeHtml(item.category)}</span>
                        <strong>${formatCurrency(item.spent)} / ${formatCurrency(item.monthlyLimit)}</strong>
                      </div>
                      <p class="meta">${formatPercent(item.percentUsed)} ${
                        item.isOverLimit ? '<span style="color:#fecaca">(acima do limite)</span>' : ""
                      }</p>
                    </div>
                  `
                )
                .join("")
            : '<p class="empty">Nenhum orcamento cadastrado.</p>'
        }
      </article>
    </div>

    <article class="card stack">
      <h4>Metas financeiras</h4>
      ${
        data.goals.length
          ? data.goals
              .map(
                (goal) => `
                  <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
                    <div>
                      <strong>${escapeHtml(goal.name)}</strong>
                      <p class="meta">${formatCurrency(goal.currentAmount)} de ${formatCurrency(goal.targetAmount)} (${formatPercent(goal.progressPercent)})</p>
                    </div>
                    <span class="badge">${escapeHtml(goal.status)}</span>
                  </div>
                `
              )
              .join("")
          : '<p class="empty">Nenhuma meta cadastrada.</p>'
      }
    </article>
  `;
}

async function renderTransactions() {
  const content = document.getElementById("main-content");
  const [accountsResponse, transactionsResponse] = await Promise.all([
    request("/finance/accounts"),
    request(`/finance/transactions?month=${state.monthRef}`)
  ]);

  const accounts = accountsResponse.data;
  const transactions = transactionsResponse.data;

  content.innerHTML = `
    <div class="grid-2">
      <article class="card stack">
        <h4>Novo lancamento</h4>
        <form id="transaction-form" class="form-grid">
          <label>
            Tipo
            <select name="type" required>
              <option value="income">Receita</option>
              <option value="expense" selected>Despesa</option>
              <option value="transfer">Transferencia</option>
            </select>
          </label>
          <label>
            Conta
            <select name="accountId">
              <option value="">Sem conta</option>
              ${accounts
                .map((account) => `<option value="${account.id}">${escapeHtml(account.name)} (${escapeHtml(account.type)})</option>`)
                .join("")}
            </select>
          </label>
          <label>
            Categoria
            <input name="category" placeholder="alimentacao" required />
          </label>
          <label>
            Valor
            <input name="amount" type="number" step="0.01" min="0.01" required />
          </label>
          <label class="full">
            Descricao
            <input name="description" required />
          </label>
          <label>
            Data
            <input name="occurredOn" type="date" required />
          </label>
          <div style="display:flex; align-items:end;">
            <button class="btn" type="submit">Salvar</button>
          </div>
        </form>
      </article>

      <article class="card stack">
        <h4>Importar extrato CSV</h4>
        <p class="meta">Colunas aceitas: type, category, description, amount, occurredOn, accountId</p>
        <form id="csv-form" class="stack">
          <input name="file" type="file" accept=".csv,text/csv" required />
          <button class="btn secondary" type="submit">Importar CSV</button>
        </form>

        <h4 style="margin-top:8px;">Contas</h4>
        ${
          accounts.length
            ? accounts
                .map(
                  (account) => `
                    <div style="display:flex; justify-content:space-between; gap:8px;">
                      <span>${escapeHtml(account.name)} (${escapeHtml(account.type)})</span>
                      <strong>${formatCurrency(account.balance, account.currency)}</strong>
                    </div>
                  `
                )
                .join("")
            : '<p class="empty">Nenhuma conta cadastrada.</p>'
        }
      </article>
    </div>

    <article class="card stack">
      <h4>Transacoes do mes</h4>
      ${
        transactions.length
          ? `
            <div style="overflow:auto;">
              <table class="table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Descricao</th>
                    <th>Categoria</th>
                    <th>Conta</th>
                    <th>Tipo</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  ${transactions
                    .map(
                      (item) => `
                        <tr>
                          <td>${escapeHtml(item.occurredOn)}</td>
                          <td>${escapeHtml(item.description)}</td>
                          <td>${escapeHtml(item.category)}</td>
                          <td>${escapeHtml(item.accountName || "-")}</td>
                          <td>${escapeHtml(item.type)}</td>
                          <td>${formatCurrency(item.amount)}</td>
                        </tr>
                      `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `
          : '<p class="empty">Sem lancamentos no mes selecionado.</p>'
      }
    </article>
  `;

  document.getElementById("transaction-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    try {
      await request("/finance/transactions", {
        method: "POST",
        body: {
          type: formData.get("type"),
          accountId: formData.get("accountId") || undefined,
          category: formData.get("category"),
          description: formData.get("description"),
          amount: Number(formData.get("amount")),
          occurredOn: formData.get("occurredOn")
        }
      });

      showToast("Lancamento salvo com sucesso");
      await renderTransactions();
    } catch (error) {
      showToast(error.message || "Falha ao salvar", "error");
    }
  });

  document.getElementById("csv-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    try {
      await request("/finance/transactions/import-csv", {
        method: "POST",
        body: formData
      });

      showToast("Importacao concluida");
      await renderTransactions();
    } catch (error) {
      showToast(error.message || "Falha na importacao", "error");
    }
  });
}

async function renderPlanning() {
  const content = document.getElementById("main-content");
  const [budgetsResponse, goalsResponse] = await Promise.all([
    request(`/finance/budgets?month=${state.monthRef}`),
    request("/finance/goals")
  ]);

  const budgets = budgetsResponse.data;
  const goals = goalsResponse.data;

  content.innerHTML = `
    <div class="grid-2">
      <article class="card stack">
        <h4>Adicionar/Atualizar Orcamento</h4>
        <form id="budget-form" class="form-grid">
          <label>
            Categoria
            <input name="category" placeholder="alimentacao" required />
          </label>
          <label>
            Limite mensal (R$)
            <input name="monthlyLimit" type="number" min="1" step="0.01" required />
          </label>
          <label>
            Mes
            <input name="monthRef" type="month" value="${escapeHtml(state.monthRef)}" required />
          </label>
          <div style="display:flex; align-items:end;">
            <button class="btn" type="submit">Salvar orcamento</button>
          </div>
        </form>

        <h4 style="margin-top:8px;">Orcamentos do mes</h4>
        ${
          budgets.length
            ? budgets
                .map(
                  (item) => `
                    <div style="display:flex; justify-content:space-between; gap:8px;">
                      <span>${escapeHtml(item.category)}</span>
                      <strong>${formatCurrency(item.monthlyLimit)}</strong>
                    </div>
                  `
                )
                .join("")
            : '<p class="empty">Sem orcamentos para este mes.</p>'
        }
      </article>

      <article class="card stack">
        <h4>Nova meta financeira</h4>
        <form id="goal-form" class="form-grid">
          <label class="full">
            Nome da meta
            <input name="name" placeholder="Reserva de emergencia" required />
          </label>
          <label>
            Valor alvo (R$)
            <input name="targetAmount" type="number" min="1" step="0.01" required />
          </label>
          <label>
            Valor atual (R$)
            <input name="currentAmount" type="number" min="0" step="0.01" value="0" required />
          </label>
          <label>
            Data alvo
            <input name="targetDate" type="date" />
          </label>
          <label>
            Status
            <select name="status">
              <option value="active">Ativa</option>
              <option value="paused">Pausada</option>
              <option value="completed">Concluida</option>
            </select>
          </label>
          <div style="display:flex; align-items:end;">
            <button class="btn" type="submit">Criar meta</button>
          </div>
        </form>
      </article>
    </div>

    <article class="card stack">
      <h4>Metas cadastradas</h4>
      ${
        goals.length
          ? goals
              .map(
                (goal) => `
                  <form data-goal-id="${goal.id}" class="form-grid" style="padding:10px; border:1px solid rgba(255,255,255,0.12); border-radius: 12px;">
                    <label class="full">
                      ${escapeHtml(goal.name)}
                      <span class="meta">${formatCurrency(goal.currentAmount)} de ${formatCurrency(goal.targetAmount)} (${formatPercent(goal.progressPercent)})</span>
                    </label>
                    <label>
                      Atualizar progresso (R$)
                      <input name="currentAmount" type="number" min="0" step="0.01" value="${goal.currentAmount}" required />
                    </label>
                    <label>
                      Status
                      <select name="status">
                        <option value="active" ${goal.status === "active" ? "selected" : ""}>Ativa</option>
                        <option value="paused" ${goal.status === "paused" ? "selected" : ""}>Pausada</option>
                        <option value="completed" ${goal.status === "completed" ? "selected" : ""}>Concluida</option>
                      </select>
                    </label>
                    <div style="display:flex; align-items:end;">
                      <button class="btn secondary" type="submit">Atualizar</button>
                    </div>
                  </form>
                `
              )
              .join("")
          : '<p class="empty">Nenhuma meta cadastrada.</p>'
      }
    </article>
  `;

  document.getElementById("budget-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    try {
      await request("/finance/budgets", {
        method: "PUT",
        body: {
          category: formData.get("category"),
          monthlyLimit: Number(formData.get("monthlyLimit")),
          monthRef: formData.get("monthRef")
        }
      });
      showToast("Orcamento salvo");
      await renderPlanning();
    } catch (error) {
      showToast(error.message || "Falha ao salvar", "error");
    }
  });

  document.getElementById("goal-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    try {
      await request("/finance/goals", {
        method: "POST",
        body: {
          name: formData.get("name"),
          targetAmount: Number(formData.get("targetAmount")),
          currentAmount: Number(formData.get("currentAmount")),
          targetDate: formData.get("targetDate") || undefined,
          status: formData.get("status")
        }
      });
      showToast("Meta criada");
      await renderPlanning();
    } catch (error) {
      showToast(error.message || "Falha ao criar meta", "error");
    }
  });

  content.querySelectorAll("[data-goal-id]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(event.currentTarget);
      const goalId = form.dataset.goalId;

      try {
        await request(`/finance/goals/${goalId}`, {
          method: "PATCH",
          body: {
            currentAmount: Number(formData.get("currentAmount")),
            status: formData.get("status")
          }
        });

        showToast("Meta atualizada");
        await renderPlanning();
      } catch (error) {
        showToast(error.message || "Falha ao atualizar meta", "error");
      }
    });
  });
}

async function renderInvestments() {
  const content = document.getElementById("main-content");
  const [positionsResponse, watchlistResponse] = await Promise.all([
    request("/investments/positions"),
    request("/investments/watchlist")
  ]);

  const positions = positionsResponse.data;
  const watchlist = watchlistResponse.data;

  content.innerHTML = `
    <div class="grid-2">
      <article class="card stack">
        <h4>Adicionar posicao</h4>
        <form id="position-form" class="form-grid">
          <label>
            Ativo (ticker)
            <input name="symbol" placeholder="PETR4" required />
          </label>
          <label>
            Nome
            <input name="name" placeholder="Petrobras PN" />
          </label>
          <label>
            Quantidade
            <input name="quantity" type="number" step="0.0001" min="0.0001" required />
          </label>
          <label>
            Preco medio
            <input name="avgPrice" type="number" step="0.0001" min="0.0001" required />
          </label>
          <div style="display:flex; align-items:end;">
            <button class="btn" type="submit">Salvar posicao</button>
          </div>
        </form>
      </article>

      <article class="card stack">
        <h4>Watchlist</h4>
        <form id="watchlist-form" class="form-grid">
          <label>
            Ativo
            <input name="symbol" placeholder="VALE3" required />
          </label>
          <label>
            Nivel de risco
            <select name="riskLevel">
              <option value="baixo">Baixo</option>
              <option value="moderado" selected>Moderado</option>
              <option value="alto">Alto</option>
            </select>
          </label>
          <label class="full">
            Tese
            <textarea name="thesis" placeholder="Porque esse ativo esta no radar"></textarea>
          </label>
          <div style="display:flex; align-items:end;">
            <button class="btn secondary" type="submit">Salvar watchlist</button>
          </div>
        </form>

        ${
          watchlist.length
            ? watchlist
                .map(
                  (item) => `
                    <div style="display:flex; justify-content:space-between; gap:8px; align-items:center; border-top:1px solid rgba(255,255,255,0.12); padding-top:8px;">
                      <div>
                        <strong>${escapeHtml(item.symbol)}</strong>
                        <p class="meta">${escapeHtml(item.riskLevel)}${item.thesis ? ` | ${escapeHtml(item.thesis)}` : ""}</p>
                      </div>
                      <button class="btn danger" data-remove-symbol="${escapeHtml(item.symbol)}">Remover</button>
                    </div>
                  `
                )
                .join("")
            : '<p class="empty">Nenhum ativo na watchlist.</p>'
        }
      </article>
    </div>

    <article class="card stack">
      <h4>Posicoes da carteira</h4>
      ${
        positions.length
          ? `
            <div style="overflow:auto;">
              <table class="table">
                <thead>
                  <tr>
                    <th>Ativo</th>
                    <th>Quantidade</th>
                    <th>Preco medio</th>
                    <th>Preco mercado</th>
                    <th>Valor mercado</th>
                    <th>P/L</th>
                  </tr>
                </thead>
                <tbody>
                  ${positions
                    .map(
                      (item) => `
                        <tr>
                          <td>${escapeHtml(item.symbol)}</td>
                          <td>${item.quantity}</td>
                          <td>${formatCurrency(item.avgPrice, item.currency)}</td>
                          <td>${formatCurrency(item.marketPrice, item.currency)}</td>
                          <td>${formatCurrency(item.marketValue, item.currency)}</td>
                          <td style="color:${item.unrealizedPnl >= 0 ? "#86efac" : "#fecaca"}">${formatCurrency(item.unrealizedPnl, item.currency)}</td>
                        </tr>
                      `
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `
          : '<p class="empty">Nenhuma posicao cadastrada.</p>'
      }
    </article>

    <article class="card stack">
      <div style="display:flex; gap:8px; align-items:center; justify-content:space-between;">
        <h4>Radar de oportunidades</h4>
        <div style="display:flex; gap:8px;">
          <input id="opportunity-symbols" placeholder="PETR4,VALE3 (opcional)" />
          <button id="load-opportunities" class="btn">Analisar mercado</button>
        </div>
      </div>
      <div id="opportunities-content" class="stack">
        <p class="empty">Clique em "Analisar mercado" para gerar o ranking de oportunidades.</p>
      </div>
      <p class="meta">Analise educacional, nao e recomendacao individual de investimento.</p>
    </article>
  `;

  document.getElementById("position-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    try {
      await request("/investments/positions", {
        method: "PUT",
        body: {
          symbol: formData.get("symbol"),
          name: formData.get("name") || undefined,
          quantity: Number(formData.get("quantity")),
          avgPrice: Number(formData.get("avgPrice")),
          currency: "BRL"
        }
      });
      showToast("Posicao atualizada");
      await renderInvestments();
    } catch (error) {
      showToast(error.message || "Falha ao salvar posicao", "error");
    }
  });

  document.getElementById("watchlist-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    try {
      await request("/investments/watchlist", {
        method: "PUT",
        body: {
          symbol: formData.get("symbol"),
          thesis: formData.get("thesis") || undefined,
          riskLevel: formData.get("riskLevel")
        }
      });
      showToast("Watchlist atualizada");
      await renderInvestments();
    } catch (error) {
      showToast(error.message || "Falha ao atualizar watchlist", "error");
    }
  });

  content.querySelectorAll("[data-remove-symbol]").forEach((button) => {
    button.addEventListener("click", async () => {
      const symbol = button.dataset.removeSymbol;
      try {
        await request(`/investments/watchlist/${symbol}`, { method: "DELETE" });
        showToast("Ativo removido");
        await renderInvestments();
      } catch (error) {
        showToast(error.message || "Falha ao remover", "error");
      }
    });
  });

  document.getElementById("load-opportunities").addEventListener("click", async () => {
    const container = document.getElementById("opportunities-content");
    container.innerHTML = `<p class="empty">Analisando mercado...</p>`;

    const symbolsInput = document.getElementById("opportunity-symbols").value.trim();
    const query = symbolsInput ? `?symbols=${encodeURIComponent(symbolsInput)}` : "";

    try {
      const response = await request(`/investments/opportunities${query}`);
      const opportunities = response.data;

      if (!opportunities.length) {
        container.innerHTML = `<p class="empty">Sem dados suficientes para os ativos informados.</p>`;
        return;
      }

      container.innerHTML = opportunities
        .map(
          (item) => `
            <article style="border:1px solid rgba(255,255,255,0.12); border-radius:12px; padding:12px;">
              <div style="display:flex; justify-content:space-between; gap:8px; align-items:center;">
                <h4>${escapeHtml(item.symbol)} - score ${item.score}/100</h4>
                <span class="badge">${escapeHtml(item.signal)} | risco ${escapeHtml(item.risk)}</span>
              </div>
              <p class="meta">Preco: ${formatCurrency(item.metrics.price, item.quote.currency)} | Momentum 30d: ${formatPercent(item.metrics.momentum30d)} | Volatilidade: ${formatPercent(item.metrics.volatilityAnnualized)}</p>
              <div class="meta" style="margin-top:8px;">${item.reasons.map((reason) => `• ${escapeHtml(reason)}`).join("<br>")}</div>
            </article>
          `
        )
        .join("");
    } catch (error) {
      container.innerHTML = `<p class="empty">${escapeHtml(error.message || "Falha ao analisar mercado")}</p>`;
    }
  });
}

function inlineMarkdown(text) {
  let html = escapeHtml(text);
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  return html;
}

function markdownToSafeHtml(markdown) {
  const lines = String(markdown || "").split("\n");
  const output = [];
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
        output.push("<ul class=\"md-list\">");
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
        output.push("<ol class=\"md-list\">");
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

function renderChatMessage(item) {
  if (item.role === "user") {
    return `<div class="chat-item user"><p class="md-p">${escapeHtml(item.content)}</p></div>`;
  }

  return `<div class="chat-item assistant">${markdownToSafeHtml(item.content)}</div>`;
}

async function renderAdvisor() {
  const content = document.getElementById("main-content");
  const historyResponse = await request("/advisor/history?limit=25");
  const history = historyResponse.data;

  content.innerHTML = `
    <article class="card stack">
      <h4>Agente financeiro ${APP_NAME}</h4>
      <p class="meta">O agente responde em formato estruturado e tambem executa acoes de meta direto pelo chat.</p>

      <div class="prompt-chips">
        <button class="chip" data-prompt="Adicione 200 reais na meta Reserva de emergencia">+ R$ 200 na meta</button>
        <button class="chip" data-prompt="Analise oportunidades de PETR4, VALE3 e ITUB4 com cautelas">Analisar oportunidades</button>
        <button class="chip" data-prompt="Monte um plano de 30 dias para eu economizar 800 reais">Plano de 30 dias</button>
      </div>

      <div id="chat-box" class="chat">
        ${
          history.length
            ? history.map((item) => renderChatMessage(item)).join("")
            : '<p class="empty">Sem mensagens ainda. Inicie a conversa.</p>'
        }
      </div>

      <form id="advisor-form" class="stack">
        <textarea name="message" placeholder="Ex.: adicione 200 reais na minha meta Reserva de emergencia" required></textarea>
        <button class="btn" type="submit">Enviar para IA</button>
      </form>

      <p class="meta">Aviso: conteudo educacional e sem promessa de retorno financeiro.</p>
    </article>
  `;

  const chatBox = document.getElementById("chat-box");
  const form = document.getElementById("advisor-form");
  const input = form.querySelector("textarea[name='message']");
  chatBox.scrollTop = chatBox.scrollHeight;

  content.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      input.value = button.dataset.prompt;
      input.focus();
    });
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const message = String(formData.get("message") || "").trim();

    if (!message) {
      return;
    }

    const optimistic = document.createElement("div");
    optimistic.className = "chat-item user";
    optimistic.innerHTML = `<p class="md-p">${escapeHtml(message)}</p>`;
    chatBox.appendChild(optimistic);

    const loading = document.createElement("div");
    loading.className = "chat-item assistant";
    loading.innerHTML = `<p class="md-p">Analisando seu comando e seus dados financeiros...</p>`;
    chatBox.appendChild(loading);
    chatBox.scrollTop = chatBox.scrollHeight;

    event.currentTarget.reset();

    try {
      const response = await request("/advisor/chat", {
        method: "POST",
        body: { message }
      });

      loading.innerHTML = markdownToSafeHtml(response.data.message);
      chatBox.scrollTop = chatBox.scrollHeight;
    } catch (error) {
      loading.innerHTML = `<p class="md-p">${escapeHtml(error.message || "Falha ao conversar com IA.")}</p>`;
    }
  });
}

async function bootstrapApp() {
  try {
    await loadMe();
    renderShell();
    await renderPage();
  } catch {
    clearSession();
    renderAuth("Sessao expirada. Faca login novamente.");
  }
}

async function init() {
  if (!state.token) {
    renderAuth();
    return;
  }

  await bootstrapApp();
}

void init();
