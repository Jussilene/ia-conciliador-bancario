// src/parsers/extrato.js
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { cleanLine, parseDateBRToISO, parseValorBRToCentavos } from "./common.js";
import { safeExtractPdfText } from "./pdfText.js";

/**
 * Retorna array:
 * [{ dateISO, dateBR, valorCentavos, valorBR, descricao, origem:"DOC1" }]
 */
export async function parseExtrato(filePath) {
  const ext = (path.extname(filePath) || "").toLowerCase();
  const buffer = fs.readFileSync(filePath);
  const magic = buffer.slice(0, 5).toString();

  if (ext === ".xlsx" || ext === ".xls") return parseExtratoXlsx(buffer);
  if (ext === ".csv" || ext === ".txt") return parseExtratoText(buffer.toString("utf8"));

  if (ext === ".pdf" || magic.startsWith("%PDF")) {
    const text = await safeExtractPdfText(buffer, "DOC1_EXTRATO");
    return parseExtratoText(text || "");
  }

  return parseExtratoText(buffer.toString("utf8"));
}

function parseExtratoXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

  const out = [];
  for (const row of rows) {
    const cols = (row || []).map((c) => cleanLine(c));
    if (!cols.length) continue;

    const joined = cleanLine(cols.join(" "));
    for (const it of parseLinhaExtrato(joined)) out.push(it);
  }
  return out;
}

/**
 * Remove lixo típico do PDF CAIXA e "desgruda" tokens que vêm colados pelo PDF.
 * ✅ FIX PRINCIPAL: não apagar "05/08" achando que é paginação.
 */
function preprocessText(text) {
  let t = String(text || "");

  // normaliza quebras
  t = t.replace(/\r/g, "\n");
  t = t.replace(/\n{2,}/g, "\n");

  // remove URLs inteiras
  t = t.replace(/https?:\/\/\S+/gi, " ");

  // remove qualquer hdn...=dd/mm/aaaa (com ou sem &)
  t = t.replace(/&?hdn[a-z0-9_]+=\d{2}\/\d{2}\/\d{4}/gi, " ");

  // ✅ REMOÇÃO DE PAGINAÇÃO (SEGURA):
  // remove somente LINHAS que são só "1/16", "7/16", etc.
  // (não remove "05/08" no meio de uma linha)
  t = t.replace(/^\s*\d{1,2}\s*\/\s*\d{1,3}\s*$/gm, " ");

  // ✅ RECONSTRUIR DATA quando vier quebrada:
  // "05/08 /2025" -> "05/08/2025"
  t = t.replace(/(\d{2}\/\d{2})\s*\/\s*(\d{4})/g, "$1/$2");

  // quebra antes de datas no meio do texto
  t = t.replace(/([^\n])(\d{2}\/\d{2}\/\d{4}\b)/g, "$1\n$2");

  // ✅ DESGRUDAR: "04/08/2025031537" -> "04/08/2025 031537"
  t = t.replace(/(\d{2}\/\d{2}\/\d{4})(\d{5,20})/g, "$1 $2");

  // ✅ DESGRUDAR documento + valor no padrão BB:
  // "Boleto80.101964,92 D" -> "Boleto 80.101 964,92 D"
  t = t.replace(
    /([A-Za-zÀ-ÿ])(\d{2}\.\d{3})(\d{1,3}(?:\.\d{3})*,\d{2})\s*([DC])/g,
    "$1 $2 $3 $4"
  );

  // ✅ DESGRUDAR: "031537ENVIO" -> "031537 ENVIO"
  t = t.replace(/(\d{5,7})([A-Za-zÀ-ÿ])/g, "$1 $2");

  // ✅ DESGRUDAR: letra colada em número monetário: "PIX200,00" -> "PIX 200,00"
  t = t.replace(
    /([A-Za-zÀ-ÿ])(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/g,
    "$1 $2"
  );

  // ✅ DESGRUDAR: D/C colado no próximo número: "D418,64" -> "D 418,64"
  t = t.replace(/\b([DC])(\d)/g, "$1 $2");

  // normaliza espaços
  t = t.replace(/[ \t]{2,}/g, " ");

  return t;
}

/**
 * ✅ NOVO (isolado): detecta TXT/CSV "Data;Descricao;Valor;Tipo" e normaliza para:
 * "Data Descricao Valor Tipo"
 * Sem mexer nos parsers existentes.
 */
function normalizeDelimitedIfNeeded(lines) {
  if (!lines || !lines.length) return lines;

  const semi = lines.reduce((acc, l) => acc + ((l.match(/;/g) || []).length), 0);
  const comma = lines.reduce((acc, l) => acc + ((l.match(/,/g) || []).length), 0);
  const delim = semi >= comma ? ";" : ",";

  // heurística simples e segura: precisa ter pelo menos 1 linha com data + delimitador
  const looksDelimited = lines.some((l) => /^\d{2}\/\d{2}\/\d{4}\s*[;,]/.test(l));
  if (!looksDelimited) return lines;

  const out = [];
  for (const l of lines) {
    // ignora títulos/cabeçalhos comuns
    const low = String(l).toLowerCase();
    if (low.includes("extrato banc")) continue;
    if (low.startsWith("data") && (low.includes("descricao") || low.includes("descrição")) && low.includes("valor")) continue;

    const cols = String(l).split(delim).map((c) => cleanLine(c));
    if (cols.length < 3) {
      out.push(l);
      continue;
    }

    const date = cols[0];
    const desc = cols[1] || "";
    const valor = cols[2] || "";
    const tipo = (cols[3] || "").toString().trim().toUpperCase(); // D/C

    // só normaliza se a 1ª coluna for data br
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
      out.push(l);
      continue;
    }

    // vira "05/02/2026 Recebimento X 8500,00 C"
    out.push(cleanLine([date, desc, valor, tipo].filter(Boolean).join(" ")));
  }

  return out.length ? out : lines;
}

function parseExtratoText(text) {
  const t = preprocessText(text);

  let lines = t
    .split("\n")
    .map((l) => cleanLine(l))
    .filter(Boolean);

  // ✅ AJUSTE: se for TXT/CSV delimitado, normaliza para o mesmo formato do parser simples
  lines = normalizeDelimitedIfNeeded(lines);

  const out = [];
  for (const line of lines) {
    for (const it of parseLinhaExtrato(line)) out.push(it);
  }

  if (process.env.DEBUG_EXTRATO === "1") {
    console.log("🧪 [DOC1_EXTRATO] primeiras linhas pós-preprocess:");
    for (const l of lines.slice(0, 30)) console.log("  -", l);
    console.log(`🧪 [DOC1_EXTRATO] total linhas: ${lines.length} | parseados: ${out.length}`);
  }

  return out;
}

/**
 * ✅ Mantém o CAIXA como está e adiciona fallback para extrato "simples" (fictício).
 */
function parseLinhaExtrato(line) {
  // 1) tenta CAIXA (seu parser original)
  const caixa = parseLinhaExtratoCaixa(line);
  if (caixa.length) return caixa;

  // 2) tenta Banco do Brasil (valor único + D/C)
  const bb = parseLinhaExtratoBancoBrasil(line);
  if (bb.length) return bb;

  // 3) fallback: formato simples fictício (sem Nr Mov e sem saldo)
  const simples = parseLinhaExtratoSimples(line);
  if (simples.length) return simples;

  return [];
}

function parseLinhaExtratoBancoBrasil(line) {
  const t = String(line || "").trim();
  if (!t) return [];
  if (!/^\d{2}\/\d{2}\/\d{4}\b/.test(t)) return [];
  if (!/^\d{2}\/\d{2}\/\d{4}\s*\d{8,}/.test(t)) return [];

  const low = t.toLowerCase();
  if (low.includes("saldo anterior")) return [];
  if (low.includes("saldo dia")) return [];
  if (low.includes("bb rende")) return [];
  if (/rende\s*f[aá]cil/i.test(t)) return [];

  const m = t.match(/^(\d{2}\/\d{2}\/\d{4})\s*(\d{8,})\s+(.*)$/);
  if (!m) return [];

  const dateBR = m[1];
  const dateISO = parseDateBRToISO(dateBR);
  if (!dateISO) return [];

  let rest = cleanLine(m[3] || "");
  if (!rest) return [];

  // corrige casos de documento colado no valor
  rest = rest.replace(
    /(\d{2}\.\d{3})(\d{1,3}(?:\.\d{3})*,\d{2})\s*([DC])\b/g,
    "$1 $2 $3"
  );

  // usa o último valor com D/C da linha
  const mv = rest.match(
    /(.*?)([+-]?(?:\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}))\s*([DC])\b(?:\s+.*)?$/i
  );
  if (!mv) return [];

  const desc = cleanLine(mv[1] || "");
  const valorBR = mv[2];
  const dc = String(mv[3] || "").toUpperCase();
  if (!desc) return [];
  if (/rende\s*f[aá]cil/i.test(desc)) return [];

  let valorCentavos = parseValorBRToCentavos(valorBR);
  if (valorCentavos == null || valorCentavos === 0) return [];
  valorCentavos = dc === "D" ? -Math.abs(valorCentavos) : Math.abs(valorCentavos);

  return [
    {
      dateISO,
      dateBR,
      valorCentavos,
      valorBR,
      descricao: desc,
      origem: "DOC1",
    },
  ];
}

/**
 * ✅ Parser CAIXA determinístico (ORIGINAL, SEM MUDAR LÓGICA):
 * Exemplo:
 * "05/08/2025 051007 DEB PIX CH 3.000,00 D 418,64 C"
 *
 * Regra robusta:
 * - começa com dd/mm/aaaa
 * - tem Nr. Mov (5-7 dígitos)
 * - captura DOIS valores (movimentação e saldo) e usa o PRIMEIRO
 */
function parseLinhaExtratoCaixa(line) {
  if (!isLinhaLancamentoExtratoCaixa(line)) return [];

  const m = line.match(/^(\d{2}\/\d{2}\/\d{4})\s*(\d{5,7})\s+(.*)$/);
  if (!m) return [];

  const dateBR = m[1];
  const resto = cleanLine(m[3] || "");
  const dateISO = parseDateBRToISO(dateBR);
  if (!dateISO || !resto) return [];

  // VALOR_MOV + DC_MOV + VALOR_SALDO + DC_SALDO
  const re2val =
    /(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*([DC])\s+(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})\s*([DC])\b/i;

  const mv = resto.match(re2val);
  if (!mv) return [];

  const valorBR = mv[1];
  const dcMov = String(mv[2] || "").toUpperCase();

  let valorCentavos = parseValorBRToCentavos(valorBR);
  if (valorCentavos == null) return [];

  if (dcMov === "D") valorCentavos = -Math.abs(valorCentavos);
  if (dcMov === "C") valorCentavos = Math.abs(valorCentavos);
  if (valorCentavos === 0) return [];

  // descrição = tudo antes do bloco "valorMov D/C valorSaldo D/C"
  const idxValor = resto.toUpperCase().indexOf(String(mv[0]).toUpperCase());
  const desc = idxValor > 0 ? cleanLine(resto.slice(0, idxValor)) : resto;

  // filtros finais
  if (/\bSALDO\s+DIA\b/i.test(desc)) return [];
  if (/\bRESG\s+AUT\b/i.test(desc)) return [];
  if (/rende\s*f[aá]cil/i.test(desc)) return [];

  return [
    {
      dateISO,
      dateBR,
      valorCentavos,
      valorBR,
      descricao: desc || line,
      origem: "DOC1",
    },
  ];
}

/**
 * ✅ Fallback para extrato fictício/simples:
 * Ex.: "05/01/2026 Pagamento Fornecedor A 3.000,00 D"
 *     "10/01/2026 Recebimento Cliente Alpha 15.000,00 C"
 */
function parseLinhaExtratoSimples(line) {
  if (!isLinhaLancamentoExtratoSimples(line)) return [];

  const m = line.match(
    /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([+-]?(?:\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2}))(?:\s+([DC]))?\b/i
  );
  if (!m) return [];

  const dateBR = m[1];
  const desc = cleanLine(m[2] || "");
  const valorBR = m[3];
  const dc = String(m[4] || "").toUpperCase();

  const dateISO = parseDateBRToISO(dateBR);
  if (!dateISO) return [];

  let valorCentavos = parseValorBRToCentavos(valorBR);
  if (valorCentavos == null) return [];

  if (dc === "D") {
    valorCentavos = -Math.abs(valorCentavos);
  } else if (dc === "C") {
    valorCentavos = Math.abs(valorCentavos);
  }
  if (valorCentavos === 0) return [];

  // filtros básicos para evitar pegar cabeçalho
  const low = desc.toLowerCase();
  if (low.startsWith("data") && low.includes("valor")) return [];
  if (low.includes("extrato banc")) return [];
  if (/rende\s*f[aá]cil/i.test(desc)) return [];

  return [
    {
      dateISO,
      dateBR,
      valorCentavos,
      valorBR,
      descricao: desc || line,
      origem: "DOC1",
    },
  ];
}

function isLinhaLancamentoExtratoCaixa(line) {
  const t = String(line || "").trim();
  if (!t) return false;

  if (!/^\d{2}\/\d{2}\/\d{4}\b/.test(t)) return false;
  if (!/^\d{2}\/\d{2}\/\d{4}\s*\d{5,7}\b/.test(t)) return false;

  const low = t.toLowerCase();
  if (low.startsWith("extrato")) return false;
  if (low.startsWith("mês:") || low.startsWith("mes:")) return false;
  if (low.startsWith("período:") || low.startsWith("periodo:")) return false;
  if (low.startsWith("data mov")) return false;
  if (low.startsWith("data:")) return false;
  if (low.startsWith("cliente:")) return false;
  if (low.startsWith("conta:")) return false;
  if (low.startsWith("sac")) return false;
  if (low.startsWith("ouvidoria")) return false;
  if (low.startsWith("alô caixa") || low.startsWith("alo caixa")) return false;

  if (/\bSALDO\s+DIA\b/i.test(t)) return false;
  if (/\bRESG\s+AUT\b/i.test(t)) return false;

  return true;
}

function isLinhaLancamentoExtratoSimples(line) {
  const t = String(line || "").trim();
  if (!t) return false;

  // precisa começar com data
  if (!/^\d{2}\/\d{2}\/\d{4}\b/.test(t)) return false;

  // não pode ser CAIXA (se tiver nr mov, deixa o CAIXA pegar)
  if (/^\d{2}\/\d{2}\/\d{4}\s*\d{5,7}\b/.test(t)) return false;

  // aceita valor com D/C, valor assinado ou valor simples no fim da linha
  const hasValorComDc = /([+-]?(?:\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2}))\s+[DC]\b/i.test(t);
  const hasValorAssinado = /[+-]\d+(?:[.,]\d{2})\b/.test(t);
  const hasValorSimplesFinal = /(?:\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2})\s*$/.test(t);
  if (!hasValorComDc && !hasValorAssinado && !hasValorSimplesFinal) return false;

  const low = t.toLowerCase();
  if (low.startsWith("extrato")) return false;
  if (low.startsWith("data") && low.includes("valor")) return false;

  return true;
}
