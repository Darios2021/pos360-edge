/**
 * src/utils/path.js
 */

function ensureSlashStart(p) {
  if (!p) return "/";
  return p.startsWith("/") ? p : `/${p}`;
}

function removeTrailingSlash(p) {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

function joinPrefix(prefix, pth) {
  const pfx = removeTrailingSlash(ensureSlashStart(prefix));
  const p = ensureSlashStart(pth);
  if (p === "/") return `${pfx}/`;
  return `${pfx}${p}`;
}

module.exports = { ensureSlashStart, removeTrailingSlash, joinPrefix };
