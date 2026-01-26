/**
 * ✅ pos360-edge/server.js
 * ✅ COPY-PASTE FINAL DEFINITIVO (ESTABLE + FIX ASSETS + FIX APIv1 + FIX /app mapeado a /shop/app)
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

// ====================
// HARDEN: no morir en silencio
// ====================
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

function safePath(p) {
  // http-proxy-middleware puede pasar algo raro en edge-cases
  if (typeof p !== "string") return "/";
  const s = p.trim();
  return s ? s : "/";
}
function ensureSlashStart(p) {
  p = safePath(p);
  return p.startsWith("/") ? p : `/${p}`;
}
function removeTrailingSlash(p) {
  p = safePath(p);
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}
function joinPrefix(prefix, path) {
  const pfx = removeTrailingSlash(ensureSlashStart(prefix));
  const pth = ensureSlashStart(path);
  if (pth === "/") return `${pfx}/`;
  return `${pfx}${pth}`;
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

// Upstreams
const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend");
const APP_UPSTREAM = env("APP_UPSTREAM", "http://srv-captain--pos360-frontend"); // en tu caso coexiste ahí
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000");
const API_BASE = env("API_BASE", "/api/v1");

// Base pública (debug)
const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com");

// Dónde vive el frontend (build base)
const FRONTEND_INDEX_PATH = env("FRONTEND_INDEX_PATH", "/shop/");

// Backoffice dentro del mismo build
const APP_INDEX_PATH = env("APP_INDEX_PATH", "/shop/app/");

// ====================
// Core settings
// ====================
app.disable("x-powered-by");
app.enable("strict routing");

// ====================
// Health
// ====================
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", "EDGE_HARDENED_01");
  res.json({
    ok: true,
    edge: "pos360-edge",
    time: new Date().toISOString(),
    host: req.headers.host || null,
    proto: req.headers["x-forwarded-proto"] || req.protocol,
  });
});

// ====================
// Proxy builder (con onError)
// ====================
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
      res.status(502);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("X-EDGE-PROXY-ERROR", "1");
      res.end(
        JSON.stringify({
          ok: false,
          error: "Bad Gateway",
          path: req.originalUrl,
          target,
          message: String(err && err.message ? err.message : err),
        })
      );
    },
  });
}

/**
 * ✅ 1) SHOP ASSETS FIRST
 * /shop/assets/* (mount) => llega "/index-xxx.js"
 * upstream necesita "/assets/index-xxx.js"
 */
const shopAssetsFirstProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => `/assets${ensureSlashStart(p)}`,
});

/**
 * ✅ 2) SHOP proxy general (PRESERVA /shop)
 */
const shopProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => joinPrefix(FRONTEND_INDEX_PATH, p),
});

/**
 * ✅ compat /assets/*
 */
const rootAssetsProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => `/assets${ensureSlashStart(p)}`,
});

/**
 * ✅ compat estáticos raíz
 */
const rootStaticProxy = makeProxy(SHOP_UPSTREAM);

/**
 * ✅ API: /api/* -> /api/v1/*
 */
const apiProxy = makeProxy(API_ORIGIN, {
  pathRewrite: (p) => {
    const path = ensureSlashStart(p);
    const base = ensureSlashStart(API_BASE); // "/api/v1"
    if (path.startsWith(base)) return path;
    return `${removeTrailingSlash(base)}${path}`;
  },
});

/**
 * ✅ compat: /api/v1/* directo
 */
const apiV1CompatProxy = makeProxy(API_ORIGIN);

/**
 * ✅ compat: /public/* directo
 */
const publicCompatProxy = makeProxy(API_ORIGIN);

/**
 * ✅ APP: /app/* -> /shop/app/*
 * (porque el build está en base /shop/)
 */
const appProxy = makeProxy(APP_UPSTREAM, {
  pathRewrite: (p) => joinPrefix(APP_INDEX_PATH, p),
});

// ====================
// Redirects base
// ====================
app.get("/", (req, res) =>
  res.redirect(301, removeTrailingSlash(FRONTEND_INDEX_PATH) + "/")
);
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));
app.get("/app", (req, res) => res.redirect(301, "/app/"));

// ====================
// MOUNTS (ORDEN IMPORTA)
// ====================
app.use("/shop/assets/", shopAssetsFirstProxy);
app.use("/assets/", rootAssetsProxy);

app.get("/favicon.ico", rootStaticProxy);
app.get("/robots.txt", rootStaticProxy);
app.get("/manifest.webmanifest", rootStaticProxy);
app.get("/manifest.json", rootStaticProxy);

app.use("/shop/", shopProxy);

app.use("/api/v1/", apiV1CompatProxy);
app.use("/public/", publicCompatProxy);
app.use("/api/", apiProxy);

app.use("/app/", appProxy);

// ====================
// 404
// ====================
app.use((req, res) => {
  res.setHeader("X-EDGE-HIT", "edge-404");
  res.status(404).json({ ok: false, error: "Not Found", path: req.originalUrl });
});

// ====================
// Express error (último recurso)
// ====================
app.use((err, req, res, next) => {
  console.error("❌ express error:", err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).json({ ok: false, error: "Edge Internal Error", path: req.originalUrl });
});

// ====================
// Start
// ====================
app.listen(PORT, () => {
  console.log(`✅ pos360-edge listo en :${PORT}`);
  console.log(`shop -> ${SHOP_UPSTREAM}`);
  console.log(`api -> ${API_ORIGIN}${API_BASE}`);
  console.log(`app -> ${APP_UPSTREAM} (mapped to ${APP_INDEX_PATH})`);
  console.log(`PUBLIC_BASE_URL -> ${PUBLIC_BASE_URL}`);
  console.log(`FRONTEND_INDEX_PATH -> ${FRONTEND_INDEX_PATH}`);
  console.log(`APP_INDEX_PATH -> ${APP_INDEX_PATH}`);
});
