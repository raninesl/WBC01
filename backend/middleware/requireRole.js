// backend/middleware/requireRole.js
export default function requireRole(...roles) {
  const allowed = roles.map((r) => String(r).toUpperCase());

  return (req, res, next) => {
    const role = String(req.user?.role || "").toUpperCase();
    if (!role) return res.status(401).json({ message: "Non authentifié" });
    if (!allowed.includes(role)) return res.status(403).json({ message: "Accès refusé" });
    next();
  };
}
