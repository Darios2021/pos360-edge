/**
 * src/og/productOg.js
 */

const {
  API_ORIGIN,
  API_BASE,
  OG_BRANCH_ID,
  OG_SITE_NAME,
  OG_DESCRIPTION_DEFAULT,
  OG_IMAGE_DEFAULT,
  OG_TITLE_INCLUDE_PRICE,
  OG_PRICE_CURRENCY_DEFAULT,
  PUBLIC_BASE_URL,
  removeTrailingSlash,
  ensureSlashStart,
} = require("../config");

function absolutizeUrl(u) {
  if (!u) return "";
  const s = String(u).trim();
  if (!s) return "";
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("//")) return `https:${s}`;
  return `${PUBLIC_BASE_URL}${s.startsWith("/") ? "" : "/"}${s}`;
}

function pickFirstImage(obj) {
  if (!obj) return "";
  const candidates = [
    obj.og_image,
    obj.image,
    obj.image_url,
    obj.imageUrl,
    obj.cover,
    obj.cover_url,
    obj.thumbnail,
    obj.thumbnail_url,
    obj.photo,
    obj.photo_url,
    obj.main_image,
    obj.main_image_url,
  ];
  for (const c of candidates) if (c && String(c).trim()) return String(c).trim();

  const imgs = obj.images || obj.gallery || obj.pictures;
  if (Array.isArray(imgs) && imgs.length) {
    const first = imgs[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object") {
      return first.url || first.secure_url || first.src || first.path || first.location || first.public_url || "";
    }
  }
  return "";
}

function deriveImageVersion(imageUrl, productId, branchId) {
  const u = String(imageUrl || "");
  const m = u.match(/\/(\d{10,})-[^\/]+\.(webp|jpg|jpeg|png)(\?.*)?$/i);
  if (m && m[1]) return m[1];
  const m2 = u.match(/\/(\d{10,})\.(webp|jpg|jpeg|png)(\?.*)?$/i);
  if (m2 && m2[1]) return m2[1];
  return `p${String(productId || "").trim() || "x"}-b${String(branchId || "").trim() || "x"}`;
}

function addVersionParam(url, key, version) {
  if (!url) return url;
  const s = String(url);
  if (!version) return s;
  const re = new RegExp(`[?&]${key}=`, "i");
  if (re.test(s)) return s;
  return s.includes("?") ? `${s}&${key}=${encodeURIComponent(version)}` : `${s}?${key}=${encodeURIComponent(version)}`;
}

function normalizePrice(v) {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (!s) return "";
  return s.replace(/\s/g, "");
}

async function fetchJson(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal });
    const text = await resp.text();
    if (!resp.ok) return { ok: false, status: resp.status, data: null, text };
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      return { ok: false, status: resp.status, data: null, text };
    }
    return { ok: true, status: resp.status, data, text };
  } catch (e) {
    return { ok: false, status: 0, data: null, text: "" };
  } finally {
    clearTimeout(t);
  }
}

async function fetchProductOg(productId, branchId) {
  const id = String(productId || "").trim();
  const br = String(branchId || "").trim() || OG_BRANCH_ID;
  if (!id) return null;

  const base = removeTrailingSlash(API_ORIGIN) + ensureSlashStart(API_BASE);
  const branch = encodeURIComponent(br);

  const tries = [
    `${base}/public/products/${encodeURIComponent(id)}?branch_id=${branch}`,
    `${base}/public/product/${encodeURIComponent(id)}?branch_id=${branch}`,
    `${base}/public/products/${encodeURIComponent(id)}`,
    `${base}/public/product/${encodeURIComponent(id)}`,
    `${base}/public/catalog?branch_id=${branch}&product_id=${encodeURIComponent(id)}&page=1&limit=1`,
    `${base}/public/catalog?branch_id=${branch}&id=${encodeURIComponent(id)}&page=1&limit=1`,
  ];

  for (const url of tries) {
    const r = await fetchJson(url, 5000);
    if (!r.ok || !r.data) continue;

    const d = r.data;
    const item =
      d.item || d.product || (Array.isArray(d.items) && d.items[0]) || (Array.isArray(d.data) && d.data[0]) || d;

    if (!item || typeof item !== "object") continue;

    const name = item.name || item.title || item.product_name || item.productTitle || item.nombre || "";
    const description =
      item.description || item.desc || item.short_description || item.shortDescription || item.descripcion || "";

    const img = pickFirstImage(item);
    const imageAbs = img ? absolutizeUrl(img) : "";

    const safeName = String(name || "").trim();
    if (!safeName) continue;

    const rawPrice =
      item.price ?? item.price_final ?? item.price_list ?? item.price_discount ?? item.amount ?? "";

    const price = normalizePrice(rawPrice);
    const currency =
      (item.currency || item.price_currency || item.currency_code || "").toString().trim() || OG_PRICE_CURRENCY_DEFAULT;

    let titleBase = `${safeName} | ${OG_SITE_NAME}`;
    if (OG_TITLE_INCLUDE_PRICE && price) titleBase = `${safeName} - $${price} | ${OG_SITE_NAME}`;

    const desc = String(description || "").trim() || OG_DESCRIPTION_DEFAULT;

    const baseImg = imageAbs || OG_IMAGE_DEFAULT;
    const v = deriveImageVersion(baseImg, id, br);
    const versionedImage = addVersionParam(baseImg, "v", v);

    return {
      ogTitle: titleBase,
      ogDescription: desc,
      ogImage: versionedImage,
      ogVersion: v,
      price,
      currency,
    };
  }

  return null;
}

module.exports = {
  fetchProductOg,
  addVersionParam,
  normalizePrice,
  absolutizeUrl,
  pickFirstImage,
  deriveImageVersion,
};
