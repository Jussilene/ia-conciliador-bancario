// src/parsers/pdfText.js
import pdfParse from "pdf-parse";
import path from "path";
import { pathToFileURL } from "url";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

function toStrictUint8Array(data) {
  if (!data) return new Uint8Array();
  if (data instanceof Uint8Array && !Buffer.isBuffer(data)) return data;
  if (Buffer.isBuffer(data)) return Uint8Array.from(data);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Uint8Array.from(Buffer.from(data));
}

function itemsToLines(items) {
  const rows = new Map();
  const TOL = 2;

  for (const it of items || []) {
    const s = it?.str ? String(it.str) : "";
    if (!s.trim()) continue;

    const y = Array.isArray(it.transform) ? it.transform[5] : 0;

    let key = null;
    for (const k of rows.keys()) {
      if (Math.abs(k - y) <= TOL) {
        key = k;
        break;
      }
    }
    if (key == null) key = y;

    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(s);
  }

  const keys = Array.from(rows.keys()).sort((a, b) => b - a);
  const lines = [];

  for (const k of keys) {
    const parts = rows.get(k) || [];
    const line = parts.join(" ").replace(/\s+/g, " ").trim();
    if (line) lines.push(line);
  }

  return lines;
}

async function pdfTextViaPdfJs(inputBuffer, label = "PDF") {
  const uint8 = toStrictUint8Array(inputBuffer);

  if (process.env.DEBUG_PDF === "1") {
    console.log(
      `🧪 [${label}] pdfjs input => isBuffer=${Buffer.isBuffer(uint8)} | ctor=${uint8?.constructor?.name} | len=${uint8?.length}`
    );
  }

  let pdfjs;
  try {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  } catch {
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.js");
  }

  // standard fonts (evita tentar baixar pelo file:// e gerar warning)
  const pdfjsPkg = require.resolve("pdfjs-dist/package.json");
  const pdfjsRoot = path.dirname(pdfjsPkg);
  const fontsDir = path.join(pdfjsRoot, "standard_fonts");
  const standardFontDataUrl = pathToFileURL(fontsDir + path.sep).href;

  const loadingTask = pdfjs.getDocument({
    data: uint8,
    standardFontDataUrl,
    disableFontFace: true,
  });

  const pdf = await loadingTask.promise;

  let full = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent({
      normalizeWhitespace: true,
      disableCombineTextItems: false,
    });

    let lines = itemsToLines(content?.items || []);

    // corta lixo grosseiro (link/rotas)
    lines = lines.filter(
      (l) =>
        !/https?:\/\//i.test(l) &&
        !/gerenciador\.caixa\.gov\.br/i.test(l) &&
        !/imprime_ext_periodo/i.test(l)
    );

    if (lines.length) full += lines.join("\n") + "\n";
  }

  return full.trim();
}

/**
 * Extrai texto do PDF:
 * - tenta pdf-parse
 * - se falhar OU vier sem “cara de extrato” (sem datas), usa pdfjs
 */
export async function safeExtractPdfText(buffer, label = "PDF") {
  try {
    const data = await pdfParse(buffer);
    const txt = String(data?.text || "").trim();

    const hasDates = /\b\d{2}\/\d{2}\/\d{4}\b/.test(txt);

    if (txt && txt.length >= 50 && hasDates) return txt;

    console.warn(`⚠️ [${label}] pdf-parse retornou pouco/sem datas. Tentando fallback pdfjs-dist…`);
    return await pdfTextViaPdfJs(buffer, label);
  } catch (err) {
    const msg = String(err?.message || err);
    console.warn(`⚠️ [${label}] pdf-parse falhou: ${msg}. Tentando fallback pdfjs-dist…`);
    return await pdfTextViaPdfJs(buffer, label);
  }
}
