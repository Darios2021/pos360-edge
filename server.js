/**
 * ✅ pos360-edge/server.js
 * ✅ COPY-PASTE FINAL DEFINITIVO
 * - FIX ASSETS 404 (/shop/assets -> /assets)
 * - FIX API compat (/api/v1 y /public)
 * - FIX 500 en /shop (NO reinyectar /shop al upstream)
 * - /app/* redirect -> /shop/app/* (porque backoffice vive dentro del mismo frontend)
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

// ====== HARDEN ======
process.on("uncaughtException", (err) => {
  console.error("❌ uncaughtException:", err && err.stack ? err.stack : err);
});
process.on("unhandledRejection", (reason) => {
  console.error("❌ unhandledRejection:", reason);
});

function env(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== null && String(v).trim() !== ""
    ? String(v).trim()
    : fallback;
}

function ensureSlashStart(p) {
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}
function removeTrailingSlash(p) {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

// Upstreams
const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend");
// (Backoffice coexiste ahí, NO usamos otro upstream)
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000");
const API_BASE = env("API_BASE", "/api/v1"); // default

// Debug
const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com");

// Donde “vive” públicamente
const FRONTEND_INDEX_PATH = env("FRONTEND_INDEX_PATH", "/shop/"); // "/shop/"
const APP_INDEX_PATH = env("APP_INDEX_PATH", "/shop/app/"); // backoffice real dentro del mismo FE

app.disable("x-powered-by");
app.enable("strict routing");

// ====== Health ======
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", "EDGE_FIX_SHOP500_STRIP_PREFIX_01");
  res.json({
    ok: true,
    edge: "pos360-edge",
    time: new Date().toISOString(),
    host: req.headers.host || null,
    proto: req.headers["x-forwarded-proto"] || req.protocol,
  });
});

// ====== Proxy helper ======
function makeProxy(target, opts = {}) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    secure: false,
    ...opts,
    onProxyReq(proxyReq, req, res) {
      proxyReq.setHeader("Host", req.headers.host || "");
      if (opts.onProxyReq) opts.onProxyReq(proxyReq, req, res);
    },
    onError(err, req, res) {
      console.error(
        "❌ proxy error:",
        req.method,
        req.originalUrl,
        "->",
        target,
        err && err.stack ? err.stack : err
      );
      if (res.headersSent) return;
      res.status(502).json({
        ok: false,
        error: "Bad Gateway",
        path: req.originalUrl,
        target,
        message: String(err && err.message ? err.message : err),
      });
    },
  });
}

/**
 * ✅ 1) /shop/assets/* -> /assets/*
 * Montado en "/shop/assets/" => al proxy le llega "/index-xxx.js"
 * Mandamos al upstream "/assets/index-xxx.js"
 */
const shopAssetsFirstProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => `/assets${ensureSlashStart(p)}`,
});

/**
 * ✅ 2) SHOP proxy general (FIX 500):
 * Montado en "/shop/" => al proxy le llega "/" o "/product/303"
 * IMPORTANTÍSIMO: NO reinyectamos "/shop" al upstream.
 * - /shop/            -> upstream "/"
 * - /shop/product/303 -> upstream "/product/303"
 */
const shopProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => ensureSlashStart(p),
});

/**
 * ✅ Compat: /assets/* en raíz -> /assets/*
 */
const rootAssetsProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => `/assets${ensureSlashStart(p)}`,
});

/**
 * ✅ Compat: estáticos raíz (favicon, robots, manifest)
 * Van tal cual
 */
const rootStaticProxy = makeProxy(SHOP_UPSTREAM);

/**
 * ✅ API: /api/* -> /api/v1/*
 * Montado en "/api/" => al proxy le llega "/public/..." etc
 */
const apiProxy = makeProxy(API_ORIGIN, {
  pathRewrite: (p) => {
    const base = ensureSlashStart(API_BASE); // "/api/v1"
    const path = ensureSlashStart(p);
    if (path.startsWith(base)) return path;
    return `${removeTrailingSlash(base)}${path}`;
  },
});

/**
 * ✅ COMPAT: /api/v1/* directo
 */
const apiV1CompatProxy = makeProxy(API_ORIGIN);

/**
 * ✅ COMPAT: /public/* directo
 */
const publicCompatProxy = makeProxy(API_ORIGIN);

// ====== Root "/" (caprover friendly) ======
app.get("/", (req, res) => {
  const accept = String(req.headers.accept || "");
  const ua = String(req.headers["user-agent"] || "");
  const looksLikeBrowser = accept.includes("text/html") || ua.includes("Mozilla");

  if (looksLikeBrowser) {
    return res.redirect(302, removeTrailingSlash(FRONTEND_INDEX_PATH) + "/");
  }
  return res.status(200).send("OK");
});

// ====== Redirects ======
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));

// ✅ /app externo => redirige al backoffice real dentro del FE (/shop/app)
app.get("/app", (req, res) => res.redirect(301, removeTrailingSlash(APP_INDEX_PATH) + "/"));
app.use("/app/", (req, res) => {
  // preserva el resto del path: /app/users -> /shop/app/users
  const rest = req.originalUrl.replace(/^\/app/, ""); // incluye leading slash
  return res.redirect(302, removeTrailingSlash(APP_INDEX_PATH) + rest);
});

// ====== ✅ MOUNTS (orden importa) ======

// 1) assets vite bajo /shop
app.use("/shop/assets/", shopAssetsFirstProxy);

// 2) compat assets raíz
app.use("/assets/", rootAssetsProxy);

// 3) compat estáticos raíz
app.get("/favicon.ico", rootStaticProxy);
app.get("/robots.txt", rootStaticProxy);
app.get("/manifest.webmanifest", rootStaticProxy);
app.get("/manifest.json", rootStaticProxy);

// 4) shop general (FIX 500: upstream sin /shop)
app.use("/shop/", shopProxy);

// 5) compat API para builds que llaman /api/v1
app.use("/api/v1/", apiV1CompatProxy);
app.use("/public/", publicCompatProxy);

// 6) api “oficial” del edge (/api -> /api/v1)
app.use("/api/", apiProxy);

// ====== 404 edge ======
app.use((req, res) => {
  res.setHeader("X-EDGE-HIT", "edge-404");
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl });
});

// ====== Start ======
app.listen(PORT, () => {
  console.log(`✅ pos360-edge listo en :${PORT}`);
  console.log(`shop -> ${SHOP_UPSTREAM}`);
  console.log(`api -> ${API_ORIGIN}${API_BASE}`);
  console.log(`PUBLIC_BASE_URL -> ${PUBLIC_BASE_URL}`);
  console.log(`FRONTEND_INDEX_PATH -> ${FRONTEND_INDEX_PATH}`);
  console.log(`APP_INDEX_PATH -> ${APP_INDEX_PATH}`);
});
