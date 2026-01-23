/**
 * pos360-edge (FINAL PRO)
 * - / -> /shop
 * - Inyecta OG/Favicon en TODAS las rutas HTML
 * - ✅ Proxy /api/v1/* a commerce-api (evita "me devuelve HTML")
 * - Proxy de assets y resto al frontend interno
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3000;

const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://sanjuantecnologia.com").replace(/\/+$/, "");
const FRONTEND_INTERNAL = String(process.env.FRONTEND_INTERNAL || "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const FRONTEND_INDEX_PATH = String(process.env.FRONTEND_INDEX_PATH || "/shop");

const API_BASE = String(process.env.API_BASE || "https://pos360-commerce-api.cingulado.org/api/v1").replace(/\/+$/, "");
const BRANDING_ENDPOINT = String(process.env.BRANDING_ENDPOINT || "/shop/branding/public");
const CACHE_SECONDS = Math.max(5, parseInt(process.env.BRANDING_CACHE_SECONDS || "60", 10) || 60);

function esc(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function absUrl(u) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("//")) return `https:${s}`;
  return `${PUBLIC_BASE_URL}${s.startsWith("/") ? "" : "/"}${s}`;
}

function wantsHtml(req) {
  const a = String(req.headers.accept || "");
  return a.includes("text/html") || a.includes("*/*") || a === "";
}

function isAssetPath(p) {
  return (
    p.startsWith("/assets/") ||
    p.startsWith("/favicon") ||
    p.startsWith("/robots.txt") ||
    p.startsWith("/sitemap") ||
    p.startsWith("/.well-known/") ||
    /\.[a-z0-9]{2,6}$/i.test(p)
  );
}

/* =========================
   BRANDING CACHE
   ========================= */
let cached = null;
let cachedAt = 0;

async function loadBranding() {
  const now = Date.now();
  if (cached && now - cachedAt < CACHE_SECONDS * 1000) return cached;

  try {
    const r = await fetch(`${API_BASE}${BRANDING_ENDPOINT}`, {
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!r.ok) throw new Error(`branding http ${r.status}`);
    const j = await r.json();

    const name = j?.name || "San Juan Tecnología";
    const favicon = absUrl(j?.favicon_url);
    const ogImage = absUrl(j?.og_image_url || j?.logo_url || j?.favicon_url);

    cached = { name, favicon, ogImage };
    cachedAt = now;
    return cached;
  } catch {
    cached = { name: "San Juan Tecnología", favicon: "", ogImage: "" };
    cachedAt = now;
    return cached;
  }
}

/* =========================
   0) HOME
   ========================= */
app.get("/", (req, res) => res.redirect(301, "/shop"));

/* =========================
   1) ✅ API PROXY
   /api/v1/* -> commerce-api
   ========================= */
app.use(
  "/api/v1",
  createProxyMiddleware({
    target: "https://pos360-commerce-api.cingulado.org",
    changeOrigin: true,
    secure: true,
    ws: true,
    pathRewrite: { "^/api/v1": "/api/v1" },
  })
);

/* =========================
   2) HTML INJECTION (todas las rutas HTML)
   ========================= */
app.get("*", async (req, res, next) => {
  try {
    // Assets o requests no-HTML: proxy normal
    if (req.path.startsWith("/api/v1/") || isAssetPath(req.path) || !wantsHtml(req)) return next();

    const [branding, indexRes] = await Promise.all([
      loadBranding(),
      fetch(`${FRONTEND_INTERNAL}${FRONTEND_INDEX_PATH}`, {
        headers: { Accept: "text/html" },
        redirect: "follow",
      }),
    ]);

    let html = await indexRes.text();

    const title = `${branding.name} | Tienda`;
    const desc = "Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas.";
    const canonical = `${PUBLIC_BASE_URL}${req.originalUrl || "/shop"}`;

    const favicon = branding.favicon || `${PUBLIC_BASE_URL}/favicon.png`;
    const ogImage = branding.ogImage || favicon;

    // Evitar duplicados
    html = html.replace(/<title>.*?<\/title>/is, "");
    html = html.replace(/<meta\s+name=["']description["'][^>]*>/gi, "");
    html = html.replace(/<link\s+rel=["']canonical["'][^>]*>/gi, "");
    html = html.replace(/<link\s+rel=["']icon["'][^>]*>/gi, "");
    html = html.replace(/<link\s+rel=["']apple-touch-icon["'][^>]*>/gi, "");
    html = html.replace(/<meta\s+property=["']og:[^"']+["'][^>]*>/gi, "");
    html = html.replace(/<meta\s+name=["']twitter:[^"']+["'][^>]*>/gi, "");

    const inject = `
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${esc(canonical)}" />

<link rel="icon" type="image/png" href="${esc(favicon)}" />
<link rel="apple-touch-icon" href="${esc(favicon)}" />

<meta property="og:type" content="website" />
<meta property="og:site_name" content="${esc(branding.name)}" />
<meta property="og:title" content="${esc(branding.name)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:image" content="${esc(ogImage)}" />
<meta property="og:image:secure_url" content="${esc(ogImage)}" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(branding.name)}" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta name="twitter:image" content="${esc(ogImage)}" />
`;

    html = html.replace(/<\/head>/i, `${inject}\n</head>`);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    return res.status(200).send(html);
  } catch (e) {
    return next(e);
  }
});

/* =========================
   3) favicon.ico tipo WordPress
   ========================= */
app.get("/favicon.ico", async (req, res) => {
  const b = await loadBranding();
  if (b?.favicon) return res.redirect(302, b.favicon);
  return res.status(204).end();
});

/* =========================
   4) Proxy resto al frontend
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
