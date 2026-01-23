/**
 * pos360-edge (COPY-PASTE FINAL - OG FIX SIN /public/products)
 *
 * ✅ YA ANDA:
 * - /public/catalog -> api/v1/public/catalog (rewrite correcto)
 *
 * FIXES:
 * - OG por producto SIN endpoint /public/products (que te da 404)
 *   => usa /public/catalog buscando el item por distintos params
 * - og:image fallback: SIEMPRE imagen real /og-default.png (image/png)
 * - NO usar favicon.png como og:image jamás
 * - /app y /app/*: proxy al frontend (admin) sin inyección
 * - Proxy resto al frontend + rewrite de Location para que no salga srv-captain
 */

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================
   ENV
   ========================= */
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://sanjuantecnologia.com").replace(/\/+$/, "");
const FRONTEND_INTERNAL = String(process.env.FRONTEND_INTERNAL || "http://srv-captain--pos360-frontend").replace(/\/+$/, "");
const FRONTEND_INDEX_PATH = String(process.env.FRONTEND_INDEX_PATH || "/shop").replace(/\/+$/, "");

const API_ORIGIN = String(process.env.API_ORIGIN || "https://pos360-commerce-api.cingulado.org").replace(/\/+$/, "");
const API_BASE = String(process.env.API_BASE || `${API_ORIGIN}/api/v1`).replace(/\/+$/, "");

const BRANDING_ENDPOINT = String(process.env.BRANDING_ENDPOINT || "/shop/branding/public").trim();
const CACHE_SECONDS = Math.max(5, parseInt(process.env.BRANDING_CACHE_SECONDS || "60", 10) || 60);

// OG
const OG_BRANCH_ID = Number(process.env.OG_BRANCH_ID || "3");

/* =========================
   HELPERS
   ========================= */
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
    p.startsWith("/robots.txt") ||
    p.startsWith("/sitemap") ||
    p.startsWith("/.well-known/") ||
    /\.[a-z0-9]{2,6}$/i.test(p)
  );
}

function isShopProductPath(p) {
  return /^\/shop\/product\/(\d+)(\/)?$/i.test(p);
}
function getProductIdFromPath(p) {
  const m = p.match(/^\/shop\/product\/(\d+)(\/)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pickDescFromCatalogItem(p) {
  const v = p?.description ?? p?.short_description ?? p?.summary ?? "";
  return String(v || "").trim();
}

function pickImgFromCatalogItem(p) {
  const v =
    p?.image_url ??
    p?.og_image_url ??
    p?.image ??
    p?.thumbnail ??
    p?.thumb ??
    "";
  return String(v || "").trim();
}

/* =========================
   SAFE REAL IMAGE (PNG 1x1)
   ========================= */
const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/erWn2kAAAAASUVORK5CYII=",
  "base64"
);

app.get("/og-default.png", (req, res) => {
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.status(200).send(ONE_BY_ONE_PNG);
});

/* =========================
   BRANDING CACHE
   ========================= */
let cachedBranding = null;
let cachedAt = 0;

async function loadBranding() {
  const now = Date.now();
  if (cachedBranding && now - cachedAt < CACHE_SECONDS * 1000) return cachedBranding;

  try {
    const r = await fetch(`${API_BASE}${BRANDING_ENDPOINT}`, {
      headers: { Accept: "application/json" },
      redirect: "follow",
    });
    if (!r.ok) throw new Error(`branding http ${r.status}`);
    const j = await r.json();

    const name = j?.name || "San Juan Tecnología";
    const favicon = absUrl(j?.favicon_url || j?.logo_url || "");
    const ogImage = absUrl(j?.og_image_url || j?.logo_url || j?.favicon_url || "");

    cachedBranding = { name, favicon, ogImage };
    cachedAt = now;
    return cachedBranding;
  } catch {
    cachedBranding = { name: "San Juan Tecnología", favicon: "", ogImage: "" };
    cachedAt = now;
    return cachedBranding;
  }
}

/* =========================
   PRODUCT OG via /public/catalog (sin /public/products)
   ========================= */
async function tryCatalogUrl(paramsObj) {
  const u = new URL(`${API_BASE}/public/catalog`);
  u.searchParams.set("branch_id", String(OG_BRANCH_ID || 3));
  u.searchParams.set("page", "1");
  u.searchParams.set("limit", "1");
  u.searchParams.set("in_stock", "0"); // no dependas de stock para OG

  for (const [k, v] of Object.entries(paramsObj)) {
    u.searchParams.set(k, String(v));
  }

  const r = await fetch(u.toString(), {
    headers: { Accept: "application/json" },
    redirect: "follow",
  });
  if (!r.ok) return null;

  const j = await r.json();
  const items =
    Array.isArray(j?.items) ? j.items :
    Array.isArray(j?.rows) ? j.rows :
    Array.isArray(j) ? j :
    [];

  if (!items.length) return null;
  return items[0];
}

async function loadProductForOgFromCatalog(productId) {
  // Probamos varias “formas” típicas de filtrar por ID (tu backend puede tener una u otra)
  const attempts = [
    { product_id: productId }, // la más probable
    { id: productId },
    { productId: productId },
    { q: `P000000${String(productId).padStart(3, "0")}` }, // fallback por código si fuera necesario
  ];

  for (const a of attempts) {
    try {
      const it = await tryCatalogUrl(a);
      if (it && Number(it.product_id || it.id) === Number(productId)) return it;
      // si el backend ignora el filtro y devuelve “cualquiera”, no lo aceptamos
    } catch {}
  }

  // ✅ último recurso: buscar en primeras páginas (limitado, para no matar el edge)
  try {
    const u = new URL(`${API_BASE}/public/catalog`);
    u.searchParams.set("branch_id", String(OG_BRANCH_ID || 3));
    u.searchParams.set("page", "1");
    u.searchParams.set("limit", "50");
    u.searchParams.set("in_stock", "0");

    const r = await fetch(u.toString(), { headers: { Accept: "application/json" } });
    if (r.ok) {
      const j = await r.json();
      const items = Array.isArray(j?.items) ? j.items : [];
      const found = items.find((x) => Number(x.product_id || x.id) === Number(productId));
      if (found) return found;
    }
  } catch {}

  return null;
}

/* =========================
   HOME
   ========================= */
app.get("/", (req, res) => res.redirect(301, "/shop"));

/* =========================
   /app (admin) => proxy directo (sin inyección)
   ========================= */
app.get("/app", (req, res, next) => next());
app.get("/app/*", (req, res, next) => next());

/* =========================
   API PROXY (mount strips /api/v1)
   ========================= */
app.use(
  "/api/v1",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    secure: true,
    ws: true,
    pathRewrite: (path) => `/api/v1${path}`,
  })
);

/* =========================
   PUBLIC PROXY (mount strips /public)
   ========================= */
app.use(
  "/public",
  createProxyMiddleware({
    target: API_ORIGIN,
    changeOrigin: true,
    secure: true,
    ws: true,
    pathRewrite: (path) => `/api/v1/public${path}`,
  })
);

/* =========================
   FAVICON (browser)
   - Si branding tiene favicon => redirect
   - Si no => imagen real (image/png)
   ========================= */
app.get("/favicon.ico", async (req, res) => {
  const b = await loadBranding();
  if (b?.favicon) return res.redirect(302, b.favicon);
  res.setHeader("Content-Type", "image/png");
  return res.status(200).send(ONE_BY_ONE_PNG);
});

app.get("/favicon.png", async (req, res) => {
  const b = await loadBranding();
  if (b?.favicon) return res.redirect(302, b.favicon);
  res.setHeader("Content-Type", "image/png");
  return res.status(200).send(ONE_BY_ONE_PNG);
});

/* =========================
   HTML INJECTION (SOLO SHOP)
   ========================= */
app.get("*", async (req, res, next) => {
  try {
    if (!wantsHtml(req)) return next();
    if (isAssetPath(req.path)) return next();
    if (req.path.startsWith("/api/v1/")) return next();
    if (req.path.startsWith("/public/")) return next();

    // ✅ NO tocar /app (admin)
    if (req.path === "/app" || req.path.startsWith("/app/")) return next();

    const [branding, indexRes] = await Promise.all([
      loadBranding(),
      fetch(`${FRONTEND_INTERNAL}${FRONTEND_INDEX_PATH}`, {
        headers: { Accept: "text/html" },
        redirect: "follow",
      }),
    ]);

    let html = await indexRes.text();

    let title = `${branding.name} | Tienda`;
    let desc = "Electrónica, ecommerce, sistemas POS y soluciones tecnológicas para empresas.";
    const canonical = `${PUBLIC_BASE_URL}${req.originalUrl || "/shop"}`;

    const favicon = branding.favicon || `${PUBLIC_BASE_URL}/favicon.png`;

    // ✅ og:image fallback SIEMPRE real
    let ogImage = branding.ogImage || `${PUBLIC_BASE_URL}/og-default.png`;

    // ✅ PRODUCT OG desde /public/catalog
    if (isShopProductPath(req.path)) {
      const productId = getProductIdFromPath(req.path);
      if (productId) {
        const it = await loadProductForOgFromCatalog(productId);
        if (it) {
          const n = String(it.name || "").trim();
          const d = pickDescFromCatalogItem(it);
          const img = pickImgFromCatalogItem(it);

          if (n) title = `${n} | ${branding.name}`;
          if (d) desc = d.slice(0, 300);
          if (img) ogImage = absUrl(img);
        }
      }
    }

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
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(canonical)}" />

<meta property="og:image" content="${esc(ogImage)}" />
<meta property="og:image:secure_url" content="${esc(ogImage)}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${esc(title)}" />

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

/* =========================
   Proxy resto al frontend (incluye /app)
   + Location rewrite srv-captain -> dominio público
   ========================= */
app.use(
  "/",
  createProxyMiddleware({
    target: FRONTEND_INTERNAL,
    changeOrigin: true,
    ws: true,
    autoRewrite: true,
    protocolRewrite: "https",

    onProxyReq(proxyReq) {
      try {
        const host = new URL(PUBLIC_BASE_URL).host;
        proxyReq.setHeader("X-Forwarded-Host", host);
        proxyReq.setHeader("X-Forwarded-Proto", "https");
      } catch {}
    },

    onProxyRes(proxyRes) {
      const loc = proxyRes.headers["location"];
      if (loc && typeof loc === "string") {
        proxyRes.headers["location"] = loc
          .replace(/^http:\/\/srv-captain--pos360-frontend/i, PUBLIC_BASE_URL)
          .replace(/^https:\/\/srv-captain--pos360-frontend/i, PUBLIC_BASE_URL);
      }
    },
  })
);

app.listen(PORT, () => console.log(`✅ pos360-edge on :${PORT}`));
