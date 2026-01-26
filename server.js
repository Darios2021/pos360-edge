/**
 * ✅ pos360-edge/server.js
 * ✅ COPY-PASTE FINAL DEFINITIVO (TU BASE ESTABLE + FIX /app + FIX compat /api/v1 + anti-crash)
 *
 * Mantiene TODO lo que tenías y suma:
 * - /app/* preserva "/app" hacia el MISMO frontend (tu caso APP_UPSTREAM=pos360-frontend)
 * - /api/v1/* compat REINYECTA "/api/v1" (porque express corta el prefijo del mount)
 * - onError para que NO se caiga el edge y nginx no muestre 500 genérico
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

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
function joinPrefix(prefix, path) {
  // prefix: "/shop/" o "/shop"
  // path: "/product/303" o "/"
  const pfx = removeTrailingSlash(ensureSlashStart(prefix));
  const pth = ensureSlashStart(path);
  if (pth === "/") return `${pfx}/`;
  return `${pfx}${pth}`;
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

// Upstreams
const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend");

// ⚠️ En TU setup real: APP_UPSTREAM = http://srv-captain--pos360-frontend
// (backoffice coexiste en el mismo frontend)
const APP_UPSTREAM = env("APP_UPSTREAM", "http://srv-captain--pos360-frontend");

const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000");
const API_BASE = env("API_BASE", "/api/v1"); // default

// Base pública (no se usa en routing, queda para logs/debug)
const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com");

// Donde vive el frontend
const FRONTEND_INDEX_PATH = env("FRONTEND_INDEX_PATH", "/shop/"); // "/shop/"

// ====== Core settings ======
app.disable("x-powered-by");
app.enable("strict routing");

// ====== Health ======
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", "EDGE_STABLE_PLUS_APP_PLUS_APIv1_COMPAT_01");
  res.json({
    ok: true,
    edge: "pos360-edge",
    time: new Date().toISOString(),
    host: req.headers.host || null,
    proto: req.headers["x-forwarded-proto"] || req.protocol,
  });
});

// ====== Helpers: proxy builder ======
function makeProxy(target, opts = {}) {
  return createProxyMiddleware({
    target,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    secure: false, // targets internos http
    proxyTimeout: 30_000,
    timeout: 30_000,
    ...opts,
    onProxyReq(proxyReq, req, res) {
      proxyReq.setHeader("Host", req.headers.host || "");
      if (opts.onProxyReq) opts.onProxyReq(proxyReq, req, res);
    },
    onError(err, req, res) {
      // ✅ NO CRASHEAR / NO 500 genérico de nginx
      const code = err?.code || "PROXY_ERROR";
      if (res.headersSent) return;
      res.status(502).json({
        ok: false,
        error: "Bad Gateway",
        code,
        path: req.originalUrl,
      });
    },
  });
}

/**
 * ✅ 1) SHOP ASSETS FIRST
 * Montado en "/shop/assets/" => al proxy le llega "/index-xxx.js"
 * Necesitamos mandarlo al upstream como "/assets/index-xxx.js"
 */
const shopAssetsFirstProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => `/assets${ensureSlashStart(p)}`,
});

/**
 * ✅ 2) SHOP proxy general (PRESERVA /shop)
 */
const shopProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (path) => joinPrefix(FRONTEND_INDEX_PATH, path),
});

/**
 * ✅ Compat: /assets/* en raíz
 */
const rootAssetsProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => `/assets${ensureSlashStart(p)}`,
});

/**
 * ✅ Compat: estáticos de raíz (favicon, robots, manifest)
 */
const rootStaticProxy = makeProxy(SHOP_UPSTREAM);

/**
 * ✅ API proxy: /api/* -> /api/v1/*
 */
const apiProxy = makeProxy(API_ORIGIN, {
  pathRewrite: (path) => {
    const base = ensureSlashStart(API_BASE); // "/api/v1"
    if (path.startsWith(base)) return path;
    return `${removeTrailingSlash(base)}${ensureSlashStart(path)}`;
  },
});

/**
 * ✅ COMPAT: /api/v1/* directo a la API
 *
 * CLAVE: Montado en "/api/v1/" => al proxy le llega "/public/..."
 * Entonces hay que REINYECTAR "/api/v1" para pegar bien.
 */
const apiV1CompatProxy = makeProxy(API_ORIGIN, {
  pathRewrite: (p) => `/api/v1${ensureSlashStart(p)}`,
});

/**
 * ✅ COMPAT: /public/* directo a la API (opcional)
 * lo mapeamos a /api/v1/public/*
 */
const publicCompatProxy = makeProxy(API_ORIGIN, {
  pathRewrite: (p) => `/api/v1/public${ensureSlashStart(p)}`,
});

/**
 * ✅ APP proxy (backoffice)
 *
 * CLAVE:
 * Montado en "/app/" => al proxy le llega "/"
 * Si lo mandás como "/" el upstream te redirige a "/shop/" (tu síntoma).
 * Entonces reinyectamos "/app".
 */
const appProxy = makeProxy(APP_UPSTREAM, {
  pathRewrite: (p) => `/app${ensureSlashStart(p)}`,
});

// ====== Redirects base ======
app.get("/", (req, res) =>
  res.redirect(301, removeTrailingSlash(FRONTEND_INDEX_PATH) + "/")
);
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));

// ✅ (opcional) si querés /app -> /app/
app.get("/app", (req, res) => res.redirect(301, "/app/"));

// ====== ✅ MOUNTS (ORDEN IMPORTA) ======

// ✅ 1) assets de vite bajo /shop (PRIMERO)
app.use("/shop/assets/", shopAssetsFirstProxy);

// ✅ 2) compat assets en raíz
app.use("/assets/", rootAssetsProxy);

// ✅ 3) compat estáticos típicos en raíz
app.get("/favicon.ico", rootStaticProxy);
app.get("/robots.txt", rootStaticProxy);
app.get("/manifest.webmanifest", rootStaticProxy);
app.get("/manifest.json", rootStaticProxy);

// ✅ 4) shop general
app.use("/shop/", shopProxy);

// ✅ 5) ✅ compat API PRIMERO (tu build llama /api/v1)
app.use("/api/v1/", apiV1CompatProxy);
app.use("/public/", publicCompatProxy);

// ✅ 6) api “oficial” del edge (/api -> /api/v1)
app.use("/api/", apiProxy);

// ✅ 7) ✅ app/backoffice (preserva /app)
app.use("/app/", appProxy);

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
  console.log(`app -> ${APP_UPSTREAM}`);
  console.log(`PUBLIC_BASE_URL -> ${PUBLIC_BASE_URL}`);
  console.log(`FRONTEND_INDEX_PATH -> ${FRONTEND_INDEX_PATH}`);
});
