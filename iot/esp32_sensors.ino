/**
 * SmartClass IoT — ESP32 Capteurs Environnement
 * ================================================
 * Matériel : ESP32-WROOM-32
 * Capteurs  : DHT22 (temp/humidité) + MAX4466 (bruit)
 * Protocole : WiFi → MQTT → Broker Mosquitto (Raspberry Pi)
 *
 * Auteur : Wessup / Wess Business City — PFE 2026
 *
 * Librairies Arduino requises :
 *   - PubSubClient (MQTT)     → Sketch > Gérer les bibliothèques
 *   - DHT sensor library      → par Adafruit
 *   - ArduinoJson             → v6.x
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <DHT.h>
#include <ArduinoJson.h>

// ─── Configuration WiFi ────────────────────────────────────────────────────
#define WIFI_SSID     "NomDuWiFi"        // ← À changer
#define WIFI_PASSWORD "MotDePasseWiFi"   // ← À changer

// ─── Configuration MQTT (Mosquitto sur Raspberry Pi) ──────────────────────
#define MQTT_SERVER   "192.168.1.100"    // ← IP du Raspberry Pi
#define MQTT_PORT     1883
#define MQTT_USER     "smartclass"       // ← Si authentification activée
#define MQTT_PASSWORD "wessup2026"

// ─── Topics MQTT ───────────────────────────────────────────────────────────
#define TOPIC_ENV      "smartclass/salle101/environment"
#define TOPIC_NOISE    "smartclass/salle101/noise"
#define TOPIC_STATUS   "smartclass/salle101/esp32/status"
#define TOPIC_CMD      "smartclass/salle101/commands"  // Écoute commandes

// ─── Broches ESP32 ─────────────────────────────────────────────────────────
#define DHT_PIN        4    // GPIO4 → DATA DHT22
#define DHT_TYPE       DHT22
#define MIC_PIN        34   // GPIO34 (ADC) → OUT MAX4466
#define LED_STATUS     2    // LED interne ESP32

// ─── Paramètres ────────────────────────────────────────────────────────────
#define SEND_INTERVAL_MS    5000   // Envoi toutes les 5 secondes
#define NOISE_SAMPLES       100    // Nb échantillons pour niveau sonore
#define ROOM_ID             "salle-101"

// ─── Objets ────────────────────────────────────────────────────────────────
DHT dht(DHT_PIN, DHT_TYPE);
WiFiClient espClient;
PubSubClient mqtt(espClient);

unsigned long lastSendTime = 0;
float lastTemp = 0, lastHum = 0;
int   lastNoise = 0;
bool  wifiConnected = false;

// ─── Connexion WiFi ────────────────────────────────────────────────────────
void connectWiFi() {
  Serial.print("[WiFi] Connexion à ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connecté ✓");
    Serial.print("[WiFi] IP: ");
    Serial.println(WiFi.localIP());
    wifiConnected = true;
    digitalWrite(LED_STATUS, HIGH);
  } else {
    Serial.println("\n[WiFi] Échec — mode hors ligne");
    wifiConnected = false;
  }
}

// ─── Callback MQTT (réception commandes) ──────────────────────────────────
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) {
    msg += (char)payload[i];
  }

  Serial.print("[MQTT] Commande reçue: ");
  Serial.println(msg);

  // Exemple : {"cmd": "reboot"} ou {"cmd": "set_interval", "value": 10}
  StaticJsonDocument<128> doc;
  if (deserializeJson(doc, msg) == DeserializationError::Ok) {
    String cmd = doc["cmd"] | "";
    if (cmd == "reboot") {
      Serial.println("[CMD] Redémarrage...");
      delay(500);
      ESP.restart();
    }
    // Ajouter d'autres commandes ici
  }
}

// ─── Connexion MQTT ────────────────────────────────────────────────────────
void connectMQTT() {
  while (!mqtt.connected()) {
    Serial.print("[MQTT] Connexion au broker...");
    String clientId = "ESP32-SmartClass-" + String(random(0xffff), HEX);

    bool connected = mqtt.connect(clientId.c_str(), MQTT_USER, MQTT_PASSWORD,
                                   TOPIC_STATUS, 0, true, "offline");
    if (connected) {
      Serial.println(" Connecté ✓");
      mqtt.publish(TOPIC_STATUS, "online", true);
      mqtt.subscribe(TOPIC_CMD);
    } else {
      Serial.print(" Échec (rc=");
      Serial.print(mqtt.state());
      Serial.println(") — retry dans 5s");
      delay(5000);
    }
  }
}

// ─── Lecture niveau sonore ─────────────────────────────────────────────────
int readNoiseLevel() {
  int maxVal = 0, minVal = 4095;

  for (int i = 0; i < NOISE_SAMPLES; i++) {
    int val = analogRead(MIC_PIN);
    if (val > maxVal) maxVal = val;
    if (val < minVal) minVal = val;
    delayMicroseconds(100);
  }

  // Amplitude crête-à-crête → niveau sonore 0-100
  int amplitude = maxVal - minVal;
  int noiseLevel = map(amplitude, 0, 2000, 0, 100);
  return constrain(noiseLevel, 0, 100);
}

// ─── Classification ambiance sonore ───────────────────────────────────────
String noiseCategory(int level) {
  if (level < 20) return "silencieux";
  if (level < 40) return "calme";
  if (level < 60) return "modéré";
  if (level < 80) return "bruyant";
  return "très bruyant";
}

// ─── Classification confort thermique ─────────────────────────────────────
String thermalComfort(float temp, float hum) {
  if (temp < 18.0) return "trop froid";
  if (temp > 26.0) return "trop chaud";
  if (temp >= 20.0 && temp <= 23.0 && hum >= 40 && hum <= 60) return "confortable";
  if (hum > 70) return "humide";
  return "acceptable";
}

// ─── Envoi données MQTT ────────────────────────────────────────────────────
void sendData() {
  // Lecture DHT22
  float temp = dht.readTemperature();
  float hum  = dht.readHumidity();

  if (isnan(temp) || isnan(hum)) {
    Serial.println("[DHT22] Erreur de lecture — utilisation dernière valeur");
    temp = lastTemp;
    hum  = lastHum;
  } else {
    lastTemp = temp;
    lastHum  = hum;
  }

  // Lecture microphone
  int noiseLevel = readNoiseLevel();
  lastNoise = noiseLevel;

  // ── Payload JSON principal (environnement) ──
  StaticJsonDocument<256> envDoc;
  envDoc["room_id"]          = ROOM_ID;
  envDoc["timestamp"]        = millis();
  envDoc["temperature"]      = round(temp * 10.0) / 10.0;
  envDoc["humidity"]         = round(hum * 10.0) / 10.0;
  envDoc["noise_level"]      = noiseLevel;
  envDoc["noise_category"]   = noiseCategory(noiseLevel);
  envDoc["thermal_comfort"]  = thermalComfort(temp, hum);
  envDoc["device_id"]        = "ESP32-ENV-01";
  envDoc["wifi_rssi"]        = WiFi.RSSI();

  char envBuffer[256];
  serializeJson(envDoc, envBuffer);

  bool ok = mqtt.publish(TOPIC_ENV, envBuffer, false);

  // Log série
  Serial.printf("[DATA] Temp: %.1f°C | Hum: %.1f%% | Bruit: %d%% (%s) | Confort: %s | MQTT: %s\n",
                temp, hum, noiseLevel,
                noiseCategory(noiseLevel).c_str(),
                thermalComfort(temp, hum).c_str(),
                ok ? "✓" : "✗");
}

// ─── Setup ─────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n========================================");
  Serial.println("  SmartClass IoT — ESP32 Capteurs");
  Serial.println("  Wessup / Wess Business City 2026");
  Serial.println("========================================\n");

  // Init broches
  pinMode(LED_STATUS, OUTPUT);
  pinMode(MIC_PIN, INPUT);
  analogSetAttenuation(ADC_11db);  // Pour ADC jusqu'à 3.3V

  // Init DHT22
  dht.begin();
  Serial.println("[DHT22] Initialisé ✓");

  // WiFi
  connectWiFi();

  // MQTT
  mqtt.setServer(MQTT_SERVER, MQTT_PORT);
  mqtt.setCallback(mqttCallback);
  mqtt.setKeepAlive(60);

  if (wifiConnected) {
    connectMQTT();
  }

  Serial.println("\n[READY] Envoi données toutes les " + String(SEND_INTERVAL_MS/1000) + "s\n");
}

// ─── Loop ──────────────────────────────────────────────────────────────────
void loop() {
  // Reconnexion WiFi si perdu
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Reconnexion...");
    connectWiFi();
  }

  // Reconnexion MQTT si perdu
  if (wifiConnected && !mqtt.connected()) {
    connectMQTT();
  }

  // Traitement messages MQTT entrants
  mqtt.loop();

  // Envoi périodique
  unsigned long now = millis();
  if (now - lastSendTime >= SEND_INTERVAL_MS) {
    lastSendTime = now;
    if (mqtt.connected()) {
      sendData();
    } else {
      Serial.println("[WARN] MQTT non connecté — données non envoyées");
    }
  }
}
