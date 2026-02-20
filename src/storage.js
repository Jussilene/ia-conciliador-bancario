// src/storage.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "concilicoes.json");

function ensure() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify({ concilios: [] }, null, 2));
}

export function readDB() {
  ensure();
  const raw = fs.readFileSync(dbPath, "utf8");
  return JSON.parse(raw || '{"concilios":[]}');
}

export function writeDB(db) {
  ensure();
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

export function addConciliacao(record) {
  const db = readDB();
  db.concilios.unshift(record); // mais recente primeiro
  writeDB(db);
  return record;
}

export function listConcilios() {
  const db = readDB();
  return db.concilios || [];
}

export function getConcilio(id) {
  const db = readDB();
  return (db.concilios || []).find((c) => c.id === id) || null;
}

export function deleteConcilio(id) {
  const db = readDB();
  const before = (db.concilios || []).length;
  db.concilios = (db.concilios || []).filter((c) => c.id !== id);
  writeDB(db);
  return before !== db.concilios.length;
}
