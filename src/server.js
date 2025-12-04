// src/server.js
import express from "express";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { rodarConciliacao } from "./conciliador.js";
import fs from "fs";
import { openai } from "./openaiClient.js"; // USA O MESMO CLIENTE DA CONCILIAÇÃO

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Para ler JSON do chat-ia
app.use(express.json());

// Pasta de uploads
const uploadDir = path.join(__dirname, "..", "uploads");

// garante que a pasta existe
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer salvando os arquivos na pasta uploads/
const upload = multer({
  dest: uploadDir,
});

// servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, "..", "public")));

// servir os arquivos gerados (Excel) pela rota /uploads
app.use("/uploads", express.static(uploadDir));

// rota da página inicial
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// ==============================
// ROTA DO CHAT IA (OpenAI)
// ==============================
app.post("/chat-ia", async (req, res) => {
  try {
    const pergunta = (req.body?.pergunta || "").toString().trim();

    if (!pergunta) {
      return res.json({
        reply:
          "Pode me perguntar qualquer coisa sobre conciliação bancária, DOC1, DOC2 ou DOC3. 🙂",
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
    res.status(500).json({
      reply: null,
    });
  }
});

// ==============================
// ROTA DE CONCILIAÇÃO
// ==============================
app.post(
  "/conciliar",
  upload.fields([
    { name: "extrato", maxCount: 10 }, // já aceitava múltiplos
    { name: "controle", maxCount: 10 }, // agora também aceita vários
    { name: "duplicatas", maxCount: 10 }, // idem
  ]),
  async (req, res) => {
    try {
      // ainda usamos apenas o PRIMEIRO de cada lista, para não mexer na lógica
      const extratoFile = req.files?.extrato?.[0];
      const controleFile = req.files?.controle?.[0];
      const duplicatasFile = req.files?.duplicatas?.[0];

      // 🔴 ERRO: faltou algum arquivo obrigatório
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

      console.log("📎 Arquivo extrato (usando o primeiro):", extratoFile.path);
      console.log("📎 Arquivo controle:", controleFile.path);

      if (duplicatasFile) {
        console.log("📎 Arquivo duplicatas:", duplicatasFile.path);
      } else {
        console.log("ℹ️ Nenhum arquivo de duplicatas enviado.");
      }

      // chama a função de conciliação
      const {
        outputPath,
        temDivergencias,
        totalDivergencias,
      } = await rodarConciliacao(
        extratoFile.path,
        controleFile.path,
        duplicatasFile ? duplicatasFile.path : undefined
      );

      const fileName = path.basename(outputPath);

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

      // ✅ SUCESSO: mesma lógica, visual bonito
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
                <strong>controle interno</strong>${duplicatasFile
                  ? " e usou o arquivo de <strong>duplicatas</strong> para enriquecer as descrições."
                  : "."}
              </p>
              <p>
                O arquivo abaixo contém apenas os lançamentos divergentes.
              </p>

              ${mensagemResultadoHtml}

              <div class="file-box">
                <span>Relatório gerado</span>
                <strong>${fileName}</strong>
              </div>

              <a
                href="/uploads/${fileName}"
                class="download-btn"
                download
              >
                ⬇️ Baixar Excel de divergências
              </a>

              <a href="/" class="secondary-btn">
                ⟵ Fazer outra conciliação
              </a>

              <small>IA Conciliador Bancário &middot; Versão demo para testes internos</small>
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
