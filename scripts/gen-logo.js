/* ---------- NovaBlock.io logo generator (pure Node, no deps) ---------- */
/* Renders the brand mark — a gradient rounded tile with a white "N" — and
   writes favicon.png (128px), logo.png (512px) and favicon.svg into the
   frontend/ folder. Run: node scripts/gen-logo.js */

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

/* ---------- minimal PNG encoder (RGBA, 8-bit) ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const tb = Buffer.from(type, 'ascii');
  const cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(Buffer.concat([tb, data])), 0);
  return Buffer.concat([len, tb, data, cb]);
}
function encodePNG(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; /* RGBA */
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; /* filter: none */
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------- drawing ---------- */
function lerp(a, b, t) { return a + (b - a) * t; }
function hexc(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
const C1 = hexc('#22d3ee'); /* cyan  */
const C2 = hexc('#6366f1'); /* indigo */
const C3 = hexc('#d946ef'); /* fuchsia */

/* Diagonal gradient, top-left → bottom-right, through the three brand colours. */
function grad(t) {
  if (t < 0.5) return [lerp(C1[0], C2[0], t * 2), lerp(C1[1], C2[1], t * 2), lerp(C1[2], C2[2], t * 2)];
  return [lerp(C2[0], C3[0], (t - 0.5) * 2), lerp(C2[1], C3[1], (t - 0.5) * 2), lerp(C2[2], C3[2], (t - 0.5) * 2)];
}

/* Distance from a point to a line segment (gives rounded stroke caps). */
function dseg(px, py, ax, ay, bx, by) {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay;
  const L2 = vx * vx + vy * vy;
  const t = L2 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / L2)) : 0;
  const dx = wx - t * vx, dy = wy - t * vy;
  return Math.sqrt(dx * dx + dy * dy);
}
/* Signed distance to a rounded rect (negative inside). */
function drr(px, py, cx, cy, hw, hh, r) {
  const dx = Math.abs(px - cx) - (hw - r), dy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0);
  return Math.sqrt(ox * ox + oy * oy) - r + Math.min(Math.max(dx, dy), 0);
}

function makeLogo(size) {
  const buf = Buffer.alloc(size * size * 4);
  const m = size * 0.19;                        /* tile inset */
  const cx = size / 2, cy = size / 2;
  const hw = size / 2 - m, hh = size / 2 - m;
  const r = size * 0.23;                        /* tile corner radius */
  const xl = size * 0.34, xr = size * 0.66;     /* N leg positions (tucked in) */
  const yTop = size * 0.345, yBot = size * 0.655;
  const half = size * 0.047;                    /* N stroke half-width (lighter) */
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5, py = y + 0.5;
      const rrCov = Math.max(0, Math.min(1, 0.5 - drr(px, py, cx, cy, hw, hh, r)));
      if (rrCov <= 0) continue;                 /* outside the tile: transparent */
      const dN = Math.min(
        dseg(px, py, xl, yTop, xl, yBot),
        dseg(px, py, xr, yTop, xr, yBot),
        dseg(px, py, xr, yTop, xl, yBot)
      ) - half;
      const nCov = Math.max(0, Math.min(1, 0.5 - dN)); /* 1 = inside an "N" stroke */
      const g = grad((px + py) / (2 * size));
      const i = (y * size + x) * 4;
      buf[i]     = Math.round(lerp(g[0], 255, nCov));
      buf[i + 1] = Math.round(lerp(g[1], 255, nCov));
      buf[i + 2] = Math.round(lerp(g[2], 255, nCov));
      buf[i + 3] = Math.round(255 * rrCov);
    }
  }
  return encodePNG(size, size, buf);
}

const frontend = path.join(__dirname, '..', 'frontend');
fs.writeFileSync(path.join(frontend, 'favicon.png'), makeLogo(128));
fs.writeFileSync(path.join(frontend, 'logo.png'), makeLogo(512));

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">\n'
  + '  <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">\n'
  + '    <stop offset="0%" stop-color="#22d3ee"/><stop offset="50%" stop-color="#6366f1"/><stop offset="100%" stop-color="#d946ef"/>\n'
  + '  </linearGradient></defs>\n'
  + '  <rect x="12" y="12" width="104" height="104" rx="29" fill="url(#g)"/>\n'
  + '  <g stroke="#fff" stroke-width="12" stroke-linecap="round" fill="none">\n'
  + '    <path d="M44 84V44"/><path d="M84 44L44 84"/><path d="M84 44V84"/>\n'
  + '  </g>\n'
  + '</svg>\n';
fs.writeFileSync(path.join(frontend, 'favicon.svg'), svg);

console.log('logo assets written:');
console.log('  ' + path.join(frontend, 'favicon.png'));
console.log('  ' + path.join(frontend, 'logo.png'));
console.log('  ' + path.join(frontend, 'favicon.svg'));
