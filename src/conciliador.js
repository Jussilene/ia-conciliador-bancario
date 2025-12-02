// src/conciliador.js
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import pdfParse from "pdf-parse";
import { fileURLToPath } from "url";
import { openai } from "./openaiClient.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Normaliza caminhos (aceita string ou array).
 */
function normalizarCaminhos(caminhos) {
  if (!caminhos) return [];
  if (Array.isArray(caminhos)) return caminhos.filter(Boolean);
  return [caminhos];
}

/**
 * Lê um arquivo (PDF, Excel, TXT, CSV) e devolve TEXTO pronto pra IA.
 */
async function lerArquivoGenerico(caminho, label = "DOC") {
  console.log(`📁 [GEN] Lendo ${label}: ${caminho}`);

  if (!fs.existsSync(caminho)) {
    throw new Error(`Arquivo não encontrado: ${caminho}`);
  }

  const buffer = fs.readFileSync(caminho);
  const ext = (path.extname(caminho) || "").toLowerCase();
  const magic = buffer.slice(0, 5).toString(); // ex: "%PDF-"

  // ===== PDF (texto ou imagem) =====
  if (ext === ".pdf" || magic.startsWith("%PDF")) {
    console.log(`📑 [${label}] Detectado PDF – usando pdf-parse…`);
    try {
      const data = await pdfParse(buffer);
      const texto = (data.text || "").trim();
      console.log(
        `🔎 [${label}] Preview texto PDF:\n` +
          texto.slice(0, 600) +
          "\n--- FIM PREVIEW ---\n"
      );
      return texto;
    } catch (err) {
      console.error(
        `[${label}] Erro ao ler PDF com pdf-parse:`,
        err.message
      );
      // fallback: devolve string bruta (não é o ideal, mas evita quebrar)
      const textoBruto = buffer.toString("utf8");
      console.log(
        `⚠️ [${label}] Usando fallback de texto bruto do PDF (tamanho ${textoBruto.length}).`
      );
      return textoBruto;
    }
  }

  // ===== Excel (.xlsx / .xls) =====
  if (ext === ".xlsx" || ext === ".xls") {
    console.log(`📊 [${label}] Detectado Excel – usando xlsx…`);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Converte a 1ª aba pra CSV de texto, que a IA entende muito bem
    const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ";", RS: "\n" });
    console.log(
      `🔎 [${label}] Preview texto Excel:\n` +
        csv.slice(0, 600) +
        "\n--- FIM PREVIEW ---\n"
    );
    return csv;
  }

  // ===== TXT / CSV / outros textos =====
  const texto = buffer.toString("utf8");
  console.log(
    `📄 [${label}] TXT/CSV (ou fallback texto) – tamanho ${texto.length}`
  );
  console.log(
    `🔎 [${label}] Preview texto:\n` +
      texto.slice(0, 600) +
      "\n--- FIM PREVIEW ---\n"
  );
  return texto;
}

/**
 * Lê vários arquivos (string ou array) e concatena o texto.
 */
async function lerVariosArquivosComoTexto(caminhos, labelBase) {
  const lista = normalizarCaminhos(caminhos);
  if (lista.length === 0) return "";

  let textoFinal = "";
  for (let i = 0; i < lista.length; i++) {
    const caminho = lista[i];
    const label = `${labelBase}_${i + 1}`;
    const t = await lerArquivoGenerico(caminho, label);
    textoFinal += `\n\n===== INÍCIO ${label} =====\n\n${t}`;
  }
  return textoFinal.trim();
}

/**
 * Limita o texto para não estourar os limites de tokens da OpenAI.
 * maxChars ~ 60.000 ≈ ~15k tokens (aproximado).
 */
function limitarTextoParaIA(texto, maxChars, nomeDoc) {
  if (!texto) return "";
  if (texto.length <= maxChars) return texto;

  console.log(
    `⚠️ ${nomeDoc} muito grande (${texto.length} caracteres). ` +
      `Será truncado para ${maxChars} caracteres para não estourar tokens.`
  );

  return (
    texto.slice(0, maxChars) +
    `\n\n[AVISO: Conteúdo truncado automaticamente para caber no limite da IA.]`
  );
}

/**
 * Limpa e extrai só o bloco CSV do texto retornado pela IA.
 */
function extrairBlocoCsv(texto) {
  if (!texto) return "";

  // Se vier entre ```csv ... ```
  const cercado = texto.match(/```(?:csv)?([\s\S]*?)```/i);
  if (cercado) {
    texto = cercado[1];
  }

  // Força a começar no cabeçalho esperado
  const headerRegex =
    /^Data;Valor;Descrição Doc1;Descrição Doc2;Documento de Origem.*$/m;
  const m = texto.match(headerRegex);
  if (m && typeof m.index === "number") {
    texto = texto.slice(m.index);
  }

  return texto.trim();
}

/**
 * Chama a IA pra gerar um CSV de divergências (formato Ronaldo).
 */
async function gerarCsvDivergenciasComIA(
  extratoTexto,
  controleTexto,
  duplicatasTexto
) {
  console.log("🧠 Chamando a IA para gerar o CSV de divergências…");

  const systemPrompt = `
Você é um especialista em conciliação bancária extremamente rigoroso.

Sua tarefa:
- Comparar o EXTRATO BANCÁRIO (DOC1) com o CONTROLE INTERNO / RAZÃO (DOC2).
- Opcionalmente usar o arquivo de DUPLICATAS (DOC3) apenas para enriquecer descrições.

REGRAS DE CONCILIAÇÃO (SEJA MUITO RÍGIDO):
- Considere como "mesmo lançamento" somente quando DATA (dd/mm/aaaa) e VALOR são exatamente iguais.
- Se a data e o valor forem iguais em DOC1 e DOC2, considere o lançamento conciliado (NÃO é divergência), mesmo que o texto da descrição seja um pouco diferente.
- Só gere divergência se:
  * existir em DOC1 e não existir nenhuma linha correspondente em DOC2 com a mesma DATA e VALOR; ou
  * existir em DOC2 e não existir nenhuma linha correspondente em DOC1 com a mesma DATA e VALOR; ou
  * existir em ambos, mas com mesma DATA e descrições semelhantes, porém VALORES diferentes.
- NÃO invente divergências. Se estiver em dúvida se é ou não divergência, considere como conciliado e NÃO inclua no CSV.

PREENCHIMENTO INTELIGENTE DAS DESCRIÇÕES:
- Descrição Doc1:
    - Se o lançamento existir em DOC1, use a melhor descrição possível a partir de DOC1.
    - Se o lançamento não existir em DOC1 (só existe em DOC2), preencha com: "Não consta no extrato bancário (DOC1)".
- Descrição Doc2:
    - Se o lançamento existir em DOC2, use a melhor descrição possível a partir de DOC2.
    - Se o lançamento não existir em DOC2 (só existe em DOC1), preencha com: "Não consta no controle interno (DOC2)".

Documento de Origem:
- "DOC1" se só existe no extrato.
- "DOC2" se só existe no controle interno.
- "AMBOS" se existe nos dois, mas há diferença de valor ou de tipo.

Formato de saída OBRIGATÓRIO (CSV, separado por ponto e vírgula):
A PRIMEIRA LINHA deve ser exatamente:
Data;Valor;Descrição Doc1;Descrição Doc2;Documento de Origem

Cada linha seguinte representa UMA divergência:
- Data: data do lançamento divergente (dd/mm/aaaa).
- Valor: valor do lançamento divergente com vírgula como separador decimal (ex: 1.234,56), sem "D" ou "C".
- Descrição Doc1: conforme regra acima.
- Descrição Doc2: conforme regra acima.
- Documento de Origem: "DOC1", "DOC2" ou "AMBOS".

NÃO inclua comentários, cabeçalhos extras ou texto fora do CSV.
Se não houver divergências, retorne apenas a linha de cabeçalho.
`.trim();

  const userPrompt = `
[DOC1 - EXTRATO BANCÁRIO]
${extratoTexto}

[DOC2 - CONTROLE INTERNO / RAZÃO]
${controleTexto}

${
  duplicatasTexto
    ? `[DOC3 - RELATÓRIO DE DUPLICATAS]
${duplicatasTexto}`
    : ""
}

Siga rigorosamente as regras e gere o CSV de divergências no formato especificado.
`.trim();

  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }],
      },
      {
        role: "user",
        content: [{ type: "input_text", text: userPrompt }],
      },
    ],
  });

  const textoSaida = response.output[0]?.content[0]?.text || "";
  const csvLimpo = extrairBlocoCsv(textoSaida);

  console.log(
    "✅ CSV recebido da IA (preview):\n" +
      csvLimpo.slice(0, 400) +
      "\n--- FIM PREVIEW CSV ---\n"
  );

  return csvLimpo;
}

/**
 * Converte o CSV (texto) em matriz (array de arrays) para gerar o Excel.
 * Garante SEMPRE 5 colunas e preenche descrições de forma inteligente.
 */
function csvParaMatriz(csvTexto) {
  const linhas = csvTexto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (linhas.length === 0) {
    // Garante pelo menos o cabeçalho
    return [
      [
        "Data",
        "Valor",
        "Descrição Doc1",
        "Descrição Doc2",
        "Documento de Origem",
      ],
    ];
  }

  const matriz = linhas.map((linha, idx) => {
    let cols = linha.split(";").map((c) => c.trim());

    // Cabeçalho: só forçamos o tamanho, não mexemos no texto
    if (idx === 0) {
      while (cols.length < 5) cols.push("");
      return cols.slice(0, 5);
    }

    // Linhas de dados: garantir 5 colunas
    while (cols.length < 5) cols.push("");
    if (cols.length > 5) {
      const extras = cols.splice(5);
      // Junta qualquer coisa que sobrou na descrição do DOC2
      cols[3] = `${cols[3]} ${extras.join(" ")}`.trim();
    }

    // Preenchimento inteligente das descrições se a IA deixou vazio
    const docOrigem = (cols[4] || "").toUpperCase();

    if (!cols[2]) {
      if (docOrigem === "DOC2") {
        cols[2] = "Não consta no extrato bancário (DOC1)";
      } else {
        cols[2] = "—";
      }
    }

    if (!cols[3]) {
      if (docOrigem === "DOC1") {
        cols[3] = "Não consta no controle interno (DOC2)";
      } else {
        cols[3] = "—";
      }
    }

    return cols.slice(0, 5);
  });

  // Remove linhas duplicadas de divergência (se a IA repetir algo)
  const header = matriz[0];
  const dados = matriz.slice(1);
  const vistos = new Set();
  const deduplicados = [];

  for (const row of dados) {
    const key = row.join("|").toLowerCase();
    if (vistos.has(key)) continue;
    vistos.add(key);
    deduplicados.push(row);
  }

  return [header, ...deduplicados];
}

/**
 * Função principal chamada pelo server.js
 * Aceita string OU array de caminhos para cada documento.
 */
export async function rodarConciliacao(
  caminhosExtrato,
  caminhosControle,
  caminhosDuplicatas // opcional
) {
  console.log(
    "🔄 Iniciando conciliação (com IA + leitura universal + múltiplos arquivos)…"
  );

  // 1) Ler arquivos como texto (universal + múltiplos)
  let extratoTexto = await lerVariosArquivosComoTexto(
    caminhosExtrato,
    "DOC1_EXTRATO"
  );
  let controleTexto = await lerVariosArquivosComoTexto(
    caminhosControle,
    "DOC2_CONTROLE"
  );
  let duplicatasTexto = await lerVariosArquivosComoTexto(
    caminhosDuplicatas,
    "DOC3_DUPLICATAS"
  );

  if (!duplicatasTexto) {
    console.log(
      "ℹ️ Nenhum arquivo de duplicatas enviado (isso é opcional)."
    );
  }

  // 2) Limitar tamanho pra não estourar tokens (bem conservador)
  const MAX_CHARS = 60000; // por documento
  extratoTexto = limitarTextoParaIA(extratoTexto, MAX_CHARS, "DOC1_EXTRATO");
  controleTexto = limitarTextoParaIA(
    controleTexto,
    MAX_CHARS,
    "DOC2_CONTROLE"
  );
  if (duplicatasTexto) {
    duplicatasTexto = limitarTextoParaIA(
      duplicatasTexto,
      MAX_CHARS,
      "DOC3_DUPLICATAS"
    );
  }

  // 🔧 Normalização simples de espaços para evitar ruídos
  extratoTexto = extratoTexto.replace(/\s+/g, " ");
  controleTexto = controleTexto.replace(/\s+/g, " ");
  if (duplicatasTexto) {
    duplicatasTexto = duplicatasTexto.replace(/\s+/g, " ");
  }

  // 3) IA gera o CSV de divergências
  const csvDivergencias = await gerarCsvDivergenciasComIA(
    extratoTexto,
    controleTexto,
    duplicatasTexto || null
  );

  // 4) CSV → matriz para planilha
  const matriz = csvParaMatriz(csvDivergencias);

  const totalDivergencias = matriz.length > 1 ? matriz.length - 1 : 0;
  const temDivergencias = totalDivergencias > 0;

  console.log(
    `📊 Total de divergências apontadas pela IA: ${totalDivergencias}`
  );

  // 5) Gerar Excel
  const planilha = XLSX.utils.aoa_to_sheet(matriz);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, planilha, "Divergencias");

  const outputPath = path.join(
    __dirname,
    "..",
    "uploads",
    "conciliacao_divergencias.xlsx"
  );

  XLSX.writeFile(workbook, outputPath);
  console.log("✅ Excel criado em:", outputPath);

  // 6) Retorno pro server.js
  return {
    outputPath,
    temDivergencias,
    totalDivergencias,
  };
}
