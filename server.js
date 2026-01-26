/**
 * ✅ pos360-edge/server.js
 * ✅ COPY-PASTE FINAL DEFINITIVO (FIX ASSETS 404 + /shop + compat /assets + compat /api/v1 + APP en /app)
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
 * FIX APP CLAVE (backoffice dentro del MISMO frontend):
 * - El backoffice físicamente vive bajo "/shop/app/" (porque Vite base="/shop/")
 * - Pero vos querés URL pública "/app/*"
 * - Solución: PROXY TRANSPARENTE /app/* -> /shop/app/* (sin redirect)
 *
 * Rutas:
 *  - /health        -> 200
 *  - /              -> 301 /shop/
 *  - /shop          -> 301 /shop/
 *  - /shop/assets/* -> proxy a frontend como /assets/*
 *  - /shop/*        -> proxy a frontend (PRESERVA /shop hacia upstream)
 *  - /assets/*      -> (compat) proxy a frontend como /assets/*
 *  - /favicon.ico   -> (compat) proxy a frontend como /favicon.ico
 *  - /api/*         -> proxy a API (rewrite a /api/v1/*)
 *  - /api/v1/*      -> ✅ compat directo a API (builds que llaman /api/v1)
 *  - /public/*      -> ✅ compat directo a API (por si alguna vez se usa)
 *  - /app/*         -> ✅ proxy transparente a /shop/app/*
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
  const pfx = removeTrailingSlash(ensureSlashStart(prefix));
  const pth = ensureSlashStart(path);
  if (pth === "/") return `${pfx}/`;
  return `${pfx}${pth}`;
}

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

// Upstreams
const SHOP_UPSTREAM = env("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend");
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000");
const API_BASE = env("API_BASE", "/api/v1"); // default

// Base pública (solo logs/debug)
const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com");

// Donde vive el frontend (público)
const FRONTEND_INDEX_PATH = env("FRONTEND_INDEX_PATH", "/shop/"); // "/shop/"

// Backoffice REAL dentro del mismo FE (físico)
const APP_INDEX_PATH = env("APP_INDEX_PATH", "/shop/app/"); // "/shop/app/"

// ====== Core settings ======
app.disable("x-powered-by");
app.enable("strict routing");

// ====== Health ======
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", "EDGE_STABLE_SHOP_ASSETS_APIv1_APP_PROXY_01");
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
        err && err.message ? err.message : err
      );
      if (res.headersSent) return;
      res.status(502).json({
        ok: false,
        error: "Bad Gateway",
        path: req.originalUrl,
        message: String(err && err.message ? err.message : err),
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
 * Express al montar "/shop/" pasa req.url SIN "/shop".
 * Acá lo reponemos: "/" -> "/shop/", "/product/303" -> "/shop/product/303"
 */
const shopProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (path) => joinPrefix(FRONTEND_INDEX_PATH, path),
});

/**
 * ✅ 3) APP proxy TRANSPARENTE: /app/* -> /shop/app/*
 * Express al montar "/app/" pasa req.url SIN "/app".
 * Reinyectamos APP_INDEX_PATH, pero mantenemos URL pública /app/*
 */
const appProxy = makeProxy(SHOP_UPSTREAM, {
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
 */
const rootStaticProxy = makeProxy(SHOP_UPSTREAM);

/**
 * ✅ API proxy
 * /api/... -> /api/v1/...
 * Montado en "/api/" => al proxy le llega "/public/..."
 * Por eso reinyectamos API_BASE
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
 */
const apiV1CompatProxy = makeProxy(API_ORIGIN);

/**
 * ✅ COMPAT: /public/* directo a la API
 */
const publicCompatProxy = makeProxy(API_ORIGIN);

// ====== Redirects base ======
app.get("/", (req, res) =>
  res.redirect(301, removeTrailingSlash(FRONTEND_INDEX_PATH) + "/")
);
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));

// ✅ /app sin barra -> /app/
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

// ✅ 4) ✅ APP (ANTES o DESPUÉS da igual por path, pero lo dejo antes del shop por claridad)
app.use("/app/", appProxy);

// ✅ 5) shop general
app.use("/shop/", shopProxy);

// ✅ 6) compat API primero (para builds que llaman /api/v1)
app.use("/api/v1/", apiV1CompatProxy);
app.use("/public/", publicCompatProxy);

// ✅ 7) api “oficial” del edge (/api -> /api/v1)
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
  console.log(`app -> ${SHOP_UPSTREAM} (transparent /app -> ${APP_INDEX_PATH})`);
  console.log(`PUBLIC_BASE_URL -> ${PUBLIC_BASE_URL}`);
  console.log(`FRONTEND_INDEX_PATH -> ${FRONTEND_INDEX_PATH}`);
  console.log(`APP_INDEX_PATH -> ${APP_INDEX_PATH}`);
});
