/**
 * ✅ pos360-edge/server.js
 * Reverse proxy por PATH:
 * - /        -> TIENDA (shop)
 * - /shop/*  -> TIENDA
 * - /app/*   -> PLATAFORMA (admin/backoffice)  ✅ reescribe Location: /auth -> /app/auth
 * - /api/*   -> API
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

const PORT = parseInt(env("PORT", "3000"), 10) || 3000;

// 🔗 Upstreams
const SHOP_UPSTREAM = env(
  "SHOP_UPSTREAM",
  "http://srv-captain--pos360-frontend"
);

// ✅ AJUSTÁ al servicio real de la plataforma
const APP_UPSTREAM = env(
  "APP_UPSTREAM",
  "http://srv-captain--pos360-admin"
);

// ✅ SIN /api acá
const API_UPSTREAM = env(
  "API_UPSTREAM",
  "http://srv-captain--pos360-commerce-api:3000"
);

app.disable("x-powered-by");

function setForwardedHeaders(proxyReq, req, extra = {}) {
  proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
  proxyReq.setHeader("X-Forwarded-Proto", req.headers["x-forwarded-proto"] || "https");
  Object.entries(extra).forEach(([k, v]) => proxyReq.setHeader(k, v));
}

// ------------------------------------------------------
// HEALTH
// ------------------------------------------------------
app.get("/health", (_req, res) =>
  res.status(200).json({ ok: true, service: "pos360-edge" })
);

// ------------------------------------------------------
// /api/* -> API
// ------------------------------------------------------
app.use(
  "/api",
  createProxyMiddleware({
    target: API_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req);
    },
    onError(err, _req, res) {
      console.error("[api-proxy] error:", err?.message || err);
      if (!res.headersSent) res.status(502);
      res.end("Bad gateway (api)");
    },
  })
);

// ------------------------------------------------------
// /app/* -> PLATAFORMA (admin)
// - Hacia el upstream: STRIP /app  (/app/users -> /users)
// - Hacia el cliente: reescribe Location: /xxx -> /app/xxx (para que NO te saque del prefijo)
// ------------------------------------------------------
app.use(
  "/app",
  createProxyMiddleware({
    target: APP_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    ws: true,

    // ✅ hacia el upstream sacamos el prefijo /app
    pathRewrite: (path) => {
      const out = path.replace(/^\/app/, "");
      return out ? out : "/";
    },

    onProxyReq(proxyReq, req) {
      // 👇 útil si tu plataforma sabe manejar prefijos
      setForwardedHeaders(proxyReq, req, { "X-Forwarded-Prefix": "/app" });
    },

    onProxyRes(proxyRes, req) {
      // ✅ si el backend devuelve redirect absoluto: Location: /auth/login
      // lo convertimos a: Location: /app/auth/login
      const loc = proxyRes.headers?.location;
      if (loc && typeof loc === "string") {
        // si ya viene con /app, no tocamos
        if (loc.startsWith("/") && !loc.startsWith("/app/") && loc !== "/app") {
          proxyRes.headers.location = "/app" + loc;
        }
      }

      // (opcional) cookies que dependan del path:
      // si el backend setea cookies con Path=/, podrías querer Path=/app
      // ⚠️ solo si te hace falta
      // const sc = proxyRes.headers["set-cookie"];
      // if (Array.isArray(sc)) {
      //   proxyRes.headers["set-cookie"] = sc.map((c) =>
      //     c.replace(/;\s*Path=\/(\s*;|$)/i, "; Path=/app$1")
      //   );
      // }
    },

    onError(err, _req, res) {
      console.error("[app-proxy] error:", err?.message || err);
      if (!res.headersSent) res.status(502);
      res.end("Bad gateway (app)");
    },
  })
);

// ------------------------------------------------------
// /shop/* -> TIENDA
// ------------------------------------------------------
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req);
    },
    onError(err, _req, res) {
      console.error("[shop-proxy] error:", err?.message || err);
      if (!res.headersSent) res.status(502);
      res.end("Bad gateway (shop)");
    },
  })
);

// ------------------------------------------------------
// ROOT "/" -> TIENDA como "/shop/*" (sin redirect)
// ------------------------------------------------------
app.use(
  "/",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    onProxyReq(proxyReq, req) {
      setForwardedHeaders(proxyReq, req);
    },
    pathRewrite: (path) => {
      if (path === "/") return "/shop/";
      return `/shop${path}`;
    },
    onError(err, _req, res) {
      console.error("[root-proxy] error:", err?.message || err);
      if (!res.headersSent) res.status(502);
      res.end("Bad gateway (root)");
    },
  })
);

app.listen(PORT, () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`   shop  -> ${SHOP_UPSTREAM}`);
  console.log(`   app   -> ${APP_UPSTREAM}`);
  console.log(`   api   -> ${API_UPSTREAM}`);
});
