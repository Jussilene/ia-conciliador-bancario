// src/server.js
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { rodarConciliacao } from "./conciliador.js";
import fs from "fs";
import { openai } from "./openaiClient.js";

import session from "express-session";
import bcrypt from "bcryptjs";

import { initDb } from "./db.js";
import {
  createReconciliation,
  listReconciliations,
  getReconciliationById,
  deleteReconciliationById,
  getDashboardStats,
} from "./repo/reconciliationsRepo.js";

// ✅ usa seu repo/auth do SQLite (sem mudar o que já funciona)
import {
  getUserByEmail,
  createUser as createUserDb,
  listUsers as listUsersDb,
  updateUserStatus,
  updateUserPasswordHash,
  updateUserName,
  updateUserEmail,
  setResetToken,
  getUserByResetToken,
  clearResetToken,
  deleteUserById,
  getUserById,
} from "./repo/usersRepo.js";

import {
  hashPassword,
  verifyPassword,
  requireAdmin as requireAdminFromAuth,
  makeResetToken,
} from "./auth.js";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==============================
// ✅ LOGIN (SESSÃO) - ADICIONADO
// ==============================
app.use(
  session({
    name: "concilia.sid",
    secret: process.env.SESSION_SECRET || "troque_isso_por_algo_grande",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // quando tiver HTTPS -> true
      maxAge: 1000 * 60 * 60 * 8, // 8 horas
    },
  })
);

// ✅ Middlewares de proteção (mínimo, sem mexer no resto)
function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.redirect("/login");
}

function requireApiAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: "Não autenticado" });
}

// ✅ ADMIN (mantém compatível com seu auth.js)
function requireAdminApi(req, res, next) {
  // tenta usar o requireAdmin do auth.js (mesma regra)
  try {
    return requireAdminFromAuth(req, res, next);
  } catch {
    const u = req.session?.user;
    if (u?.role === "ADMIN") return next();
    return res.status(403).json({ error: "Apenas ADMIN" });
  }
}

// ==============================
// ✅ Helpers antigos (NÃO APAGUEI) - mas agora o login usa SQLite
// ==============================
const usersDbPath = path.join(__dirname, "..", "data", "users.json");

function readUsers() {
  try {
    if (!fs.existsSync(usersDbPath)) return [];
    const raw = fs.readFileSync(usersDbPath, "utf8");
    const data = JSON.parse(raw || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeUsers(users) {
  fs.mkdirSync(path.dirname(usersDbPath), { recursive: true });
  fs.writeFileSync(usersDbPath, JSON.stringify(users, null, 2), "utf8");
}

function ensureAdminUser() {
  const adminEmail = (process.env.ADMIN_EMAIL || "").toLowerCase().trim();
  const adminPass = String(process.env.ADMIN_PASSWORD || "").trim();
  const adminName = String(process.env.ADMIN_NAME || "Admin").trim();

  if (!adminEmail || !adminPass) {
    console.warn("⚠️ ADMIN_EMAIL/ADMIN_PASSWORD não configurados no .env. Login não funcionará.");
    return;
  }

  const users = readUsers();
  const exists = users.find((u) => (u.email || "").toLowerCase() === adminEmail);

  if (!exists) {
    const password_hash = bcrypt.hashSync(adminPass, 10);
    users.push({
      id: Date.now(),
      name: adminName,
      email: adminEmail,
      role: "ADMIN",
      status: "ACTIVE",
      password_hash,
      created_at: new Date().toISOString(),
    });
    writeUsers(users);
    console.log("✅ Admin (LEGADO) criado em data/users.json:", adminEmail);
  } else {
    console.log("ℹ️ Admin (LEGADO) já existe:", adminEmail);
  }
}

// cria admin legado (não apaga)
ensureAdminUser();

// ==============================
// ✅ Rotas de páginas do login (servir HTML estático)
// ==============================
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "login.html"));
});

// ✅ NOVO: página de redefinir senha (reset.html)
app.get("/reset", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "reset.html"));
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// ==============================
// ✅ APIs de auth (AJUSTADO: agora usa SQLite)
// ==============================

// ✅ requerido no seu pedido
app.get("/api/me", requireApiAuth, (req, res) => {
  res.json({ user: req.session.user });
});

// ✅ mantém sua rota existente (front já usa)
app.post("/api/auth/login", (req, res) => {
  try {
    const email = String(req.body?.email || "").toLowerCase().trim();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Informe e-mail e senha." });
    }

    // ✅ login oficial pelo SQLite
    const user = getUserByEmail(email);

    if (!user) {
      return res.status(401).json({ error: "E-mail ou senha inválidos." });
    }

    if (String(user.status) !== "ACTIVE") {
      return res.status(403).json({ error: "Conta inativa." });
    }

    const ok = verifyPassword(password, user.password_hash || "");
    if (!ok) return res.status(401).json({ error: "E-mail ou senha inválidos." });

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
    };

    return res.json({ ok: true, user: req.session.user });
  } catch (err) {
    console.error("Erro /api/auth/login:", err);
    return res.status(500).json({ error: "Erro ao entrar." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ✅ requerido no seu pedido (alias)
app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ✅ NOVO: ESQUECI A SENHA (gera link /reset?token=...)
// OBS: por enquanto retorna o link (para você testar). Depois você troca pra enviar por e-mail.
app.post("/api/auth/forgot", async (req, res) => {
  try {
    const email = String(req.body?.email || "").toLowerCase().trim();
    if (!email) return res.status(400).json({ error: "Informe um e-mail." });

    const user = getUserByEmail(email);
    if (!user) {
      // não revela se existe ou não
      return res.json({ ok: true, resetUrl: "" });
    }

    const token = makeResetToken();
    const expires = new Date(Date.now() + 1000 * 60 * 30).toISOString(); // 30 min

    setResetToken(email, token, expires);

    // gera URL absoluta simples
    const base = `${req.protocol}://${req.get("host")}`;
    const resetUrl = `${base}/reset?token=${encodeURIComponent(token)}`;

    return res.json({ ok: true, resetUrl });
  } catch (err) {
    console.error("Erro /api/auth/forgot:", err);
    return res.status(500).json({ error: "Falha ao gerar link." });
  }
});

// ✅ NOVO: REDEFINIR SENHA pelo token
app.post("/api/auth/reset", async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    const newPassword = String(req.body?.newPassword || "").trim();

    if (!token) return res.status(400).json({ error: "Token inválido." });
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "A senha deve ter pelo menos 6 caracteres." });
    }

    const user = getUserByResetToken(token);
    if (!user) return res.status(400).json({ error: "Token inválido." });

    // valida expiração
    const exp = user.reset_token_expires_at ? new Date(user.reset_token_expires_at).getTime() : 0;
    if (!exp || Date.now() > exp) {
      return res.status(400).json({ error: "Token expirado. Gere um novo link." });
    }

    updateUserPasswordHash(user.id, hashPassword(newPassword));
    clearResetToken(user.id);

    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro /api/auth/reset:", err);
    return res.status(500).json({ error: "Falha ao redefinir." });
  }
});

// ==============================
// ✅ Conta do usuário (Configurações)
// ==============================

// Trocar senha (seu app.js chama /api/account/change-password)
app.post("/api/account/change-password", requireApiAuth, async (req, res) => {
  try {
    const uid = Number(req.session.user.id);
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Informe senha atual e nova senha." });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "A nova senha deve ter pelo menos 6 caracteres." });
    }

    const user = getUserById(uid);
    if (!user) return res.status(401).json({ error: "Não autenticado" });

    const ok = verifyPassword(currentPassword, user.password_hash || "");
    if (!ok) return res.status(400).json({ error: "Senha atual incorreta." });

    updateUserPasswordHash(uid, hashPassword(newPassword));

    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro /api/account/change-password:", err);
    return res.status(500).json({ error: "Falha ao alterar senha." });
  }
});

// ✅ opcional (para quando você ajustar o modal): atualizar nome/email do próprio usuário
app.post("/api/account/update", requireApiAuth, async (req, res) => {
  try {
    const uid = Number(req.session.user.id);
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").toLowerCase().trim();

    if (!name && !email) return res.status(400).json({ error: "Nada para atualizar." });

    // se mudar email, checa duplicidade
    if (email) {
      const exists = getUserByEmail(email);
      if (exists && Number(exists.id) !== uid) {
        return res.status(400).json({ error: "E-mail já cadastrado." });
      }
      updateUserEmail(uid, email);
      req.session.user.email = email;
    }
    if (name) {
      updateUserName(uid, name);
      req.session.user.name = name;
    }

    return res.json({ ok: true, user: req.session.user });
  } catch (err) {
    console.error("Erro /api/account/update:", err);
    return res.status(500).json({ error: "Falha ao atualizar conta." });
  }
});

const uploadDir = path.join(__dirname, "..", "uploads");
const dataDir = path.join(__dirname, "..", "data");

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// ✅ initDb já cria tabela users e seed ADMIN pelo .env (do seu db.js)
initDb();

function safeName(name = "arquivo") {
  return name.replace(/[^\w.\-()\s]/g, "").replace(/\s+/g, "_").slice(0, 160);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
    const original = safeName(file.originalname || "arquivo");
    cb(null, `${unique}__${original}`);
  },
});

const upload = multer({ storage });

app.use(express.static(path.join(__dirname, "..", "public")));

// ✅ uploads protegidos (excel e arquivos)
app.use("/uploads", requireAuth, express.static(uploadDir));

// ✅ página principal protegida
app.get("/", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// ==============================
// ✅ USERS API (ADMIN) — compat com seu app.js
// ==============================

// LISTAR (ADMIN)
app.get("/api/users", requireApiAuth, requireAdminApi, (req, res) => {
  try {
    const items = listUsersDb();
    return res.json({ items });
  } catch (err) {
    console.error("Erro GET /api/users:", err);
    return res.status(500).json({ error: "Erro ao listar usuários" });
  }
});

// alias compat
app.get("/api/admin/users", requireApiAuth, requireAdminApi, (req, res) => {
  try {
    const items = listUsersDb();
    return res.json({ items });
  } catch (err) {
    console.error("Erro GET /api/admin/users:", err);
    return res.status(500).json({ error: "Erro ao listar usuários" });
  }
});

// CRIAR (ADMIN) — seu front manda tempPassword, mas aceito password também (compat)
app.post("/api/users", requireApiAuth, requireAdminApi, (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || req.body?.tempPassword || "").trim();
    const roleRaw = String(req.body?.role || "USER").toUpperCase().trim();
    const role = roleRaw === "ADMIN" ? "ADMIN" : "USER";

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Informe nome, e-mail e senha." });
    }

    const exists = getUserByEmail(email);
    if (exists) return res.status(400).json({ error: "E-mail já cadastrado." });

    const created = createUserDb({
      name,
      email,
      password_hash: hashPassword(password),
      role,
      status: "ACTIVE",
    });

    return res.json({ ok: true, id: created.id });
  } catch (err) {
    console.error("Erro POST /api/users:", err);
    return res.status(500).json({ error: "Erro ao criar usuário" });
  }
});

// alias compat
app.post("/api/admin/users", requireApiAuth, requireAdminApi, (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || req.body?.tempPassword || "").trim();
    const roleRaw = String(req.body?.role || "USER").toUpperCase().trim();
    const role = roleRaw === "ADMIN" ? "ADMIN" : "USER";

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Informe nome, e-mail e senha." });
    }

    const exists = getUserByEmail(email);
    if (exists) return res.status(400).json({ error: "E-mail já cadastrado." });

    const created = createUserDb({
      name,
      email,
      password_hash: hashPassword(password),
      role,
      status: "ACTIVE",
    });

    return res.json({ ok: true, id: created.id });
  } catch (err) {
    console.error("Erro POST /api/admin/users:", err);
    return res.status(500).json({ error: "Erro ao criar usuário" });
  }
});

// RESET PASSWORD (ADMIN) — seu front manda tempPassword; aceito password também
app.post("/api/users/:id/reset-password", requireApiAuth, requireAdminApi, (req, res) => {
  try {
    const id = Number(req.params.id);
    const newPass = String(req.body?.password || req.body?.tempPassword || "").trim();
    if (!id || !newPass) return res.status(400).json({ error: "Senha inválida." });

    updateUserPasswordHash(id, hashPassword(newPass));
    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro POST /api/users/:id/reset-password:", err);
    return res.status(500).json({ error: "Erro ao resetar senha" });
  }
});

// alias compat com seu app.js: /api/admin/users/:id/reset-password
app.post("/api/admin/users/:id/reset-password", requireApiAuth, requireAdminApi, (req, res) => {
  try {
    const id = Number(req.params.id);
    const newPass = String(req.body?.password || req.body?.tempPassword || "").trim();
    if (!id || !newPass) return res.status(400).json({ error: "Senha inválida." });

    updateUserPasswordHash(id, hashPassword(newPass));
    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro POST /api/admin/users/:id/reset-password:", err);
    return res.status(500).json({ error: "Erro ao resetar senha" });
  }
});

// ✅ NOVO: rota que seu app.js usa: PATCH /api/admin/users/:id/status body {status:"ACTIVE"/"INACTIVE"}
app.patch("/api/admin/users/:id/status", requireApiAuth, requireAdminApi, (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = String(req.body?.status || "").toUpperCase().trim();
    if (!id || (status !== "ACTIVE" && status !== "INACTIVE")) {
      return res.status(400).json({ error: "Status inválido." });
    }
    updateUserStatus(id, status);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro PATCH /api/admin/users/:id/status:", err);
    return res.status(500).json({ error: "Erro ao atualizar status" });
  }
});

// TOGGLE ACTIVE (ADMIN) — body: { active: true/false } (mantive)
app.patch("/api/users/:id/toggle", requireApiAuth, requireAdminApi, (req, res) => {
  try {
    const id = Number(req.params.id);
    const active = !!req.body?.active;
    const status = active ? "ACTIVE" : "INACTIVE";
    updateUserStatus(id, status);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro PATCH /api/users/:id/toggle:", err);
    return res.status(500).json({ error: "Erro ao atualizar status" });
  }
});

// alias compat (mantive)
app.patch("/api/admin/users/:id/toggle", requireApiAuth, requireAdminApi, (req, res) => {
  try {
    const id = Number(req.params.id);
    const active = !!req.body?.active;
    const status = active ? "ACTIVE" : "INACTIVE";
    updateUserStatus(id, status);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro PATCH /api/admin/users/:id/toggle:", err);
    return res.status(500).json({ error: "Erro ao atualizar status" });
  }
});

// ✅ NOVO: EXCLUIR USUÁRIO (ADMIN)
app.delete("/api/admin/users/:id", requireApiAuth, requireAdminApi, (req, res) => {
  try {
    const id = Number(req.params.id);
    const me = Number(req.session.user.id);

    if (!id) return res.status(400).json({ error: "ID inválido." });
    if (id === me) return res.status(400).json({ error: "Você não pode excluir a própria conta." });

    const user = getUserById(id);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado." });

    // segurança: não deixa excluir ADMIN (você pode mudar depois se quiser)
    if (String(user.role).toUpperCase() === "ADMIN") {
      return res.status(403).json({ error: "Não é permitido excluir usuários ADMIN." });
    }

    deleteUserById(id);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro DELETE /api/admin/users/:id:", err);
    return res.status(500).json({ error: "Erro ao excluir usuário" });
  }
});

// ==============================
// ROTA DO CHAT IA (OpenAI)  ✅ PROTEGIDA
// ==============================
app.post("/chat-ia", requireApiAuth, async (req, res) => {
  try {
    const pergunta = (req.body?.pergunta || "").toString().trim();

    if (!pergunta) {
      return res.json({
        reply: "Pode me perguntar qualquer coisa sobre conciliação bancária, DOC1, DOC2 ou DOC3. 🙂",
      });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: `
Você é a IA Conciliador Bancário.

Responda SEMPRE em português do Brasil, de forma didática e objetiva.
Seu foco é:

- conciliação bancária
- diferenças entre extrato bancário (DOC1) e controle interno (DOC2)
- uso opcional do arquivo de duplicatas (DOC3)
- divergências de lançamentos
- interpretação do Excel conciliacao_divergencias.xlsx

Não diga que não tem acesso aos arquivos.
Explique conceitos, boas práticas e possíveis causas de divergência.
        `,
        },
        { role: "user", content: pergunta },
      ],
    });

    const reply = completion.choices?.[0]?.message?.content || "";
    res.json({ reply });
  } catch (err) {
    console.error("Erro na rota /chat-ia:", err);
    res.status(500).json({ reply: null });
  }
});

// =====================================
// API - DASHBOARD (KPIs) ✅ PROTEGIDA
// ✅ AGORA: por usuário
// =====================================
app.get("/api/dashboard", requireApiAuth, (req, res) => {
  try {
    const uid = Number(req.session.user.id);
    const stats = getDashboardStats(uid);
    res.json(stats);
  } catch (err) {
    console.error("Erro /api/dashboard:", err);
    res.status(500).json({ error: "Erro ao carregar dashboard" });
  }
});

// =====================================
// API - LISTAR CONCILIAÇÕES ✅ PROTEGIDA
// ✅ AGORA: por usuário
// =====================================
app.get("/api/reconciliations", requireApiAuth, (req, res) => {
  try {
    const uid = Number(req.session.user.id);
    const items = listReconciliations(uid);
    res.json({ items });
  } catch (err) {
    console.error("Erro /api/reconciliations:", err);
    res.status(500).json({ error: "Erro ao listar conciliações" });
  }
});

// =====================================
// API - DETALHE ✅ PROTEGIDA
// ✅ AGORA: por usuário
// =====================================
app.get("/api/reconciliations/:id", requireApiAuth, (req, res) => {
  try {
    const uid = Number(req.session.user.id);
    const id = Number(req.params.id);
    const item = getReconciliationById(id, uid);
    if (!item) return res.status(404).json({ error: "Não encontrado" });
    res.json({ item });
  } catch (err) {
    console.error("Erro /api/reconciliations/:id:", err);
    res.status(500).json({ error: "Erro ao carregar conciliação" });
  }
});

// =====================================
// DOWNLOAD PELO ID ✅ PROTEGIDO
// ✅ AGORA: só baixa se a conciliação for do próprio user
// =====================================
app.get("/download/:id", requireAuth, (req, res) => {
  try {
    const uid = Number(req.session.user.id);
    const id = Number(req.params.id);
    const item = getReconciliationById(id, uid);
    if (!item) return res.status(404).send("Não encontrado");

    const filePath = path.join(uploadDir, item.output_filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send("Arquivo não encontrado no servidor");
    }
    return res.download(filePath, item.output_filename);
  } catch (err) {
    console.error("Erro /download/:id:", err);
    res.status(500).send("Erro no download");
  }
});

// =====================================
// REMOVER CONCILIAÇÃO ✅ PROTEGIDO
// ✅ AGORA: por usuário
// =====================================
app.delete("/api/reconciliations/:id", requireApiAuth, (req, res) => {
  try {
    const uid = Number(req.session.user.id);
    const id = Number(req.params.id);
    const item = getReconciliationById(id, uid);
    if (!item) return res.status(404).json({ error: "Não encontrado" });

    const excelPath = path.join(uploadDir, item.output_filename || "");
    if (item.output_filename && fs.existsSync(excelPath)) {
      fs.unlinkSync(excelPath);
    }

    const filesToDelete = [item.extrato_saved_path, item.controle_saved_path, item.duplicatas_saved_path].filter(Boolean);

    for (const f of filesToDelete) {
      try {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      } catch (e) {
        console.warn("⚠️ Falha ao deletar arquivo:", f, e?.message);
      }
    }

    deleteReconciliationById(id, uid);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro DELETE /api/reconciliations/:id:", err);
    res.status(500).json({ error: "Erro ao remover conciliação" });
  }
});

// ==============================
// ROTA DE CONCILIAÇÃO ✅ PROTEGIDA
// ✅ AGORA: salva user_id na conciliação
// ==============================
app.post(
  "/conciliar",
  requireAuth,
  upload.fields([
    { name: "extrato", maxCount: 1 },
    { name: "controle", maxCount: 1 },
    { name: "duplicatas", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const extratoFile = req.files?.extrato?.[0] || null;
      const controleFile = req.files?.controle?.[0] || null;
      const duplicatasFile = req.files?.duplicatas?.[0] || null;

      const nomeConcil = (req.body?.nome_conciliacao || "").toString().trim();

      const dataInicial = (req.body?.data_inicial || "").toString().trim();
      const dataFinal = (req.body?.data_final || "").toString().trim();

      if (!extratoFile || !controleFile) {
        return res.status(400).send(`
          <!DOCTYPE html>
          <html lang="pt-BR">
          <head>
            <meta charset="UTF-8" />
            <title>Erro na conciliação</title>
            <style>
              body {
                margin: 0;
                padding: 0;
                font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                background: radial-gradient(circle at top, #1f2937, #020617 55%);
                color: #e5e7eb;
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
              }
              .card {
                background: rgba(15, 23, 42, 0.98);
                border-radius: 18px;
                padding: 32px 28px;
                box-shadow: 0 18px 45px rgba(0,0,0,0.55);
                width: min(520px, 90vw);
                border: 1px solid rgba(248, 113, 113, 0.55);
              }
              .badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 46px;
                height: 46px;
                border-radius: 999px;
                background: rgba(127, 29, 29, 0.35);
                border: 1px solid rgba(248, 113, 113, 0.9);
                margin-bottom: 16px;
                font-size: 26px;
              }
              h1 {
                margin: 0 0 8px;
                font-size: 24px;
                color: #fecaca;
              }
              p {
                margin: 6px 0;
                color: #9ca3af;
                line-height: 1.6;
                font-size: 14px;
              }
              a.button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                margin-top: 20px;
                padding: 10px 18px;
                border-radius: 999px;
                border: 1px solid rgba(148,163,184,0.5);
                color: #e5e7eb;
                text-decoration: none;
                font-size: 14px;
                gap: 8px;
              }
              a.button:hover {
                border-color: #fca5a5;
                color: #fee2e2;
              }
            </style>
          </head>
          <body>
            <div class="card">
              <div class="badge">⚠️</div>
              <h1>Arquivos insuficientes</h1>
              <p>Para iniciar a conciliação, é obrigatório enviar:</p>
              <p>
                • <strong>Extrato bancário (DOC1)</strong><br/>
                • <strong>Controle interno (DOC2)</strong>
              </p>
              <p>O arquivo de <strong>duplicatas (DOC3)</strong> é opcional.</p>
              <a href="/" class="button">⟵ Voltar e selecionar os arquivos</a>
            </div>
          </body>
          </html>
        `);
      }

      console.log("📎 Extrato (DOC1):", extratoFile.path, "| original:", extratoFile.originalname);
      console.log("📎 Controle (DOC2):", controleFile.path, "| original:", controleFile.originalname);
      if (duplicatasFile) {
        console.log("📎 Duplicatas (DOC3):", duplicatasFile.path, "| original:", duplicatasFile.originalname);
      } else {
        console.log("ℹ️ Nenhum arquivo de duplicatas enviado.");
      }

      if (dataInicial || dataFinal) {
        console.log("🗓️ Período recebido do form:", { dataInicial, dataFinal });
      } else {
        console.log("🗓️ Período não informado. Usará período automático do extrato (DOC1).");
      }

      const finalName =
        nomeConcil ||
        `Conciliação ${new Date().toLocaleDateString("pt-BR")} ${new Date()
          .toLocaleTimeString("pt-BR")
          .slice(0, 5)}`;

      const uniqueExcelName = `conciliacao_${Date.now()}_${Math.round(Math.random() * 1e9)}.xlsx`;

      const {
        outputPath,
        temDivergencias,
        totalDivergencias,
        csvDivergencias,

        // ✅ NOVO: métricas
        doc1_count,
        doc2_count,
        transacoes_count,
        matches_count,
        volume_doc1_abs_centavos,
        volume_doc1_liquido_centavos,
      } = await rodarConciliacao(
        extratoFile.path,
        controleFile.path,
        duplicatasFile ? duplicatasFile.path : undefined,
        {
          outputFileName: uniqueExcelName,
          dataInicial: dataInicial || undefined,
          dataFinal: dataFinal || undefined,
        }
      );

      const fileName = path.basename(outputPath);

      const created = createReconciliation({
        name: finalName,
        extrato_original: extratoFile.originalname,
        controle_original: controleFile.originalname,
        duplicatas_original: duplicatasFile?.originalname || null,
        extrato_saved_path: extratoFile.path,
        controle_saved_path: controleFile.path,
        duplicatas_saved_path: duplicatasFile?.path || null,
        output_filename: fileName,
        divergences_count: totalDivergencias,
        has_divergences: temDivergencias ? 1 : 0,
        status: "concluida",
        divergences_csv: csvDivergencias || "",

        // ✅ salva KPIs reais
        doc1_count,
        doc2_count,
        transacoes_count,
        matches_count,
        volume_doc1_abs_centavos,
        volume_doc1_liquido_centavos,

        // ✅ isola por usuário
        user_id: Number(req.session.user.id),
      });

      const mensagemResultadoHtml = temDivergencias
        ? `
              <p style="margin: 8px 0 6px; color: #bbf7d0; font-size: 14px;">
                <strong>Resultado:</strong> Foram encontradas
                <strong>${totalDivergencias}</strong> divergência(s) entre o extrato e o controle interno.
              </p>
              <p style="margin: 4px 0 10px; color: #9ca3af; font-size: 13px;">
                Recomenda-se baixar o Excel abaixo e seguir linha a linha para ajuste contábil.
              </p>
        `
        : `
              <p style="margin: 8px 0 6px; color: #fde68a; font-size: 14px;">
                <strong>Resultado:</strong> Nenhuma divergência foi encontrada entre o extrato e o controle interno.
              </p>
              <p style="margin: 4px 0 10px; color: #9ca3af; font-size: 13px;">
                O arquivo Excel gerado está <strong>em branco (apenas com o cabeçalho)</strong>.
                Você só precisa baixá-lo se quiser manter um registro formal dessa conciliação sem divergências.
              </p>
        `;

      res.send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
          <meta charset="UTF-8" />
          <title>Conciliação concluída</title>
          <style>
            body {
              margin: 0;
              padding: 0;
              font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              background: radial-gradient(circle at top, #1f2937, #020617 55%);
              color: #e5e7eb;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
            }
            .card {
              background: rgba(15, 23, 42, 0.98);
              border-radius: 18px;
              padding: 32px 28px;
              box-shadow: 0 18px 45px rgba(0,0,0,0.55);
              width: min(520px, 90vw);
              border: 1px solid rgba(34, 197, 94, 0.55);
              position: relative;
              overflow: hidden;
            }
            .card::before {
              content: "";
              position: absolute;
              inset: -80px;
              background: radial-gradient(circle at top left, rgba(34,197,94,0.12), transparent 60%);
              opacity: 0.9;
              pointer-events: none;
            }
            .content {
              position: relative;
              z-index: 1;
            }
            .badge {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              width: 46px;
              height: 46px;
              border-radius: 999px;
              background: rgba(22, 163, 74, 0.12);
              border: 1px solid rgba(34, 197, 94, 0.8);
              margin-bottom: 16px;
              font-size: 26px;
            }
            h1 {
              margin: 0 0 6px;
              font-size: 26px;
              color: #f9fafb;
            }
            p {
              margin: 6px 0;
              color: #9ca3af;
              line-height: 1.6;
              font-size: 14px;
            }
            .file-box {
              margin-top: 18px;
              padding: 10px 12px;
              border-radius: 12px;
              background: rgba(15, 23, 42, 0.9);
              border: 1px dashed rgba(148, 163, 184, 0.6);
              font-size: 13px;
              color: #cbd5f5;
            }
            .file-box span {
              display: block;
              color: #9ca3af;
              font-size: 12px;
              margin-bottom: 4px;
            }
            a.download-btn {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              margin-top: 22px;
              padding: 10px 20px;
              border-radius: 999px;
              border: none;
              cursor: pointer;
              background: linear-gradient(135deg, #22c55e, #16a34a);
              color: #0b1120;
              font-weight: 600;
              text-decoration: none;
              font-size: 14px;
              gap: 8px;
              box-shadow: 0 10px 30px rgba(34,197,94,0.35);
            }
            a.download-btn:hover {
              filter: brightness(1.04);
              box-shadow: 0 14px 34px rgba(34,197,94,0.45);
            }
            a.secondary-btn {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              margin-top: 14px;
              padding: 9px 18px;
              border-radius: 999px;
              border: 1px solid rgba(148,163,184,0.6);
              background: rgba(15,23,42,0.95);
              color: #e5e7eb;
              font-size: 13px;
              text-decoration: none;
              gap: 6px;
            }
            a.secondary-btn:hover {
              border-color: #e5e7eb;
              background: rgba(15,23,42,1);
              color: #f9fafb;
            }
            a.mini {
              display:inline-flex;
              margin-top: 10px;
              font-size: 12px;
              color:#93c5fd;
              text-decoration:none;
            }
            a.mini:hover { text-decoration: underline; }
            small {
              display: block;
              margin-top: 16px;
              font-size: 11px;
              color: #6b7280;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="content">
              <div class="badge">✅</div>
              <h1>Conciliação bancária concluída!</h1>
              <p>
                A IA comparou o <strong>extrato bancário</strong> com o
                <strong>controle interno</strong>${
                  duplicatasFile
                    ? " e usou o arquivo de <strong>duplicatas</strong> para enriquecer as descrições."
                    : "."
                }
              </p>
              <p>
                O arquivo abaixo contém apenas os lançamentos divergentes,
                organizados por data e valor, no formato combinado com o Ronaldo.
              </p>

              ${mensagemResultadoHtml}

              <div class="file-box">
                <span>Conciliação salva no histórico</span>
                <strong>${finalName}</strong>
              </div>

              <div class="file-box">
                <span>Relatório gerado</span>
                <strong>${fileName}</strong>
              </div>

              <a href="/uploads/${fileName}" class="download-btn" download>
                ⬇️ Baixar Excel de divergências
              </a>

              <a href="/download/${created.id}" class="mini">Baixar pelo ID (histórico): #${created.id}</a>

              <a href="/" class="secondary-btn">
                ⟵ Fazer outra conciliação
              </a>
            </div>
          </div>
        </body>
        </html>
      `);
    } catch (err) {
      console.error("❌ Erro na conciliação:", err);

      res.status(500).send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head>
          <meta charset="UTF-8" />
          <title>Erro na conciliação</title>
          <style>
            body {
              margin: 0;
              padding: 0;
              font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
              background: radial-gradient(circle at top, #1f2937, #020617 55%);
              color: #e5e7eb;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
            }
            .card {
              background: rgba(15, 23, 42, 0.98);
              border-radius: 18px;
              padding: 32px 28px;
              box-shadow: 0 18px 45px rgba(0,0,0,0.55);
              width: min(540px, 90vw);
              border: 1px solid rgba(248, 113, 113, 0.55);
            }
            .badge {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              width: 46px;
              height: 46px;
              border-radius: 999px;
              background: rgba(127, 29, 29, 0.35);
              border: 1px solid rgba(248, 113, 113, 0.9);
              margin-bottom: 16px;
              font-size: 26px;
            }
            h1 {
              margin: 0 0 8px;
              font-size: 24px;
              color: #fecaca;
            }
            p {
              margin: 6px 0;
              color: #9ca3af;
              line-height: 1.6;
              font-size: 14px;
            }
            code {
              font-size: 12px;
              background: rgba(15,23,42,0.9);
              padding: 6px 8px;
              border-radius: 8px;
              display: block;
              margin-top: 10px;
              border: 1px solid rgba(55, 65, 81, 0.9);
              overflow-x: auto;
              color: #e5e7eb;
            }
            a.button {
              display: inline-flex;
              align-items: center;
              justify-content: center;
              margin-top: 20px;
              padding: 10px 18px;
              border-radius: 999px;
              border: 1px solid rgba(148,163,184,0.5);
              color: #e5e7eb;
              text-decoration: none;
              font-size: 14px;
              gap: 8px;
            }
            a.button:hover {
              border-color: #fca5a5;
              color: #fee2e2;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="badge">❌</div>
            <h1>Erro ao processar os arquivos</h1>
            <p>Algo deu errado durante a conciliação.</p>
            <p>Detalhe técnico (para debug):</p>
            <code>${(err && err.message) || "Erro desconhecido"}</code>
            <p>Você pode tentar novamente ou enviar um print dessa tela para análise.</p>
            <a href="/" class="button">⟵ Voltar para tentar de novo</a>
          </div>
        </body>
        </html>
      `);
    }
  }
);

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});