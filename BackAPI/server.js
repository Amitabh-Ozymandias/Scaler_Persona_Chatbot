import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { PERSONAS } from "./personas.js";

const app = express();

// ---------- MIDDLEWARE ----------
app.use(cors());
app.use(express.json());

// Debug logger
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// ---------- PATH SETUP ----------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname, "public")));

// ---------- GEMINI CONFIG ----------
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// 🔥 Primary + fallback models
const PRIMARY_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

const FALLBACK_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent";

// ---------- CHAT ROUTE ----------
app.post("/chat", async (req, res) => {
  try {
    const { messages, personaId } = req.body;

    // ✅ Validate request
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    const persona = PERSONAS.find((p) => p.id === personaId);
    if (!persona) {
      return res.status(400).json({ error: "Invalid persona" });
    }

    if (!GEMINI_API_KEY) {
      return res.status(500).json({
        error: "Server misconfiguration: API key missing",
      });
    }

    // 🔥 Limit history (prevents 429)
    const trimmedMessages = messages.slice(-6);

    // Convert messages → Gemini format
    const geminiContents = trimmedMessages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body = {
      system_instruction: {
        parts: [{ text: persona.system || "" }],
      },
      contents: geminiContents,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
      },
    };

    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };

    // 🔥 Try primary model
    let geminiRes = await fetch(`${PRIMARY_URL}?key=${GEMINI_API_KEY}`, options);

    // 🔥 Fallback if overloaded / rate limited
    if (geminiRes.status === 503 || geminiRes.status === 429) {
      console.log("⚠️ Switching to fallback model...");
      geminiRes = await fetch(`${FALLBACK_URL}?key=${GEMINI_API_KEY}`, options);
    }

    // ❌ Handle API error
    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", errText);

      return res.status(geminiRes.status).json({
        error: "AI service error. Please try again.",
      });
    }

    const data = await geminiRes.json();

    const reply =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      "No response from AI.";

    res.json({ reply });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({
      error: "Something went wrong. Please try again.",
    });
  }
});

// ---------- FALLBACK ----------
app.use((req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// ---------- START SERVER ----------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});