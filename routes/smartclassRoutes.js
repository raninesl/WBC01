/**
 * Routes API SmartClass
 * =====================
 * GET  /api/smartclass/rooms              → liste des salles
 * GET  /api/smartclass/room/:id           → état temps réel d'une salle
 * GET  /api/smartclass/room/:id/history   → historique données
 * POST /api/smartclass/room/:id/heating   → contrôle chauffage
 * POST /api/smartclass/room/:id/plug      → contrôle prise
 * POST /api/smartclass/engagement         → reçoit données IA (Raspberry Pi)
 *
 * Wessup / Wess Business City — PFE 2026
 */

const express = require('express');
const router  = express.Router();
const IotData = require('../models/IotData');
const { requireRole } = require('../middleware/auth');
const {
  sendHeatingCommand,
  sendPlugCommand,
  getRoomStatus,
  getAllRoomsStatus,
} = require('../services/mqttService');

// ─── GET /rooms — Toutes les salles ───────────────────────────────────────
router.get('/rooms', async (req, res) => {
  try {
    const allStatus = getAllRoomsStatus();
    res.json({ success: true, rooms: Object.values(allStatus) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /room/:id — État temps réel ──────────────────────────────────────
router.get('/room/:id', async (req, res) => {
  try {
    const status = getRoomStatus(req.params.id);
    if (!status) {
      return res.status(404).json({ success: false, error: 'Salle non trouvée' });
    }
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /room/:id/history — Historique ───────────────────────────────────
router.get('/room/:id/history', async (req, res) => {
  try {
    const { type = 'environment', hours = 24, limit = 100 } = req.query;
    const since = new Date(Date.now() - hours * 3600000);

    const data = await IotData.find({
      roomId: req.params.id,
      type,
      timestamp: { $gte: since },
    })
    .sort({ timestamp: -1 })
    .limit(parseInt(limit))
    .lean();

    res.json({ success: true, count: data.length, data: data.reverse() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET /room/:id/stats — Statistiques agrégées ──────────────────────────
router.get('/room/:id/stats', async (req, res) => {
  try {
    const { hours = 24 } = req.query;
    const since = new Date(Date.now() - hours * 3600000);

    const [envStats, energyStats, engagementStats] = await Promise.all([
      IotData.aggregate([
        { $match: { roomId: req.params.id, type: 'environment', timestamp: { $gte: since } } },
        { $group: {
          _id: null,
          avg_temp: { $avg: '$temperature' },
          max_temp: { $max: '$temperature' },
          min_temp: { $min: '$temperature' },
          avg_hum:  { $avg: '$humidity' },
          avg_noise: { $avg: '$noise_level' },
          count: { $sum: 1 },
        }}
      ]),
      IotData.aggregate([
        { $match: { roomId: req.params.id, type: 'energy', timestamp: { $gte: since } } },
        { $group: {
          _id: null,
          total_kwh: { $sum: '$energy_kwh' },
          avg_power: { $avg: '$power_w' },
          max_power: { $max: '$power_w' },
        }}
      ]),
      IotData.aggregate([
        { $match: { roomId: req.params.id, type: 'engagement', timestamp: { $gte: since } } },
        { $group: {
          _id: null,
          avg_engagement: { $avg: '$engagement_score' },
          avg_students:   { $avg: '$student_count' },
          avg_distracted: { $avg: '$distracted_pct' },
          avg_fatigued:   { $avg: '$fatigued_pct' },
        }}
      ]),
    ]);

    res.json({
      success: true,
      roomId: req.params.id,
      period_hours: hours,
      environment: envStats[0] || null,
      energy: energyStats[0] || null,
      engagement: engagementStats[0] || null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── POST /room/:id/heating — Contrôle chauffage ──────────────────────────
router.post('/room/:id/heating', requireRole('teacher', 'admin'), async (req, res) => {
  const { mode } = req.body;
  const validModes = ['OFF', 'LOW', 'MID', 'HIGH', 'AUTO'];

  if (!validModes.includes(mode)) {
    return res.status(400).json({
      success: false,
      error: `Mode invalide. Valeurs: ${validModes.join(', ')}`,
    });
  }

  const ok = sendHeatingCommand(req.params.id, mode);
  res.json({
    success: ok,
    message: ok ? `Chauffage ${req.params.id} → ${mode}` : 'MQTT non disponible',
  });
});

// ─── POST /room/:id/plug — Contrôle prise ────────────────────────────────
router.post('/room/:id/plug', requireRole('teacher', 'admin'), async (req, res) => {
  const { plug_id, state } = req.body;
  if (!plug_id || state === undefined) {
    return res.status(400).json({ success: false, error: 'plug_id et state requis' });
  }
  const ok = sendPlugCommand(req.params.id, plug_id, state);
  res.json({ success: ok, message: ok ? `Prise ${plug_id} → ${state ? 'ON' : 'OFF'}` : 'MQTT non disponible' });
});

// ─── POST /engagement — Données IA depuis Raspberry Pi ───────────────────
router.post('/engagement', async (req, res) => {
  try {
    const data = req.body;
    const roomId = data.room_id || data.roomId || 'unknown';

    // Sauvegarder en base
    await IotData.create({
      roomId,
      type: 'engagement',
      engagement_score: data.engagement_score,
      student_count:    data.student_count,
      engaged_pct:      data.engaged_pct,
      distracted_pct:   data.distracted_pct,
      fatigued_pct:     data.fatigued_pct,
      session_profile:  data.session_profile,
      timestamp: new Date(),
    });

    res.json({ success: true, message: 'Données IA reçues' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
