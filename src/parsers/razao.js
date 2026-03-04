// src/parsers/razao.js
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { cleanLine, parseDateBRToISO, parseValorBRToCentavos } from "./common.js";
import { safeExtractPdfText } from "./pdfText.js";

/**
 * Retorna array:
 * [{ dateISO, dateBR, valorCentavos, valorBR, descricao, origem:"DOC2" }]
 */
export async function parseRazao(filePath) {
  const ext = (path.extname(filePath) || "").toLowerCase();
  const buffer = fs.readFileSync(filePath);
  const magic = buffer.slice(0, 5).toString();

  if (ext === ".xlsx" || ext === ".xls") return parseRazaoXlsx(buffer);
  if (ext === ".csv" || ext === ".txt") return parseRazaoText(buffer.toString("utf8"));

  if (ext === ".pdf" || magic.startsWith("%PDF")) {
    const text = await safeExtractPdfText(buffer, "DOC2_RAZAO");
    return parseRazaoText(text || "");
  }

  return parseRazaoText(buffer.toString("utf8"));
}

function parseRazaoXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });

  const out = [];
  for (const row of rows) {
    const cols = (row || []).map((c) => cleanLine(c));
    if (!cols.length) continue;

    const joined = cleanLine(cols.join(" "));
    const itens = parseLinhaRazao(joined);
    for (const it of itens) out.push(it);
  }
  return out;
}

// Detecta TXT/CSV "Data;Descricao;Valor;Tipo" e normaliza para:
// "Data Descricao Valor Tipo"
function normalizeDelimitedIfNeeded(lines) {
  if (!lines || !lines.length) return lines;

  const semi = lines.reduce((acc, l) => acc + ((l.match(/;/g) || []).length), 0);
  const comma = lines.reduce((acc, l) => acc + ((l.match(/,/g) || []).length), 0);
  const delim = semi >= comma ? ";" : ",";

  const looksDelimited = lines.some((l) => /^\d{2}\/\d{2}\/\d{4}\s*[;,]/.test(l));
  if (!looksDelimited) return lines;

  const out = [];
  for (const l of lines) {
    const low = String(l).toLowerCase();
    if (
      low.startsWith("data") &&
      (low.includes("descricao") || low.includes("descri")) &&
      low.includes("valor")
    ) {
      continue;
    }
    if (low.startsWith("raz") && low.includes("fict")) continue;

    const cols = String(l).split(delim).map((c) => cleanLine(c));
    if (cols.length < 3) {
      out.push(l);
      continue;
    }

    const date = cols[0];
    const desc = cols[1] || "";
    const valor = cols[2] || "";
    const tipo = (cols[3] || "").toString().trim().toUpperCase(); // D/C

    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(date)) {
      out.push(l);
      continue;
    }

    out.push(cleanLine([date, desc, valor, tipo].filter(Boolean).join(" ")));
  }

  return out.length ? out : lines;
}

function parseRazaoText(text) {
  let lines = String(text || "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  lines = normalizeDelimitedIfNeeded(lines);

  const out = [];
  for (const line of lines) {
    const itens = parseLinhaRazao(line);
    for (const it of itens) out.push(it);
  }
  return out;
}

// Usa o que esta na linha.
// - se vier "D" ou "C", usa
// - senao: tenta inferir por sinal/palavras
function parseLinhaRazao(line) {
  if (!isLinhaLancamentoRazao(line)) return [];

  const m = line.match(/^(\d{2}\/\d{2}\/\d{4})\b(.*)$/);
  if (!m) return [];

  const dateBR = m[1];
  const rest = cleanLine(m[2] || "");
  const dateISO = parseDateBRToISO(dateBR);
  if (!dateISO) return [];

  const reValorComDC = /([+-]?(?:\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2}))\s*([DC])?\b/gi;

  const valores = [];
  reValorComDC.lastIndex = 0;
  let mv;
  while ((mv = reValorComDC.exec(rest))) {
    valores.push({
      valorBR: mv[1],
      tipo: mv[2] ? String(mv[2]).toUpperCase() : null,
    });
  }
  if (valores.length === 0) return [];

  const ctx = {
    temDebito:
      /\bd[e\u00E9]bito\b/i.test(rest) ||
      /\bpagamento\b/i.test(rest) ||
      /\btarifa\b/i.test(rest) ||
      /\bjuros\b/i.test(rest) ||
      /\bmensalidade\b/i.test(rest),
    temCredito:
      /\bcr[e\u00E9]dito\b/i.test(rest) ||
      /\breceb(imento|i)\b/i.test(rest) ||
      /\bdeposito\b/i.test(rest),
  };

  const picked = escolherValorRazao(valores, ctx);
  if (!picked?.valorBR) return [];

  const abs = parseValorBRToCentavos(picked.valorBR);
  if (abs == null || abs === 0) return [];

  const valorCentavos = picked.tipo === "D" ? -Math.abs(abs) : Math.abs(abs);

  return [
    {
      dateISO,
      dateBR,
      valorCentavos,
      valorBR: picked.valorBR,
      descricao: rest || line,
      origem: "DOC2",
    },
  ];
}

function isLinhaLancamentoRazao(line) {
  const t = String(line || "");
  if (/^raz[a\u00E3]o/i.test(t)) return false;
  if (/^empresa:/i.test(t)) return false;
  if (/^cnpj:/i.test(t)) return false;
  if (/^per[i\u00ED]odo:/i.test(t)) return false;
  if (/^data\s*\|/i.test(t)) return false;
  if (/^data\b.*hist[o\u00F3]rico/i.test(t)) return false;
  return /^\d{2}\/\d{2}\/\d{4}\b/.test(t);
}

function escolherValorRazao(valores, ctx = {}) {
  const normZero = (v) => Math.abs(Number(parseValorBRToCentavos(v) || 0)) === 0;

  const tipoPorTexto = (valorBR = "") => {
    if (/^-/.test(String(valorBR).trim())) return "D";
    if (ctx.temDebito && !ctx.temCredito) return "D";
    if (ctx.temCredito && !ctx.temDebito) return "C";
    return "C";
  };

  const pickComTipo = (obj) => ({
    valorBR: obj.valorBR,
    tipo: obj.tipo || tipoPorTexto(obj.valorBR),
  });

  if (!valores || valores.length === 0) return null;

  const norm = valores.map((v) =>
    typeof v === "string" ? { valorBR: v, tipo: null } : v
  );

  for (const v of norm) {
    if (v?.valorBR && !normZero(v.valorBR)) return pickComTipo(v);
  }

  return pickComTipo(norm[0]);
}
