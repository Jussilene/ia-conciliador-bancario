import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { cleanLine, parseValorBRToCentavos } from "./common.js";
import { safeExtractPdfText } from "./pdfText.js";

function toDateKey(dateBR) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(dateBR || "").trim());
  if (!m) return null;
  return Number(`${m[3]}${m[2]}${m[1]}`);
}

function extractDocs(line) {
  const txt = String(line || "");
  const nf = (txt.match(/\bNF(?:-?e)?\s*[:#-]?\s*(\d{3,})\b/i) || [])[1] || "";
  const dup =
    (txt.match(/\bDUP(?:LICATA)?\s*[:#-]?\s*([A-Za-z0-9.\-\/]{2,})\b/i) || [])[1] || "";
  const parc = (txt.match(/\b(?:PARC|PARCELA)\s*[:#-]?\s*(\d{1,2}(?:\/\d{1,2})?)\b/i) || [])[1] || "";
  return { nf, dup, parc };
}

function normalizeDelimitedIfNeeded(lines) {
  if (!lines || !lines.length) return lines;

  const semi = lines.reduce((acc, l) => acc + ((l.match(/;/g) || []).length), 0);
  const comma = lines.reduce((acc, l) => acc + ((l.match(/,/g) || []).length), 0);
  const delim = semi >= comma ? ";" : ",";

  const looksDelimited = lines.some((l) => /^\s*\d{2}\/\d{2}\/\d{4}\s*[;,]/.test(l));
  if (!looksDelimited) return lines;

  const out = [];
  for (const l of lines) {
    const cols = String(l).split(delim).map((c) => cleanLine(c));
    if (cols.length < 2) {
      out.push(l);
      continue;
    }
    out.push(cleanLine(cols.join(" ")));
  }
  return out;
}

function parseDuplicatasText(text) {
  let lines = String(text || "")
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);

  lines = normalizeDelimitedIfNeeded(lines);

  const out = [];
  for (const line of lines) {
    if (/^data\b/i.test(line) && /valor/i.test(line)) continue;

    const dateMatch = line.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
    const valorMatches = Array.from(
      line.matchAll(/([+-]?(?:\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}|\d+\.\d{2}))\b/g)
    );
    if (!valorMatches.length) continue;

    const valorBR = valorMatches[valorMatches.length - 1][1];
    const abs = parseValorBRToCentavos(valorBR);
    if (abs == null || abs === 0) continue;

    const { nf, dup, parc } = extractDocs(line);
    const vencimento = dateMatch ? dateMatch[1] : "";

    out.push({
      valorAbsCentavos: Math.abs(abs),
      vencimentoBR: vencimento,
      vencimentoKey: toDateKey(vencimento),
      nf,
      duplicata: dup,
      parcela: parc,
      raw: line,
    });
  }

  return out;
}

function parseDuplicatasXlsx(buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const out = [];
  for (const sn of wb.SheetNames) {
    const sheet = wb.Sheets[sn];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
    for (const row of rows) {
      const line = cleanLine((row || []).map((c) => cleanLine(c)).join(" "));
      if (!line) continue;
      out.push(...parseDuplicatasText(line));
    }
  }
  return out;
}

export async function parseDuplicatas(filePath) {
  const ext = (path.extname(filePath) || "").toLowerCase();
  const buffer = fs.readFileSync(filePath);
  const magic = buffer.slice(0, 5).toString();

  if (ext === ".xlsx" || ext === ".xls") return parseDuplicatasXlsx(buffer);
  if (ext === ".csv" || ext === ".txt") return parseDuplicatasText(buffer.toString("utf8"));

  if (ext === ".pdf" || magic.startsWith("%PDF")) {
    const text = await safeExtractPdfText(buffer, "DOC3_DUPLICATAS");
    return parseDuplicatasText(text || "");
  }

  return parseDuplicatasText(buffer.toString("utf8"));
}
