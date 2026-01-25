/**
 * ✅ pos360-edge/server.js (COPY-PASTE FINAL)
 *
 * Routing:
 * - /            -> redirect to /shop/
 * - /shop/*      -> FRONTEND (shop)
 * - /app/*       -> FRONTEND (backoffice vive en el mismo frontend)
 * - /api/*       -> API
 *
 * Fixes:
 * - trust proxy => detecta https correctamente
 * - fuerza X-Forwarded-Proto=https cuando corresponde
 * - reescribe Location: http://... -> https://...
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

const FRONTEND_UPSTREAM = env("FRONTEND_UPSTREAM", "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const API_UPSTREAM = env("API_UPSTREAM", "http://srv-captain--pos360-commerce-api:3000/api/v1").replace(/\/+$/, "");

const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

function isHttps(req) {
  const xfProto = (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim();
  if (xfProto) return xfProto === "https";
  return req.protocol === "https";
}

function forceForwardProto(proxyReq, req) {
  // si el request original fue https, mantenelo.
  proxyReq.setHeader("X-Forwarded-Proto", isHttps(req) ? "https" : "http");
  proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
}

function rewriteLocationToHttps(proxyRes, req) {
  const loc = proxyRes.headers["location"];
  if (!loc) return;

  const host = req.headers.host;
  if (!host) return;

  // 1) Si upstream devuelve http://host/... => https://host/...
  // 2) Si devuelve http://srv-captain--pos360-frontend/... => https://host/...
  let newLoc = loc;

  // reemplaza servicios internos por host público
  newLoc = newLoc.replace(/^http:\/\/srv-captain--pos360-frontend(?=\/|$)/i, `https://${host}`);
  newLoc = newLoc.replace(/^http:\/\/127\.0\.0\.1(?=\/|$)/i, `https://${host}`);

  // upgrade http://host -> https://host
  newLoc = newLoc.replace(new RegExp(`^http:\\/\\/${host.replace(/\./g, "\\.")}(?=\\/|$)`, "i"), `https://${host}`);

  // si sigue viniendo http:// (por cualquier razón) y el request era https, lo subimos igual
  if (isHttps(req)) {
    newLoc = newLoc.replace(/^http:\/\//i, "https://");
  }

  if (newLoc !== loc) proxyRes.headers["location"] = newLoc;
}

// ===== Health =====
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "pos360-edge",
    safeMode: false,
    frontend: FRONTEND_UPSTREAM,
    api: API_UPSTREAM,
    publicBase: PUBLIC_BASE_URL,
  });
});

// ===== Root -> /shop/ =====
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="0; url=/shop/" />
  <title>pos360-edge</title>
</head>
<body>
  <script>location.replace('/shop/');</script>
  <noscript><a href="/shop/">/shop/</a></noscript>
</body>
</html>`);
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
    onProxyRes: rewriteLocationToHttps,
    pathRewrite: (path) => path.replace(/^\/api/, ""),
  })
);

// ===== /shop -> FRONTEND =====
app.use(
  "/shop",
  createProxyMiddleware({
    target: FRONTEND_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardProto,
    onProxyRes: rewriteLocationToHttps,
    // deja /shop tal cual, porque tu frontend ya vive bajo /shop
  })
);

// ===== /app -> FRONTEND (backoffice en el mismo frontend) =====
app.use(
  "/app",
  createProxyMiddleware({
    target: FRONTEND_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardProto,
    onProxyRes: rewriteLocationToHttps,
    // IMPORTANT: si tu backoffice en el frontend realmente vive en /app,
    // esto está perfecto (no reescribe).
    // Si en realidad vive en otra ruta (ej /admin), cambiá acá:
    // pathRewrite: (path) => path.replace(/^\/app/, "/admin")
  })
);

app.listen(PORT, () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`frontend -> ${FRONTEND_UPSTREAM}/`);
  console.log(`api -> ${API_UPSTREAM}`);
  console.log(`public -> ${PUBLIC_BASE_URL}`);
});
