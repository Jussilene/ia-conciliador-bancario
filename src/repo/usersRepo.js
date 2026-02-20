// src/repo/usersRepo.js
import { getDb } from "../db.js";

function nowPtBr() {
  const d = new Date();
  const date = d.toLocaleDateString("pt-BR");
  const time = d.toLocaleTimeString("pt-BR").slice(0, 8);
  return `${date} ${time}`;
}

export function createUser({ name, email, password_hash, role = "USER", status = "ACTIVE" }) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO users (name, email, password_hash, role, status, created_at, updated_at)
    VALUES (@name, @email, @password_hash, @role, @status, @created_at, @updated_at)
  `);
  const result = stmt.run({
    name,
    email: String(email || "").toLowerCase().trim(),
    password_hash,
    role,
    status,
    created_at: nowPtBr(),
    updated_at: nowPtBr(),
  });
  return { id: result.lastInsertRowid };
}

export function getUserByEmail(email) {
  const db = getDb();
  return (
    db
      .prepare(`SELECT * FROM users WHERE lower(email) = lower(?) LIMIT 1`)
      .get(String(email || "").trim()) || null
  );
}

export function getUserById(id) {
  const db = getDb();
  return db.prepare(`SELECT * FROM users WHERE id = ? LIMIT 1`).get(Number(id)) || null;
}

export function listUsers() {
  const db = getDb();
  return db
    .prepare(
      `
      SELECT id, name, email, role, status, created_at, updated_at
      FROM users
      ORDER BY id DESC
      LIMIT 500
    `
    )
    .all();
}

export function updateUserStatus(id, status) {
  const db = getDb();
  db.prepare(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`)
    .run(String(status), nowPtBr(), Number(id));
  return true;
}

export function updateUserRole(id, role) {
  const db = getDb();
  db.prepare(`UPDATE users SET role = ?, updated_at = ? WHERE id = ?`)
    .run(String(role), nowPtBr(), Number(id));
  return true;
}

export function updateUserName(id, name) {
  const db = getDb();
  db.prepare(`UPDATE users SET name = ?, updated_at = ? WHERE id = ?`)
    .run(String(name || ""), nowPtBr(), Number(id));
  return true;
}

export function updateUserEmail(id, email) {
  const db = getDb();
  const em = String(email || "").toLowerCase().trim();
  db.prepare(`UPDATE users SET email = ?, updated_at = ? WHERE id = ?`)
    .run(em, nowPtBr(), Number(id));
  return true;
}

export function updateUserPasswordHash(id, password_hash) {
  const db = getDb();
  db.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`)
    .run(password_hash, nowPtBr(), Number(id));
  return true;
}

// ✅ NOVO: excluir usuário
export function deleteUserById(id) {
  const db = getDb();
  db.prepare(`DELETE FROM users WHERE id = ?`).run(Number(id));
  return true;
}

// reset token (esqueci a senha)
export function setResetToken(email, token, expiresAtIso) {
  const db = getDb();
  const row = getUserByEmail(email);
  if (!row) return false;
  db.prepare(
    `UPDATE users SET reset_token = ?, reset_token_expires_at = ?, updated_at = ? WHERE id = ?`
  ).run(token, expiresAtIso, nowPtBr(), row.id);
  return true;
}

export function getUserByResetToken(token) {
  const db = getDb();
  return (
    db.prepare(`SELECT * FROM users WHERE reset_token = ? LIMIT 1`).get(String(token || "")) ||
    null
  );
}

export function clearResetToken(userId) {
  const db = getDb();
  db.prepare(
    `UPDATE users SET reset_token = NULL, reset_token_expires_at = NULL, updated_at = ? WHERE id = ?`
  ).run(nowPtBr(), Number(userId));
  return true;
}