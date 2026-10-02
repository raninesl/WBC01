// backend/middleware/auth.js
import jwt from "jsonwebtoken";

export function auth(req, res, next) {
  const h = req.headers.authorization || "";
  if (!h.startsWith("Bearer ")) return res.status(401).json({ message: "Token manquant" });

  const token = h.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret_change_me");
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ message: "Token non valide" });
  }
}
