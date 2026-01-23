/**
 * ✅ pos360-edge/server.js
 *
 * Edge reverse-proxy por PATH para sanjuantecnologia.com
 *
 * PROBLEMA QUE ARREGLA:
 * - /shop/assets/*.js estaba respondiendo Express (404 o index.html) => MIME text/html
 * - Ahora /shop/* (incluye assets, css, js) se proxy a pos360-frontend (nginx)
 *
 * UPSTREAMS (por ENV, con defaults CapRover):
 * - SHOP_UPSTREAM  -> http://srv-captain--pos360-frontend
 * - API_UPSTREAM   -> http://srv-captain--pos360-api   (si lo tenés así)
 *
 * Nota: si tu api vive en otro app, cambiá API_UPSTREAM.
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

// ------------------------------------------------------
// ENV helpers
// ------------------------------------------------------
function env(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== null && String(v).trim() !== "" ? String(v).trim() : fallback;
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;

// ✅ CapRover DNS interno de apps: srv-captain--<appname>
const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend"); // nginx del frontend
const API_UPSTREAM = env("API_UPSTREAM", "http://srv-captain--pos360-api"); // <-- ajustá si tu app api se llama distinto

// ------------------------------------------------------
// Hardening básico (no-cache para HTML del edge)
// ------------------------------------------------------
app.disable("x-powered-by");

// health
app.get("/health", (_req, res) => res.status(200).json({ ok: true, service: "pos360-edge" }));

// ------------------------------------------------------
// ✅ PROXY SHOP (IMPORTANTE)
// ------------------------------------------------------
// Esto tiene que ir ANTES de cualquier handler/fallback
const shopProxy = createProxyMiddleware({
  target: SHOP_UPSTREAM,
  changeOrigin: true,
  xfwd: true,
  ws: true,
  // Mantener path tal cual: /shop/... -> /shop/...
  // NO pathRewrite.
  logLevel: env("PROXY_LOG_LEVEL", "warn"),
  onProxyReq(proxyReq, req) {
    // Si querés debug:
    // console.log("[shop-proxy]", req.method, req.originalUrl, "->", SHOP_UPSTREAM);
    // Evitar cabeceras raras
    proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
  },
  onError(err, req, res) {
    console.error("[shop-proxy] error:", err?.message || err);
    if (!res.headersSent) res.status(502);
    res.end("Bad gateway (shop)");
  },
});

// ✅ /shop y /shop/ y todo lo de abajo (assets incluido)
app.use("/shop", shopProxy);

// ------------------------------------------------------
// ✅ PROXY API (si lo querés por path)
// ------------------------------------------------------
// Si tu API ya corre bajo /api/v1 en el MISMO dominio, esto te sirve:
// /api/v1/... -> API_UPSTREAM/api/v1/...
const apiProxy = createProxyMiddleware({
  target: API_UPSTREAM,
  changeOrigin: true,
  xfwd: true,
  ws: true,
  logLevel: env("PROXY_LOG_LEVEL", "warn"),
  onError(err, req, res) {
    console.error("[api-proxy] error:", err?.message || err);
    if (!res.headersSent) res.status(502);
    res.end("Bad gateway (api)");
  },
});

app.use("/api", apiProxy);

// ------------------------------------------------------
// ROOT: redirigir a /shop/
// ------------------------------------------------------
app.get("/", (_req, res) => res.redirect(302, "/shop/"));

// ------------------------------------------------------
// 404 final (no romper assets con HTML “index”)
// ------------------------------------------------------
app.use((req, res) => {
  res.status(404).type("text/plain").send("Not found");
});

app.listen(PORT, () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`   shop -> ${SHOP_UPSTREAM}`);
  console.log(`   api  -> ${API_UPSTREAM}`);
});
