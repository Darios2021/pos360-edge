/**
 * src/utils/env.js
 */

function env(name, fallback) {
  const v = process.env[name];
  return v !== undefined && v !== null && String(v).trim() !== "" ? String(v).trim() : fallback;
}

module.exports = { env };
