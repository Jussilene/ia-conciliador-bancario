// src/db.js
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { hashPassword } from "./auth.js";
import { getUserByEmail, createUser } from "./repo/usersRepo.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "..", "data", "conciliador.sqlite");

let db = null;

export function getDb() {
  if (!db) {
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
  }
  return db;
}

function tableHasColumn(database, table, column) {
  try {
    const cols = database.prepare(`PRAGMA table_info(${table})`).all();
    return cols.some(
      (c) => String(c.name).toLowerCase() === String(column).toLowerCase()
    );
  } catch {
    return false;
  }
}

function addColumnIfMissing(database, table, column, sqlTypeAndDefault) {
  if (tableHasColumn(database, table, column)) return;
  database.exec(
    `ALTER TABLE ${table} ADD COLUMN ${column} ${sqlTypeAndDefault};`
  );
}

export function initDb() {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const database = getDb();

  // -----------------------------
  // RECONCILIATIONS (SEU ORIGINAL)
  // -----------------------------
  database.exec(`
    CREATE TABLE IF NOT EXISTS reconciliations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,

      extrato_original TEXT,
      controle_original TEXT,
      duplicatas_original TEXT,

      extrato_saved_path TEXT,
      controle_saved_path TEXT,
      duplicatas_saved_path TEXT,

      output_filename TEXT NOT NULL,

      divergences_count INTEGER NOT NULL DEFAULT 0,
      has_divergences INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'concluida',

      divergences_csv TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_reconciliations_created_at
      ON reconciliations(created_at);
  `);

  // ✅ dashboard cols
  addColumnIfMissing(database, "reconciliations", "doc1_count", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(database, "reconciliations", "doc2_count", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(database, "reconciliations", "transacoes_count", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(database, "reconciliations", "matches_count", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(database, "reconciliations", "volume_doc1_abs_centavos", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing(database, "reconciliations", "volume_doc1_liquido_centavos", "INTEGER NOT NULL DEFAULT 0");

  // ✅ NOVO: isolar histórico por usuário (cada user vê só o que é dele)
  // Mantive como coluna adicionada (sem recriar tabela).
  addColumnIfMissing(database, "reconciliations", "user_id", "INTEGER");

  // -----------------------------
  // USERS (NOVO)
  // -----------------------------
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'USER',     -- ADMIN | USER
      status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | INACTIVE
      reset_token TEXT,
      reset_token_expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  // -----------------------------
  // SEED ADMIN
  // -----------------------------
  const adminEmail = (process.env.ADMIN_EMAIL || "admin@concilia.local").toLowerCase();
  const adminPass = process.env.ADMIN_PASSWORD || "Admin123!";
  const adminName = process.env.ADMIN_NAME || "Admin";

  const exists = getUserByEmail(adminEmail);
  if (!exists) {
    createUser({
      name: adminName,
      email: adminEmail,
      password_hash: hashPassword(adminPass),
      role: "ADMIN",
      status: "ACTIVE",
    });
    console.log("✅ Admin criado:", adminEmail);
    console.log("🔐 Senha inicial (troque depois):", adminPass);
  }

  return true;
}