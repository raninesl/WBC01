import fetch from "node-fetch";

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";
const LLM_PROVIDER = process.env.LLM_PROVIDER || "ollama";
const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || "15000", 10);
const OLLAMA_TIMEOUT_MS = parseInt(process.env.OLLAMA_TIMEOUT_MS || "45000", 10);
const OLLAMA_PING_MS = parseInt(process.env.OLLAMA_PING_MS || "2000", 10);

function timeoutPromise(ms, label) {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout ${label} après ${ms}ms`)), ms)
  );
}

function buildMessages(message, history, systemPrompt) {
  const messages = [];
  if (systemPrompt) messages.push({ role: "system", content: systemPrompt });

  const recentHistory = history
    .filter(msg => msg.content !== message)
    .slice(-10)
    .map(msg => ({
      role: msg.role === "bot" ? "assistant" : msg.role,
      content: msg.content
    }));

  messages.push(...recentHistory);
  messages.push({ role: "user", content: message });
  return messages;
}

/**
 * Service pour interagir avec un LLM.
 * - PRODUCTION : STRICTEMENT les providers cloud (Groq). Pas de fallback local Ollama.
 * - DEVELOPMENT : Groq en premier, fallback Ollama local (pour debug sans internet).
 */
export async function getLLMAnswer(message, history = [], systemPrompt = "") {
  console.log(`\n[LLM] ===== Nouvelle requête =====`);
  console.log(`[LLM] Environnement : ${NODE_ENV}${IS_PRODUCTION ? " (PRODUCTION - MODE STRICT CLOUD)" : ""}`);
  console.log(`[LLM] Provider demandé : ${LLM_PROVIDER}`);

  const providers = [];

  if (LLM_PROVIDER === "groq" || IS_PRODUCTION) {
    providers.push({ name: "groq", fn: getGroqAnswer });
  }

  if (!IS_PRODUCTION) {
    providers.push({ name: "ollama", fn: getOllamaAnswer });
  }

  let lastError = null;

  for (const { name, fn } of providers) {
    try {
      console.log(`[LLM] Tentative provider : ${name}...`);
      const perProviderTimeout = name === "ollama" ? OLLAMA_TIMEOUT_MS : LLM_TIMEOUT_MS;
      const answer = await Promise.race([
        fn(message, history, systemPrompt),
        timeoutPromise(perProviderTimeout, name)
      ]);
      console.log(`[LLM] ✅ Réponse obtenue via : ${name}`);
      return answer;
    } catch (err) {
      lastError = err;
      console.error(`[LLM] ❌ Échec ${name} :`, err.message);

      if (IS_PRODUCTION) {
        console.warn(`[LLM] ⚠️ Production : pas de fallback Ollama, on passe au provider cloud suivant.`);
      }
    }
  }

  console.error(`[LLM] 💥 Tous les providers ont échoué. Dernier erreur :`, lastError?.message);

  if (IS_PRODUCTION) {
    return "Le service d'intelligence artificielle est actuellement indisponible. Veuillez réessayer dans quelques instants. Si le problème persiste, contactez l'administration WES'SUP.";
  }
  return "Je rencontre actuellement des difficultés techniques pour accéder à mon intelligence artificielle. Comment puis-je vous aider autrement ?";
}

/**
 * Appel à GroqCloud (Ultra rapide)
 */
async function getGroqAnswer(message, history, systemPrompt) {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";

  if (!apiKey || apiKey === "gsk_votre_cle_ici" || apiKey.startsWith("gsk_votre")) {
    throw new Error("Clé API Groq non configurée (GROQ_API_KEY)");
  }

  const messages = buildMessages(message, history, systemPrompt);
  console.log(`[Groq] Modèle : ${model} | Messages : ${messages.length}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: 800,
        temperature: 0.7
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      let errorDetail = "";
      try {
        const errorData = await response.json();
        errorDetail = JSON.stringify(errorData);
      } catch {
        errorDetail = await response.text();
      }
      throw new Error(`HTTP ${response.status} - ${errorDetail}`);
    }

    const data = await response.json();
    const answer = data.choices[0]?.message?.content;
    if (!answer) throw new Error("Réponse Groq vide");

    const usage = data.usage?.total_tokens ? ` (${data.usage.total_tokens} tokens)` : "";
    console.log(`[Groq] ✅ Succès${usage}`);
    return answer;

  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Appel à Ollama (Local - UNIQUEMENT en mode développement)
 */
async function getOllamaAnswer(message, history, systemPrompt) {
  if (IS_PRODUCTION) {
    throw new Error("Ollama désactivé en production (mode strict cloud)");
  }

  const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
  const ollamaModel = process.env.OLLAMA_MODEL || "llama3.2:1b";

  try {
    const pingCtl = new AbortController();
    const pingTimeout = setTimeout(() => pingCtl.abort(), OLLAMA_PING_MS);
    await fetch(`${ollamaUrl}/api/tags`, {
      method: "GET",
      signal: pingCtl.signal
    });
    clearTimeout(pingTimeout);
  } catch (pingErr) {
    throw new Error(
      `Ollama indisponible sur ${ollamaUrl} (pas lancé ?). ` +
      `Lancez "ollama serve" dans un terminal OU ignorez: Groq cloud fonctionne.`
    );
  }

  const messages = buildMessages(message, history, systemPrompt);
  console.log(`[Ollama] Modèle : ${ollamaModel} | URL : ${ollamaUrl} (timeout ${OLLAMA_TIMEOUT_MS}ms)`);

  const payload = JSON.stringify({
    model: ollamaModel,
    messages: messages,
    stream: false,
    options: {
      num_predict: 400,
      temperature: 0.7
    }
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);

  try {
    let response;
    try {
      response = await fetch(`${ollamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: controller.signal
      });
    } catch (err) {
      if (!ollamaUrl.includes("localhost") && !ollamaUrl.includes("127.0.0.1")) {
        console.log(`[Ollama] Fallback sur localhost...`);
        response = await fetch(`http://localhost:11434/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          signal: controller.signal
        });
      } else {
        throw err;
      }
    }

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 404) {
        throw new Error(`Modèle '${ollamaModel}' absent. Lancez: ollama pull ${ollamaModel}`);
      }
      throw new Error(`HTTP ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const answer = data.message?.content;
    if (!answer) throw new Error("Réponse Ollama vide");
    console.log(`[Ollama] ✅ Succès`);
    return answer;

  } finally {
    clearTimeout(timeoutId);
  }
}
