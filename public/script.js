const IP_AUTO_CHECK_INTERVAL_MS = 3000;
let autoIpCheckTimer = null;
let autoIpCheckRunning = false;
let autoIpCheckEnabled = false;
let ipCheckPromise = null;

let currentUser = null;
let pendencias = [];
let historicoTarefas = [];
let manutencoes = [];
let historicoManutencoes = [];
let ipsMonitorados = [];
let editingPendenciaId = null;
let editingManutencaoId = null;
let editingIpId = null;
let ipCategoriaAtiva = "Todos";
let sleepController = null;
let dashboardSnapshot = null;
let dashboardLastUpdatedAt = null;
let loadAllPromise = null;
const pendingActions = new Set();
const busyForms = new WeakSet();

const $ = (id) => document.getElementById(id);
const norm = (text) =>
  String(text ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

async function api(url, options = {}) {
  const { trackBusy = true, ...requestOptions } = options;
  if (trackBusy) sleepController?.beginBusy();
  try {
    const response = await fetch(url, {
      credentials: "same-origin",
      headers:
        requestOptions.body instanceof FormData
          ? undefined
          : { "Content-Type": "application/json" },
      ...requestOptions,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Erro na requisição.");
    return data;
  } finally {
    if (trackBusy) sleepController?.endBusy();
  }
}

function showToast(message, duration = 2200) {
  const toast = $("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), duration);
}

async function runPendingAction(key, action) {
  if (pendingActions.has(key)) {
    showToast("Esta ação já está em andamento.");
    return null;
  }
  pendingActions.add(key);
  sleepController?.beginBusy();
  try {
    return await action();
  } catch (error) {
    showToast(error.message || "Não foi possível concluir a ação.", 4200);
    return null;
  } finally {
    sleepController?.endBusy();
    pendingActions.delete(key);
  }
}

function setFormBusy(form, busy) {
  if (!form) return;
  if (busy && !busyForms.has(form)) {
    busyForms.add(form);
    sleepController?.beginBusy();
  } else if (!busy && busyForms.has(form)) {
    busyForms.delete(form);
    sleepController?.endBusy();
  }
  form.setAttribute("aria-busy", String(busy));
  form.querySelectorAll('button[type="submit"]').forEach((button) => {
    button.disabled = busy;
  });
}

function formatDate(date) {
  if (!date) return "-";
  if (String(date).includes("T")) date = String(date).slice(0, 10);
  const [y, m, d] = String(date).split("-");
  if (!y || !m || !d) return date;
  return `${d}/${m}/${y}`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const rawValue = String(value).trim();
  const normalizedValue = rawValue.replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalizedValue);
  const date = new Date(hasTimezone ? normalizedValue : `${normalizedValue}Z`);
  if (Number.isNaN(date.getTime())) return rawValue;
  return date.toLocaleString("pt-BR");
}

function tempoEmManutencao(dataEnvio, retornadoEm) {
  if (!dataEnvio || !retornadoEm) return "-";
  const inicio = new Date(`${String(dataEnvio).slice(0, 10)}T12:00:00`);
  const fim = new Date(
    String(retornadoEm).replace(" ", "T") +
      (String(retornadoEm).includes("Z") ? "" : "Z"),
  );
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fim.getTime())) return "-";
  const dias = Math.max(
    0,
    Math.ceil((fim.getTime() - inicio.getTime()) / 86400000),
  );
  if (dias === 0) return "Retornou no mesmo dia";
  return `${dias} dia${dias === 1 ? "" : "s"}`;
}

function escapeHtml(text) {
  return String(text ?? "").replace(
    /[&<>'"]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#039;",
        '"': "&quot;",
      })[c],
  );
}

function sanitizeCssToken(text, fallback = "padrao") {
  const token = norm(text)
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return token || fallback;
}

function safeRecordId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function safeCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count >= 0 ? String(count) : "0";
}

function attachmentUrl(attachment) {
  const id = safeRecordId(attachment?.id);
  return id ? `/api/anexos/${id}` : "";
}

function badge(text) {
  const cls = sanitizeCssToken(text);
  return `<span class="badge ${cls}">${escapeHtml(text || "-")}</span>`;
}

function empty() {
  return $("emptyTemplate").content.cloneNode(true);
}

function todayISO() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function setupDate() {
  const now = new Date();
  if ($("todayWeek"))
    $("todayWeek").textContent = now.toLocaleDateString("pt-BR", {
      weekday: "long",
    });
  if ($("todayDate"))
    $("todayDate").textContent = now.toLocaleDateString("pt-BR");
  if ($("pendenciaData")) $("pendenciaData").valueAsDate = now;
  if ($("manutencaoData")) $("manutencaoData").valueAsDate = now;
}

function setupAuthTabs() {
  $("showLogin").addEventListener("click", () => switchAuth("login"));
  $("showRegister").addEventListener("click", () => switchAuth("register"));
  $("showReset").addEventListener("click", () => switchAuth("reset"));
}

function switchAuth(type) {
  $("showLogin").classList.toggle("active", type === "login");
  $("showRegister").classList.toggle("active", type === "register");
  $("showReset").classList.toggle("active", type === "reset");
  $("loginForm").classList.toggle("active", type === "login");
  $("registerForm").classList.toggle("active", type === "register");
  $("resetForm").classList.toggle("active", type === "reset");
  $("authMessage").textContent = "";
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      activatePanel(tab.dataset.tab, {
        refreshDashboard: tab.dataset.tab === "dashboard",
      });
    });
  });
}

function activatePanel(
  panelId,
  { refreshDashboard = false, scroll = false } = {},
) {
  const panel = $(panelId);
  if (!panel) return false;

  document
    .querySelectorAll(".tab")
    .forEach((tab) =>
      tab.classList.toggle("active", tab.dataset.tab === panelId),
    );
  document
    .querySelectorAll(".panel")
    .forEach((item) => item.classList.toggle("active", item === panel));

  if (scroll) {
    panel.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (panelId === "dashboard" && refreshDashboard && currentUser) {
    loadAll().catch((error) => {
      showToast(
        error.message || "Não foi possível atualizar a Visão Geral.",
        4200,
      );
    });
  }
  return true;
}

function setupSleepController() {
  if (sleepController || typeof window.SleepScreenController !== "function") {
    return;
  }

  sleepController = new window.SleepScreenController({
    timeoutMs: 300000,
    isAuthenticated: () =>
      Boolean(currentUser) &&
      !$("appContent")?.classList.contains("app-hidden"),
    getUserLabel: () =>
      currentUser?.nome || $("userInfo")?.textContent || "Usuário conectado",
    onBlocked: () => showToast("Aguarde a conclusão da ação em andamento."),
  });
  sleepController.init();
}

async function checkAuth() {
  const data = await api("/api/auth/me");
  if (data.user) {
    currentUser = data.user;
    showApp();
    await loadAll();
    iniciarAutoVerificacaoIps();
  } else {
    $("showRegister").classList.toggle("app-hidden", !data.setupRequired);
    if (!data.setupRequired) switchAuth("login");
    showAuth();
  }
}

function showApp() {
  $("authScreen").classList.add("app-hidden");
  $("appContent").classList.remove("app-hidden");
  $("userInfo").textContent = `${currentUser.nome} • ${currentUser.perfil}`;
  $("adminTab")?.classList.toggle("app-hidden", currentUser.perfil !== "admin");
  activatePanel("dashboard");
  renderDashboardHeader();
  sleepController?.activate();
}

function showAuth() {
  sleepController?.deactivate();
  $("authScreen").classList.remove("app-hidden");
  $("appContent").classList.add("app-hidden");
}

function setupForms() {
  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    setFormBusy(form, true);
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({
          usuario: $("loginUsuario").value.trim(),
          senha: $("loginSenha").value,
        }),
      });
      currentUser = data.user;
      showToast("Login realizado com sucesso");
      showApp();
      await loadAll();
      iniciarAutoVerificacaoIps();
    } catch (error) {
      $("authMessage").textContent = error.message;
      $("loginSenha").value = "";
    } finally {
      setFormBusy(form, false);
    }
  });

  $("registerForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const senha = $("registerSenha").value;
    const confirmar = $("registerConfirmar").value;
    if (senha !== confirmar) {
      $("authMessage").textContent = "As senhas não conferem.";
      return;
    }
    const form = e.currentTarget;
    setFormBusy(form, true);
    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          nome: $("registerNome").value.trim(),
          usuario: $("registerUsuario").value.trim(),
          senha,
        }),
      });
      currentUser = data.user;
      showToast("Conta criada com sucesso");
      showApp();
      await loadAll();
      iniciarAutoVerificacaoIps();
    } catch (error) {
      $("authMessage").textContent = error.message;
    } finally {
      setFormBusy(form, false);
    }
  });

  $("resetForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const novaSenha = $("resetNovaSenha").value;
    const confirmarSenha = $("resetConfirmarSenha").value;

    if (novaSenha !== confirmarSenha) {
      $("authMessage").textContent = "As senhas não conferem.";
      return;
    }

    const form = e.currentTarget;
    setFormBusy(form, true);
    try {
      await api("/api/auth/reset-password-admin", {
        method: "POST",
        body: JSON.stringify({
          usuario: $("resetUsuario").value.trim(),
          novaSenha,
          adminUsuario: $("resetAdminUsuario").value.trim(),
          adminSenha: $("resetAdminSenha").value,
        }),
      });

      $("authMessage").textContent =
        "Senha alterada com sucesso. Agora o usuário já pode entrar com a nova senha.";
      $("resetForm").reset();
      setTimeout(() => switchAuth("login"), 1600);
    } catch (error) {
      $("authMessage").textContent = error.message;
      $("resetAdminSenha").value = "";
    } finally {
      setFormBusy(form, false);
    }
  });

  $("logoutBtn").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await api("/api/auth/logout", {
        method: "POST",
        body: JSON.stringify({}),
      });
      pararAutoVerificacaoIps();
      location.reload();
    } catch (error) {
      showToast(error.message || "Não foi possível sair.", 4200);
      button.disabled = false;
    }
  });

  $("pendenciaForm").addEventListener("submit", savePendencia);
  $("manutencaoForm").addEventListener("submit", saveManutencao);
  $("ipForm").addEventListener("submit", saveIp);
  $("ipBusca").addEventListener("input", renderIps);
  $("verificarTodosIps").addEventListener("click", () =>
    verificarTodosIps(),
  );
  $("cancelarEdicaoIp").addEventListener("click", resetIpForm);

  $("adminCreateUserForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    setFormBusy(form, true);
    try {
      await api("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          nome: $("adminCreateNome").value.trim(),
          usuario: $("adminCreateUsuario").value.trim(),
          senha: $("adminCreateSenha").value,
        }),
      });
      e.currentTarget.reset();
      showToast("Usuário técnico criado");
    } catch (error) {
      showToast(error.message);
    } finally {
      setFormBusy(form, false);
    }
  });

  $("adminResetPasswordForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    setFormBusy(form, true);
    try {
      await api("/api/auth/reset-password-admin", {
        method: "POST",
        body: JSON.stringify({
          usuario: $("adminResetUsuario").value.trim(),
          novaSenha: $("adminResetSenha").value,
        }),
      });
      e.currentTarget.reset();
      showToast("Senha redefinida");
    } catch (error) {
      showToast(error.message);
    } finally {
      setFormBusy(form, false);
    }
  });

  document.querySelectorAll(".ip-category-tab").forEach((button) => {
    button.addEventListener("click", () => {
      ipCategoriaAtiva = button.dataset.ipCategory || "Todos";
      document
        .querySelectorAll(".ip-category-tab")
        .forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      renderIps();
    });
  });

  const buscaHistorico = $("historicoBusca");
  if (buscaHistorico) {
    buscaHistorico.addEventListener("input", renderHistoricoTarefas);
  }

  const limparBuscaHistorico = $("limparBuscaHistorico");
  if (limparBuscaHistorico) {
    limparBuscaHistorico.addEventListener("click", () => {
      $("historicoBusca").value = "";
      renderHistoricoTarefas();
      $("historicoBusca").focus();
    });
  }

  const buscaHistoricoManutencoes = $("historicoManutencoesBusca");
  if (buscaHistoricoManutencoes) {
    buscaHistoricoManutencoes.addEventListener(
      "input",
      renderHistoricoManutencoes,
    );
  }

  const limparBuscaHistoricoManutencoes = $("limparBuscaHistoricoManutencoes");
  if (limparBuscaHistoricoManutencoes) {
    limparBuscaHistoricoManutencoes.addEventListener("click", () => {
      $("historicoManutencoesBusca").value = "";
      renderHistoricoManutencoes();
      $("historicoManutencoesBusca").focus();
    });
  }
}

async function loadAll() {
  if (loadAllPromise) return loadAllPromise;

  const operation = (async () => {
    setDashboardBusy(true);
    try {
      const results = await Promise.allSettled([
        loadPendencias(),
        loadHistoricoTarefas(),
        loadManutencoes(),
        loadHistoricoManutencoes(),
        loadIps(),
        loadStats(),
      ]);
      const failures = results.filter((result) => result.status === "rejected");
      renderDashboard({
        warning: failures.length
          ? "Alguns dados não puderam ser atualizados. Os valores disponíveis foram preservados."
          : "",
      });
      if (failures.length) throw failures[0].reason;
    } finally {
      setDashboardBusy(false);
    }
  })();

  loadAllPromise = operation;
  try {
    return await operation;
  } finally {
    if (loadAllPromise === operation) loadAllPromise = null;
  }
}

async function loadPendencias() {
  pendencias = await api("/api/pendencias");
  renderPendencias();
  if (!loadAllPromise) renderDashboard();
}

async function loadHistoricoTarefas() {
  historicoTarefas = await api("/api/pendencias-historico");
  renderHistoricoTarefas();
  if (!loadAllPromise) renderDashboard();
}

async function loadManutencoes() {
  manutencoes = await api("/api/manutencoes");
  renderManutencoes();
  if (!loadAllPromise) renderDashboard();
}

async function loadHistoricoManutencoes() {
  historicoManutencoes = await api("/api/manutencoes-historico");
  renderHistoricoManutencoes();
  if (!loadAllPromise) renderDashboard();
}

async function loadIps() {
  ipsMonitorados = await api("/api/ips");
  renderIps();
  if (!loadAllPromise) renderDashboard();
}

async function loadStats() {
  const stats = await api("/api/stats");
  $("statPendencias").textContent = stats.pendencias;
  $("statManutencao").textContent = stats.manutencoes;
  renderResumoRotina(stats);
}

function renderResumoRotina(stats) {
  const resumo = $("resumoRotina");
  if (!resumo) return;
  resumo.innerHTML = `
    <article class="mini-card ${Number(stats.atrasadas) > 0 ? "danger-glow" : ""}">
      <span>Atrasadas</span>
      <strong>${escapeHtml(safeCount(stats.atrasadas))}</strong>
      <small>minhas tarefas vencidas</small>
    </article>
    <article class="mini-card">
      <span>Hoje</span>
      <strong>${escapeHtml(safeCount(stats.hoje))}</strong>
      <small>minhas tarefas de hoje</small>
    </article>
    <article class="mini-card">
      <span>Próximas</span>
      <strong>${escapeHtml(safeCount(stats.proximas))}</strong>
      <small>minhas tarefas agendadas</small>
    </article>
    <article class="mini-card next-task">
      <span>Próxima tarefa</span>
      <strong>${stats.proximaTarefa ? escapeHtml(stats.proximaTarefa.descricao) : "Tudo em ordem"}</strong>
      <small>${stats.proximaTarefa ? `${escapeHtml(formatDate(stats.proximaTarefa.data))} ${stats.proximaTarefa.hora ? "às " + escapeHtml(stats.proximaTarefa.hora) : ""}` : "nenhuma pendência aberta"}</small>
    </article>
  `;
}

function dashboardCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function renderDashboardHeader(now = new Date()) {
  const greeting = $("dashboardGreeting");
  const fullDate = $("dashboardFullDate");
  if (greeting) {
    const hour = now.getHours();
    const period =
      hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
    greeting.textContent = `${period}, ${currentUser?.nome || "usuário"}`;
  }
  if (fullDate) {
    const value = now.toLocaleDateString("pt-BR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    fullDate.textContent = value.charAt(0).toUpperCase() + value.slice(1);
  }
}

function setDashboardStatus(message, type = "") {
  const status = $("dashboardStatus");
  if (!status) return;
  status.textContent = message;
  status.className = `dashboard-status${type ? ` is-${type}` : ""}`;
}

function setDashboardBusy(busy) {
  const panel = $("dashboard");
  const button = $("dashboardRefresh");
  panel?.setAttribute("aria-busy", String(busy));
  if (button) {
    button.disabled = busy;
    button.classList.toggle("is-loading", busy);
  }
  if (busy) {
    setDashboardStatus(
      dashboardSnapshot
        ? "Atualizando os indicadores..."
        : "Carregando a visão geral...",
    );
  }
}

function dashboardEmptyState(title, description) {
  return `
    <div class="dashboard-empty">
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(description)}</span>
      </div>
    </div>
  `;
}

function dashboardBarClass(label, index) {
  const token = norm(label);
  if (
    token.includes("urgente") ||
    token.includes("retorno") ||
    token.includes("offline")
  ) {
    return "is-danger";
  }
  if (
    token.includes("baixa") ||
    token.includes("consertado") ||
    token.includes("online")
  ) {
    return "is-green";
  }
  if (
    token.includes("analise") ||
    token.includes("enviado") ||
    token.includes("alta")
  ) {
    return "is-blue";
  }
  return index % 3 === 2 ? "is-blue" : "";
}

function renderDashboardBars(containerId, distribution) {
  const container = $(containerId);
  if (!container) return;
  const items = Array.isArray(distribution) ? distribution : [];
  const total = items.reduce(
    (sum, item) => sum + dashboardCount(item?.total),
    0,
  );

  container.innerHTML = items
    .map((item, index) => {
      const label = String(item?.categoria || "Não informado");
      const value = dashboardCount(item?.total);
      const percentage = total > 0 ? (value / total) * 100 : 0;
      const colorClass = dashboardBarClass(label, index);
      return `
        <div class="dashboard-bar-row">
          <span class="dashboard-bar-label">${escapeHtml(label)}</span>
          <div
            class="dashboard-bar-track"
            role="img"
            aria-label="${escapeHtml(`${label}: ${value}`)}"
          >
            <span
              class="dashboard-bar-fill ${colorClass}"
              style="width: ${percentage.toFixed(2)}%"
            ></span>
          </div>
          <strong class="dashboard-bar-value">${escapeHtml(String(value))}</strong>
        </div>
      `;
    })
    .join("");

  if (total === 0) {
    container.insertAdjacentHTML(
      "beforeend",
      '<p class="dashboard-zero-note">Nenhum registro nesta distribuição.</p>',
    );
  }
}

function renderDashboardIpChart(distribution) {
  const container = $("dashboardIpChart");
  if (!container) return;

  const totals = new Map(
    (Array.isArray(distribution) ? distribution : []).map((item) => [
      item.categoria,
      dashboardCount(item.total),
    ]),
  );
  const online = totals.get("Online") || 0;
  const offline = totals.get("Offline") || 0;
  const unknown = totals.get("Não verificado") || 0;
  const total = online + offline + unknown;
  const onlineAngle = total > 0 ? (online / total) * 360 : 0;
  const offlineAngle = total > 0 ? ((online + offline) / total) * 360 : 0;

  container.innerHTML = `
    <div class="dashboard-donut-wrap">
      <div
        class="dashboard-donut"
        role="img"
        aria-label="${escapeHtml(`IPs: ${online} online, ${offline} offline e ${unknown} não verificados`)}"
      >
        <div class="dashboard-donut-center">
          <strong>${escapeHtml(String(total))}</strong>
          <span>monitorados</span>
        </div>
      </div>
    </div>
    <div class="dashboard-chart-legend">
      <div class="dashboard-legend-item">
        <span class="dashboard-legend-dot is-online" aria-hidden="true"></span>
        <span>Online</span>
        <strong>${escapeHtml(String(online))}</strong>
      </div>
      <div class="dashboard-legend-item">
        <span class="dashboard-legend-dot is-offline" aria-hidden="true"></span>
        <span>Offline</span>
        <strong>${escapeHtml(String(offline))}</strong>
      </div>
      <div class="dashboard-legend-item">
        <span class="dashboard-legend-dot is-unknown" aria-hidden="true"></span>
        <span>Não verificado</span>
        <strong>${escapeHtml(String(unknown))}</strong>
      </div>
      ${
        total === 0
          ? '<p class="dashboard-zero-note">Nenhum IP monitorado.</p>'
          : ""
      }
    </div>
  `;

  const donut = container.querySelector(".dashboard-donut");
  donut?.style.setProperty(
    "--dashboard-online-angle",
    `${onlineAngle.toFixed(2)}deg`,
  );
  donut?.style.setProperty(
    "--dashboard-offline-angle",
    `${offlineAngle.toFixed(2)}deg`,
  );
}

function dashboardRecordBadge(label, className = "") {
  return `<span class="dashboard-record-badge ${className}">${escapeHtml(label || "-")}</span>`;
}

function renderDashboardPendingList(items) {
  const container = $("dashboardProximasList");
  if (!container) return;
  if (!Array.isArray(items) || !items.length) {
    container.innerHTML = dashboardEmptyState(
      "Nenhuma pendência aberta",
      "Sua fila pessoal está em ordem.",
    );
    return;
  }

  container.innerHTML = items
    .map((item) => {
      const late = item.data && item.data < todayISO();
      const when = item.data
        ? `${formatDate(item.data)}${item.hora ? ` às ${item.hora}` : ""}`
        : "Sem data definida";
      return `
        <article class="dashboard-record">
          <div class="dashboard-record-top">
            <strong class="dashboard-record-title">${escapeHtml(item.descricao || "Pendência sem descrição")}</strong>
          </div>
          <div class="dashboard-record-meta">
            <span>Setor: ${escapeHtml(item.setor || "-")}</span>
            <span>Quando: ${escapeHtml(when)}</span>
          </div>
          <div class="dashboard-record-badges">
            ${dashboardRecordBadge(item.prioridade || "Média", "is-priority")}
            ${dashboardRecordBadge(item.status || "Aberta")}
            ${late ? dashboardRecordBadge("Atrasada", "is-danger") : ""}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderDashboardMaintenanceList(items) {
  const container = $("dashboardManutencoesList");
  if (!container) return;
  if (!Array.isArray(items) || !items.length) {
    container.innerHTML = dashboardEmptyState(
      "Nenhum equipamento ativo",
      "Não há manutenções em andamento.",
    );
    return;
  }

  container.innerHTML = items
    .map((item) => {
      const days = dashboardCount(item.diasEmManutencao);
      const daysLabel = item.dataEnvio
        ? `${days} dia${days === 1 ? "" : "s"}`
        : "Sem data";
      const title = [item.tipo || "Equipamento", item.patrimonio]
        .filter(Boolean)
        .join(" • ");
      return `
        <article class="dashboard-record is-maintenance">
          <div class="dashboard-record-top">
            <strong class="dashboard-record-title">${escapeHtml(title)}</strong>
            <span class="dashboard-record-days">${escapeHtml(daysLabel)}</span>
          </div>
          <div class="dashboard-record-meta">
            <span>Marca/modelo: ${escapeHtml(item.modelo || "-")}</span>
            <span>Enviado: ${escapeHtml(formatDate(item.dataEnvio))}</span>
          </div>
          <div class="dashboard-record-badges">
            ${dashboardRecordBadge(item.status || "Não informado")}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderDashboardOfflineList(items) {
  const container = $("dashboardOfflineList");
  if (!container) return;
  if (!Array.isArray(items) || !items.length) {
    container.innerHTML = dashboardEmptyState(
      "Nenhum IP offline",
      "Nenhuma indisponibilidade foi registrada.",
    );
    return;
  }

  container.innerHTML = items
    .map(
      (item) => `
        <article class="dashboard-record is-offline">
          <div class="dashboard-record-top">
            <strong class="dashboard-record-title">${escapeHtml(item.ip || "-")}</strong>
            <span class="dashboard-record-days">Offline</span>
          </div>
          <div class="dashboard-record-meta">
            <span>Equipamento: ${escapeHtml(item.nome || "-")}</span>
            <span>Categoria: ${escapeHtml(item.categoria || "Outro")}</span>
            <span>Setor/local: ${escapeHtml(item.setor || "-")}</span>
            <span>Última verificação: ${escapeHtml(formatDateTime(item.verificadoEm))}</span>
          </div>
        </article>
      `,
    )
    .join("");
}

function renderDashboardActivities(items) {
  const container = $("dashboardActivitiesList");
  if (!container) return;
  if (!Array.isArray(items) || !items.length) {
    container.innerHTML = dashboardEmptyState(
      "Nenhuma atividade compartilhada",
      "As próximas movimentações de manutenção aparecerão aqui.",
    );
    return;
  }

  const markers = { criacao: "+", edicao: "ED", retorno: "OK" };
  container.innerHTML = items
    .map((item) => {
      const equipment = item.equipamento || {};
      const identity = [equipment.tipo || "Equipamento", equipment.patrimonio]
        .filter(Boolean)
        .join(" • ");
      const details = [
        identity,
        equipment.modelo,
        item.usuario ? `por ${item.usuario}` : "",
      ]
        .filter(Boolean)
        .join(" — ");
      return `
        <article class="dashboard-activity">
          <span class="dashboard-activity-marker" aria-hidden="true">${escapeHtml(markers[item.tipo] || "TI")}</span>
          <div class="dashboard-activity-content">
            <strong>${escapeHtml(item.acao || "Manutenção atualizada")}</strong>
            <p>${escapeHtml(details || "Registro compartilhado da equipe")}</p>
            <time datetime="${escapeHtml(item.data || "")}">${escapeHtml(formatDateTime(item.data))}</time>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderDashboard({ warning = "" } = {}) {
  renderDashboardHeader();
  const builder = window.RotinaDashboardModel?.buildDashboardModel;
  if (typeof builder !== "function") {
    setDashboardStatus(
      "O resumo local do Dashboard não pôde ser carregado.",
      "error",
    );
    return;
  }

  try {
    dashboardSnapshot = builder({
      currentUser,
      pendencias,
      historicoTarefas,
      manutencoes,
      historicoManutencoes,
      ipsMonitorados,
    });

    const counts = dashboardSnapshot.contagens || {};
    const countTargets = {
      dashboardPendenciasAbertas: counts.pendenciasAbertas,
      dashboardPendenciasAtrasadas: counts.pendenciasAtrasadas,
      dashboardTarefasHoje: counts.pendenciasHoje,
      dashboardConcluidas7Dias: counts.pendenciasConcluidasUltimos7Dias,
      dashboardManutencoesAtivas: counts.manutencoesAtivas,
      dashboardAguardandoRetorno: counts.manutencoesAguardandoRetorno,
      dashboardIpsTotal: counts.ipsMonitorados,
      dashboardIpsOffline: counts.ipsOffline,
    };
    Object.entries(countTargets).forEach(([id, value]) => {
      const element = $(id);
      if (element) element.textContent = String(dashboardCount(value));
    });

    renderDashboardBars(
      "dashboardPrioridadeChart",
      dashboardSnapshot.distribuicoes?.pendenciasPorPrioridade,
    );
    renderDashboardBars(
      "dashboardManutencaoChart",
      dashboardSnapshot.distribuicoes?.manutencoesPorStatus,
    );
    renderDashboardIpChart(dashboardSnapshot.distribuicoes?.ipsPorStatus);
    renderDashboardPendingList(dashboardSnapshot.proximasPendencias);
    renderDashboardMaintenanceList(dashboardSnapshot.manutencoesMaisAntigas);
    renderDashboardOfflineList(dashboardSnapshot.ipsOffline);
    renderDashboardActivities(dashboardSnapshot.atividadesRecentes);

    dashboardLastUpdatedAt = new Date();
    const updatedAt = $("dashboardUpdatedAt");
    if (updatedAt) {
      updatedAt.textContent = dashboardLastUpdatedAt.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    setDashboardStatus(
      warning || "Visão Geral atualizada com sucesso.",
      warning ? "warning" : "ready",
    );
  } catch (error) {
    console.error("Erro ao montar o Dashboard:", error);
    setDashboardStatus(
      "Não foi possível montar a Visão Geral. Tente atualizar novamente.",
      "error",
    );
  }
}

function openDashboardTarget(element) {
  const target = element?.dataset?.dashboardTarget;
  if (!target) return;
  const filter = element.dataset.dashboardFilter || "";

  if (target === "monitorIps") {
    ipCategoriaAtiva = "Todos";
    document.querySelectorAll(".ip-category-tab").forEach((button) => {
      button.classList.toggle("active", button.dataset.ipCategory === "Todos");
    });
    if ($("ipBusca")) {
      $("ipBusca").value = filter === "offline" ? "Offline" : "";
    }
    renderIps();
  }

  if (target === "historicoTarefas" && $("historicoBusca")) {
    $("historicoBusca").value = "";
    renderHistoricoTarefas();
  }

  activatePanel(target, { scroll: true });
}

function setupDashboard() {
  $("dashboardRefresh")?.addEventListener("click", () => {
    loadAll().catch((error) => {
      showToast(
        error.message || "Não foi possível atualizar a Visão Geral.",
        4200,
      );
    });
  });

  document
    .querySelectorAll("#dashboard [data-dashboard-target]")
    .forEach((element) => {
      element.addEventListener("click", () => openDashboardTarget(element));
    });
}

function renderPendencias() {
  const list = $("pendenciasList");
  list.innerHTML = "";
  if (!pendencias.length) return list.appendChild(empty());

  pendencias.forEach((item) => {
    const itemId = safeRecordId(item.id);
    const atrasada = item.data && item.data < todayISO();
    const hoje = item.data === todayISO();
    const card = document.createElement("article");
    card.className = `item-card pendencia-card ${sanitizeCssToken(item.prioridade)} ${atrasada ? "is-late" : ""} ${hoje ? "is-today" : ""}`;
    card.innerHTML = `
      <div>
        <div class="item-title">
          <strong>${escapeHtml(item.descricao)}</strong>
          ${badge(item.prioridade)}
          ${badge(item.status)}
          ${item.repeticao === "Semanal" ? badge("Semanal") : ""}
          ${atrasada ? badge("Atrasada") : ""}
          ${hoje ? badge("Hoje") : ""}
        </div>
        <div class="meta">
          <span>Setor: ${escapeHtml(item.setor || "-")}</span>
          <span>Data: ${escapeHtml(formatDate(item.data))}</span>
          <span>Hora: ${escapeHtml(item.hora || "-")}</span>
          <span>Repetição: ${escapeHtml(item.repeticao === "Semanal" ? "Toda semana" : "Não repetir")}</span>
          <span>Criado: ${escapeHtml(formatDateTime(item.criadoEm))}</span>
        </div>
      </div>
      ${
        itemId
          ? `<div class="actions">
        <button class="success" type="button" onclick="concluirPendencia(${itemId})">Concluir</button>
        <button class="secondary" type="button" onclick="editPendencia(${itemId})">Editar</button>
        <button class="danger" type="button" onclick="deletePendencia(${itemId})">Excluir</button>
      </div>`
          : ""
      }
    `;
    list.appendChild(card);
  });
}

function renderHistoricoTarefas() {
  const list = $("historicoTarefasList");
  const total = $("historicoCount");
  if (!list) return;

  const termo = norm($("historicoBusca")?.value || "").trim();
  const filtradas = historicoTarefas.filter((item) => {
    if (!termo) return true;
    const texto = norm(
      [
        item.descricao,
        item.setor,
        item.prioridade,
        item.status,
        item.repeticao,
        formatDate(item.data),
        item.hora,
        formatDateTime(item.concluidoEm),
      ].join(" "),
    );
    return texto.includes(termo);
  });

  if (total) total.textContent = historicoTarefas.length;
  list.innerHTML = "";

  if (!historicoTarefas.length) {
    list.innerHTML = `
      <div class="empty-state history-empty">
        <strong>Nenhuma tarefa concluída ainda</strong>
        <span>Quando você concluir uma pendência, ela aparecerá aqui automaticamente.</span>
      </div>
    `;
    return;
  }

  if (!filtradas.length) {
    list.innerHTML = `
      <div class="empty-state history-empty">
        <strong>Nenhum resultado encontrado</strong>
        <span>Tente pesquisar com outro termo.</span>
      </div>
    `;
    return;
  }

  filtradas.forEach((item) => {
    const card = document.createElement("article");
    card.className = `item-card history-card ${sanitizeCssToken(item.prioridade)}`;
    card.innerHTML = `
      <div>
        <div class="item-title">
          <strong>${escapeHtml(item.descricao)}</strong>
          ${badge("Concluída")}
          ${badge(item.prioridade)}
          ${item.repeticao === "Semanal" ? badge("Semanal") : ""}
        </div>
        <div class="meta">
          <span>Setor: ${escapeHtml(item.setor || "-")}</span>
          <span>Data da tarefa: ${escapeHtml(formatDate(item.data))}</span>
          <span>Hora: ${escapeHtml(item.hora || "-")}</span>
          <span>Repetição: ${escapeHtml(item.repeticao === "Semanal" ? "Toda semana" : "Não repetir")}</span>
          <span>Concluída em: ${escapeHtml(formatDateTime(item.concluidoEm || item.atualizadoEm || item.criadoEm))}</span>
          <span>Criada em: ${escapeHtml(formatDateTime(item.criadoEm))}</span>
        </div>
      </div>
      <div class="history-check" aria-label="Tarefa concluída">✓</div>
    `;
    list.appendChild(card);
  });
}

function renderAttachmentSection(attachments, uploadMaintenanceId = null) {
  const files = Array.isArray(attachments) ? attachments : [];
  const listHtml = files.length
    ? files
        .map((attachment) => {
          const url = attachmentUrl(attachment);
          const name = attachment.nomeOriginal || "Documento PDF";
          const fileNameHtml = url
            ? `<a class="pdf-name" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" download="${escapeHtml(name)}">${escapeHtml(name)}</a>`
            : `<span class="pdf-name">${escapeHtml(name)}</span>`;
          return `
            <div class="pdf-item">
              <div class="pdf-item-left">
                ${fileNameHtml}
                <span class="pdf-meta">Anexado por ${escapeHtml(attachment.anexadoPor || "-")} • ${escapeHtml(formatDateTime(attachment.criadoEm))}</span>
              </div>
            </div>
          `;
        })
        .join("")
    : `<div class="pdf-empty">Nenhum PDF anexado.</div>`;

  const maintenanceId = safeRecordId(uploadMaintenanceId);
  const uploadHtml = maintenanceId
    ? `
      <div class="pdf-upload-box">
        <input
          id="pdf-${maintenanceId}"
          type="file"
          accept="application/pdf"
          multiple
          aria-label="Selecionar PDFs para esta manutenção"
        />
        <button class="secondary" type="button" onclick="uploadPdf(${maintenanceId})">
          Anexar PDFs
        </button>
      </div>
    `
    : "";

  return `
    <section class="pdf-section" aria-label="Documentos PDF">
      <span class="pdf-title">PDFs anexados</span>
      <div class="pdf-list">${listHtml}</div>
      ${uploadHtml}
    </section>
  `;
}

function renderManutencoes() {
  const list = $("manutencoesList");
  if (!list) return;
  list.innerHTML = "";
  if (!manutencoes.length) return list.appendChild(empty());

  manutencoes.forEach((item) => {
    const itemId = safeRecordId(item.id);
    const statusClass = `status-${sanitizeCssToken(item.status)}`;
    const card = document.createElement("article");
    card.className = "manut-card";
    card.innerHTML = `
      <div class="manut-top">
        <div class="manut-title-area">
          <div class="manut-title-line">
            <strong class="manut-title">${escapeHtml(item.tipo || "Equipamento")} — ${escapeHtml(item.modelo || "Sem modelo")}</strong>
            <span class="type-badge">${escapeHtml(item.tipo || "Outro")}</span>
            <span class="status-badge ${statusClass}">${escapeHtml(item.status || "-")}</span>
          </div>
          <span class="manut-subtitle">Registro compartilhado com a equipe de TI</span>
        </div>
        ${
          itemId
            ? `<div class="manut-actions">
          <button class="btn-return" type="button" onclick="retornarManutencao(${itemId})">Retornou</button>
          <button class="btn-edit" type="button" onclick="editManutencao(${itemId})">Editar</button>
          ${currentUser?.perfil === "admin" ? `<button class="btn-delete" type="button" onclick="deleteManutencao(${itemId})">Excluir</button>` : ""}
        </div>`
            : ""
        }
      </div>

      <div class="manut-grid">
        <div class="info-box">
          <span>Patrimônio</span>
          <strong>${escapeHtml(item.patrimonio || "-")}</strong>
        </div>
        <div class="info-box">
          <span>Serial</span>
          <strong>${escapeHtml(item.serial || "-")}</strong>
        </div>
        <div class="info-box">
          <span>Setor / Usuário</span>
          <strong>${escapeHtml(item.responsavel || "-")}</strong>
        </div>
        <div class="info-box">
          <span>Destino</span>
          <strong>${escapeHtml(item.destino || "-")}</strong>
        </div>
        <div class="info-box">
          <span>Data de envio</span>
          <strong>${escapeHtml(formatDate(item.dataEnvio))}</strong>
        </div>
      </div>

      <div class="manut-desc">
        <span class="manut-desc-title">Defeito / Observações</span>
        <p>${escapeHtml(item.obs || "Nenhuma observação registrada.")}</p>
      </div>

      <div class="manut-footer-meta">
        <span>Criado por <b>${escapeHtml(item.criadoPor || "-")}</b></span>
        <span>Criado em <b>${escapeHtml(formatDateTime(item.criadoEm))}</b></span>
        ${item.atualizadoPor ? `<span>Editado por <b>${escapeHtml(item.atualizadoPor)}</b></span>` : ""}
        ${item.retornadoPor ? `<span>Retorno por <b>${escapeHtml(item.retornadoPor)}</b></span>` : ""}
      </div>

      ${renderAttachmentSection(item.anexos, itemId)}
    `;
    list.appendChild(card);
  });
}

function renderHistoricoManutencoes() {
  const list = $("historicoManutencoesList");
  const total = $("historicoManutencoesCount");
  if (!list) return;

  const termo = norm($("historicoManutencoesBusca")?.value || "").trim();
  const filtradas = historicoManutencoes.filter((item) => {
    if (!termo) return true;
    const texto = norm(
      [
        item.tipo,
        item.patrimonio,
        item.modelo,
        item.serial,
        item.responsavel,
        item.destino,
        item.status,
        item.obs,
        item.criadoPor,
        item.atualizadoPor,
        item.retornadoPor,
        formatDate(item.dataEnvio),
        formatDateTime(item.retornadoEm),
      ].join(" "),
    );
    return texto.includes(termo);
  });

  if (total) total.textContent = historicoManutencoes.length;
  list.innerHTML = "";

  if (!historicoManutencoes.length) {
    list.innerHTML = `
      <div class="empty-state history-empty">
        <strong>Nenhuma manutenção finalizada ainda</strong>
        <span>Quando um equipamento for marcado como retornado, ele aparecerá aqui.</span>
      </div>
    `;
    return;
  }

  if (!filtradas.length) {
    list.innerHTML = `
      <div class="empty-state history-empty">
        <strong>Nenhum resultado encontrado</strong>
        <span>Tente pesquisar pelo tipo, patrimônio, modelo, serial, usuário ou destino.</span>
      </div>
    `;
    return;
  }

  filtradas.forEach((item) => {
    const itemId = safeRecordId(item.id);
    const card = document.createElement("article");
    card.className = "manut-card manut-history-card";
    card.innerHTML = `
      <div class="manut-top">
        <div class="manut-title-area">
          <div class="manut-title-line">
            <strong class="manut-title">${escapeHtml(item.tipo || "Equipamento")} — ${escapeHtml(item.modelo || "Sem modelo")}</strong>
            <span class="type-badge">${escapeHtml(item.tipo || "Outro")}</span>
            <span class="status-badge status-retornou">Retornou</span>
          </div>
          <span class="manut-subtitle">Manutenção concluída e preservada no histórico</span>
        </div>
        ${
          itemId
            ? `<div class="manut-actions">
          <button class="btn-edit" type="button" onclick="reabrirManutencao(${itemId})">Reabrir</button>
          ${currentUser?.perfil === "admin" ? `<button class="btn-delete" type="button" onclick="deleteManutencao(${itemId}, true)">Excluir definitivamente</button>` : ""}
        </div>`
            : ""
        }
      </div>

      <div class="manut-grid">
        <div class="info-box"><span>Patrimônio</span><strong>${escapeHtml(item.patrimonio || "-")}</strong></div>
        <div class="info-box"><span>Serial</span><strong>${escapeHtml(item.serial || "-")}</strong></div>
        <div class="info-box"><span>Setor / Usuário</span><strong>${escapeHtml(item.responsavel || "-")}</strong></div>
        <div class="info-box"><span>Destino</span><strong>${escapeHtml(item.destino || "-")}</strong></div>
        <div class="info-box"><span>Enviado em</span><strong>${escapeHtml(formatDate(item.dataEnvio))}</strong></div>
        <div class="info-box"><span>Retornou em</span><strong>${escapeHtml(formatDateTime(item.retornadoEm || item.atualizadoEm))}</strong></div>
        <div class="info-box"><span>Tempo em manutenção</span><strong>${escapeHtml(tempoEmManutencao(item.dataEnvio, item.retornadoEm || item.atualizadoEm))}</strong></div>
      </div>

      <div class="manut-desc">
        <span class="manut-desc-title">Defeito / Observações</span>
        <p>${escapeHtml(item.obs || "Nenhuma observação registrada.")}</p>
      </div>

      <div class="manut-footer-meta">
        <span>Criado por <b>${escapeHtml(item.criadoPor || "-")}</b></span>
        <span>Retorno registrado por <b>${escapeHtml(item.retornadoPor || item.atualizadoPor || "-")}</b></span>
      </div>

      ${renderAttachmentSection(item.anexos)}
    `;
    list.appendChild(card);
  });
}

function renderIps() {
  const list = $("ipsList");
  if (!list) return;

  document.querySelectorAll(".ip-category-tab").forEach((tab) => {
    const categoria = tab.dataset.ipCategory || "Todos";
    const total =
      categoria === "Todos"
        ? ipsMonitorados.length
        : ipsMonitorados.filter(
            (item) => (item.categoria || "Outro") === categoria,
          ).length;
    const count = tab.querySelector(".ip-category-count");
    if (count) count.textContent = total;
  });

  const itensDaCategoria =
    ipCategoriaAtiva === "Todos"
      ? ipsMonitorados
      : ipsMonitorados.filter(
          (item) => (item.categoria || "Outro") === ipCategoriaAtiva,
        );

  const termo = norm($("ipBusca")?.value || "").trim();
  const filtrados = itensDaCategoria.filter((item) => {
    if (!termo) return true;
    return norm(
      [
        item.categoria,
        item.nome,
        item.ip,
        item.setor,
        item.observacoes,
        item.status,
      ].join(" "),
    ).includes(termo);
  });

  const online = itensDaCategoria.filter(
    (item) => item.status === "Online",
  ).length;
  const offline = itensDaCategoria.filter(
    (item) => item.status === "Offline",
  ).length;
  $("ipsOnlineCount").textContent = online;
  $("ipsOfflineCount").textContent = offline;

  list.innerHTML = "";
  if (!ipsMonitorados.length) {
    list.innerHTML = `
      <div class="empty-state ip-empty">
        <strong>Nenhum IP cadastrado</strong>
        <span>Adicione acima somente os equipamentos que você deseja acompanhar.</span>
      </div>
    `;
    return;
  }

  if (!filtrados.length) {
    list.innerHTML = `
      <div class="empty-state ip-empty">
        <strong>Nenhum resultado encontrado</strong>
        <span>Não há IPs nesta categoria ou pesquisa.</span>
      </div>
    `;
    return;
  }

  filtrados.forEach((item) => {
    const itemId = safeRecordId(item.id);
    const statusClass =
      item.status === "Online"
        ? "online"
        : item.status === "Offline"
          ? "offline"
          : "unknown";
    const card = document.createElement("article");
    const responseTime = Number(item.tempoMs);
    card.className = `item-card ip-card ${statusClass}`;
    card.innerHTML = `
      <div class="ip-main">
        <div class="item-title">
          <span class="ip-status-dot" aria-hidden="true"></span>
          <strong>${escapeHtml(item.nome)}</strong>
          <span class="ip-category-badge">${escapeHtml(item.categoria || "Outro")}</span>
          ${badge(item.status || "Não verificado")}
        </div>
        <div class="ip-address">${escapeHtml(item.ip)}</div>
        <div class="meta">
          <span>Categoria: ${escapeHtml(item.categoria || "Outro")}</span>
          <span>Setor / Local: ${escapeHtml(item.setor || "-")}</span>
          <span>Resposta: ${item.status === "Online" && Number.isFinite(responseTime) && responseTime >= 0 ? `${escapeHtml(String(responseTime))} ms` : "-"}</span>
          <span>Última verificação: ${escapeHtml(formatDateTime(item.verificadoEm))}</span>
          <span>Cadastrado por: ${escapeHtml(item.criadoPor || "-")}</span>
        </div>
        ${item.observacoes ? `<p>${escapeHtml(item.observacoes)}</p>` : ""}
      </div>
      ${
        itemId
          ? `<div class="actions ip-actions">
        <button class="success" type="button" onclick="verificarIp(${itemId})">Verificar</button>
        <button class="secondary" type="button" onclick="editIp(${itemId})">Editar</button>
        ${currentUser?.perfil === "admin" ? `<button class="danger" type="button" onclick="deleteIp(${itemId})">Excluir</button>` : ""}
      </div>`
          : ""
      }
    `;
    list.appendChild(card);
  });
}

async function saveIp(e) {
  e.preventDefault();

  const form = e.currentTarget;

  const payload = {
    categoria: $("ipCategoria").value,
    nome: $("ipNome").value.trim(),
    ip: $("ipEndereco").value.trim(),
    setor: $("ipSetor").value.trim(),
    observacoes: $("ipObservacoes").value.trim(),
  };

  setFormBusy(form, true);

  try {
    if (editingIpId) {
      await api(`/api/ips/${editingIpId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });

      showToast("IP atualizado e verificado");
    } else {
      await api("/api/ips", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      showToast("IP cadastrado e verificado");
    }

    resetIpForm();
    await loadIps();
  } catch (error) {
    showToast(error.message || "Não foi possível salvar o IP.", 5000);
  } finally {
    setFormBusy(form, false);
  }
}

function editIp(id) {
  const itemId = safeRecordId(id);
  if (!itemId) return;
  const item = ipsMonitorados.find((ip) => safeRecordId(ip.id) === itemId);
  if (!item) return;
  const salvarIpBtn = $("salvarIpBtn");

if (salvarIpBtn) {
  salvarIpBtn.textContent = "Salvar alterações";
}
  editingIpId = itemId;
  $("ipId").value = itemId;
  $("ipCategoria").value = item.categoria || "Outro";
  $("ipNome").value = item.nome || "";
  $("ipEndereco").value = item.ip || "";
  $("ipSetor").value = item.setor || "";
  $("ipObservacoes").value = item.observacoes || "";
  $("cancelarEdicaoIp").classList.remove("app-hidden");
  $("ipForm").querySelector('button[type="submit"]').textContent =
    "Atualizar IP";
  window.scrollTo({ top: $("monitorIps").offsetTop - 20, behavior: "smooth" });
}

function resetIpForm() {
   editingIpId = null;
  $("ipId").value = "";
  $("ipForm").reset();
  $("ipCategoria").value = "Outro";
  $("cancelarEdicaoIp").classList.add("app-hidden");

  const salvarIpBtn = $("salvarIpBtn");

  if (salvarIpBtn) {
    salvarIpBtn.textContent = "Salvar IP";
  }
}

async function verificarIp(id) {
  const itemId = safeRecordId(id);
  if (!itemId) return;
  await runPendingAction(`verificar-ip:${itemId}`, async () => {
    showToast("Verificando IP...");
    await api(`/api/ips/${itemId}/verificar`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await loadIps();
    const item = ipsMonitorados.find((ip) => safeRecordId(ip.id) === itemId);
    showToast(
      item?.status === "Online"
        ? `Online - ${item.tempoMs ?? "-"} ms`
        : "IP não respondeu",
    );
  });
}

async function executarAutoVerificacaoIps() {
  autoIpCheckTimer = null;
  if (!autoIpCheckEnabled) return;
  if (autoIpCheckRunning) return;

  const appContent = document.getElementById("appContent");
  if (!appContent || appContent.classList.contains("app-hidden")) {
    agendarAutoVerificacaoIps();
    return;
  }

  if (!ipsMonitorados.length) {
    agendarAutoVerificacaoIps();
    return;
  }

  autoIpCheckRunning = true;

  try {
    await verificarTodosIps({ silent: true });
  } catch (error) {
    console.error("Falha na verificação automática de IPs:", error);
  } finally {
    autoIpCheckRunning = false;
    agendarAutoVerificacaoIps();
  }
}

function agendarAutoVerificacaoIps() {
  clearTimeout(autoIpCheckTimer);
  autoIpCheckTimer = null;
  if (!autoIpCheckEnabled) return;

  autoIpCheckTimer = setTimeout(
    executarAutoVerificacaoIps,
    IP_AUTO_CHECK_INTERVAL_MS,
  );
}

function iniciarAutoVerificacaoIps() {
  autoIpCheckEnabled = true;
  agendarAutoVerificacaoIps();
}

function pararAutoVerificacaoIps() {
  autoIpCheckEnabled = false;
  clearTimeout(autoIpCheckTimer);
  autoIpCheckTimer = null;
  autoIpCheckRunning = false;
}

async function verificarTodosIps({ silent = false } = {}) {
  const button = $("verificarTodosIps");
  if (!ipsMonitorados.length) {
    if (!silent) showToast("Cadastre pelo menos um IP");
    return;
  }

  if (!silent) {
    sleepController?.beginBusy();
  }

  let operation = ipCheckPromise;
  if (!operation) {
    operation = (async () => {
      const updatedIps = await api("/api/ips/verificar-todos", {
        method: "POST",
        body: JSON.stringify({}),
        trackBusy: false,
      });
      ipsMonitorados = updatedIps;
      renderIps();
      renderDashboard();
      return updatedIps;
    })();
    ipCheckPromise = operation;
  }

  try {
    if (!silent && button) {
      button.disabled = true;
      button.textContent = "Verificando...";
    }

    await operation;

    if (!silent) {
      const online = ipsMonitorados.filter(
        (item) => item.status === "Online",
      ).length;
      showToast(`${online} de ${ipsMonitorados.length} IPs responderam`);
    }
  } catch (error) {
    if (silent) throw error;
    showToast(error.message || "Não foi possível verificar os IPs.");
  } finally {
    if (ipCheckPromise === operation) {
      ipCheckPromise = null;
    }

    if (!silent && button) {
      button.disabled = false;
      button.textContent = "Verificar todos";
    }

    if (!silent) {
      sleepController?.endBusy();
    }
  }
}

async function deleteIp(id) {
  const itemId = safeRecordId(id);
  if (!itemId) return;
  const item = ipsMonitorados.find((ip) => safeRecordId(ip.id) === itemId);
  if (!confirm(`Deseja excluir ${item?.nome || "este IP"} da lista?`)) return;
  await runPendingAction(`excluir-ip:${itemId}`, async () => {
    await api(`/api/ips/${itemId}`, { method: "DELETE" });
    showToast("IP excluído");
    if (editingIpId === itemId) resetIpForm();
    await loadIps();
  });
}

async function savePendencia(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const payload = {
    descricao: $("pendenciaDescricao").value.trim(),
    setor: $("pendenciaSetor").value.trim(),
    data: $("pendenciaData").value,
    hora: $("pendenciaHora").value,
    prioridade: $("pendenciaPrioridade").value,
    status: $("pendenciaStatus").value,
    repeticao: $("pendenciaRepeticao").value,
  };

  setFormBusy(form, true);
  try {
    if (editingPendenciaId) {
      await api(`/api/pendencias/${editingPendenciaId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      showToast("Pendência editada");
    } else {
      await api("/api/pendencias", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      showToast("Pendência salva");
    }
    editingPendenciaId = null;
    $("pendenciaForm").reset();
    $("pendenciaPrioridade").value = "Média";
    $("pendenciaStatus").value = "Aberta";
    $("pendenciaRepeticao").value = "Nenhuma";
    $("pendenciaData").valueAsDate = new Date();
    await loadAll();
  } catch (error) {
    showToast(error.message);
  } finally {
    setFormBusy(form, false);
  }
}

function editPendencia(id) {
  const itemId = safeRecordId(id);
  if (!itemId) return;
  const item = pendencias.find(
    (pendingItem) => safeRecordId(pendingItem.id) === itemId,
  );
  if (!item) return;
  editingPendenciaId = itemId;
  $("pendenciaDescricao").value = item.descricao || "";
  $("pendenciaSetor").value = item.setor || "";
  $("pendenciaData").value = item.data || "";
  $("pendenciaHora").value = item.hora || "";
  $("pendenciaPrioridade").value = item.prioridade || "Média";
  $("pendenciaStatus").value = item.status || "Aberta";
  $("pendenciaRepeticao").value = item.repeticao || "Nenhuma";
  window.scrollTo({ top: $("pendencias").offsetTop - 20, behavior: "smooth" });
}

async function concluirPendencia(id) {
  const itemId = safeRecordId(id);
  if (!itemId) return;
  await runPendingAction(`concluir-pendencia:${itemId}`, async () => {
    const result = await api(`/api/pendencias/${itemId}/concluir`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    showToast(
      result.proximaCriada
        ? "Concluída. Próxima tarefa criada para a semana seguinte."
        : "Pendência concluída",
    );
    await loadAll();
  });
}

async function deletePendencia(id) {
  const itemId = safeRecordId(id);
  if (!itemId) return;
  if (!confirm("Deseja excluir esta pendência?")) return;
  await runPendingAction(`excluir-pendencia:${itemId}`, async () => {
    await api(`/api/pendencias/${itemId}`, { method: "DELETE" });
    showToast("Pendência excluída");
    await loadAll();
  });
}

async function saveManutencao(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const payload = {
    tipo: $("manutencaoTipo").value,
    patrimonio: $("manutencaoPatrimonio").value.trim(),
    modelo: $("manutencaoModelo").value.trim(),
    serial: $("manutencaoSerial").value.trim(),
    responsavel: $("manutencaoResponsavel").value.trim(),
    destino: $("manutencaoDestino").value.trim(),
    dataEnvio: $("manutencaoData").value,
    status: $("manutencaoStatus").value,
    obs: $("manutencaoObs").value.trim(),
  };

  setFormBusy(form, true);
  try {
    let manutencaoId = editingManutencaoId;
    const wasEditing = Boolean(editingManutencaoId);

    if (editingManutencaoId) {
      await api(`/api/manutencoes/${editingManutencaoId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
    } else {
      const created = await api("/api/manutencoes", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      manutencaoId = created.id;
    }

    const uploadResult = await uploadPdfFromForm(manutencaoId);

    editingManutencaoId = null;
    $("manutencaoForm").reset();
    $("manutencaoData").valueAsDate = new Date();
    await loadAll();
    showToast(
      formatUploadFeedback(
        uploadResult,
        wasEditing ? "Manutenção editada." : "Manutenção salva.",
      ),
      uploadResult.failures.length ? 6000 : 2800,
    );
  } catch (error) {
    showToast(error.message);
  } finally {
    setFormBusy(form, false);
  }
}

function editManutencao(id) {
  const itemId = safeRecordId(id);
  if (!itemId) return;
  const item = manutencoes.find(
    (maintenanceItem) => safeRecordId(maintenanceItem.id) === itemId,
  );
  if (!item) return;
  editingManutencaoId = itemId;
  $("manutencaoTipo").value = item.tipo || "CPU";
  $("manutencaoPatrimonio").value = item.patrimonio || "";
  $("manutencaoModelo").value = item.modelo || "";
  $("manutencaoSerial").value = item.serial || "";
  $("manutencaoResponsavel").value = item.responsavel || "";
  $("manutencaoDestino").value = item.destino || "";
  $("manutencaoData").value = item.dataEnvio || "";
  $("manutencaoStatus").value = item.status || "Enviado";
  $("manutencaoObs").value = item.obs || "";
  window.scrollTo({ top: $("manutencao").offsetTop - 20, behavior: "smooth" });
}

async function retornarManutencao(id) {
  const itemId = safeRecordId(id);
  if (!itemId) return;
  await runPendingAction(`retornar-manutencao:${itemId}`, async () => {
    await api(`/api/manutencoes/${itemId}/retornar`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    showToast("Equipamento marcado como retornado");
    await loadAll();
  });
}

async function reabrirManutencao(id) {
  const itemId = safeRecordId(id);
  if (!itemId) return;
  if (
    !confirm(
      "Deseja reabrir esta manutenção? Ela voltará para a lista de equipamentos em manutenção.",
    )
  )
    return;
  await runPendingAction(`reabrir-manutencao:${itemId}`, async () => {
    await api(`/api/manutencoes/${itemId}/reabrir`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    showToast("Manutenção reaberta");
    await loadAll();
  });
}

async function deleteManutencao(id, definitivo = false) {
  const itemId = safeRecordId(id);
  if (!itemId) return;
  const mensagem = definitivo
    ? "Deseja excluir definitivamente esta manutenção e os registros dos PDFs? Esta ação não pode ser desfeita."
    : "Deseja excluir esta manutenção?";
  if (!confirm(mensagem)) return;
  await runPendingAction(`excluir-manutencao:${itemId}`, async () => {
    await api(`/api/manutencoes/${itemId}`, { method: "DELETE" });
    showToast("Manutenção excluída");
    await loadAll();
  });
}

async function uploadPdfFile(id, file) {
  const maintenanceId = safeRecordId(id);
  if (!maintenanceId || !file) {
    throw new Error("Manutenção ou arquivo inválido.");
  }
  if (
    !file.name.toLowerCase().endsWith(".pdf") ||
    (file.type && file.type !== "application/pdf")
  ) {
    throw new Error(`${file.name}: apenas PDF é permitido.`);
  }

  const form = new FormData();
  form.append("pdf", file);
  await api(`/api/manutencoes/${maintenanceId}/anexos`, {
    method: "POST",
    body: form,
  });
}

async function uploadPdfFiles(id, fileList) {
  const files = Array.from(fileList || []);
  const result = { total: files.length, uploaded: 0, failures: [] };

  for (const file of files) {
    try {
      await uploadPdfFile(id, file);
      result.uploaded += 1;
    } catch (error) {
      result.failures.push({
        name: file.name || "arquivo",
        message: error.message || "Falha no envio.",
      });
    }
  }

  return result;
}

function formatUploadFeedback(result, prefix = "") {
  if (!result?.total) return prefix || "Nenhum PDF selecionado.";

  const parts = [];
  if (prefix) parts.push(prefix);
  if (result.uploaded) {
    parts.push(
      `${result.uploaded} PDF${result.uploaded === 1 ? "" : "s"} anexado${result.uploaded === 1 ? "" : "s"}.`,
    );
  }
  if (result.failures.length) {
    const details = result.failures
      .map((failure) => `${failure.name}: ${failure.message}`)
      .join(" | ");
    parts.push(
      `${result.failures.length} arquivo${result.failures.length === 1 ? "" : "s"} não enviado${result.failures.length === 1 ? "" : "s"}: ${details}`,
    );
  }
  return parts.join(" ").trim();
}

async function uploadPdfFromForm(id) {
  const input = $("manutencaoPdf");
  if (!input?.files?.length) {
    return { total: 0, uploaded: 0, failures: [] };
  }
  return uploadPdfFiles(id, input.files);
}

async function uploadPdf(id) {
  const maintenanceId = safeRecordId(id);
  if (!maintenanceId) return;
  const input = $(`pdf-${maintenanceId}`);
  if (!input || !input.files.length) {
    showToast("Selecione pelo menos um PDF primeiro.");
    return;
  }

  const files = Array.from(input.files);
  await runPendingAction(`upload-pdf:${maintenanceId}`, async () => {
    const result = await uploadPdfFiles(maintenanceId, files);
    input.value = "";
    if (result.uploaded) await loadManutencoes();
    showToast(
      formatUploadFeedback(result, "Envio concluído."),
      result.failures.length ? 6000 : 2800,
    );
  });
}

function setupMotivation() {
  const frases = [
    "Resolva uma coisa por vez. TI boa é TI organizada.",
    "Comece pelas urgências, depois vá para as melhorias.",
    "Documente hoje para não sofrer amanhã.",
    "Todo problema resolvido vira experiência.",
    "Calma, analisa, testa e resolve.",
    "Não confie só na memória. Registre tudo.",
    "Menos correria, mais controle.",
    "O suporte bom começa com organização.",
  ];
  const icones = ["⚡", "💻", "🧠", "🛠️", "🚀", "📌", "✅", "🔧"];
  const card = document.querySelector(".motivation-card");
  if (!card) return;
  card.addEventListener("click", () => {
    $("motivacaoTexto").textContent =
      frases[Math.floor(Math.random() * frases.length)];
    $("motivacaoIcon").textContent =
      icones[Math.floor(Math.random() * icones.length)];
  });
}

setupDate();
setupAuthTabs();
setupTabs();
setupForms();
setupDashboard();
setupMotivation();
setupSleepController();
checkAuth().catch((error) => showToast(error.message));
