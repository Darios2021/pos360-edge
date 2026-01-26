/**
 * ✅ pos360-edge/server.js
 * ✅ COPY-PASTE FINAL DEFINITIVO (FIX ASSETS 404 + /shop + compat /assets + compat /api/v1)
 *
 * FIX CLAVE:
 * - Vite genera <script src="/shop/assets/..."> y <link href="/shop/assets/...">
 * - Express cuando montás "/shop/assets/" entrega al proxy SOLO "/index-xxx.js"
 * - Entonces el rewrite debe RE-PREFIJAR "/assets" (no hacer replace de "/shop")
 *
 * FIX API CLAVE:
 * - Tu frontend HOY está llamando "/api/v1/..." (según consola)
 * - En edge sólo existía "/api/..." => 404
 * - Solución: compat /api/v1/* (y opcional /public/*) hacia API_ORIGIN
 *
 * Rutas:
 *  - /health        -> 200
 *  - /              -> 301 /shop/
 *  - /shop          -> 301 /shop/
 *  - /shop/assets/* -> proxy a frontend como /assets/*
 *  - /shop/*        -> proxy a frontend (preserva /shop según tu diseño)
 *  - /assets/*      -> (compat) proxy a frontend como /assets/*
 *  - /favicon.ico   -> (compat) proxy a frontend como /favicon.ico
 *  - /api/*         -> proxy a API (rewrite a /api/v1/*)
 *  - /api/v1/*      -> ✅ compat directo a API (builds que llaman /api/v1)
 *  - /public/*      -> ✅ compat directo a API (por si alguna vez se usa)
 *  - /app/*         -> proxy a APP (si aplica)
 *
 * ✅ NEW (tu caso real):
 * - Backoffice coexiste en el MISMO frontend (pos360-frontend)
 * - Entonces /app/* debe ir al mismo upstream que shop
 * - Activable con APP_SAME_AS_SHOP=1
 * - Soporta /app/assets/* también
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

function envBool(name, fallback = false) {
  const v = process.env[name];
  if (v === undefined || v === null || String(v).trim() === "") return fallback;
  const s = String(v).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y" || s === "on";
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
const APP_UPSTREAM = env("APP_UPSTREAM", "http://srv-captain--pos360-admin");
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000");
const API_BASE = env("API_BASE", "/api/v1"); // default

// ✅ NEW: si el backoffice vive en el MISMO frontend que /shop
const APP_SAME_AS_SHOP = envBool("APP_SAME_AS_SHOP", false);
const APP_INDEX_PATH = env("APP_INDEX_PATH", "/app/"); // "/app/"

// Base pública (no se usa en routing, queda para logs/debug)
const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com");

// Donde vive el frontend
const FRONTEND_INDEX_PATH = env("FRONTEND_INDEX_PATH", "/shop/"); // "/shop/"

// ====== Core settings ======
app.disable("x-powered-by");
// evita equivalencia /shop y /shop/
app.enable("strict routing");

// ====== Health ======
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", "EDGE_FIX_ASSETS_FIRST_02_API_COMPAT_02_APP_COMPAT_01");
  res.json({
    ok: true,
    edge: "pos360-edge",
    time: new Date().toISOString(),
    host: req.headers.host || null,
    proto: req.headers["x-forwarded-proto"] || req.protocol,
    app_same_as_shop: APP_SAME_AS_SHOP,
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
    ...opts,
    onProxyReq(proxyReq, req, res) {
      // Host real (útil para apps que generan URLs)
      proxyReq.setHeader("Host", req.headers.host || "");
      if (opts.onProxyReq) opts.onProxyReq(proxyReq, req, res);
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
 * ✅ NEW: APP ASSETS FIRST (si backoffice vive en /app)
 * Montado en "/app/assets/" => al proxy le llega "/index-xxx.js"
 * Necesitamos mandarlo al upstream como "/assets/index-xxx.js"
 */
const appAssetsFirstProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => `/assets${ensureSlashStart(p)}`,
});

/**
 * ✅ 2) SHOP proxy general (PRESERVA /shop)
 * Express al montar "/shop/" pasa req.url SIN "/shop".
 * Acá lo reponemos: "/" -> "/shop/", "/product/303" -> "/shop/product/303"
 */
const shopProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (path) => joinPrefix(FRONTEND_INDEX_PATH, path),
});

/**
 * ✅ NEW: APP proxy cuando APP_SAME_AS_SHOP=1 (backoffice en mismo frontend)
 * Express al montar "/app/" pasa req.url SIN "/app".
 * Reponemos: "/" -> "/app/", "/users" -> "/app/users"
 */
const appProxySameFrontend = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (path) => joinPrefix(APP_INDEX_PATH, path),
});

/**
 * ✅ Compat: si el build/algún HTML pide /assets/* en raíz
 * Montado en "/assets/" => al proxy le llega "/index-xxx.js"
 * Debe ir a "/assets/index-xxx.js"
 */
const rootAssetsProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (p) => `/assets${ensureSlashStart(p)}`,
});

/**
 * ✅ Compat: estáticos de raíz (favicon, robots, manifest)
 * Acá NO queremos prefijar /assets, deben pasar tal cual.
 */
const rootStaticProxy = makeProxy(SHOP_UPSTREAM);

/**
 * ✅ API proxy
 * /api/... -> /api/v1/...
 * si ya viene /api/v1 no lo duplica
 *
 * IMPORTANTE:
 * - Montado en "/api/" => al proxy le llega "/public/..."
 * - Por eso reinyectamos API_BASE
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
 * - Montado en "/api/v1/" => al proxy le llega "/public/..."
 * - Acá NO reescribimos (va tal cual, con el prefijo ya presente en el mount)
 */
const apiV1CompatProxy = makeProxy(API_ORIGIN);

/**
 * ✅ COMPAT: /public/* directo a la API (opcional, útil)
 */
const publicCompatProxy = makeProxy(API_ORIGIN);

/**
 * ✅ APP proxy (si lo usás)
 * (Se mantiene, pero en tu caso probablemente no se usa)
 */
const appProxy = makeProxy(APP_UPSTREAM);

// ====== Redirects base ======
app.get("/", (req, res) =>
  res.redirect(301, removeTrailingSlash(FRONTEND_INDEX_PATH) + "/")
);
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));

// ✅ NEW: si entran a /app sin slash, lo normalizamos
app.get("/app", (req, res) => res.redirect(301, "/app/"));

// ====== ✅ MOUNTS (ORDEN IMPORTA) ======

// ✅ 1) assets de vite bajo /shop (PRIMERO)
app.use("/shop/assets/", shopAssetsFirstProxy);

// ✅ NEW: assets bajo /app (también primero)
app.use("/app/assets/", appAssetsFirstProxy);

// ✅ 2) compat assets en raíz (por si algo pide /assets/*)
app.use("/assets/", rootAssetsProxy);

// ✅ 3) compat estáticos típicos en raíz
app.get("/favicon.ico", rootStaticProxy);
app.get("/robots.txt", rootStaticProxy);
app.get("/manifest.webmanifest", rootStaticProxy);
app.get("/manifest.json", rootStaticProxy);

// ✅ 4) shop general (DESPUÉS)
app.use("/shop/", shopProxy);

// ✅ 5) ✅ compat API PRIMERO (para tu build actual que llama /api/v1)
app.use("/api/v1/", apiV1CompatProxy);
app.use("/public/", publicCompatProxy);

// ✅ 6) api “oficial” del edge (/api -> /api/v1)
app.use("/api/", apiProxy);

// ✅ 7) app/backoffice
// ✅ NEW: si coexiste en el mismo frontend, lo mandamos al SHOP_UPSTREAM
if (APP_SAME_AS_SHOP) {
  app.use("/app/", appProxySameFrontend);
} else {
  app.use("/app/", appProxy);
}

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
  console.log(`app -> ${APP_SAME_AS_SHOP ? SHOP_UPSTREAM + " (same as shop)" : APP_UPSTREAM}`);
  console.log(`PUBLIC_BASE_URL -> ${PUBLIC_BASE_URL}`);
  console.log(`FRONTEND_INDEX_PATH -> ${FRONTEND_INDEX_PATH}`);
  console.log(`APP_INDEX_PATH -> ${APP_INDEX_PATH}`);
  console.log(`APP_SAME_AS_SHOP -> ${APP_SAME_AS_SHOP}`);
});
