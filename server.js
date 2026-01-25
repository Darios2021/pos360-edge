/**
 * ✅ pos360-edge/server.js (COPY-PASTE FINAL DEFINITIVO)
 *
 * Routing:
 * - /            -> 301 -> /shop/
 * - /shop/*      -> FRONTEND (shop)
 * - /app/*       -> FRONTEND (backoffice vive en el mismo frontend)
 * - /api/*       -> API
 *
 * Fixes:
 * - trust proxy => detecta https correctamente
 * - fuerza X-Forwarded-Proto=https cuando corresponde
 * - reescribe Location: http://srv-... -> https://tu-dominio
 * - FIX CLAVE: /shop/* en edge pega contra upstream /shop/* (no contra /)
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

const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com").replace(/\/+$/, "");

const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const APP_UPSTREAM  = env("APP_UPSTREAM",  SHOP_UPSTREAM).replace(/\/+$/, "");

const API_UPSTREAM = env("API_UPSTREAM", "http://srv-captain--pos360-commerce-api:3000/api/v1").replace(/\/+$/, "");
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

function firstHeaderValue(v) {
  return (v || "").toString().split(",")[0].trim();
}

function isHttps(req) {
  const xfProto = firstHeaderValue(req.headers["x-forwarded-proto"]);
  if (xfProto) return xfProto === "https";
  return req.protocol === "https";
}

function forceForwardProto(proxyReq, req) {
  proxyReq.setHeader("X-Forwarded-Proto", isHttps(req) ? "https" : "http");
  proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
}

function rewriteLocationToPublic(proxyRes, req) {
  const loc = proxyRes.headers["location"];
  if (!loc) return;

  const host = req.headers.host;
  if (!host) return;

  let newLoc = loc;

  // servicios internos -> host público
  newLoc = newLoc.replace(/^http:\/\/srv-captain--pos360-frontend(?=\/|$)/i, `https://${host}`);
  newLoc = newLoc.replace(/^http:\/\/127\.0\.0\.1(?=\/|$)/i, `https://${host}`);

  // upgrade http://host -> https://host
  newLoc = newLoc.replace(
    new RegExp(`^http:\\/\\/${host.replace(/\./g, "\\.")}(?=\\/|$)`, "i"),
    `https://${host}`
  );

  // si el request original fue https, subimos cualquier http://
  if (isHttps(req)) newLoc = newLoc.replace(/^http:\/\//i, "https://");

  if (newLoc !== loc) proxyRes.headers["location"] = newLoc;
}

// ===== Health =====
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "pos360-edge",
    safeMode: false,
    shop: `${SHOP_UPSTREAM}/`,
    app: `${APP_UPSTREAM}/`,
    api: API_UPSTREAM,
    publicBase: PUBLIC_BASE_URL,
  });
});

// ===== Root -> /shop/ (HTTP redirect real) =====
app.get("/", (req, res) => {
  res.redirect(301, "/shop/");
});

// ===== /api -> API =====
app.use(
  "/api",
  createProxyMiddleware({
    target: API_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardProto,
    onProxyRes: rewriteLocationToPublic,
    pathRewrite: (path) => path.replace(/^\/api/, ""),
  })
);

// ===== /shop -> FRONTEND =====
// FIX: upstream vive en /shop, entonces /shop/* => /shop/* (no /)
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardProto,
    onProxyRes: rewriteLocationToPublic,
    pathRewrite: (path) => `/shop${path}`, // ✅ CLAVE
  })
);

// ===== /app -> FRONTEND (backoffice en el mismo frontend) =====
// Si tu backoffice vive bajo /app en el frontend: /app/* => /app/*
// Si en realidad vive en /app dentro del build del frontend, esto queda OK.
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardProto,
    onProxyRes: rewriteLocationToPublic,
    // si tu backoffice realmente está montado en otra ruta interna, reescribí acá:
    // pathRewrite: (path) => path.replace(/^\/app/, "/shop/app")
  })
);

app.listen(PORT, () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`shop -> ${SHOP_UPSTREAM}/shop/`);
  console.log(`app  -> ${APP_UPSTREAM}/app/`);
  console.log(`api  -> ${API_UPSTREAM}`);
  console.log(`public -> ${PUBLIC_BASE_URL}`);
});
