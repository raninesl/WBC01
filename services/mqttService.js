/**
 * SmartClass — Service MQTT
 * =========================
 * Reçoit les données IoT (ESP32) via MQTT
 * et les diffuse en temps réel via Socket.IO
 *
 * Topics écoutés :
 *   smartclass/+/environment  → temp, humidité, bruit
 *   smartclass/+/energy       → conso électrique (Shelly)
 *   smartclass/+/heating      → état chauffage
 *   smartclass/+/esp32/status → statut ESP32
 *
 * Wessup / Wess Business City — PFE 2026
 */

const mqtt   = require('mqtt');
const IotData = require('../models/IotData');

// ─── Configuration MQTT ───────────────────────────────────────────────────
const MQTT_CONFIG = {
  host:     process.env.MQTT_HOST     || 'localhost',
  port:     parseInt(process.env.MQTT_PORT) || 1883,
  username: process.env.MQTT_USER     || 'smartclass',
  password: process.env.MQTT_PASSWORD || 'wessup2026',
  clientId: `WBC-Backend-${Math.random().toString(16).slice(2, 8)}`,
  reconnectPeriod: 3000,
  connectTimeout: 10000,
};

// ─── Topics ───────────────────────────────────────────────────────────────
const TOPICS = {
  ENVIRONMENT: 'smartclass/+/environment',
  ENERGY:      'smartclass/+/energy',
  HEATING:     'smartclass/+/heating',
  STATUS:      'smartclass/+/esp32/status',
  ENGAGEMENT:  'smartclass/+/engagement',  // résultats IA Raspberry Pi
};

// Commandes vers ESP32
const CMD_TOPICS = {
  heating: (roomId, payload) => ({ topic: `smartclass/${roomId}/commands`, payload }),
};

// ─── État en mémoire par salle ────────────────────────────────────────────
const roomState = {};

function getRoomState(roomId) {
  if (!roomState[roomId]) {
    roomState[roomId] = {
      roomId,
      temperature:     null,
      humidity:        null,
      noise_level:     null,
      noise_category:  null,
      thermal_comfort: null,
      energy_w:        null,
      energy_kwh:      null,
      heating_mode:    'unknown',
      esp32_online:    false,
      engagement_score: null,
      student_count:   null,
      session_profile: null,
      lastUpdate:      null,
    };
  }
  return roomState[roomId];
}

// ─── Extraction roomId depuis le topic ───────────────────────────────────
function extractRoomId(topic) {
  const parts = topic.split('/');
  return parts[1] || 'unknown';
}

// ─── Initialisation MQTT ─────────────────────────────────────────────────
let mqttClient = null;
let io = null;  // Socket.IO instance

function initMQTT(socketIo) {
  io = socketIo;

  const brokerUrl = `mqtt://${MQTT_CONFIG.host}:${MQTT_CONFIG.port}`;
  console.log(`[MQTT] Connexion au broker ${brokerUrl}...`);

  mqttClient = mqtt.connect(brokerUrl, {
    username:        MQTT_CONFIG.username,
    password:        MQTT_CONFIG.password,
    clientId:        MQTT_CONFIG.clientId,
    reconnectPeriod: MQTT_CONFIG.reconnectPeriod,
    connectTimeout:  MQTT_CONFIG.connectTimeout,
    will: {
      topic: 'smartclass/backend/status',
      payload: 'offline',
      retain: true,
    },
  });

  // ── Connexion réussie ──
  mqttClient.on('connect', () => {
    console.log('[MQTT] Broker connecté ✓');
    mqttClient.publish('smartclass/backend/status', 'online', { retain: true });

    // S'abonner à tous les topics
    Object.values(TOPICS).forEach(topic => {
      mqttClient.subscribe(topic, { qos: 1 }, (err) => {
        if (!err) console.log(`[MQTT] Abonné: ${topic}`);
        else console.error(`[MQTT] Erreur abonnement ${topic}: ${err.message}`);
      });
    });
  });

  // ── Réception message ──
  mqttClient.on('message', async (topic, payload) => {
    try {
      const data = JSON.parse(payload.toString());
      const roomId = extractRoomId(topic);
      const state = getRoomState(roomId);
      state.lastUpdate = new Date();

      // ── Données environnement (ESP32) ──
      if (topic.includes('/environment')) {
        state.temperature     = data.temperature;
        state.humidity        = data.humidity;
        state.noise_level     = data.noise_level;
        state.noise_category  = data.noise_category;
        state.thermal_comfort = data.thermal_comfort;
        state.esp32_online    = true;

        // Sauvegarde MongoDB
        await IotData.create({
          roomId,
          type: 'environment',
          temperature:    data.temperature,
          humidity:       data.humidity,
          noise_level:    data.noise_level,
          noise_category: data.noise_category,
          thermal_comfort: data.thermal_comfort,
          timestamp: new Date(),
        });

        // Broadcast Socket.IO
        emitToRoom(roomId, 'iot:environment', {
          roomId,
          temperature:    data.temperature,
          humidity:       data.humidity,
          noise_level:    data.noise_level,
          noise_category: data.noise_category,
          thermal_comfort: data.thermal_comfort,
          timestamp: state.lastUpdate,
        });

        // Alertes automatiques
        checkEnvironmentAlerts(roomId, data);

        console.log(`[IOT] Env ${roomId} — Temp: ${data.temperature}°C | Hum: ${data.humidity}% | Bruit: ${data.noise_level}%`);
      }

      // ── Données énergie (Shelly Plug) ──
      else if (topic.includes('/energy')) {
        state.energy_w   = data.power_w;
        state.energy_kwh = data.energy_kwh;

        await IotData.create({
          roomId,
          type: 'energy',
          power_w:    data.power_w,
          energy_kwh: data.energy_kwh,
          timestamp:  new Date(),
        });

        emitToRoom(roomId, 'iot:energy', {
          roomId,
          power_w:    data.power_w,
          energy_kwh: data.energy_kwh,
          timestamp:  state.lastUpdate,
        });

        console.log(`[IOT] Énergie ${roomId} — ${data.power_w}W | ${data.energy_kwh} kWh`);
      }

      // ── État chauffage ──
      else if (topic.includes('/heating')) {
        state.heating_mode = data.mode;
        emitToRoom(roomId, 'iot:heating', { roomId, mode: data.mode, timestamp: state.lastUpdate });
        console.log(`[IOT] Chauffage ${roomId} — Mode: ${data.mode}`);
      }

      // ── Statut ESP32 ──
      else if (topic.includes('/esp32/status')) {
        const online = payload.toString() === 'online';
        state.esp32_online = online;
        emitToRoom(roomId, 'iot:device_status', { roomId, device: 'esp32', online });
        console.log(`[IOT] ESP32 ${roomId} — ${online ? 'ONLINE ✓' : 'OFFLINE ✗'}`);
      }

      // ── Données engagement IA (Raspberry Pi) ──
      else if (topic.includes('/engagement')) {
        state.engagement_score = data.engagement_score;
        state.student_count    = data.student_count;
        state.session_profile  = data.session_profile;

        emitToRoom(roomId, 'smartclass:engagement', {
          roomId,
          ...data,
          timestamp: state.lastUpdate,
        });

        console.log(`[IA] Engagement ${roomId} — Score: ${data.engagement_score}% | ${data.student_count} étudiants`);
      }

    } catch (err) {
      console.error(`[MQTT] Erreur traitement message (${topic}):`, err.message);
    }
  });

  // ── Erreur ──
  mqttClient.on('error', (err) => {
    console.error('[MQTT] Erreur:', err.message);
  });

  // ── Reconnexion ──
  mqttClient.on('reconnect', () => {
    console.log('[MQTT] Reconnexion en cours...');
  });

  return mqttClient;
}

// ─── Alertes automatiques ─────────────────────────────────────────────────
function checkEnvironmentAlerts(roomId, data) {
  const alerts = [];

  if (data.temperature > 28) {
    alerts.push({ type: 'temperature_high', message: `Température élevée: ${data.temperature}°C`, severity: 'warning' });
  }
  if (data.temperature < 16) {
    alerts.push({ type: 'temperature_low', message: `Température basse: ${data.temperature}°C`, severity: 'warning' });
  }
  if (data.noise_level > 75) {
    alerts.push({ type: 'noise_high', message: `Niveau sonore élevé: ${data.noise_level}%`, severity: 'info' });
  }
  if (data.humidity > 75) {
    alerts.push({ type: 'humidity_high', message: `Humidité élevée: ${data.humidity}%`, severity: 'info' });
  }

  alerts.forEach(alert => {
    emitToRoom(roomId, 'iot:alert', { roomId, ...alert, timestamp: new Date() });
    console.log(`[ALERTE] ${roomId}: ${alert.message}`);
  });
}

// ─── Emission Socket.IO ───────────────────────────────────────────────────
function emitToRoom(roomId, event, data) {
  if (!io) return;
  // Émettre à tous les clients abonnés à cette salle
  io.to(`room:${roomId}`).emit(event, data);
  // Émettre aussi globalement (pour les dashboards admins)
  io.emit(`${event}:global`, data);
}

// ─── Commandes vers l'IoT ─────────────────────────────────────────────────
function sendHeatingCommand(roomId, mode) {
  if (!mqttClient || !mqttClient.connected) {
    console.warn('[MQTT] Client non connecté — commande ignorée');
    return false;
  }
  const validModes = ['OFF', 'LOW', 'MID', 'HIGH', 'AUTO'];
  if (!validModes.includes(mode)) {
    console.warn(`[MQTT] Mode chauffage invalide: ${mode}`);
    return false;
  }
  const payload = JSON.stringify({ cmd: 'set_heating', mode, timestamp: Date.now() });
  const topic = `smartclass/${roomId}/commands`;
  mqttClient.publish(topic, payload, { qos: 1 });
  console.log(`[MQTT] Commande chauffage envoyée: ${roomId} → ${mode}`);
  return true;
}

function sendPlugCommand(roomId, plugId, state) {
  if (!mqttClient || !mqttClient.connected) return false;
  const payload = JSON.stringify({ cmd: 'set_plug', plug_id: plugId, state, timestamp: Date.now() });
  mqttClient.publish(`smartclass/${roomId}/commands`, payload, { qos: 1 });
  console.log(`[MQTT] Commande prise ${plugId}: ${state ? 'ON' : 'OFF'}`);
  return true;
}

// ─── Getters état salles ──────────────────────────────────────────────────
function getRoomStatus(roomId) {
  return roomState[roomId] || null;
}

function getAllRoomsStatus() {
  return roomState;
}

module.exports = {
  initMQTT,
  sendHeatingCommand,
  sendPlugCommand,
  getRoomStatus,
  getAllRoomsStatus,
};
