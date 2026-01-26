/**
 * ✅ pos360-edge/server.js
 * FIX: Express al montar "/shop/" recorta req.url (pierde el prefijo).
 * Solución: re-inyectar "/shop" antes de proxy_pass.
 *
 * Rutas:
 *  - /health        -> 200
 *  - /              -> 301 /shop/
 *  - /shop          -> 301 /shop/
 *  - /shop/*        -> proxy a frontend PRESERVANDO /shop
 *  - /assets/*      -> (compat) proxy a frontend como /shop/assets/*
 *  - /favicon.ico   -> (compat) proxy a frontend como /shop/favicon.ico
 *  - /api/*         -> proxy a API
 *  - /app/*         -> proxy a APP (si aplica)
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
const APP_UPSTREAM = env("APP_UPSTREAM", "http://srv-captain--pos360-admin");
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000");
const API_BASE = env("API_BASE", "/api/v1"); // si no lo seteás, default /api/v1

// Base pública
const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com");

// Donde vive el frontend (IMPORTANTE)
const FRONTEND_INDEX_PATH = env("FRONTEND_INDEX_PATH", "/shop/"); // => "/shop/"

// ====== Core settings ======
app.disable("x-powered-by");
// 🔥 IMPORTANTE para evitar equivalencia /shop y /shop/
app.enable("strict routing");

// ====== Health ======
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", "EDGE_FIX_NO_LOOP_SHOP_03");
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
    secure: false, // por si target es http interno
    ...opts,
    onProxyReq(proxyReq, req, res) {
      // Host real
      proxyReq.setHeader("Host", req.headers.host || "");
      if (opts.onProxyReq) opts.onProxyReq(proxyReq, req, res);
    },
  });
}

// ====== SHOP proxy (PRESERVA /shop) ======
const shopProxy = makeProxy(SHOP_UPSTREAM, {
  /**
   * Express al montar "/shop/" pasa req.url SIN "/shop".
   * Acá lo reponemos: "/" -> "/shop/", "/product/303" -> "/shop/product/303"
   */
  pathRewrite: (path, req) => {
    return joinPrefix(FRONTEND_INDEX_PATH, path);
  },
});

// ====== Compat: si el build pide /assets/* en raíz ======
const shopAssetsProxy = makeProxy(SHOP_UPSTREAM, {
  pathRewrite: (path) => joinPrefix(FRONTEND_INDEX_PATH, path), // /assets/x -> /shop/assets/x
});

// ====== API proxy ======
const apiProxy = makeProxy(API_ORIGIN, {
  pathRewrite: (path) => {
    // /api/... -> /api/v1/...
    // si ya viene /api/v1 no lo duplica
    const base = ensureSlashStart(API_BASE);
    if (path.startsWith(base)) return path;
    return `${removeTrailingSlash(base)}${ensureSlashStart(path)}`;
  },
});

// ====== APP proxy (si lo usás) ======
const appProxy = makeProxy(APP_UPSTREAM);

// ====== Redirects base ======
app.get("/", (req, res) => res.redirect(301, removeTrailingSlash(FRONTEND_INDEX_PATH) + "/"));
app.get("/shop", (req, res) => res.redirect(301, "/shop/"));

// ====== Compat assets raíz (evita “a veces rompe”) ======
app.use("/assets/", shopAssetsProxy);
app.get("/favicon.ico", shopAssetsProxy);
app.get("/robots.txt", shopAssetsProxy);
app.get("/manifest.webmanifest", shopAssetsProxy);
app.get("/manifest.json", shopAssetsProxy);

// ====== Mounts principales ======
app.use("/shop/", shopProxy);
app.use("/api/", apiProxy);
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
