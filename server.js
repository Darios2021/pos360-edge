/**
 * ✅ pos360-edge/server.js — FINAL DEFINITIVO (ANTI 301 LOOP)
 * POS360 / sanjuantecnologia.com
 *
 * - NO redirects en /shop/
 * - Proxy /shop -> frontend (strip prefix)
 * - / (raíz) se sirve como shop SIN 301 (proxy interno)
 * - Reescritura de Location para mantener /shop
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();

// 🔑 Detrás de CapRover/Nginx
app.set("trust proxy", true);

// =========================
// ENV helpers
// =========================
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
const APP_UPSTREAM = env("APP_UPSTREAM", "http://srv-captain--pos360-admin").replace(/\/+$/, "");
const API_ORIGIN = env("API_ORIGIN", "http://srv-captain--pos360-commerce-api:3000").replace(/\/+$/, "");
const EDGE_BUILD = env("EDGE_BUILD", "EDGE_FINAL_ANTI_301_LOOP_2026-01-25_02");

// =========================
// HTTP helpers
// =========================
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

  return xfProto === "https" || req.protocol === "https" || req.secure === true;
}

/**
 * 🔁 Reescritura defensiva de Location
 * - Si upstream devuelve Location: /login -> lo convertimos a /shop/login (o /app/login)
 * - Si devuelve absoluto interno, lo convertimos al host público
 */
function rewriteLocationFactory({ publicPrefix }) {
  return function rewriteLocation(proxyRes, req) {
    const loc = proxyRes.headers?.location;
    if (!loc) return;

    const host = getHost(req);
    if (!host) return;

    let newLoc = String(loc);

    // 1) Si el upstream devuelve "/algo", lo mantenemos en el namespace público (/shop o /app)
    if (newLoc.startsWith("/")) {
      // Evita duplicar
      if (publicPrefix && !newLoc.startsWith(publicPrefix + "/") && newLoc !== publicPrefix) {
        newLoc = publicPrefix + newLoc;
      }
      proxyRes.headers.location = newLoc;
      return;
    }

    // 2) Si viene absoluto interno, lo pasamos a https://host y con prefijo público si aplica
    const targets = [
      /https?:\/\/srv-captain--pos360-frontend(?=\/|$)/i,
      /https?:\/\/srv-captain--pos360-admin(?=\/|$)/i,
      /https?:\/\/srv-captain--pos360-edge(?=\/|$)/i,
      /https?:\/\/127\.0\.0\.1(?=\/|$)/i,
      /https?:\/\/localhost(?=\/|$)/i,
    ];

    targets.forEach((rx) => {
      newLoc = newLoc.replace(rx, `https://${host}`);
    });

    // forzar https si corresponde
    if (isHttps(req)) {
      const hostEsc = host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      newLoc = newLoc.replace(new RegExp(`^http:\\/\\/${hostEsc}(?=\\/|$)`, "i"), `https://${host}`);
    }

    // Si quedó absoluto al host, y tiene path /algo, lo pasamos a /shop/algo o /app/algo
    try {
      const u = new URL(newLoc);
      if (publicPrefix && u.pathname && u.pathname.startsWith("/") && !u.pathname.startsWith(publicPrefix + "/")) {
        u.pathname = publicPrefix + u.pathname;
        newLoc = u.toString();
      }
    } catch (_) {
      // ignore
    }

    proxyRes.headers.location = newLoc;
  };
}

// =========================
// Health Check
// =========================
app.get("/health", (req, res) => {
  res.setHeader("X-EDGE-BUILD", EDGE_BUILD);
  res.json({
    ok: true,
    service: "pos360-edge",
    build: EDGE_BUILD,
    shopUpstream: SHOP_UPSTREAM,
    appUpstream: APP_UPSTREAM,
    apiOrigin: API_ORIGIN,
  });
});

// =========================
// PROXIES
// =========================

// ---- API: /api -> API_ORIGIN (strip /api)
app.use(
  "/api",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    pathRewrite: { "^/api": "" },
    onProxyRes: rewriteLocationFactory({ publicPrefix: "" }),
  })
);

// ---- APP: /app -> APP_UPSTREAM (strip /app)
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    pathRewrite: (path) => {
      const out = path.replace(/^\/app(\/|$)/, "/");
      return out === "" ? "/" : out;
    },
    onProxyRes: rewriteLocationFactory({ publicPrefix: "/app" }),
  })
);

// ---- SHOP: /shop -> SHOP_UPSTREAM (strip /shop)
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    // 🔥 CLAVE: strip /shop para que el frontend upstream siempre vea "/" como base
    pathRewrite: (path) => {
      const out = path.replace(/^\/shop(\/|$)/, "/");
      return out === "" ? "/" : out;
    },
    onProxyRes: rewriteLocationFactory({ publicPrefix: "/shop" }),
  })
);

// =========================
// RAÍZ: servir shop SIN 301
// =========================
// En vez de redirect 301, proxy directo al frontend con path "/"
app.use(
  "/",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    logLevel: PROXY_LOG_LEVEL,
    xfwd: true,
    // raíz siempre al index del frontend
    pathRewrite: () => "/",
    onProxyRes: rewriteLocationFactory({ publicPrefix: "/shop" }),
  })
);

app.listen(PORT, () => {
  console.log(`✅ pos360-edge FINAL ANTI-301 loop en ${PORT} build=${EDGE_BUILD}`);
});
