/**
 * pos360-edge (FINAL PRO + FIX /app + FIX redirect interno)
 * - / -> /shop
 * - /app -> /admin/shop/branding  (recupera la "plataforma")
 * - Inyecta OG/Favicon en TODAS las rutas HTML
 * - ✅ OG dinámico en /shop/product/:id (title/img/desc)
 * - ✅ Proxy /api/v1/* a commerce-api
 * - ✅ Proxy al frontend interno SIN filtrar srv-captain-- al browser
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3000;

// =========================
// ENV
// =========================
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://sanjuantecnologia.com").replace(/\/+$/, "");
const PUBLIC_HOST = (() => {
  try {
    return new URL(PUBLIC_BASE_URL).host;
  } catch {
    return "sanjuantecnologia.com";
  }
})();

const FRONTEND_INTERNAL = String(process.env.FRONTEND_INTERNAL || "http://srv-captain--pos360-frontend").replace(
  /\/+$/,
  ""
);
// ✅ importante: index del frontend (NO /shop)
const FRONTEND_INDEX_PATH = String(process.env.FRONTEND_INDEX_PATH || "/").trim() || "/";

const API_ORIGIN = String(process.env.API_ORIGIN || "https://pos360-commerce-api.cingulado.org").replace(/\/+$/, "");
const API_BASE_V1 = String(process.env.API_BASE_V1 || `${API_ORIGIN}/api/v1`).replace(/\/+$/, "");

// Branding público del backend
const BRANDING_ENDPOINT = String(process.env.BRANDING_ENDPOINT || "/public/shop/branding").trim();
const BRANDING_CACHE_SECONDS = Math.max(5, parseInt(process.env.BRANDING_CACHE_SECONDS || "60", 10) || 60);

// Producto público del backend
const PRODUCT_ENDPOINT_PREFIX = String(process.env.PRODUCT_ENDPOINT_PREFIX || "/public/products/").trim();
const PRODUCT_CACHE_SECONDS = Math.max(10, parseInt(process.env.PRODUCT_CACHE_SECONDS || "120", 10) || 120);

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

function parseProductIdFromPath(p) {
  const m = String(p || "").match(/^\/shop\/product\/(\d+)(\/)?$/i);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) && id > 0 ? id : null;
}

// =========================
// CACHE: Branding
// =========================
let brandingCache = null;
let brandingCacheAt = 0;

async function loadBranding() {
  const now = Date.now();
  if (brandingCache && now - brandingCacheAt < BRANDING_CACHE_SECONDS * 1000) return brandingCache;

  try {
    const url = `${API_BASE_V1}${BRANDING_ENDPOINT.startsWith("/") ? "" : "/"}${BRANDING_ENDPOINT}`;
    const r = await fetch(url, { headers: { Accept: "application/json" }, redirect: "follow" });
    if (!r.ok) throw new Error(`branding http ${r.status}`);
    const j = await r.json();

    const name = j?.name || "San Juan Tecnología";
    const favicon = absUrl(j?.favicon_url);
    const ogImage = absUrl(j?.og_image_url || j?.logo_url || j?.favicon_url);

    brandingCache = { name, favicon, ogImage };
    brandingCacheAt = now;
    return brandingCache;
  } catch {
    brandingCache = { name: "San Juan Tecnología", favicon: "", ogImage: "" };
    brandingCacheAt = now;
    return brandingCache;
  }
}

// =========================
// CACHE: Producto
// =========================
const productCache = new Map(); // id -> { data, at }

function pickProductImage(p) {
  const candidates = [
    p?.og_image_url,
    p?.image_url,
    p?.imageUrl,
    p?.cover_url,
    p?.coverUrl,
    p?.primary_image_url,
    p?.primaryImageUrl,
    p?.ProductImages?.[0]?.url,
    p?.images?.[0]?.url,
    p?.images?.[0],
  ].filter(Boolean);

  return String(candidates[0] || "").trim();
}
function pickProductTitle(p) {
  return String(p?.name || p?.title || p?.product_name || "Producto").trim();
}
function pickProductDesc(p) {
  const raw = p?.short_description || p?.shortDescription || p?.description || p?.desc || "";
  const s = String(raw || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return s.length > 180 ? `${s.slice(0, 177)}...` : s;
}

async function loadProduct(id) {
  const now = Date.now();
  const cached = productCache.get(id);
  if (cached && now - cached.at < PRODUCT_CACHE_SECONDS * 1000) return cached.data;

  const url = `${API_BASE_V1}${PRODUCT_ENDPOINT_PREFIX.startsWith("/") ? "" : "/"}${PRODUCT_ENDPOINT_PREFIX}${id}`;

  try {
    const r = await fetch(url, { headers: { Accept: "application/json" }, redirect: "follow" });
    if (!r.ok) throw new Error(`product http ${r.status}`);
    const j = await r.json();
    const data = j?.item || j?.data || j;

    productCache.set(id, { data, at: now });
    return data;
  } catch {
    productCache.set(id, { data: null, at: now });
    return null;
  }
}

// =========================
// 0) HOME + /app FIX
// =========================
app.get("/", (req, res) => res.redirect(301, "/shop"));

// ✅ Recuperar tu “plataforma” por /app
// Podés cambiar el destino a "/" si preferís.
app.get("/app", (req, res) => res.redirect(302, "/admin/shop/branding"));
app.get("/app/*", (req, res) => res.redirect(302, "/admin/shop/branding"));

// =========================
// 1) ✅ API PROXY
// /api/v1/* -> commerce-api
// =========================
app.use(
  "/api/v1",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    secure: true,
    ws: true,
    pathRewrite: { "^/api/v1": "/api/v1" },
  })
);

// =========================
// 2) favicon.ico
// =========================
app.get("/favicon.ico", async (req, res) => {
  const b = await loadBranding();
  if (b?.favicon) return res.redirect(302, b.favicon);
  return res.status(204).end();
});

// =========================
// 3) HTML INJECTION (OG/Favicon)
// =========================
app.get("*", async (req, res, next) => {
  try {
    if (req.path.startsWith("/api/v1/") || isAssetPath(req.path) || !wantsHtml(req)) return next();

    const branding = await loadBranding();

    const indexRes = await fetch(`${FRONTEND_INTERNAL}${FRONTEND_INDEX_PATH}`, {
      headers: { Accept: "text/html" },
      redirect: "follow",
    });
    let html = await indexRes.text();

    let title = `${branding.name} | Tienda`;
    let desc = "Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas.";
    let ogImage = branding.ogImage || branding.favicon || `${PUBLIC_BASE_URL}/favicon.png`;

    const pid = parseProductIdFromPath(req.path);
    if (pid) {
      const p = await loadProduct(pid);
      if (p) {
        const pt = pickProductTitle(p);
        const pd = pickProductDesc(p);
        const pi = pickProductImage(p);

        title = pt ? `${pt} | ${branding.name}` : title;
        if (pd) desc = pd;
        if (pi) ogImage = absUrl(pi);
      }
    }

    const canonical = `${PUBLIC_BASE_URL}${req.originalUrl || req.path || "/"}`;
    const favicon = branding.favicon || `${PUBLIC_BASE_URL}/favicon.png`;

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
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:image" content="${esc(ogImage)}" />
<meta property="og:image:secure_url" content="${esc(ogImage)}" />

<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
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

// =========================
// 4) Proxy resto al frontend (FIX: no filtrar srv-captain-- en redirects)
// =========================
app.use(
  "/",
  createProxyMiddleware({
    target: FRONTEND_INTERNAL,
    changeOrigin: true,
    ws: true,

    // ✅ manda Host público al nginx interno (por si genera redirects absolutos)
    onProxyReq: (proxyReq) => {
      try {
        proxyReq.setHeader("Host", PUBLIC_HOST);
        proxyReq.setHeader("X-Forwarded-Host", PUBLIC_HOST);
        proxyReq.setHeader("X-Forwarded-Proto", "https");
      } catch {}
    },

    // ✅ reescribe Location si viene con srv-captain--pos360-frontend
    onProxyRes: (proxyRes) => {
      const loc = proxyRes.headers?.location;
      if (!loc) return;

      const s = String(loc);
      if (s.includes("srv-captain--pos360-frontend") || s.includes(FRONTEND_INTERNAL.replace(/^https?:\/\//, ""))) {
        const fixed = s
          .replaceAll("http://srv-captain--pos360-frontend", PUBLIC_BASE_URL)
          .replaceAll("https://srv-captain--pos360-frontend", PUBLIC_BASE_URL);

        proxyRes.headers.location = fixed;
      }
    },
  })
);

app.listen(PORT, () => console.log(`✅ pos360-edge on :${PORT}`));
