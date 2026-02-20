const form = document.getElementById("loginForm");
const msg = document.getElementById("msg");
const togglePass = document.getElementById("togglePass");

const forgotBtn = document.getElementById("forgotBtn");
const forgotModal = document.getElementById("forgotModal");
const forgotClose = document.getElementById("forgotClose");
const forgotSend = document.getElementById("forgotSend");
const forgotEmail = document.getElementById("forgotEmail");
const forgotMsg = document.getElementById("forgotMsg");
const forgotResult = document.getElementById("forgotResult");
const forgotLink = document.getElementById("forgotLink");

// ✅ Olhinho (troca type + alterna os SVGs)
togglePass?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();

  const input = document.getElementById("password");
  if (!input) return;

  const eyeOpen = document.getElementById("eyeOpen");
  const eyeClosed = document.getElementById("eyeClosed");

  const show = input.type === "password";
  input.type = show ? "text" : "password";

  if (eyeOpen && eyeClosed) {
    eyeOpen.classList.toggle("hidden", show);
    eyeClosed.classList.toggle("hidden", !show);
  }
});

function showError(el, text) {
  el.textContent = text;
  el.classList.remove("hidden");
}

function hideError(el) {
  el.classList.add("hidden");
  el.textContent = "";
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideError(msg);

  const email = document.getElementById("email")?.value || "";
  const password = document.getElementById("password")?.value || "";
  const remember = !!document.getElementById("remember")?.checked;

  try {
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, remember }),
    });
    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      showError(msg, data?.error || "Falha ao entrar.");
      return;
    }

    window.location.href = "/";
  } catch (err) {
    showError(msg, "Erro de rede. Tente novamente.");
  }
});

forgotBtn?.addEventListener("click", () => {
  forgotModal.classList.remove("hidden");
  forgotModal.classList.add("flex");
  forgotEmail.value = document.getElementById("email")?.value || "";
  hideError(forgotMsg);
  forgotResult.classList.add("hidden");
});

forgotClose?.addEventListener("click", () => {
  forgotModal.classList.add("hidden");
  forgotModal.classList.remove("flex");
});

forgotModal?.addEventListener("click", (e) => {
  if (e.target === forgotModal) {
    forgotModal.classList.add("hidden");
    forgotModal.classList.remove("flex");
  }
});

forgotSend?.addEventListener("click", async () => {
  hideError(forgotMsg);
  forgotResult.classList.add("hidden");

  const email = (forgotEmail.value || "").trim();
  if (!email) {
    showError(forgotMsg, "Informe um e-mail.");
    return;
  }

  try {
    const r = await fetch("/api/auth/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      showError(forgotMsg, data?.error || "Falha ao gerar link.");
      return;
    }

    forgotResult.classList.remove("hidden");
    forgotLink.textContent = data.resetUrl;
    forgotLink.href = data.resetUrl;
  } catch {
    showError(forgotMsg, "Erro de rede. Tente novamente.");
  }
});