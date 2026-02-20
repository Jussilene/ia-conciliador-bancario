// src/repo/passwordResetsRepo.js
import { db } from "../db.js";

export function createPasswordReset(userId, token, expiresAtUnix) {
  db.prepare(
    `INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)`
  ).run(userId, token, expiresAtUnix);
}

export function getPasswordResetByToken(token) {
  return db
    .prepare(`SELECT * FROM password_resets WHERE token = ?`)
    .get(token);
}

export function deletePasswordResetByToken(token) {
  db.prepare(`DELETE FROM password_resets WHERE token = ?`).run(token);
}

// opcional: limpeza
export function deleteExpiredResets(nowUnix) {
  db.prepare(`DELETE FROM password_resets WHERE expires_at < ?`).run(nowUnix);
}