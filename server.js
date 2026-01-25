/**
 * ✅ pos360-edge/server.js — COPY-PASTE FINAL (NO LOOP /shop/)
 *
 * Routing:
 * - /            -> 301 /shop/
 * - /shop        -> 301 /shop/        (SOLO si req.url === "/shop" o "/shop?...")
 * - /shop/*      -> FRONTEND (proxy)
 * - /app/*       -> FRONTEND (proxy)
 * - /api/*       -> API (API_ORIGIN)
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

// ✅ host:puerto (SIN /api, SIN /v1)
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000").replace(/\/+$/, "");

const FRONTEND_INDEX_PATH = env("FRONTEND_INDEX_PATH", "/shop/");
const BRANDING_ENDPOINT = env("BRANDING_ENDPOINT", "/shop/branding/public");
const BRANDING_CACHE_SECONDS = parseInt(env("BRANDING_CACHE_SECONDS", "60"), 10) || 60;
const OG_BRANCH_ID = parseInt(env("OG_BRANCH_ID", "3"), 10) || 3;

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
  if (xfProto) return xfProto === "https";
  return req.protocol === "https";
}

function forceForwardHeaders(proxyReq, req) {
  const host = getHost(req);
  proxyReq.setHeader("X-Forwarded-Proto", isHttps(req) ? "https" : "http");
  if (host) proxyReq.setHeader("X-Forwarded-Host", host);
}

function rewriteLocation(proxyRes, req) {
  const loc = proxyRes.headers?.location;
  if (!loc) return;

  // relativo => NO tocar
  if (String(loc).startsWith("/")) return;

  const host = getHost(req);
  if (!host) return;

  let newLoc = String(loc);

  newLoc = newLoc.replace(/^https?:\/\/srv-captain--pos360-frontend(?=\/|$)/i, `https://${host}`);
  newLoc = newLoc.replace(/^https?:\/\/srv-captain--pos360-edge(?=\/|$)/i, `https://${host}`);
  newLoc = newLoc.replace(/^https?:\/\/127\.0\.0\.1(?=\/|$)/i, `https://${host}`);
  newLoc = newLoc.replace(/^https?:\/\/localhost(?=\/|$)/i, `https://${host}`);

  if (isHttps(req)) {
    const hostEsc = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    newLoc = newLoc.replace(new RegExp(`^http:\\/\\/${hostEsc}(?=\\/|$)`, "i"), `https://${host}`);
  }

  if (newLoc !== loc) proxyRes.headers.location = newLoc;
}

// ---- Health
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "pos360-edge",
    safeMode: false,
    shop: `${SHOP_UPSTREAM}/`,
    app: `${APP_UPSTREAM}/`,
    apiOrigin: API_ORIGIN,
    publicBase: PUBLIC_BASE_URL,
    frontendIndexPath: FRONTEND_INDEX_PATH,
    brandingEndpoint: BRANDING_ENDPOINT,
    brandingCacheSeconds: BRANDING_CACHE_SECONDS,
    ogBranchId: OG_BRANCH_ID,
  });
});

// ✅ / -> /shop/
app.get("/", (req, res) => res.redirect(301, "/shop/"));

// ✅ FIX DEFINITIVO: redirigir SOLO si el REQUEST es EXACTAMENTE "/shop" (o "/shop?...")
// OJO: usamos req.url (incluye query) para NO confundir "/shop/".
app.use((req, res, next) => {
  if (!(req.method === "GET" || req.method === "HEAD")) return next();

  const u = String(req.url || "");
  if (u === "/shop" || u.startsWith("/shop?")) {
    return res.redirect(301, "/shop/");
  }
  return next();
});

// ---- API
app.use(
  "/api",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    onProxyReq: forceForwardHeaders,
    onProxyRes: rewriteLocation,
    pathRewrite: (p) => p.replace(/^\/api/, ""),
  })
);

// ---- FRONTEND
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
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`shop -> ${SHOP_UPSTREAM}/`);
  console.log(`app  -> ${APP_UPSTREAM}/`);
  console.log(`api  -> ${API_ORIGIN}`);
  console.log(`public -> ${PUBLIC_BASE_URL}`);
});
