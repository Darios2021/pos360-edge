/**
 * ✅ pos360-edge/server.js
 * ✅ COPY-PASTE FINAL DEFINITIVO (FIX ASSETS 404 + /shop + compat /assets + compat /api/v1 + FIX /app)
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
 * FIX APP CLAVE:
 * - Tu backoffice coexiste en el MISMO frontend (pos360-frontend)
 * - Si montás "/app/" y NO reinyectás el prefijo, al upstream le llega "/"
 *   => y tu upstream te redirige a "/shop/" (por eso te manda a /shop)
 * - Solución: /app/* proxy preservando "/app" igual que /shop
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
 *  - /app/assets/*  -> ✅ (si existiera) proxy a frontend como /assets/*
 *  - /app/*         -> ✅ proxy a frontend preservando /app
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
// ✅ en tu caso APP_UPSTREAM también es pos360-frontend (backoffice coexiste)
const APP_UPSTREAM = env("APP_UPSTREAM", "http://srv-captain--pos360-frontend");
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000");
const API_BASE = env("API_BASE", "/api/v1"); // default

// Base pública (no se usa en routing, queda para logs/debug)
const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com");

// Donde vive el frontend (SHOP)
const FRONTEND_INDEX_PATH = env("FRONTEND_INDEX_PATH", "/shop/"); // "/shop/"

// ====== Core settings ======
app.disable("x-powered-by");
// evita equivalencia /shop y /shop/
app.enable("strict routing");

// ====== Health ======
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", "EDGE_FIX_ASSETS_FIRST_02_API_COMPAT_02_APP_PRESERVE_01");
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
      // Host real (útil para apps que generan URLs)
      proxyReq.setHeader("Host", req.headers.host || "");
      if (opts.onProxyReq) opts.onProxyReq(proxyReq, req, res);
    },
    onError(err, req, res) {
      // ✅ evita que el proceso muera / nginx muestre 500 genérico
      const msg = (err && err.code) ? `${err.code}` : "PROXY_ERROR";
      try {
        res.writeHead(502, {
          "Content-Type": "application/json; charset=utf-8",
          "X-EDGE-PROXY-ERROR": msg,
        });
        res.end(JSON.stringify({ ok: false, error: "Bad Gateway", code: msg, path: req.originalUrl }));
      } catch (_) {
        // noop
      }
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
 * - Por lo tanto REINYECTAMOS "/api/v1" para que pegue bien en tu API real
 */
const apiV1CompatProxy = makeProxy(API_ORIGIN, {
  pathRewrite: (p) => `/api/v1${ensureSlashStart(p)}`,
});

/**
 * ✅ COMPAT: /public/* directo a la API (opcional)
 * - Lo más sano: mapear /public/* -> /api/v1/public/*
 */
const publicCompatProxy = makeProxy(API_ORIGIN, {
  pathRewrite: (p) => `/api/v1/public${ensureSlashStart(p)}`,
});

/**
 * ✅ APP proxy (backoffice coexiste en el mismo frontend)
 * - Montado en "/app/" => al proxy le llega "/"
 * - Entonces reinyectamos "/app" para NO caer en "/" (que te redirige a /shop)
 */
const appProxy = makeProxy(APP_UPSTREAM, {
  pathRewrite: (p) => joinPrefix("/app/", p),
});

/**
 * ✅ (Opcional / blindado) si algún día tu build pidiera /app/assets/*
 * lo convertimos a /assets/*
 */
const appAssetsCompatProxy = makeProxy(APP_UPSTREAM, {
  pathRewrite: (p) => `/assets${ensureSlashStart(p)}`,
});

// ====== Redirects base ======
app.get("/", (req, res) =>
  res.redirect(301, removeTrailingSlash(FRONTEND_INDEX_PATH) + "/")
);
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));

// ====== ✅ MOUNTS (ORDEN IMPORTA) ======

// ✅ 1) assets de vite bajo /shop (PRIMERO)
app.use("/shop/assets/", shopAssetsFirstProxy);

// ✅ 1b) (blindado) assets si se pidieran desde /app/assets
app.use("/app/assets/", appAssetsCompatProxy);

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
