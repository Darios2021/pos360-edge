/**
 * ✅ pos360-edge/server.js
 * Reverse Proxy Express — ANTI LOOP 301
 * Proyecto: POS360 / sanjuantecnologia.com
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

/**
 * 🔑 CLAVE para CapRover / Nginx
 * Permite que Express confíe en X-Forwarded-Proto / Host
 */
app.set("trust proxy", true);

/**
 * ❌ NO usamos strict routing
 * Express maneja /shop y /shop/ como equivalentes
 * (evita loops innecesarios)
 */
// app.set("strict routing", true);

/* =========================
 * Helpers ENV
 * ========================= */
function env(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== null && String(v).trim() !== ""
    ? String(v).trim()
    : fallback;
}

const PORT = parseInt(env("PORT", "3000"), 10);
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

const PUBLIC_BASE_URL = env(
  "PUBLIC_BASE_URL",
  "https://sanjuantecnologia.com"
).replace(/\/+$/, "");

const SHOP_UPSTREAM = env(
  "SHOP_UPSTREAM",
  "http://srv-captain--pos360-frontend"
).replace(/\/+$/, "");

const APP_UPSTREAM = env(
  "APP_UPSTREAM",
  SHOP_UPSTREAM
).replace(/\/+$/, "");

const API_ORIGIN = env(
  "API_ORIGIN",
  "http://srv-captain--pos360-commerce-api:3000"
).replace(/\/+$/, "");

/* =========================
 * Helpers HTTP
 * ========================= */
function getHost(req) {
  return (req.headers["x-forwarded-host"] || req.headers.host || "")
    .toString()
    .split(",")[0]
    .trim();
}

function isHttps(req) {
  const xfProto = (req.headers["x-forwarded-proto"] || "")
    .toString()
    .split(",")[0]
    .trim()
    .toLowerCase();

  return xfProto === "https" || req.protocol === "https";
}

function forceForwardHeaders(proxyReq, req) {
  const host = getHost(req);

  proxyReq.setHeader(
    "X-Forwarded-Proto",
    isHttps(req) ? "https" : "http"
  );

  if (host) {
    proxyReq.setHeader("X-Forwarded-Host", host);
  }
}

/**
 * 🔁 Reescritura defensiva de Location
 * Evita redirects internos srv-captain / localhost
 */
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
    /https?:\/\/localhost(?=\/|$)/i,
  ];

  targets.forEach((rx) => {
    newLoc = newLoc.replace(rx, `https://${host}`);
  });

  if (isHttps(req)) {
    const escHost = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    newLoc = newLoc.replace(
      new RegExp(`^http:\\/\\/${escHost}`, "i"),
      `https://${host}`
    );
  }

  proxyRes.headers.location = newLoc;
}

/* =========================
 * 1️⃣ Health Check
 * ========================= */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "pos360-edge",
    mode: "ANTI_LOOP",
    shopUpstream: SHOP_UPSTREAM,
    apiOrigin: API_ORIGIN,
  });
});

/* =========================
 * 2️⃣ Redirect raíz → /shop/
 * (único redirect permitido)
 * ========================= */
app.get("/", (req, res) => {
  return res.redirect(301, "/shop/");
});

/* =========================
 * 3️⃣ API Proxy
 * ========================= */
app.use(
  "/api",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    pathRewrite: { "^/api": "" },
    onProxyReq: forceForwardHeaders,
    onProxyRes: rewriteLocation,
  })
);

/* =========================
 * 4️⃣ SHOP Proxy
 * 🔥 CLAVE: montado en /shop
 * cubre /shop y /shop/*
 * SIN redirects
 * ========================= */
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

/* =========================
 * 5️⃣ APP / Backoffice
 * ========================= */
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

/* =========================
 * START
 * ========================= */
app.listen(PORT, () => {
  console.log(`✅ pos360-edge ANTI LOOP escuchando en ${PORT}`);
});
