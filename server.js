/**
 * ✅ pos360-edge/server.js — FINAL (NO LOOP + MATCH FORTE)
 * - Captura /shop, /shop/, /shop/* con regex (sin depender de strict routing)
 * - Agrega headers para debug: X-EDGE-HIT
 * - /api -> proxy
 * - /app -> proxy
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
app.set("trust proxy", true);

function env(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== null && String(v).trim() !== ""
    ? String(v).trim()
    : fallback;
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const APP_UPSTREAM  = env("APP_UPSTREAM", "http://srv-captain--pos360-admin").replace(/\/+$/, "");
const API_ORIGIN    = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000").replace(/\/+$/, "");

// ===== TRACE =====
app.use((req, res, next) => {
  // esto te deja ver EXACTO qué ruta ve Express
  console.log("🧭 REQ", req.method, {
    originalUrl: req.originalUrl,
    url: req.url,
    path: req.path,
    host: req.headers.host,
    xfp: req.headers["x-forwarded-proto"],
  });
  next();
});

// ===== HEALTH =====
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", env("X_EDGE_BUILD", "EDGE_FINAL_MATCH_FORTE_01"));
  res.json({
    ok: true,
    service: "pos360-edge",
    build: env("X_EDGE_BUILD", "EDGE_FINAL_MATCH_FORTE_01"),
    shopUpstream: SHOP_UPSTREAM,
    appUpstream: APP_UPSTREAM,
    apiOrigin: API_ORIGIN,
  });
});

// ===== PROXIES =====

// ✅ SHOP: regex captura /shop, /shop/, /shop/loquesea
const shopProxy = createProxyMiddleware({
  target: SHOP_UPSTREAM,
  changeOrigin: true,
  logLevel: PROXY_LOG_LEVEL,
  xfwd: true,
  onProxyRes(proxyRes) {
    proxyRes.headers["X-EDGE-HIT"] = "shop-proxy";
  },
});

// match fuerte
app.use(/^\/shop(\/|$)/, (req, res, next) => {
  res.setHeader("X-EDGE-HIT", "shop-entry");
  return shopProxy(req, res, next);
});

// ✅ API
app.use(
  "/api",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    pathRewrite: { "^/api": "" },
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-HIT"] = "api-proxy";
    },
  })
);

// ✅ APP
app.use(
  /^\/app(\/|$)/,
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyRes(proxyRes) {
      proxyRes.headers["X-EDGE-HIT"] = "app-proxy";
    },
  })
);

// ===== ROOT =====
app.get("/", (req, res) => {
  res.setHeader("X-EDGE-HIT", "root-redirect");
  return res.redirect(301, "/shop/");
});

// ===== FALLBACK =====
app.use((req, res) => {
  res.setHeader("X-EDGE-HIT", "edge-404");
  res.status(404).type("text/plain").send("edge: not found");
});

app.listen(PORT, () => console.log(`✅ pos360-edge FINAL en :${PORT}`));
