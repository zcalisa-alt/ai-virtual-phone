/**
 * 生成 PWA / 桌面图标（构建期执行，产出真正的静态 PNG 文件）。
 *
 * 图标来源：public/icon-flat-*.png —— 由仓库自带的 Float 原版图标
 * （public/icon-512.png）预先压平生成的 24 位真彩 PNG，不含 alpha 通道。
 * iOS 会把 apple-touch-icon 里的**透明区域填成纯黑**，所以这里只做
 * 文件复制，保证装上主屏后不会出现黑底。
 *
 * 产出：
 *   public/apple-touch-icon.png  (180)  —— iOS 会自动探测的固定路径
 *   public/pwa-icon-192.png      (192)  —— manifest / favicon
 *   public/pwa-icon-512.png      (512)  —— manifest
 */
import fs from "node:fs";
import path from "node:path";

const targets = [
  ["apple-touch-icon.png", "icon-flat-180.png"],
  ["pwa-icon-192.png", "icon-flat-192.png"],
  ["pwa-icon-512.png", "icon-flat-512.png"],
];

const publicDir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "public");

for (const [file, source] of targets) {
  try {
    fs.copyFileSync(path.join(publicDir, source), path.join(publicDir, file));
    console.log(`✅ generated public/${file} from public/${source}`);
  } catch (error) {
    // 生成失败不该拖垮整次构建：站点照常可用，只是图标缺失。
    console.warn(`⚠️ failed to generate public/${file}:`, error);
  }
}
