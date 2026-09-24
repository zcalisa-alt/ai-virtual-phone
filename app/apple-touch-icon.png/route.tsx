import { renderPwaIcon } from "@/lib/pwa-icon";

// iOS 会自动探测站点根目录的 /apple-touch-icon.png，这个路径不依赖任何 <link> 声明，
// 是最稳的一条路：即使 iOS 忽略了页面里的标签，也能直接取到这里生成的图。
export function GET() {
  return renderPwaIcon(180);
}
