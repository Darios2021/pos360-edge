/**
 * ✅ pos360-edge/server.js — VERSIÓN FINAL CORREGIDA
 * * Cambios realizados:
 * 1. Eliminación del middleware global que comparaba req.url === "/shop".
 * 2. Mantenimiento de la redirección de raíz "/" únicamente.
 * 3. Priorización de proxies para evitar intercepciones de Express.
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
    ok: true,
    service: "pos360-edge",
    shop: `${SHOP_UPSTREAM}/`,
    apiOrigin: API_ORIGIN,
    publicBase: PUBLIC_BASE_URL
  });
});

// ---- 2. Redirección de Raíz (ESTRICTA)
// Solo redirige si entran a https://dominio.com/
app.get("/", (req, res) => {
  return res.redirect(301, "/shop/");
});

// ---- 3. Proxy API
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

// ---- 4. Proxy FRONTEND (Maneja /shop y /shop/)
// Al no haber middlewares previos, el proxy entrega la petición limpia al Nginx del frontend
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardHeaders,
    onProxyRes: rewriteLocation,
  })
);

// ---- 5. Proxy APP
app.use(
  "/app",
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
  console.log(`✅ pos360-edge funcionando en puerto ${PORT}`);
});