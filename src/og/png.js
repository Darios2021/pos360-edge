/**
 * src/og/png.js
 */

const zlib = require("zlib");

let __crcTable = null;

function crc32(buf) {
  if (!__crcTable) {
    __crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      __crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = __crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcBuf = Buffer.alloc(4);
  const crcVal = crc32(Buffer.concat([typeBuf, data]));
  crcBuf.writeUInt32BE(crcVal, 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function createSolidPng(width, height, rgba = [245, 245, 245, 255]) {
  const [r, g, b, a] = rgba;

  const rowLen = 1 + width * 4;
  const raw = Buffer.alloc(rowLen * height);

  const row = Buffer.alloc(rowLen);
  row[0] = 0; // filter 0
  for (let x = 0; x < width; x++) {
    const o = 1 + x * 4;
    row[o] = r;
    row[o + 1] = g;
    row[o + 2] = b;
    row[o + 3] = a;
  }
  for (let y = 0; y < height; y++) row.copy(raw, y * rowLen);

  const compressed = zlib.deflateSync(raw, { level: 9 });

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", compressed), pngChunk("IEND", Buffer.alloc(0))]);
}

const OG_DEFAULT_PNG_BUFFER = createSolidPng(1200, 630, [245, 245, 245, 255]);

module.exports = { createSolidPng, OG_DEFAULT_PNG_BUFFER };
