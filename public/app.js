// public/app.js

const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");
const mobileMenuBtn = document.getElementById("mobileMenuBtn");

const navButtons = document.querySelectorAll(".nav-btn");
const views = {
  dashboard: document.getElementById("view-dashboard"),
  conciliacoes: document.getElementById("view-conciliacoes"),
  importar: document.getElementById("view-importar"),
};

const pageTitle = document.getElementById("pageTitle");
const pageSubtitle = document.getElementById("pageSubtitle");

const titles = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Visão geral da sua conciliação bancária",
  },
  conciliacoes: {
    title: "Importar Dados",
    subtitle: "Histórico de todas as conciliações realizadas",
  },
  importar: {
    title: "Conciliações",
    subtitle:
      "Faça upload dos seus extratos e lançamentos para iniciar a conciliação",
  },
};

// ===============================
// USER TOP (novo)
// ===============================
let ME = null;

const userMenuBtn = document.getElementById("userMenuBtn");
const userMenu = document.getElementById("userMenu");
const userNameTop = document.getElementById("userNameTop");
const userNameCard = document.getElementById("userNameCard");
const userEmailCard = document.getElementById("userEmailCard");
const userRoleCard = document.getElementById("userRoleCard");

const openSettingsBtn = document.getElementById("openSettings");
const logoutBtn = document.getElementById("logoutBtn");

function escapeHtml(str = "") {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function iconSvg(name, classes = "w-4 h-4") {
  const map = {
    download:
      '<path d="M12 3v10m0 0 4-4m-4 4-4-4M5 15v4h14v-4" stroke-linecap="round" stroke-linejoin="round"/>',
    eye: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="3"/>',
    trash:
      '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" stroke-linecap="round" stroke-linejoin="round"/>',
    plus: '<path d="M12 5v14M5 12h14" stroke-linecap="round" stroke-linejoin="round"/>',
    file: '<path d="M7 3h7l5 5v13H7z" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 3v5h5" stroke-linecap="round" stroke-linejoin="round"/>',
  };
  const body = map[name] || map.download;
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="${classes}" aria-hidden="true">${body}</svg>`;
}

async function loadMe() {
  try {
    const r = await fetch("/api/me");
    if (!r.ok) {
      window.location.href = "/login";
      return;
    }
    const data = await r.json();
    ME = data.user;

    if (userNameTop) userNameTop.textContent = ME?.name || "Usuário";
    if (userNameCard) userNameCard.textContent = ME?.name || "Usuário";
    if (userEmailCard) userEmailCard.textContent = ME?.email || "-";
    if (userRoleCard) userRoleCard.textContent = ME?.role || "USER";
  } catch {
    window.location.href = "/login";
  }
}

function toggleUserMenu(open) {
  if (!userMenu) return;
  const isOpen = !userMenu.classList.contains("hidden");
  const next = typeof open === "boolean" ? open : !isOpen;
  userMenu.classList.toggle("hidden", !next);
}

userMenuBtn?.addEventListener("click", () => toggleUserMenu());
document.addEventListener("click", (e) => {
  if (!userMenu || !userMenuBtn) return;
  const wrap = document.getElementById("userMenuWrap");
  if (!wrap) return;
  if (!wrap.contains(e.target)) toggleUserMenu(false);
});

logoutBtn?.addEventListener("click", async () => {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  window.location.href = "/login";
});

openSettingsBtn?.addEventListener("click", () => {
  toggleUserMenu(false);
  openSettingsModal();
});

// ===============================
// Settings modal + Admin Users
// ===============================
function openSettingsModal() {
  const root = document.getElementById("settingsModalRoot");
  if (!root) return;

  const isAdmin = (ME?.role || "") === "ADMIN";

  // ✅ AJUSTE: modal full screen (tela cheia)
  root.innerHTML = `
    <div class="fixed inset-0 z-50 bg-black/40">
      <div class="absolute inset-0 bg-white shadow-xl border border-slate-200 overflow-hidden">
        <div class="flex items-center justify-between p-5 border-b border-slate-200">
          <div>
            <p class="text-xs text-slate-500">Configurações</p>
            <h3 class="text-xl font-extrabold">Gerencie seus dados e acessos</h3>
          </div>
          <button id="closeSettings" class="text-slate-500 hover:text-slate-900 text-2xl">x</button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-4 h-[calc(100vh-81px)]">
          <div class="p-4 border-r border-slate-200 overflow-auto">
            <button id="tabConta" class="w-full text-left px-4 py-3 rounded-xl hover:bg-slate-50 font-bold inline-flex items-center gap-2">
              <span class="text-violet-600">👤</span>
              <span>Minha conta</span>
            </button>
            ${
              isAdmin
                ? `<button id="tabUsers" class="mt-2 w-full text-left px-4 py-3 rounded-xl hover:bg-slate-50 font-bold inline-flex items-center gap-2">
                    <span class="text-emerald-500">🧩</span>
                    <span>Usuarios</span>
                  </button>`
                : ""
            }
          </div>

          <div class="p-5 md:col-span-3 overflow-auto">
            <div id="panelConta">
              <h4 class="font-extrabold text-lg">Minha conta</h4>
              <p class="text-sm text-slate-500 mt-1">Altere sua senha.</p>

              <div class="mt-5 grid gap-4 sm:grid-cols-2 max-w-2xl">
                <div>
                  <label class="text-sm font-bold text-slate-700">Senha atual</label>
                  <input id="curPass" type="password" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm" placeholder="Digite sua senha atual"/>
                </div>
                <div>
                  <label class="text-sm font-bold text-slate-700">Nova senha</label>
                  <input id="newPass" type="password" class="mt-2 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm" placeholder="Digite a nova senha"/>
                </div>
              </div>

              <button id="savePass" class="mt-4 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800">
                Salvar
              </button>

              <p id="passMsg" class="mt-3 text-sm hidden"></p>
            </div>

            ${
              isAdmin
                ? `
              <div id="panelUsers" class="hidden">
                <div class="flex items-start justify-between gap-4">
                  <div>
                    <h4 class="font-extrabold text-lg">Usuários</h4>
                    <p class="text-sm text-slate-500 mt-1">Criar, desativar e resetar senha.</p>
                  </div>
                  <p id="usersCount" class="text-xs text-slate-500">-</p>
                </div>

                <div class="mt-5 grid gap-5 lg:grid-cols-2">
                  <div class="border border-slate-200 rounded-2xl p-4">
                    <p class="font-extrabold">Criar usuário</p>

                    <div class="mt-3 space-y-3">
                      <input id="uName" class="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm" placeholder="Nome" />
                      <input id="uEmail" class="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm" placeholder="Email" />
                      <input id="uPass" class="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm" placeholder="Senha temporária" />
                      <select id="uRole" class="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm">
                        <option value="USER">USER</option>
                        <option value="ADMIN">ADMIN</option>
                      </select>

                      <button id="uCreate" class="w-full rounded-xl bg-slate-900 text-white py-3 font-bold hover:bg-slate-800">
                        Criar
                      </button>
                      <p id="uCreateMsg" class="text-sm hidden"></p>
                    </div>
                  </div>

                  <div class="border border-slate-200 rounded-2xl p-4">
                    <p class="font-extrabold">Lista</p>
                    <div class="mt-3 overflow-x-auto">
                      <table class="w-full text-sm">
                        <thead>
                          <tr class="text-left text-slate-500">
                            <th class="py-2">Nome</th>
                            <th class="py-2">Email</th>
                            <th class="py-2">Role</th>
                            <th class="py-2">Status</th>
                            <th class="py-2">Ações</th>
                          </tr>
                        </thead>
                        <tbody id="usersTbody"></tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            `
                : ""
            }
          </div>
        </div>
      </div>
    </div>
  `;

  document
    .getElementById("closeSettings")
    ?.addEventListener("click", () => (root.innerHTML = ""));

  // trocar senha
  document.getElementById("savePass")?.addEventListener("click", async () => {
    const cur = document.getElementById("curPass")?.value || "";
    const nw = document.getElementById("newPass")?.value || "";
    const el = document.getElementById("passMsg");
    if (!el) return;

    el.classList.add("hidden");
    el.textContent = "";

    const r = await fetch("/api/account/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: cur, newPassword: nw }),
    });
    const data = await r.json().catch(() => ({}));
    el.classList.remove("hidden");
    if (!r.ok) {
      el.classList.remove("text-emerald-600");
      el.classList.add("text-red-600");
      el.textContent = data?.error || "Falha ao salvar.";
      return;
    }
    el.classList.remove("text-red-600");
    el.classList.add("text-emerald-600");
    el.textContent = "Senha alterada com sucesso!";
    document.getElementById("curPass").value = "";
    document.getElementById("newPass").value = "";
  });

  // tabs admin
  const tabConta = document.getElementById("tabConta");
  const tabUsers = document.getElementById("tabUsers");
  const panelConta = document.getElementById("panelConta");
  const panelUsers = document.getElementById("panelUsers");

  tabConta?.addEventListener("click", () => {
    panelConta?.classList.remove("hidden");
    panelUsers?.classList.add("hidden");
  });

  tabUsers?.addEventListener("click", async () => {
    panelConta?.classList.add("hidden");
    panelUsers?.classList.remove("hidden");
    await loadUsersAdmin();
  });

  // se admin, já deixa o painel conta como padrão
}

async function loadUsersAdmin() {
  const tbody = document.getElementById("usersTbody");
  const countEl = document.getElementById("usersCount");
  if (!tbody) return;

  const r = await fetch("/api/admin/users");
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    tbody.innerHTML = `<tr><td class="py-3 text-red-600" colspan="5">Falha ao carregar usuários.</td></tr>`;
    return;
  }

  const items = data.items || [];
  if (countEl)
    countEl.textContent = `Ativos: ${
      items.filter((x) => x.status === "ACTIVE").length
    } | Inativos: ${
      items.filter((x) => x.status === "INACTIVE").length
    } | Total: ${items.length}`;

  tbody.innerHTML = items
    .map((u) => {
      const active = u.status === "ACTIVE";

      // ✅ (adição segura) só mostra "Excluir" se NÃO for você e NÃO for ADMIN
      const canDelete =
        String(u.role || "").toUpperCase() !== "ADMIN" &&
        String(u.email || "").toLowerCase() !==
          String(ME?.email || "").toLowerCase();

      return `
        <tr class="border-t border-slate-200">
          <td class="py-3 font-bold">${escapeHtml(u.name)}</td>
          <td class="py-3 text-slate-600">${escapeHtml(u.email)}</td>
          <td class="py-3">${escapeHtml(u.role)}</td>
          <td class="py-3 ${
            active ? "text-emerald-600 font-bold" : "text-slate-500"
          }">${escapeHtml(u.status)}</td>
          <td class="py-3">
            <div class="flex flex-wrap gap-2">
              <button data-status="${u.id}" data-next="${
        active ? "INACTIVE" : "ACTIVE"
      }"
                class="px-3 py-1 rounded-lg border border-slate-200 hover:bg-slate-50">
                ${active ? "Desativar" : "Ativar"}
              </button>
              <button data-reset="${u.id}" class="px-3 py-1 rounded-lg border border-slate-200 hover:bg-slate-50">
                Reset senha
              </button>
              ${
                canDelete
                  ? `<button data-deluser="${u.id}" data-name="${escapeHtml(
                      u.name
                    )}"
                      class="px-3 py-1 rounded-lg border border-red-200 text-red-700 hover:bg-red-50">
                      Excluir
                    </button>`
                  : ""
              }
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  document.querySelectorAll("[data-status]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-status");
      const next = btn.getAttribute("data-next");
      await fetch(`/api/admin/users/${id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      await loadUsersAdmin();
    });
  });

  document.querySelectorAll("[data-reset]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-reset");
      const temp = prompt("Digite a senha temporária para o usuário:");
      if (!temp) return;
      await fetch(`/api/admin/users/${id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tempPassword: temp }),
      });
      alert("Senha resetada.");
    });
  });

  // ✅ (adição segura) Excluir usuário
  document.querySelectorAll("[data-deluser]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-deluser");
      const nm = btn.getAttribute("data-name") || "usuário";
      if (!id) return;

      const ok = confirm(`Tem certeza que deseja excluir o usuário "${nm}"?`);
      if (!ok) return;

      const r = await fetch(`/api/admin/users/${id}`, { method: "DELETE" });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) {
        alert(data?.error || "Falha ao excluir usuário.");
        return;
      }
      await loadUsersAdmin();
    });
  });

  // criar usuário
  document.getElementById("uCreate")?.addEventListener("click", async () => {
    const name = document.getElementById("uName")?.value || "";
    const email = document.getElementById("uEmail")?.value || "";
    const tempPassword = document.getElementById("uPass")?.value || "";
    const role = document.getElementById("uRole")?.value || "USER";
    const msg = document.getElementById("uCreateMsg");
    if (!msg) return;

    msg.classList.add("hidden");
    msg.textContent = "";

    const r = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, tempPassword, role }),
    });
    const data = await r.json().catch(() => ({}));
    msg.classList.remove("hidden");

    if (!r.ok) {
      msg.classList.remove("text-emerald-600");
      msg.classList.add("text-red-600");
      msg.textContent = data?.error || "Falha ao criar.";
      return;
    }

    msg.classList.remove("text-red-600");
    msg.classList.add("text-emerald-600");
    msg.textContent = "Usuário criado com sucesso!";

    document.getElementById("uName").value = "";
    document.getElementById("uEmail").value = "";
    document.getElementById("uPass").value = "";
    document.getElementById("uRole").value = "USER";

    await loadUsersAdmin();
  });
}

// ===============================
// seu layout original abaixo
// ===============================
function setActiveNav(key) {
  navButtons.forEach((btn) => {
    const isActive = btn.dataset.view === key;
    btn.classList.toggle("bg-white/5", isActive);
    btn.classList.toggle("border-white/10", isActive);

    if (!isActive) {
      btn.classList.add("bg-white/0");
      btn.classList.remove("border-white/10");
      btn.classList.add("border-transparent");
    }
  });
}

async function showView(key) {
  Object.keys(views).forEach((k) => {
    views[k]?.classList.toggle("hidden", k !== key);
  });

  setActiveNav(key);

  if (pageTitle && pageSubtitle && titles[key]) {
    pageTitle.textContent = titles[key].title;
    pageSubtitle.textContent = titles[key].subtitle;
  }

  if (key === "dashboard") {
    await loadDashboard();
  }
  if (key === "conciliacoes") {
    await loadReconciliations();
  }

  closeSidebarMobile();
}

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.view;
    if (key) showView(key);
  });
});

document.querySelectorAll("[data-go]").forEach((el) => {
  el.addEventListener("click", () => {
    const key = el.getAttribute("data-go");
    if (key) showView(key);
  });
});

// Mobile sidebar
function openSidebarMobile() {
  sidebar?.classList.remove("-translate-x-full");
  sidebarOverlay?.classList.remove("hidden");
}

function closeSidebarMobile() {
  sidebar?.classList.add("-translate-x-full");
  sidebarOverlay?.classList.add("hidden");
}

mobileMenuBtn?.addEventListener("click", openSidebarMobile);
sidebarOverlay?.addEventListener("click", closeSidebarMobile);

// Hints de arquivo selecionado
function setFileHint(inputId, hintId) {
  const input = document.getElementById(inputId);
  const hint = document.getElementById(hintId);
  if (!input || !hint) return;

  input.addEventListener("change", () => {
    const files = Array.from(input.files || []);
    if (!files.length) {
      hint.textContent = "Nenhum arquivo selecionado";
      return;
    }
    if (files.length === 1) {
      hint.textContent = files[0].name;
      return;
    }
    hint.textContent = `${files.length} arquivos selecionados`;
  });
}

setFileHint("extrato", "extratoHint");
setFileHint("controle", "controleHint");
setFileHint("duplicatas", "duplicatasHint");

function formatMoneyFromCentavos(centavos) {
  const n = Number(centavos || 0) / 100;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function setTextIf(el, text) {
  if (el) el.textContent = text;
}

function findBigNumberElementWithin(cardEl) {
  if (!cardEl) return null;
  const common =
    cardEl.querySelector(".text-4xl") ||
    cardEl.querySelector(".text-3xl") ||
    cardEl.querySelector(".text-2xl") ||
    cardEl.querySelector(".font-extrabold") ||
    cardEl.querySelector(".font-bold");
  if (common) return common;

  const all = Array.from(
    cardEl.querySelectorAll("div, span, p, h1, h2, h3, h4, strong")
  );
  for (const el of all) {
    const t = (el.textContent || "").trim();
    if (!t) continue;
    if (/^\d+$/.test(t)) return el;
  }
  return null;
}

function findMoneyElementWithin(cardEl) {
  if (!cardEl) return null;
  const common =
    cardEl.querySelector(".text-4xl") ||
    cardEl.querySelector(".text-3xl") ||
    cardEl.querySelector(".font-extrabold") ||
    cardEl.querySelector(".font-bold");

  if (common) {
    const t = (common.textContent || "").trim();
    if (t.includes("R$")) return common;
  }

  const all = Array.from(cardEl.querySelectorAll("div, span, p, strong"));
  for (const el of all) {
    const t = (el.textContent || "").trim();
    if (!t) continue;
    if (t.includes("R$")) return el;
  }
  return null;
}

// ===============================
// carregar KPIs dashboard
// ===============================
async function loadDashboard() {
  try {
    const r = await fetch("/api/dashboard");
    if (!r.ok) return;
    const data = await r.json();

    const kpiTransacoes = document.getElementById("kpiTransacoes");
    const kpiConciliadas = document.getElementById("kpiConciliadas");
    const kpiDivergencias = document.getElementById("kpiDivergencias");
    const kpiPendentes = document.getElementById("kpiPendentes");

    if (kpiTransacoes) kpiTransacoes.textContent = String(data.transacoes ?? 0);
    if (kpiConciliadas)
      kpiConciliadas.textContent = String(data.conciliadas ?? 0);
    if (kpiDivergencias)
      kpiDivergencias.textContent = String(data.divergencias ?? 0);
    if (kpiPendentes) kpiPendentes.textContent = String(data.pendentes ?? 0);

    const volumeTxt = formatMoneyFromCentavos(data.volume_doc1_abs_centavos ?? 0);

    const volumeCard = Array.from(
      document.querySelectorAll("#view-dashboard .bg-white")
    ).find((el) => (el.textContent || "").toUpperCase().includes("VOLUME BANCÁRIO"));

    if (volumeCard) {
      const moneyEl = findMoneyElementWithin(volumeCard);
      if (moneyEl) moneyEl.textContent = volumeTxt;
    }

    const totalConciliacoesTxt = String(data.total ?? 0);

    const conciliacoesCard = Array.from(
      document.querySelectorAll("#view-dashboard .bg-white")
    ).find((el) => {
      const t = (el.textContent || "").toUpperCase();
      return t.includes("CONCILIAÇÕES") && t.includes("REALIZADAS");
    });

    if (conciliacoesCard) {
      const bigNumEl = findBigNumberElementWithin(conciliacoesCard);
      if (bigNumEl) bigNumEl.textContent = totalConciliacoesTxt;
    }

    const recentCard = document.querySelector(
      "#view-dashboard .lg\\:col-span-2.bg-white"
    );
    if (recentCard) {
      const list = (data.recentes || []).slice(0, 5);

      const html = list.length
        ? `
          <div class="mt-4 space-y-2">
            ${list
              .map(
                (it) => `
                <div class="flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:bg-slate-50">
                  <div class="min-w-0">
                    <p class="font-bold text-sm truncate">${escapeHtml(it.name)}</p>
                    <p class="text-xs text-slate-500">
                      ${escapeHtml(it.created_at)} - ${it.divergences_count} divergencia(s)
                    </p>
                  </div>
                  <div class="flex items-center gap-2 shrink-0">
                    <a class="text-sm font-bold text-fluxo-brand hover:text-fluxo-brand2 inline-flex"
                       href="/download/${it.id}" title="Baixar Excel">${iconSvg("download")}</a>
                    <button class="text-sm font-bold text-red-600 hover:text-red-700 inline-flex"
                            data-del="${it.id}" title="Remover">${iconSvg("trash")}</button>
                  </div>
                </div>
              `
              )
              .join("")}
          </div>
        `
        : `
          <div class="mt-10 text-center text-slate-400">
            <p class="text-base">Nenhuma conciliação encontrada</p>
          </div>
        `;

      const header = recentCard.querySelector(".flex.items-center.justify-between");
      const keepHeader = header ? header.outerHTML : "";
      recentCard.innerHTML = `${keepHeader}${html}`;

      recentCard.querySelectorAll("[data-del]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = btn.getAttribute("data-del");
          if (!id) return;
          await deleteReconciliation(id);
          await loadDashboard();
          await loadReconciliations();
        });
      });
    }
  } catch (e) {
    console.warn("Dashboard não carregou:", e?.message);
  }
}

// =======================================
// lista conciliações (view)
// =======================================
async function loadReconciliations() {
  try {
    const r = await fetch("/api/reconciliations");
    if (!r.ok) return;
    const data = await r.json();
    const items = data.items || [];

    const container = document.querySelector("#view-conciliacoes .mt-6.bg-white");
    if (!container) return;

    if (!items.length) {
      container.innerHTML = `
        <div class="text-slate-300 inline-flex">${iconSvg("file", "w-12 h-12")}</div>
        <p class="text-lg font-bold mt-4">Nenhuma conciliação ainda</p>
        <p class="text-slate-500 mt-1">Importe seus dados para começar</p>
        <button
          class="mt-6 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-fluxo-brand text-white hover:bg-fluxo-brand2 shadow"
          type="button"
          data-go="importar"
        >
          <span class="inline-flex">${iconSvg("plus")}</span>
          <span class="font-semibold">Importar Dados</span>
        </button>
      `;
      container.querySelectorAll("[data-go]").forEach((el) => {
        el.addEventListener("click", () => showView(el.getAttribute("data-go")));
      });
      return;
    }

    container.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <div>
          <p class="text-sm text-slate-500">Total no histórico</p>
          <p class="text-2xl font-extrabold">${items.length}</p>
        </div>
        <button
          class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-fluxo-brand text-white hover:bg-fluxo-brand2 shadow"
          type="button"
          data-go="importar"
        >
          <span class="inline-flex">${iconSvg("plus")}</span>
          <span class="font-semibold">Nova Conciliação</span>
        </button>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-slate-500">
              <th class="py-2">Nome</th>
              <th class="py-2">Data</th>
              <th class="py-2">Divergências</th>
              <th class="py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            ${items
              .map(
                (it) => `
              <tr class="border-t border-slate-200 hover:bg-slate-50">
                <td class="py-3 font-bold">${escapeHtml(it.name)}</td>
                <td class="py-3 text-slate-600">${escapeHtml(it.created_at)}</td>
                <td class="py-3 ${
                  it.has_divergences ? "text-red-600 font-bold" : "text-emerald-600 font-bold"
                }">
                  ${it.divergences_count}
                </td>
                <td class="py-3">
                  <div class="flex items-center justify-end gap-3">
                    <a href="/download/${it.id}" title="Baixar Excel" class="text-slate-600 hover:text-slate-900 inline-flex">${iconSvg("download")}</a>
                    <button data-open="${it.id}" title="Ver detalhes" class="text-slate-600 hover:text-slate-900 inline-flex">${iconSvg("eye")}</button>
                    <button data-del="${it.id}" title="Remover" class="text-red-600 hover:text-red-700 inline-flex">${iconSvg("trash")}</button>
                  </div>
                </td>
              </tr>
            `
              )
              .join("")}
          </tbody>
        </table>
      </div>

      <div id="detailsModalRoot"></div>
    `;

    container.querySelectorAll("[data-go]").forEach((el) => {
      el.addEventListener("click", () => showView(el.getAttribute("data-go")));
    });

    container.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-del");
        if (!id) return;
        await deleteReconciliation(id);
        await loadReconciliations();
        await loadDashboard();
      });
    });

    container.querySelectorAll("[data-open]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-open");
        if (!id) return;
        await openDetailsModal(id);
      });
    });
  } catch (e) {
    console.warn("Conciliações não carregou:", e?.message);
  }
}

async function deleteReconciliation(id) {
  try {
    await fetch(`/api/reconciliations/${id}`, { method: "DELETE" });
  } catch (e) {
    console.warn("Falha ao remover:", e?.message);
  }
}

async function openDetailsModal(id) {
  const root =
    document.getElementById("detailsModalRoot") ||
    document.querySelector("#view-conciliacoes #detailsModalRoot");

  if (!root) return;

  try {
    const r = await fetch(`/api/reconciliations/${id}`);
    const data = await r.json();
    const it = data.item;

    const csv = (it?.divergences_csv || "").trim();
    const lines = csv ? csv.split(/\r?\n/).slice(0, 50) : [];
    const preview = lines.length
      ? `
        <div class="mt-4 border border-slate-200 rounded-xl overflow-hidden">
          <div class="px-4 py-2 bg-slate-50 text-slate-700 text-xs font-bold">
            Preview divergências (até 50 linhas)
          </div>
          <pre class="p-4 text-xs overflow-auto max-h-72 bg-white">${escapeHtml(
            lines.join("\n")
          )}</pre>
        </div>
      `
      : `
        <div class="mt-4 text-sm text-slate-500">
          Sem divergências (ou CSV não salvo).
        </div>
      `;

    root.innerHTML = `
      <div class="fixed inset-0 z-50 bg-black/40 flex items-center justify-center px-3">
        <div class="w-full max-w-3xl bg-white rounded-2xl shadow-soft border border-slate-200 p-5">
          <div class="flex items-start justify-between gap-3">
            <div>
              <p class="text-xs text-slate-500">Detalhes da conciliação</p>
              <h3 class="text-xl font-extrabold">${escapeHtml(it.name)}</h3>
              <p class="text-sm text-slate-500 mt-1">
                ${escapeHtml(it.created_at)} - ${it.divergences_count} divergencia(s)
              </p>
              <p class="text-xs text-slate-500 mt-2">
                DOC1: ${escapeHtml(it.extrato_original || "-")}<br/>
                DOC2: ${escapeHtml(it.controle_original || "-")}<br/>
                DOC3: ${escapeHtml(it.duplicatas_original || "não enviado")}
              </p>
            </div>
            <button id="closeDetails" class="text-slate-500 hover:text-slate-900 text-xl">x</button>
          </div>

          <div class="mt-4 flex items-center justify-end gap-3">
            <a class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-fluxo-brand text-white hover:bg-fluxo-brand2 shadow"
               href="/download/${it.id}">
              ${iconSvg("download")} Baixar Excel
            </a>
          </div>

          ${preview}
        </div>
      </div>
    `;

    document.getElementById("closeDetails")?.addEventListener("click", () => {
      root.innerHTML = "";
    });
  } catch (e) {
    console.warn("Falha abrir detalhes:", e?.message);
  }
}

// init
(async () => {
  await loadMe();
  await showView("dashboard");
})();
