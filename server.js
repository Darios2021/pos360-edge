/**
 * ✅ pos360-edge/server.js (COPY-PASTE FINAL DEFINITIVO)
 *
 * Routing:
 * - /        -> 301 /shop/
 * - /shop/*  -> FRONTEND (shop)
 * - /app/*   -> FRONTEND (backoffice vive en el mismo frontend)
 * - /api/*   -> API (API_ORIGIN)
 *
 * FIX CRÍTICO:
 * - Usa "on: { proxyReq, proxyRes }" (compat con http-proxy-middleware nuevo)
 * - Reescribe Location: http://srv-captain--pos360-frontend/... -> https://<tu-dominio>/...
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
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000").replace(/\/+$/, "");

const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

function getForwardedProto(req) {
  const xfProto = (req.headers["x-forwarded-proto"] || "").toString().split(",")[0].trim();
  if (xfProto) return xfProto;
  // express + trust proxy
  return req.protocol || "http";
}

function forceForwardHeaders(proxyReq, req) {
  const proto = getForwardedProto(req);
  const host = req.headers.host || "";
  proxyReq.setHeader("X-Forwarded-Proto", proto);
  proxyReq.setHeader("X-Forwarded-Host", host);
}

function rewriteLocation(proxyRes, req) {
  const loc = proxyRes.headers?.location;
  if (!loc) return;

  const host = req.headers.host;
  if (!host) return;

  let newLoc = String(loc);

  // 1) Host interno del frontend -> host público
  newLoc = newLoc.replace(
    /^http:\/\/srv-captain--pos360-frontend(?=\/|$)/i,
    `https://${host}`
  );

  // 2) Si viniera 127.0.0.1
  newLoc = newLoc.replace(/^http:\/\/127\.0\.0\.1(?=\/|$)/i, `https://${host}`);

  // 3) Si viniera http://<tu-dominio> -> https://<tu-dominio>
  const hostRe = host.replace(/\./g, "\\.");
  newLoc = newLoc.replace(new RegExp(`^http:\\/\\/${hostRe}(?=\\/|$)`, "i"), `https://${host}`);

  // 4) Si el request original fue https, forzamos https sí o sí
  const proto = getForwardedProto(req);
  if (proto === "https") newLoc = newLoc.replace(/^http:\/\//i, "https://");

  if (newLoc !== loc) proxyRes.headers.location = newLoc;
}

// ===== Health =====
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "pos360-edge",
    shop: `${SHOP_UPSTREAM}/`,
    app: `${APP_UPSTREAM}/`,
    apiOrigin: API_ORIGIN,
    publicBase: PUBLIC_BASE_URL,
  });
});

// ===== Root -> /shop/ =====
app.get("/", (req, res) => res.redirect(301, "/shop/"));

// ===== /api -> API =====
app.use(
  "/api",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    pathRewrite: (p) => p.replace(/^\/api/, ""),
    on: {
      proxyReq: forceForwardHeaders,
      proxyRes: rewriteLocation,
    },
  })
);

// ===== /shop -> FRONTEND =====
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    // ✅ evita pegarle al "/" del frontend cuando te llega /shop
    pathRewrite: (p) => (p === "/shop" ? "/shop/" : p),
    on: {
      proxyReq: forceForwardHeaders,
      proxyRes: rewriteLocation,
    },
  })
);

// ===== /app -> FRONTEND =====
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    on: {
      proxyReq: forceForwardHeaders,
      proxyRes: rewriteLocation,
    },
  })
);

app.listen(PORT, () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`shop -> ${SHOP_UPSTREAM}/`);
  console.log(`app  -> ${APP_UPSTREAM}/`);
  console.log(`api  -> ${API_ORIGIN}`);
  console.log(`public -> ${PUBLIC_BASE_URL}`);
});
