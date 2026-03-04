// src/conciliador.js
import path from "path";
import * as XLSX from "xlsx";
import { fileURLToPath } from "url";

import { parseExtrato } from "./parsers/extrato.js";
import { parseRazao } from "./parsers/razao.js";
import { parseDuplicatas } from "./parsers/duplicatas.js";
import { parseValorBRToCentavos } from "./parsers/common.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function normalizarCaminhos(caminhos) {
  if (!caminhos) return [];
  const arr = Array.isArray(caminhos) ? caminhos : [caminhos];
  return arr
    .filter(Boolean)
    .map((p) => String(p))
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
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
  if (t.length > 80) t = t.slice(0, 80).trim() + "â€¦";
  return t;
}

/**
 * âœ… Helpers de perÃ­odo (filtro)
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

function extrairPeriodo(lancamentos) {
  let min = null;
  let max = null;

  for (const it of lancamentos || []) {
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

function ordenarLancamentosDeterministico(lancamentos) {
  const arr = [...(lancamentos || [])];
  arr.sort((a, b) => {
    const ka = [
      dateBRToKey(a?.dateBR) ?? Number.MAX_SAFE_INTEGER,
      Number(a?.valorCentavos ?? 0),
      String(a?.descricao || ""),
      String(a?.origem || ""),
    ];
    const kb = [
      dateBRToKey(b?.dateBR) ?? Number.MAX_SAFE_INTEGER,
      Number(b?.valorCentavos ?? 0),
      String(b?.descricao || ""),
      String(b?.origem || ""),
    ];
    return String(ka).localeCompare(String(kb), "pt-BR");
  });
  return arr;
}

function pushLinhaDivergencia(linhas, item, descricaoDoc1, descricaoDoc2, origem) {
  linhas.push(
    [item.date, centavosParaPtBR(item.cents), descricaoDoc1, descricaoDoc2, origem].join(";")
  );
}

/**
 * DivergÃªncias bilaterais (DOC1 â†” DOC2), preservando duplicatas por chave.
 */
function cloneMap(map) {
  const out = new Map();
  for (const [k, arr] of map.entries()) out.set(k, [...arr]);
  return out;
}

function flattenMap(map) {
  const out = [];
  for (const arr of map.values()) out.push(...arr);
  return out;
}

function pickClosestByDate(target, candidates) {
  const t = dateBRToKey(target?.date);
  let bestIdx = -1;
  let bestDiff = Number.MAX_SAFE_INTEGER;

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const d = dateBRToKey(c?.date);
    const diff =
      t == null || d == null ? Number.MAX_SAFE_INTEGER - i : Math.abs(Number(t) - Number(d));
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }

  return bestIdx;
}

function reconciliarPorValor(remDoc1, remDoc2) {
  const group1 = new Map();
  const group2 = new Map();

  for (const it of remDoc1) {
    const k = String(it.cents);
    if (!group1.has(k)) group1.set(k, []);
    group1.get(k).push(it);
  }
  for (const it of remDoc2) {
    const k = String(it.cents);
    if (!group2.has(k)) group2.set(k, []);
    group2.get(k).push(it);
  }

  const nextDoc1 = [];
  const nextDoc2 = [];
  let matchedByValue = 0;

  const allValues = [...new Set([...group1.keys(), ...group2.keys()])].sort(
    (x, y) => Number(x) - Number(y)
  );
  for (const valueKey of allValues) {
    const a = [...(group1.get(valueKey) || [])].sort((x, y) =>
      `${dateBRToKey(x?.date) ?? 0}|${x?.snippet || ""}`.localeCompare(
        `${dateBRToKey(y?.date) ?? 0}|${y?.snippet || ""}`,
        "pt-BR"
      )
    );
    const b = [...(group2.get(valueKey) || [])].sort((x, y) =>
      `${dateBRToKey(x?.date) ?? 0}|${x?.snippet || ""}`.localeCompare(
        `${dateBRToKey(y?.date) ?? 0}|${y?.snippet || ""}`,
        "pt-BR"
      )
    );

    while (a.length && b.length) {
      const target = a.shift();
      const idx = pickClosestByDate(target, b);
      if (idx < 0) break;
      b.splice(idx, 1);
      matchedByValue += 1;
    }

    nextDoc1.push(...a);
    nextDoc2.push(...b);
  }

  return { remDoc1: nextDoc1, remDoc2: nextDoc2, matchedByValue };
}

/**
 * Divergencias bilaterais (DOC1 <-> DOC2), preservando duplicatas por chave.
 * Regra: primeiro compara por data+valor; depois tenta casar remanescentes por valor.
 */
function gerarCsvDivergenciasDeterministico(mapDoc1, mapDoc2) {
  const header = "Data;Valor;Descrição Doc1;Descrição Doc2;Documento de Origem";
  const linhas = [header];
  const workDoc1 = cloneMap(mapDoc1);
  const workDoc2 = cloneMap(mapDoc2);

  // 1) remove matches exatos (data+valor), preservando duplicatas.
  for (const [key, arrDoc2] of workDoc2.entries()) {
    const arrDoc1 = workDoc1.get(key) || [];
    const common = Math.min(arrDoc1.length, arrDoc2.length);
    if (!common) continue;
    workDoc1.set(key, arrDoc1.slice(common));
    workDoc2.set(key, arrDoc2.slice(common));
  }

  // 2) casa remanescentes por valor (data mais proxima).
  const remA = flattenMap(workDoc1);
  const remB = flattenMap(workDoc2);
  const { remDoc1, remDoc2, matchedByValue } = reconciliarPorValor(remA, remB);

  // 3) gera divergencias reais apos os dois niveis de match.
  for (const it of remDoc2) {
    pushLinhaDivergencia(
      linhas,
      it,
      "Não consta no extrato bancário (DOC1)",
      it.snippet || "—",
      "DOC2"
    );
  }
  for (const it of remDoc1) {
    pushLinhaDivergencia(
      linhas,
      it,
      it.snippet || "—",
      "Não consta no controle interno (DOC2)",
      "DOC1"
    );
  }

  const dados = linhas.slice(1);
  dados.sort((a, b) => {
    const [da, va] = a.split(";");
    const [db, vb] = b.split(";");
    const ka = da.split("/").reverse().join("") + "|" + va;
    const kb = db.split("/").reverse().join("") + "|" + vb;
    return ka.localeCompare(kb, "pt-BR");
  });

  return { csv: [header, ...dados].join("\n"), matchedByValue };
}

function csvParaMatriz(csvTexto) {
  const linhas = String(csvTexto || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (linhas.length === 0) {
    return [["Data", "Valor", "DescriÃ§Ã£o Doc1", "DescriÃ§Ã£o Doc2", "Documento de Origem"]];
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

function montarTagDoc3(item) {
  const parts = [];
  if (item.nf) parts.push(`NF ${item.nf}`);
  if (item.duplicata) parts.push(`Dup ${item.duplicata}`);
  if (item.parcela) parts.push(`Parc ${item.parcela}`);
  if (item.vencimentoBR) parts.push(`Venc ${item.vencimentoBR}`);
  if (!parts.length) return "";
  return ` [DOC3: ${parts.join(" | ")}]`;
}

function absDateDiff(aKey, bKey) {
  if (aKey == null || bKey == null) return Number.MAX_SAFE_INTEGER;
  const as = `${aKey}`.padStart(8, "0");
  const bs = `${bKey}`.padStart(8, "0");
  const ad = new Date(`${as.slice(0, 4)}-${as.slice(4, 6)}-${as.slice(6, 8)}T00:00:00Z`).getTime();
  const bd = new Date(`${bs.slice(0, 4)}-${bs.slice(4, 6)}-${bs.slice(6, 8)}T00:00:00Z`).getTime();
  return Math.abs(Math.round((ad - bd) / 86400000));
}

function escolherDuplicataParaLinha(linha, candidates) {
  const dateBR = String(linha?.[0] || "").trim();
  const cents = parseValorBRToCentavos(String(linha?.[1] || "").trim());
  if (cents == null) return null;

  const key = dateBRToKey(dateBR);
  const absCents = Math.abs(cents);
  const byAmount = candidates.filter((c) => c.valorAbsCentavos === absCents);
  if (!byAmount.length) return null;

  if (byAmount.length === 1) return byAmount[0];

  const withDate = byAmount
    .map((c) => ({ c, d: absDateDiff(key, c.vencimentoKey) }))
    .filter((x) => Number.isFinite(x.d))
    .sort((a, b) => a.d - b.d);

  if (!withDate.length) return null;
  if (withDate[0].d > 7) return null;
  if (withDate.length > 1 && withDate[0].d === withDate[1].d) return null;
  return withDate[0].c;
}

function enriquecerMatrizComDoc3(matriz, duplicatas) {
  if (!Array.isArray(matriz) || matriz.length <= 1) return matriz;
  if (!Array.isArray(duplicatas) || !duplicatas.length) return matriz;

  // Nao reutiliza o mesmo item de DOC3 para multiplas linhas.
  const pool = [...duplicatas].sort((a, b) => {
    const ka = [
      Number(a?.valorAbsCentavos ?? 0),
      Number(a?.vencimentoKey ?? 0),
      String(a?.nf || ""),
      String(a?.duplicata || ""),
      String(a?.parcela || ""),
      String(a?.raw || ""),
    ];
    const kb = [
      Number(b?.valorAbsCentavos ?? 0),
      Number(b?.vencimentoKey ?? 0),
      String(b?.nf || ""),
      String(b?.duplicata || ""),
      String(b?.parcela || ""),
      String(b?.raw || ""),
    ];
    return String(ka).localeCompare(String(kb), "pt-BR");
  });

  for (let i = 1; i < matriz.length; i++) {
    const linha = matriz[i];
    const hit = escolherDuplicataParaLinha(linha, pool);
    if (!hit) continue;

    const tag = montarTagDoc3(hit);
    if (!tag) continue;

    const origem = String(linha[4] || "").trim().toUpperCase();
    if (origem === "DOC2") {
      linha[3] = `${linha[3] || ""}${tag}`.trim();
    } else if (origem === "DOC1") {
      linha[2] = `${linha[2] || ""}${tag}`.trim();
    } else {
      linha[3] = `${linha[3] || ""}${tag}`.trim();
    }

    const idx = pool.indexOf(hit);
    if (idx >= 0) pool.splice(idx, 1);
  }

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
 * âœ… NOVO (apenas mÃ©tricas): conta matches determinÃ­sticos (data+valor) preservando duplicatas.
 * NÃƒO altera nada no matching, sÃ³ mede.
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
 * âœ… NOVO (apenas mÃ©tricas): volume do DOC1 (extrato)
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

// âœ… FUNÃ‡ÃƒO (sem export aqui)
async function rodarConciliacao(
  caminhosExtrato,
  caminhosControle,
  caminhosDuplicatas,
  options = {}
) {
  console.log("ðŸ”„ Iniciando conciliaÃ§Ã£o (DETERMINÃSTICA: data + valor)â€¦");

  const extratos = normalizarCaminhos(caminhosExtrato);
  const controles = normalizarCaminhos(caminhosControle);
  const duplicatasPaths = normalizarCaminhos(caminhosDuplicatas);

  let { doc1, doc2 } = await parsePair(extratos, controles);

  // blindagem auto-swap se vier 0/0
  if ((doc1.length === 0 && doc2.length === 0) && extratos.length && controles.length) {
    console.warn("âš ï¸ DOC1 e DOC2 vieram vazios. Tentando auto-swap (extrato â†” controle)...");
    const swapped = await parsePair(controles, extratos);

    const normalScore = doc1.length + doc2.length;
    const swapScore = swapped.doc1.length + swapped.doc2.length;

    if (swapScore > normalScore) {
      console.warn("âœ… Auto-swap aplicado: os arquivos estavam invertidos no upload.");
      doc1 = swapped.doc1;
      doc2 = swapped.doc2;
    } else {
      console.warn("âš ï¸ Auto-swap nÃ£o ajudou. ProvÃ¡vel problema de parse dos PDFs/formatos.");
    }
  }

  // Aplica filtro de perÃ­odo somente quando informado pelo usuÃ¡rio.
  const userStartKey = inputDateToKey(options?.dataInicial);
  const userEndKey = inputDateToKey(options?.dataFinal);
  const hasUserPeriod = userStartKey != null || userEndKey != null;

  if (hasUserPeriod) {
    const pDoc1 = extrairPeriodo(doc1);
    const pDoc2 = extrairPeriodo(doc2);
    const startKey = userStartKey ?? pDoc1.min ?? pDoc2.min;
    const endKey = userEndKey ?? pDoc1.max ?? pDoc2.max;

    doc1 = filtrarPorPeriodo(doc1, startKey, endKey);
    doc2 = filtrarPorPeriodo(doc2, startKey, endKey);

    console.log(
      `ðŸ—“ï¸ PerÃ­odo aplicado (yyyymmdd): ${startKey} â†’ ${endKey} (base: usuÃ¡rio)`
    );
  } else {
    console.log("ðŸ—“ï¸ Sem perÃ­odo informado. ConciliaÃ§Ã£o em todo o intervalo dos documentos.");
  }

  doc1 = ordenarLancamentosDeterministico(doc1);
  doc2 = ordenarLancamentosDeterministico(doc2);

  console.log(`ðŸ“Œ DOC1 lanÃ§amentos parseados: ${doc1.length}`);
  console.log(`ðŸ“Œ DOC2 lanÃ§amentos parseados: ${doc2.length}`);

  const mapDoc1 = buildMapFromLancamentos(doc1);
  const mapDoc2 = buildMapFromLancamentos(doc2);

  if (process.env.DEBUG_EXTRATO === "1") {
    for (const [key] of mapDoc2.entries()) {
      if (!mapDoc1.has(key)) console.log(`ðŸ§ª [MATCH] DOC1 NÃƒO TEM chave do DOC2 => ${key}`);
    }
  }

  const { csv: csvDivergencias, matchedByValue } = gerarCsvDivergenciasDeterministico(
    mapDoc1,
    mapDoc2
  );
  let matriz = csvParaMatriz(csvDivergencias);

  if (duplicatasPaths.length) {
    let doc3 = [];
    for (const p of duplicatasPaths) {
      const itens = await parseDuplicatas(p);
      doc3 = doc3.concat(itens || []);
    }
    if (doc3.length) {
      matriz = enriquecerMatrizComDoc3(matriz, doc3);
    }
  }

  const csvFinal = matriz.map((r) => r.join(";")).join("\n");

  const totalDivergencias = matriz.length > 1 ? matriz.length - 1 : 0;
  const temDivergencias = totalDivergencias > 0;

  console.log(`ðŸ“Š Total de divergÃªncias (determinÃ­stico): ${totalDivergencias}`);

  const planilha = XLSX.utils.aoa_to_sheet(matriz);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, planilha, "Divergencias");

  const outputFileName = options?.outputFileName || "conciliacao_divergencias.xlsx";
  const outputPath = path.join(__dirname, "..", "uploads", outputFileName);

  XLSX.writeFile(workbook, outputPath);
  console.log("âœ… Excel criado em:", outputPath);

  // âœ… NOVO: mÃ©tricas (NÃƒO muda conciliaÃ§Ã£o)
  const matches_count = contarMatchesDeterministic(mapDoc1, mapDoc2) + Number(matchedByValue || 0);
  const { absCentavos: volume_doc1_abs_centavos, netCentavos: volume_doc1_liquido_centavos } =
    calcularVolumeDoc1(doc1);

  const doc1_count = doc1.length;
  const doc2_count = doc2.length;
  const transacoes_count = doc1_count + doc2_count;

  return {
    outputPath,
    temDivergencias,
    totalDivergencias,
    csvDivergencias: csvFinal,

    // âœ… NOVO: usados no dashboard
    doc1_count,
    doc2_count,
    transacoes_count,
    matches_count,
    volume_doc1_abs_centavos,
    volume_doc1_liquido_centavos,
  };
}

// âœ… EXPORT GARANTIDO
export { rodarConciliacao };

