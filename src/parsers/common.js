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
  // "1.234,56" => 123456
  const s = String(valorBR || "")
    .replace(/\s/g, "")
    .replace(/[R$]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
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
