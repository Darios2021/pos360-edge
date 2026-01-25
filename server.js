/**
 * ✅ pos360-edge/server.js (COPY-PASTE FINAL DEFINITIVO)
 *
 * Routing:
 * - /            -> /shop/
 * - /shop/*      -> FRONTEND (shop)
 * - /app/*       -> FRONTEND (backoffice en el mismo frontend)
 * - /api/*       -> API (API_ORIGIN + path)
 *
 * Fixes:
 * - trust proxy (detecta https)
 * - fuerza X-Forwarded-Proto
 * - reescribe Location del upstream (srv-captain--pos360-frontend -> host público)
 * - ✅ evita que /shop/ termine pegando al "/" del frontend (causa del 301 con host interno)
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
const APP_UPSTREAM = env("APP_UPSTREAM", SHOP_UPSTREAM).replace(/\/+$/, "");

// ✅ API_ORIGIN = http://srv-captain--pos360-commerce-api:3000
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000").replace(/\/+$/, "");

const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

function isHttps(req) {
  const xfProto = (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim();
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
  newLoc = newLoc.replace(new RegExp(`^http:\\/\\/${host.replace(/\./g, "\\.")}(?=\\/|$)`, "i"), `https://${host}`);

  // si el request original fue https, forzá https sí o sí
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
    apiOrigin: API_ORIGIN,
    publicBase: PUBLIC_BASE_URL,
  });
});

// ===== Root -> /shop/ =====
app.get("/", (req, res) => {
  res.redirect(301, "/shop/");
});

// ===== /api -> API =====
// /api/* -> API_ORIGIN/*  (SIN /api)
app.use(
  "/api",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardProto,
    onProxyRes: rewriteLocationToPublic,
    pathRewrite: (path) => path.replace(/^\/api/, ""),
  })
);

// ✅ FIX: /shop -> FRONTEND PERO SIEMPRE BAJO /shop (nunca al / raíz)
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardProto,
    onProxyRes: rewriteLocationToPublic,
    pathRewrite: (path) => {
      // /shop        -> /shop/
      if (path === "/shop") return "/shop/";
      // /shop/xxxxx  -> /shop/xxxxx
      return path;
    },
  })
);

// ===== /app -> FRONTEND (mismo contenedor) =====
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardProto,
    onProxyRes: rewriteLocationToPublic,
    // si tu backoffice vive en /app dentro del mismo frontend: OK.
    // si vive en /admin: pathRewrite: (p) => p.replace(/^\/app/, "/admin"),
  })
);

app.listen(PORT, () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`shop -> ${SHOP_UPSTREAM}/`);
  console.log(`app  -> ${APP_UPSTREAM}/`);
  console.log(`api  -> ${API_ORIGIN}`);
  console.log(`public -> ${PUBLIC_BASE_URL}`);
});
