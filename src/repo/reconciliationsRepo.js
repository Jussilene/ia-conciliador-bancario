// src/repo/reconciliationsRepo.js
import { getDb } from "../db.js";

function nowPtBr() {
  const d = new Date();
  const date = d.toLocaleDateString("pt-BR");
  const time = d.toLocaleTimeString("pt-BR").slice(0, 8);
  return `${date} ${time}`;
}

export function createReconciliation(payload) {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT INTO reconciliations (
      name, created_at,
      extrato_original, controle_original, duplicatas_original,
      extrato_saved_path, controle_saved_path, duplicatas_saved_path,
      output_filename,
      divergences_count, has_divergences, status,
      divergences_csv,

      doc1_count, doc2_count, transacoes_count, matches_count,
      volume_doc1_abs_centavos, volume_doc1_liquido_centavos,

      user_id
    ) VALUES (
      @name, @created_at,
      @extrato_original, @controle_original, @duplicatas_original,
      @extrato_saved_path, @controle_saved_path, @duplicatas_saved_path,
      @output_filename,
      @divergences_count, @has_divergences, @status,
      @divergences_csv,

      @doc1_count, @doc2_count, @transacoes_count, @matches_count,
      @volume_doc1_abs_centavos, @volume_doc1_liquido_centavos,

      @user_id
    )
  `);

  const result = stmt.run({
    name: payload.name,
    created_at: nowPtBr(),
    extrato_original: payload.extrato_original || null,
    controle_original: payload.controle_original || null,
    duplicatas_original: payload.duplicatas_original || null,
    extrato_saved_path: payload.extrato_saved_path || null,
    controle_saved_path: payload.controle_saved_path || null,
    duplicatas_saved_path: payload.duplicatas_saved_path || null,
    output_filename: payload.output_filename,
    divergences_count: Number(payload.divergences_count || 0),
    has_divergences: Number(payload.has_divergences || 0),
    status: payload.status || "concluida",
    divergences_csv: payload.divergences_csv || "",

    // ✅ métricas
    doc1_count: Number(payload.doc1_count || 0),
    doc2_count: Number(payload.doc2_count || 0),
    transacoes_count: Number(payload.transacoes_count || 0),
    matches_count: Number(payload.matches_count || 0),
    volume_doc1_abs_centavos: Number(payload.volume_doc1_abs_centavos || 0),
    volume_doc1_liquido_centavos: Number(payload.volume_doc1_liquido_centavos || 0),

    // ✅ isolamento
    user_id: payload.user_id == null ? null : Number(payload.user_id),
  });

  return { id: result.lastInsertRowid };
}

export function listReconciliations(userId) {
  const db = getDb();

  // ✅ se userId vier, filtra. Se não vier, mantém comportamento (admin interno/debug).
  if (userId != null) {
    return db
      .prepare(
        `
        SELECT
          id, name, created_at,
          divergences_count, has_divergences, status,
          output_filename,
          extrato_original, controle_original, duplicatas_original
        FROM reconciliations
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 200
      `
      )
      .all(Number(userId));
  }

  const rows = db
    .prepare(
      `
      SELECT
        id, name, created_at,
        divergences_count, has_divergences, status,
        output_filename,
        extrato_original, controle_original, duplicatas_original
      FROM reconciliations
      ORDER BY id DESC
      LIMIT 200
    `
    )
    .all();

  return rows;
}

export function getReconciliationById(id, userId) {
  const db = getDb();

  if (userId != null) {
    const row = db
      .prepare(
        `
        SELECT *
        FROM reconciliations
        WHERE id = ?
          AND user_id = ?
        LIMIT 1
      `
      )
      .get(Number(id), Number(userId));
    return row || null;
  }

  const row = db
    .prepare(
      `
      SELECT *
      FROM reconciliations
      WHERE id = ?
      LIMIT 1
    `
    )
    .get(Number(id));

  return row || null;
}

export function deleteReconciliationById(id, userId) {
  const db = getDb();

  if (userId != null) {
    db.prepare(`DELETE FROM reconciliations WHERE id = ? AND user_id = ?`).run(
      Number(id),
      Number(userId)
    );
    return true;
  }

  db.prepare(`DELETE FROM reconciliations WHERE id = ?`).run(Number(id));
  return true;
}

export function getDashboardStats(userId) {
  const db = getDb();

  if (userId != null) {
    const uid = Number(userId);

    const total = db
      .prepare(`SELECT COUNT(*) as n FROM reconciliations WHERE user_id = ?`)
      .get(uid).n;

    const divergencias = db
      .prepare(
        `SELECT COALESCE(SUM(divergences_count), 0) as n FROM reconciliations WHERE user_id = ?`
      )
      .get(uid).n;

    const pendentes = db
      .prepare(
        `SELECT COUNT(*) as n FROM reconciliations WHERE user_id = ? AND divergences_count > 0`
      )
      .get(uid).n;

    const transacoes = db
      .prepare(
        `SELECT COALESCE(SUM(transacoes_count), 0) as n FROM reconciliations WHERE user_id = ?`
      )
      .get(uid).n;

    const conciliadas = db
      .prepare(
        `SELECT COALESCE(SUM(matches_count), 0) as n FROM reconciliations WHERE user_id = ?`
      )
      .get(uid).n;

    const volume_doc1_abs_centavos = db
      .prepare(
        `SELECT COALESCE(SUM(volume_doc1_abs_centavos), 0) as n FROM reconciliations WHERE user_id = ?`
      )
      .get(uid).n;

    const recentes = db
      .prepare(
        `
        SELECT id, name, created_at, divergences_count
        FROM reconciliations
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 5
      `
      )
      .all(uid);

    return {
      total,
      transacoes,
      conciliadas,
      divergencias,
      pendentes,
      volume_doc1_abs_centavos,
      recentes,
    };
  }

  // fallback antigo (se chamar sem userId)
  const total = db.prepare(`SELECT COUNT(*) as n FROM reconciliations`).get().n;

  const divergencias = db
    .prepare(`SELECT COALESCE(SUM(divergences_count), 0) as n FROM reconciliations`)
    .get().n;

  const pendentes = db
    .prepare(`SELECT COUNT(*) as n FROM reconciliations WHERE divergences_count > 0`)
    .get().n;

  const transacoes = db
    .prepare(`SELECT COALESCE(SUM(transacoes_count), 0) as n FROM reconciliations`)
    .get().n;

  const conciliadas = db
    .prepare(`SELECT COALESCE(SUM(matches_count), 0) as n FROM reconciliations`)
    .get().n;

  const volume_doc1_abs_centavos = db
    .prepare(`SELECT COALESCE(SUM(volume_doc1_abs_centavos), 0) as n FROM reconciliations`)
    .get().n;

  const recentes = db
    .prepare(
      `
      SELECT id, name, created_at, divergences_count
      FROM reconciliations
      ORDER BY id DESC
      LIMIT 5
    `
    )
    .all();

  return {
    total,
    transacoes,
    conciliadas,
    divergencias,
    pendentes,
    volume_doc1_abs_centavos,
    recentes,
  };
}