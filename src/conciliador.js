// src/conciliador.js
import path from "path";
import * as XLSX from "xlsx";
import { fileURLToPath } from "url";

import { parseExtrato } from "./parsers/extrato.js";
import { parseRazao } from "./parsers/razao.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizarCaminhos(caminhos) {
  if (!caminhos) return [];
  if (Array.isArray(caminhos)) return caminhos.filter(Boolean);
  return [caminhos];
}

function centavosParaPtBR(centavos) {
  const n = (centavos || 0) / 100;
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function limparSnippet(s) {
  if (!s) return "";
  let t = String(s).replace(/\s+/g, " ").trim();
  if (t.length > 80) t = t.slice(0, 80).trim() + "…";
  return t;
}

/**
 * ✅ Helpers de período (filtro)
 * - dateBR: "dd/mm/aaaa" -> number yyyymmdd
 * - inputDate: "yyyy-mm-dd" -> number yyyymmdd
 */
function dateBRToKey(dateBR) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(dateBR || "").trim());
  if (!m) return null;
  const dd = m[1];
  const mm = m[2];
  const yyyy = m[3];
  return Number(`${yyyy}${mm}${dd}`);
}

function inputDateToKey(inputDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(inputDate || "").trim());
  if (!m) return null;
  const yyyy = m[1];
  const mm = m[2];
  const dd = m[3];
  return Number(`${yyyy}${mm}${dd}`);
}

function extrairPeriodoDoc1(doc1) {
  let min = null;
  let max = null;

  for (const it of doc1 || []) {
    const k = dateBRToKey(it?.dateBR);
    if (k == null) continue;
    if (min == null || k < min) min = k;
    if (max == null || k > max) max = k;
  }

  return { min, max };
}

function filtrarPorPeriodo(lancamentos, startKey, endKey) {
  if (!startKey && !endKey) return lancamentos || [];
  const s = startKey ?? Number.MIN_SAFE_INTEGER;
  const e = endKey ?? Number.MAX_SAFE_INTEGER;

  return (lancamentos || []).filter((it) => {
    const k = dateBRToKey(it?.dateBR);
    if (k == null) return false;
    return k >= s && k <= e;
  });
}

/**
 * Monta Map<key, Array<item>> preservando duplicatas.
 * key = "dd/mm/aaaa|centavos"
 */
function buildMapFromLancamentos(lancamentos) {
  const map = new Map();
  for (const it of lancamentos || []) {
    if (!it?.dateBR || it?.valorCentavos == null) continue;

    const key = `${it.dateBR}|${it.valorCentavos}`;
    const item = {
      date: it.dateBR,
      cents: it.valorCentavos,
      snippet: limparSnippet(it.descricao || ""),
      origem: it.origem || "",
    };

    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

/**
 * ✅ Divergências APENAS de 1 lado (DOC2 → DOC1):
 * - o que existe no controle interno (DOC2) e NÃO existe no extrato (DOC1)
 * Preserva duplicatas (comparando quantidades por chave).
 */
function gerarCsvDivergenciasDeterministico(mapDoc1, mapDoc2) {
  const header = "Data;Valor;Descrição Doc1;Descrição Doc2;Documento de Origem";
  const linhas = [header];

  // ✅ SOMENTE: DOC2 que não existe no DOC1 (preserva duplicatas por chave)
  for (const [key, b] of mapDoc2.entries()) {
    const a = mapDoc1.get(key) || [];
    if (a.length >= b.length) continue;

    for (let i = a.length; i < b.length; i++) {
      const vb = b[i];
      if (!vb) continue;

      linhas.push(
        [
          vb.date,
          centavosParaPtBR(vb.cents),
          "Não consta no extrato bancário (DOC1)",
          vb.snippet || "—",
          "DOC2",
        ].join(";")
      );
    }
  }

  const dados = linhas.slice(1);
  dados.sort((a, b) => {
    const [da, va] = a.split(";");
    const [db, vb] = b.split(";");
    const ka = da.split("/").reverse().join("") + "|" + va;
    const kb = db.split("/").reverse().join("") + "|" + vb;
    return ka.localeCompare(kb, "pt-BR");
  });

  return [header, ...dados].join("\n");
}

function csvParaMatriz(csvTexto) {
  const linhas = String(csvTexto || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (linhas.length === 0) {
    return [["Data", "Valor", "Descrição Doc1", "Descrição Doc2", "Documento de Origem"]];
  }

  const matriz = linhas.map((linha, idx) => {
    let cols = linha.split(";").map((c) => c.trim());

    if (idx === 0) {
      while (cols.length < 5) cols.push("");
      return cols.slice(0, 5);
    }

    while (cols.length < 5) cols.push("");
    if (cols.length > 5) {
      const extras = cols.splice(5);
      cols[3] = `${cols[3]} ${extras.join(" ")}`.trim();
    }

    return cols.slice(0, 5);
  });

  return matriz;
}

async function parsePair(extratos, controles) {
  let doc1 = [];
  for (const p of extratos) {
    const itens = await parseExtrato(p);
    doc1 = doc1.concat(itens || []);
  }

  let doc2 = [];
  for (const p of controles) {
    const itens = await parseRazao(p);
    doc2 = doc2.concat(itens || []);
  }

  return { doc1, doc2 };
}

/**
 * ✅ NOVO (apenas métricas): conta matches determinísticos (data+valor) preservando duplicatas.
 * NÃO altera nada no matching, só mede.
 */
function contarMatchesDeterministic(mapDoc1, mapDoc2) {
  let matches = 0;
  for (const [key, arr2] of mapDoc2.entries()) {
    const arr1 = mapDoc1.get(key) || [];
    matches += Math.min(arr1.length, arr2.length);
  }
  return matches;
}

/**
 * ✅ NOVO (apenas métricas): volume do DOC1 (extrato)
 */
function calcularVolumeDoc1(doc1) {
  let abs = 0;
  let net = 0;
  for (const it of doc1 || []) {
    const c = Number(it?.valorCentavos);
    if (!Number.isFinite(c)) continue;
    net += c;
    abs += Math.abs(c);
  }
  return { absCentavos: abs, netCentavos: net };
}

// ✅ FUNÇÃO (sem export aqui)
async function rodarConciliacao(
  caminhosExtrato,
  caminhosControle,
  caminhosDuplicatas,
  options = {}
) {
  console.log("🔄 Iniciando conciliação (DETERMINÍSTICA: data + valor)…");

  const extratos = normalizarCaminhos(caminhosExtrato);
  const controles = normalizarCaminhos(caminhosControle);

  let { doc1, doc2 } = await parsePair(extratos, controles);

  // blindagem auto-swap se vier 0/0
  if ((doc1.length === 0 && doc2.length === 0) && extratos.length && controles.length) {
    console.warn("⚠️ DOC1 e DOC2 vieram vazios. Tentando auto-swap (extrato ↔ controle)...");
    const swapped = await parsePair(controles, extratos);

    const normalScore = doc1.length + doc2.length;
    const swapScore = swapped.doc1.length + swapped.doc2.length;

    if (swapScore > normalScore) {
      console.warn("✅ Auto-swap aplicado: os arquivos estavam invertidos no upload.");
      doc1 = swapped.doc1;
      doc2 = swapped.doc2;
    } else {
      console.warn("⚠️ Auto-swap não ajudou. Provável problema de parse dos PDFs/formatos.");
    }
  }

  // ✅ AQUI É O ÚNICO AJUSTE: aplicar o filtro de período (se existir)
  // - se usuário não informou, usa período do DOC1 (extrato) automaticamente
  const userStartKey = inputDateToKey(options?.dataInicial);
  const userEndKey = inputDateToKey(options?.dataFinal);

  const { min: doc1Min, max: doc1Max } = extrairPeriodoDoc1(doc1);

  let startKey = null;
  let endKey = null;

  if (doc1Min != null && doc1Max != null) {
    if (!userStartKey && !userEndKey) {
      startKey = doc1Min;
      endKey = doc1Max;
    } else {
      startKey = userStartKey ?? doc1Min;
      endKey = userEndKey ?? doc1Max;
    }

    doc1 = filtrarPorPeriodo(doc1, startKey, endKey);
    doc2 = filtrarPorPeriodo(doc2, startKey, endKey);

    console.log(
      `🗓️ Período aplicado (yyyymmdd): ${startKey} → ${endKey} (base: ${
        !userStartKey && !userEndKey ? "DOC1" : "usuário+DOC1"
      })`
    );
  } else {
    console.warn("⚠️ Não foi possível determinar período do DOC1. Filtro de datas ignorado.");
  }

  console.log(`📌 DOC1 lançamentos parseados: ${doc1.length}`);
  console.log(`📌 DOC2 lançamentos parseados: ${doc2.length}`);

  const mapDoc1 = buildMapFromLancamentos(doc1);
  const mapDoc2 = buildMapFromLancamentos(doc2);

  if (process.env.DEBUG_EXTRATO === "1") {
    for (const [key] of mapDoc2.entries()) {
      if (!mapDoc1.has(key)) console.log(`🧪 [MATCH] DOC1 NÃO TEM chave do DOC2 => ${key}`);
    }
  }

  const csvDivergencias = gerarCsvDivergenciasDeterministico(mapDoc1, mapDoc2);
  const matriz = csvParaMatriz(csvDivergencias);

  const totalDivergencias = matriz.length > 1 ? matriz.length - 1 : 0;
  const temDivergencias = totalDivergencias > 0;

  console.log(`📊 Total de divergências (determinístico): ${totalDivergencias}`);

  const planilha = XLSX.utils.aoa_to_sheet(matriz);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, planilha, "Divergencias");

  const outputFileName = options?.outputFileName || "conciliacao_divergencias.xlsx";
  const outputPath = path.join(__dirname, "..", "uploads", outputFileName);

  XLSX.writeFile(workbook, outputPath);
  console.log("✅ Excel criado em:", outputPath);

  // ✅ NOVO: métricas (NÃO muda conciliação)
  const matches_count = contarMatchesDeterministic(mapDoc1, mapDoc2);
  const { absCentavos: volume_doc1_abs_centavos, netCentavos: volume_doc1_liquido_centavos } =
    calcularVolumeDoc1(doc1);

  const doc1_count = doc1.length;
  const doc2_count = doc2.length;
  const transacoes_count = doc1_count + doc2_count;

  return {
    outputPath,
    temDivergencias,
    totalDivergencias,
    csvDivergencias,

    // ✅ NOVO: usados no dashboard
    doc1_count,
    doc2_count,
    transacoes_count,
    matches_count,
    volume_doc1_abs_centavos,
    volume_doc1_liquido_centavos,
  };
}

// ✅ EXPORT GARANTIDO
export { rodarConciliacao };
