/**
 * ✅ pos360-edge/server.js — VERSIÓN FINAL (STRICT ROUTING)
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

// Deshabilitar la normalización automática de slashes de Express
app.set("strict routing", true); 
app.set("trust proxy", true);

function env(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== null && String(v).trim() !== ""
    ? String(v).trim()
    : fallback;
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");
const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com").replace(/\/+$/, "");
const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const APP_UPSTREAM  = env("APP_UPSTREAM", SHOP_UPSTREAM).replace(/\/+$/, "");
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000").replace(/\/+$/, "");

function getHost(req) {
  return (req.headers["x-forwarded-host"] || req.headers.host || "").toString().split(",")[0].trim();
}

function isHttps(req) {
  const xfProto = (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim().toLowerCase();
  return xfProto === "https" || req.protocol === "https";
}

function forceForwardHeaders(proxyReq, req) {
  const host = getHost(req);
  proxyReq.setHeader("X-Forwarded-Proto", isHttps(req) ? "https" : "http");
  if (host) proxyReq.setHeader("X-Forwarded-Host", host);
}

function rewriteLocation(proxyRes, req) {
  const loc = proxyRes.headers?.location;
  if (!loc || String(loc).startsWith("/")) return;

  const host = getHost(req);
  if (!host) return;

  let newLoc = String(loc);
  const targets = [
    /https?:\/\/srv-captain--pos360-frontend(?=\/|$)/i,
    /https?:\/\/srv-captain--pos360-edge(?=\/|$)/i,
    /https?:\/\/127\.0\.0\.1(?=\/|$)/i,
    /https?:\/\/localhost(?=\/|$)/i
  ];

  targets.forEach(regex => {
    newLoc = newLoc.replace(regex, `https://${host}`);
  });

  if (isHttps(req)) {
    const hostEsc = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    newLoc = newLoc.replace(new RegExp(`^http:\\/\\/${hostEsc}(?=\\/|$)`, "i"), `https://${host}`);
  }

  proxyRes.headers.location = newLoc;
}

// ---- 1. Health Check
app.get("/health", (req, res) => {
  res.json({
    ok: "STRICT_MODE_ACTIVE",
    service: "pos360-edge",
    shop: `${SHOP_UPSTREAM}/`,
    apiOrigin: API_ORIGIN
  });
});

// ---- 2. Redirección de Raíz (ESTRICTA)
app.get("/", (req, res) => {
  return res.redirect(301, "/shop/");
});

// ---- 3. Redirección manual para /shop (sin slash)
// Esto evita que el proxy se confunda
app.get("/shop", (req, res) => {
  return res.redirect(301, "/shop/");
});

// ---- 4. Proxy API
app.use(
  "/api",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardHeaders,
    onProxyRes: rewriteLocation,
    pathRewrite: { "^/api": "" },
  })
);

// ---- 5. Proxy FRONTEND (Punto de montaje con slash)
app.use(
  "/shop/",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardHeaders,
    onProxyRes: rewriteLocation,
  })
);

app.use(
  "/app/",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardHeaders,
    onProxyRes: rewriteLocation,
  })
);

app.listen(PORT, () => {
  console.log(`✅ pos360-edge STRICT MODE en puerto ${PORT}`);
});