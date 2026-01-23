/**
 * pos360-edge
 * - Sirve "/" con <head> dinámico (title/og/fav) consultando al backend
 * - Proxy del resto (assets + SPA) al frontend interno CapRover
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();

const PORT = process.env.PORT || 3000;

// Dominio final público
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://sanjuantecnologia.com").replace(/\/+$/, "");

// Frontend interno (nombre servicio CapRover)
const FRONTEND_INTERNAL = String(process.env.FRONTEND_INTERNAL || "http://srv-captain--pos360-frontend").replace(/\/+$/, "");

// Backend (API v1)
const API_BASE = String(process.env.API_BASE || "https://pos360-commerce-api.cingulado.org/api/v1").replace(/\/+$/, "");

// Endpoint público branding (lo creamos en backend)
const BRANDING_ENDPOINT = String(process.env.BRANDING_ENDPOINT || "/shop/branding/public");

// Cache branding
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

// ---------- branding cache ----------
let cachedBranding = null;
let cachedAt = 0;

async function loadBranding() {
  const now = Date.now();
  if (cachedBranding && now - cachedAt < CACHE_SECONDS * 1000) return cachedBranding;

  try {
    const r = await fetch(`${API_BASE}${BRANDING_ENDPOINT}`, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`branding http ${r.status}`);
    const j = await r.json();

    const name = j?.name || "San Juan Tecnología";
    const favicon = absUrl(j?.favicon_url);
    const ogImage = absUrl(j?.og_image_url || j?.logo_url || j?.favicon_url);

    cachedBranding = { name, favicon, ogImage };
    cachedAt = now;
    return cachedBranding;
  } catch (e) {
    cachedBranding = { name: "San Juan Tecnología", favicon: "", ogImage: "" };
    cachedAt = now;
    return cachedBranding;
  }
}

// ---------- inject index ----------
async function serveInjectedIndex(req, res) {
  const indexRes = await fetch(`${FRONTEND_INTERNAL}/`, { headers: { Accept: "text/html" } });
  let html = await indexRes.text();

  const branding = await loadBranding();

  const title = `${branding.name} | Tienda`;
  const desc = "Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas.";
  const canonical = `${PUBLIC_BASE_URL}/`;

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
}

app.get("/", serveInjectedIndex);

app.get("/favicon.ico", async (req, res) => {
  const b = await loadBranding();
  if (b?.favicon) return res.redirect(302, b.favicon);
  return res.status(204).end();
});

// Proxy todo lo demás al frontend
app.use(
  "/",
  createProxyMiddleware({
    target: FRONTEND_INTERNAL,
    changeOrigin: true,
    ws: true,
  })
);

app.listen(PORT, () => console.log(`✅ pos360-edge on :${PORT}`));
