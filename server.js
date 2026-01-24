/**
 * ✅ pos360-edge/server.js  (COPY-PASTE FINAL COMPLETO)
 *
 * Reverse proxy por PATH:
 * - /        -> TIENDA (shop)
 * - /shop/*  -> TIENDA
 * - /app/*   -> PLATAFORMA (admin/backoffice) ✅ strip /app + reescritura Location/Cookies
 * - /api/*   -> API
 *
 * FIX CRÍTICO:
 * - Eliminado target dinámico / router que estaba apuntando a "sanjuantecnologia.com" (sin protocolo)
 *   y rompía requires-port (protocol undefined -> split).
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

// ✅ Normaliza: si falta protocolo, asume http://
function normalizeUrl(raw, fallback) {
  const v = env(raw, fallback);
  if (!v) return v;
  if (/^https?:\/\//i.test(v)) return v;
  return `http://${v}`;
}

function envInt(name, fallback) {
  const v = parseInt(env(name, String(fallback)), 10);
  return Number.isFinite(v) ? v : fallback;
}

const PORT = envInt("PORT", 3000);
const PROXY_LOG_LEVEL = env("PROXY_LOG_LEVEL", "warn");

// 🔗 Upstreams internos (CapRover service names)
const SHOP_UPSTREAM = normalizeUrl("SHOP_UPSTREAM", "http://srv-captain--pos360-frontend");
const APP_UPSTREAM  = normalizeUrl("APP_UPSTREAM",  "http://srv-captain--pos360-admin:80");
const API_UPSTREAM  = normalizeUrl("API_UPSTREAM",  "http://srv-captain--pos360-commerce-api:3000/api/v1");

// Base pública (solo para logs / debugging)
const PUBLIC_BASE_URL = env("PUBLIC_BASE_URL", "https://sanjuantecnologia.com");

console.log(`✅ pos360-edge on :${PORT}`);
console.log(`shop -> ${SHOP_UPSTREAM}`);
console.log(`app  -> ${APP_UPSTREAM}`);
console.log(`api  -> ${API_UPSTREAM}`);

// ===== Helpers de reescritura =====
function rewriteLocationToApp(proxyRes) {
  const loc = proxyRes.headers?.location;
  if (!loc) return;

  // 1) Redirect relativo "/auth" => "/app/auth"
  if (loc.startsWith("/") && !loc.startsWith("/app/") && loc !== "/app") {
    proxyRes.headers.location = `/app${loc}`;
    return;
  }

  // 2) Redirect absoluto a APP_UPSTREAM => convertir a "/app/..."
  //    Ej: "http://srv-captain--pos360-admin/auth" -> "/app/auth"
  try {
    const u = new URL(loc);
    const appOrigin = new URL(APP_UPSTREAM).origin;

    if (u.origin === appOrigin) {
      const newPath = u.pathname + (u.search || "") + (u.hash || "");
      proxyRes.headers.location = `/app${newPath}`;
    }
  } catch (_) {
    // si no es URL válida, no tocar
  }
}

function onProxyError(label) {
  return (err, req, res) => {
    console.error(`❌ Proxy error [${label}] ${req.method} ${req.originalUrl}:`, err?.message || err);

    if (res.headersSent) return;
    res.status(502).send(`Bad gateway (${label})`);
  };
}

// ===== Root: manda a shop (opcional) =====
app.get("/", (req, res) => {
  res.redirect("/shop");
});

// ===== /api => API =====
app.use(
  "/api",
  createProxyMiddleware({
    target: API_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    logLevel: PROXY_LOG_LEVEL,
    // /api/* -> API_UPSTREAM/*  (si tu API_UPSTREAM ya incluye /api/v1)
    pathRewrite: (path) => path.replace(/^\/api/, ""),
    onError: onProxyError("api"),
  })
);

// ===== /app => ADMIN =====
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    logLevel: PROXY_LOG_LEVEL,

    // /app/* -> APP_UPSTREAM/*
    pathRewrite: (path) => path.replace(/^\/app/, ""),

    // ✅ reescribir redirects y cookies para quedar bajo /app
    onProxyRes: (proxyRes) => {
      rewriteLocationToApp(proxyRes);

      // cookies: Path=/  -> Path=/app
      // (algunas apps usan Path=/; esto evita que "pise" la tienda)
      if (proxyRes.headers["set-cookie"]) {
        proxyRes.headers["set-cookie"] = proxyRes.headers["set-cookie"].map((c) =>
          c.replace(/;\s*Path=\/(\s*|;|$)/i, "; Path=/app$1")
        );
      }
    },

    onError: onProxyError("app"),
  })
);

// ===== /shop (y fallback) => SHOP =====
app.use(
  ["/shop", "/shop/*"],
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    logLevel: PROXY_LOG_LEVEL,
    onError: onProxyError("shop"),
  })
);

// ✅ Fallback: cualquier otra cosa se va a SHOP (evita 404 raros)
app.use(
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    logLevel: PROXY_LOG_LEVEL,
    onError: onProxyError("fallback"),
  })
);

app.listen(PORT, "0.0.0.0");
