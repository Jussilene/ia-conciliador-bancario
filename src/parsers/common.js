// src/parsers/common.js

export function parseDateBRToISO(dateBR) {
  // dd/mm/aaaa -> aaaa-mm-dd
  const m = String(dateBR || "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function isoToDateBR(iso) {
  const m = String(iso || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function parseValorBRToCentavos(valorBR) {
  // Aceita "1.234,56", "1234,56", "1234.56", "-250.00", "1.234"
  let raw = String(valorBR || "").trim();
  if (!raw) return null;

  raw = raw.replace(/\s/g, "").replace(/[R$]/g, "");
  const negativo = raw.startsWith("-");
  raw = raw.replace(/^[+-]/, "");

  let normalized = raw;
  const hasComma = raw.includes(",");
  const hasDot = raw.includes(".");

  if (hasComma) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (hasDot) {
    const parts = raw.split(".");
    if (parts.length > 2) {
      normalized = raw.replace(/\./g, "");
    } else {
      const dec = parts[1] || "";
      normalized = dec.length === 2 ? raw : raw.replace(/\./g, "");
    }
  }

  const n = Number(normalized);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  return negativo ? -Math.abs(cents) : cents;
}

export function centavosToValorBR(c) {
  const n = (Number(c) || 0) / 100;
  // 1234.56 -> "1.234,56"
  const fixed = n.toFixed(2);
  const [i, d] = fixed.split(".");
  const withThousands = i.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${withThousands},${d}`;
}

export function makeKey(dateISO, valorCentavos) {
  return `${dateISO}|${valorCentavos}`;
}

export function cleanLine(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}
