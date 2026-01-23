/**
 * pos360-edge (FINAL)
 * - Dominio público pasa por EDGE
 * - / -> /shop (controlado por EDGE)
 * - Inyección de <head> (OG + favicon) en TODAS las rutas HTML
 * - Assets / API se proxyean normal
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();

const PORT = process.env.PORT || 3000;

const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://sanjuantecnologia.com").replace(/\/+$/, "");
const FRONTEND_INTERNAL = (process.env.FRONTEND_INTERNAL || "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const FRONTEND_INDEX_PATH = process.env.FRONTEND_INDEX_PATH || "/shop";

const API_BASE = (process.env.API_BASE || "").replace(/\/+$/, "");
const BRANDING_ENDPOINT = process.env.BRANDING_ENDPOINT || "/shop/branding/public";
const CACHE_SECONDS = parseInt(process.env.BRANDING_CACHE_SECONDS || "60", 10);

function esc(s = "") {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function absUrl(u = "") {
  if (!u) return "";
  if (u.startsWith("http")) return u;
  return `${PUBLIC_BASE_URL}${u.startsWith("/") ? "" : "/"}${u}`;
}

function isAsset(path) {
  return (
    path.startsWith("/assets/") ||
    path.startsWith("/api/") ||
    path.startsWith("/favicon") ||
    path.startsWith("/robots.txt") ||
    path.startsWith("/sitemap") ||
    path.startsWith("/.well-known") ||
    /\.[a-z0-9]{2,5}$/i.test(path)
  );
}

function wantsHtml(req) {
  const a = req.headers.accept || "";
  return a.includes("text/html") || a.includes("*/*") || !a;
}

/* =========================
   BRANDING CACHE
   ========================= */
let cache = null;
let cacheAt = 0;

async function getBranding() {
  const now = Date.now();
  if (cache && now - cacheAt < CACHE_SECONDS * 1000) return cache;

  try {
    const r = await fetch(`${API_BASE}${BRANDING_ENDPOINT}`);
    const j = await r.json();

    cache = {
      name: j?.name || "San Juan Tecnología",
      favicon: absUrl(j?.favicon_url),
      ogImage: absUrl(j?.og_image_url || j?.logo_url || j?.favicon_url),
    };
    cacheAt = now;
    return cache;
  } catch {
    cache = { name: "San Juan Tecnología", favicon: "", ogImage: "" };
    cacheAt = now;
    return cache;
  }
}

/* =========================
   REDIRECT HOME
   ========================= */
app.get("/", (req, res) => {
  return res.redirect(301, "/shop");
});

/* =========================
   HTML INJECTION
   ========================= */
app.get("*", async (req, res, next) => {
  try {
    if (isAsset(req.path) || !wantsHtml(req)) return next();

    const [branding, htmlRes] = await Promise.all([
      getBranding(),
      fetch(`${FRONTEND_INTERNAL}${FRONTEND_INDEX_PATH}`, {
        headers: { Accept: "text/html" },
        redirect: "follow",
      }),
    ]);

    let html = await htmlRes.text();

    // limpiar head previo
    html = html.replace(/<title>.*?<\/title>/is, "");
    html = html.replace(/<meta[^>]+og:[^>]+>/gi, "");
    html = html.replace(/<meta[^>]+twitter:[^>]+>/gi, "");
    html = html.replace(/<link[^>]+icon[^>]*>/gi, "");

    const head = `
<title>${esc(branding.name)} | Tienda</title>
<meta name="description" content="Electrónica, ecommerce, sistemas POS y soluciones tecnológicas." />

<link rel="icon" href="${esc(branding.favicon)}" />
<link rel="apple-touch-icon" href="${esc(branding.favicon)}" />

<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(branding.name)}" />
<meta property="og:description" content="Electrónica, ecommerce, sistemas POS y soluciones tecnológicas." />
<meta property="og:url" content="${PUBLIC_BASE_URL}/shop" />
<meta property="og:image" content="${esc(branding.ogImage)}" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(branding.name)}" />
<meta name="twitter:image" content="${esc(branding.ogImage)}" />
`;

    html = html.replace("</head>", `${head}\n</head>`);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    return res.send(html);
  } catch (e) {
    return next(e);
  }
});

/* =========================
   PROXY RESTO
   ========================= */
app.use(
  "/",
  createProxyMiddleware({
    target: FRONTEND_INTERNAL,
    changeOrigin: true,
    ws: true,
  })
);

app.listen(PORT, () => console.log(`✅ pos360-edge on :${PORT}`));
