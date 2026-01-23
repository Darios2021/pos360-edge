/**
 * ✅ pos360-edge/server.js
 * Reverse proxy por PATH (SIN REDIRECTS):
 * - /shop/* -> frontend
 * - /app/*  -> frontend (internamente como /shop/*)
 * - /api/*  -> api
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

// 🔗 Upstreams reales
const SHOP_UPSTREAM = env(
  "SHOP_UPSTREAM",
  "http://srv-captain--pos360-frontend"
);
const API_UPSTREAM = env(
  "API_UPSTREAM",
  "http://srv-captain--pos360-commerce-api:3000/api"
);

app.disable("x-powered-by");

// ------------------------------------------------------
// HEALTH
// ------------------------------------------------------
app.get("/health", (_req, res) =>
  res.status(200).json({ ok: true, service: "pos360-edge" })
);

// ------------------------------------------------------
// 🔥 /app/* → frontend COMO /shop/* (SIN redirect)
// ------------------------------------------------------
app.use(
  "/app",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    ws: true,

    // 🔑 ESTA ES LA CLAVE
    pathRewrite: (path, req) => {
      // /app/cart   -> /shop/cart
      // /app        -> /shop/
      const rest = path.replace(/^\/app/, "");
      return rest ? `/shop${rest}` : "/shop/";
    },

    onProxyReq(proxyReq, req) {
      // el frontend cree que está en dominio público
      proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
    },

    onError(err, req, res) {
      console.error("[app-proxy] error:", err?.message || err);
      if (!res.headersSent) res.status(502);
      res.end("Bad gateway (app)");
    },
  })
);

// ------------------------------------------------------
// /shop/* → frontend normal
// ------------------------------------------------------
app.use(
  "/shop",
  createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    onProxyReq(proxyReq, req) {
      proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
    },
  })
);

// ------------------------------------------------------
// /api/* → api
// ------------------------------------------------------
app.use(
  "/api",
  createProxyMiddleware({
    target: API_UPSTREAM,
    changeOrigin: true,
    xfwd: true,
    ws: true,
    onProxyReq(proxyReq, req) {
      proxyReq.setHeader("X-Forwarded-Host", req.headers.host || "");
    },
  })
);

// ------------------------------------------------------
// root → frontend /shop
// ------------------------------------------------------
app.use("/", (req, res) => {
  // proxy directo como /shop
  req.url = "/shop" + req.url;
  return createProxyMiddleware({
    target: SHOP_UPSTREAM,
    changeOrigin: true,
  })(req, res);
});

app.listen(PORT, () => {
  console.log(`✅ pos360-edge on :${PORT}`);
  console.log(`   shop/app -> ${SHOP_UPSTREAM}`);
  console.log(`   api      -> ${API_UPSTREAM}`);
});
