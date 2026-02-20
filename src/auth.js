// src/auth.js
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { getUserById } from "./repo/usersRepo.js";

export function requireAuth(req, res, next) {
  if (req.session?.user?.id) return next();
  return res.redirect("/login");
}

export function requireApiAuth(req, res, next) {
  if (req.session?.user?.id) return next();
  return res.status(401).json({ error: "Não autenticado" });
}

export function requireAdmin(req, res, next) {
  const u = req.session?.user;
  if (u?.role === "ADMIN") return next();
  return res.status(403).json({ error: "Apenas ADMIN" });
}

export async function refreshSessionUser(req) {
  const id = req.session?.user?.id;
  if (!id) return null;
  const dbUser = getUserById(id);
  if (!dbUser || dbUser.status !== "ACTIVE") return null;

  req.session.user = {
    id: dbUser.id,
    name: dbUser.name,
    email: dbUser.email,
    role: dbUser.role,
    status: dbUser.status,
  };
  return req.session.user;
}

export function hashPassword(plain) {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(String(plain || ""), salt);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(String(plain || ""), String(hash || ""));
}

export function makeResetToken() {
  return crypto.randomBytes(24).toString("hex");
}