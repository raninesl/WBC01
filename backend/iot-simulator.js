// backend/iot-simulator.js
import 'dotenv/config';

const API_URL = process.env.API_URL || 'http://localhost:4000';
const IOT_API_KEY = process.env.IOT_API_KEY;
const CLASSROOM_ID = 'CLASS_A'; // Simuler pour la classe A
const INTERVAL_MS = 10000; // Toutes les 10 secondes

if (!IOT_API_KEY) {
  console.error("La clé IOT_API_KEY n'est pas définie dans le .env");
  process.exit(1);
}

async function sendActivityData() {
  const movementPercentage = Math.floor(Math.random() * 101); // 0 to 100

  console.log(`[${new Date().toISOString()}] Envoi de l'activité pour ${CLASSROOM_ID}: ${movementPercentage}%`);

  try {
    const response = await fetch(`${API_URL}/api/iot/activity`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': IOT_API_KEY,
      },
      body: JSON.stringify({
        classroomId: CLASSROOM_ID,
        movementPercentage,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error(`Erreur lors de l'envoi des données: ${response.status}`, errorData);
    } else {
      const data = await response.json();
      console.log('Données enregistrées avec succès:', data);
    }
  } catch (error) {
    console.error("Erreur de connexion à l'API:", error.message);
  }
}

console.log('Lancement du simulateur de caméra IoT...');
console.log(`Envoi de données toutes les ${INTERVAL_MS / 1000} secondes vers ${API_URL}`);

// Lancer immédiatement, puis toutes les X secondes
sendActivityData();
setInterval(sendActivityData, INTERVAL_MS);