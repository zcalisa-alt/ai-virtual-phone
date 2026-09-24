/**
 * 生成 PWA / 桌面图标（构建期执行，产出真正的静态 PNG 文件）。
 *
 * 为什么手写 PNG 编码：iOS 会把 apple-touch-icon 里的**透明区域填成纯黑**。
 * 仓库原有的 public/icon-192.png / icon-512.png 是带 alpha 通道的 RGBA，
 * 装上主屏后透明底会变成黑底，看起来就像坏图。
 * 这里直接编码 colorType 2（24 位真彩，**不含 alpha 通道**），
 * 从数据层面就不可能出现透明像素。
 *
 * 产出：
 *   public/apple-touch-icon.png  (180)  —— iOS 会自动探测的固定路径
 *   public/pwa-icon-192.png      (192)  —— manifest / favicon
 *   public/pwa-icon-512.png      (512)  —— manifest
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const KLEIN = [0x17, 0x4b, 0xff];
const WHITE = [0xff, 0xff, 0xff];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgb) {
  const stride = size * 3;
  const raw = Buffer.alloc(size * (stride + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor RGB (no alpha)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function insideRoundRect(px, py, x0, y0, w, h, r) {
  if (px < x0 || px > x0 + w || py < y0 || py > y0 + h) return false;
  const nearestX = Math.min(Math.max(px, x0 + r), x0 + w - r);
  const nearestY = Math.min(Math.max(py, y0 + r), y0 + h - r);
  const dx = px - nearestX;
  const dy = py - nearestY;
  return dx * dx + dy * dy <= r * r;
}

const mix = (base, target, t) => [
  base[0] + (target[0] - base[0]) * t,
  base[1] + (target[1] - base[1]) * t,
  base[2] + (target[2] - base[2]) * t,
];

/** 品牌蓝底 + 白色手机图形；3×3 超采样做柔边，输出仍是纯 RGB。 */
function renderIcon(size) {
  const px = Buffer.alloc(size * size * 3);
  const bodyW = size * 0.44;
  const bodyH = size * 0.70;
  const bodyX = (size - bodyW) / 2;
  const bodyY = (size - bodyH) / 2;
  const bodyR = size * 0.11;
  const notchW = size * 0.17;
  const notchH = Math.max(3, size * 0.035);
  const notchX = (size - notchW) / 2;
  const notchY = bodyY + size * 0.07;
  const samples = 3;
  const total = samples * samples;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bodyCov = 0;
      let notchCov = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const fx = x + (sx + 0.5) / samples;
          const fy = y + (sy + 0.5) / samples;
          if (insideRoundRect(fx, fy, bodyX, bodyY, bodyW, bodyH, bodyR)) bodyCov++;
          if (insideRoundRect(fx, fy, notchX, notchY, notchW, notchH, notchH / 2)) notchCov++;
        }
      }
      let color = mix(KLEIN, WHITE, bodyCov / total);
      color = mix(color, KLEIN, notchCov / total);
      const offset = (y * size + x) * 3;
      px[offset] = Math.round(color[0]);
      px[offset + 1] = Math.round(color[1]);
      px[offset + 2] = Math.round(color[2]);
    }
  }
  return encodePng(size, px);
}

const targets = [
  ["apple-touch-icon.png", 180],
  ["pwa-icon-192.png", 192],
  ["pwa-icon-512.png", 512],
];

const publicDir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "public");

for (const [file, size] of targets) {
  try {
    fs.writeFileSync(path.join(publicDir, file), renderIcon(size));
    console.log(`✅ generated public/${file} (${size}x${size})`);
  } catch (error) {
    // 生成失败不该拖垮整次构建：站点照常可用，只是图标缺失。
    console.warn(`⚠️ failed to generate public/${file}:`, error);
  }
}
