/**
 * ✅ pos360-edge/server.js — COPY-PASTE FINAL (ANTI-502 / ANTI-SIGTERM LOOP)
 *
 * Objetivo: que CapRover SIEMPRE vea 200 en / y /health.
 * Una vez que esto quede OK (sin reinicios), volvemos a habilitar el proxy.
 */

const express = require("express");

const app = express();
app.set("trust proxy", true);
app.disable("x-powered-by");

const PORT = parseInt(process.env.PORT || "3000", 10) || 3000;

// Log útil si crashea
process.on("uncaughtException", (err) => {
  console.error("❌ uncaughtException:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("❌ unhandledRejection:", err);
});

// ✅ Healthcheck: 200 plano
app.get("/health", (_req, res) => {
  res.status(200).type("text").send("OK");
});

// ✅ Root: 200 plano (NO redirect)
app.get("/", (_req, res) => {
  res.status(200).type("text").send("OK");
});

// ✅ Todo lo demás, 200 también (para no joder healthchecks raros)
app.use((req, res) => {
  res.status(200).type("text").send(`OK ${req.method} ${req.originalUrl}`);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ pos360-edge (SAFE MODE) on :${PORT}`);
});
