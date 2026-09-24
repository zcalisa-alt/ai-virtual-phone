import { ImageResponse } from "next/og";

// 现场生成 PWA / 桌面图标：纯色不透明底，避免 iOS 把透明区域填成黑色
// （旧图标是带 alpha 通道的 RGBA PNG，装上主屏后透明处会变纯黑，看起来像坏图）。
const KLEIN = "#174BFF";

export function renderPwaIcon(size: number): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: KLEIN,
        }}
      >
        <div
          style={{
            width: Math.round(size * 0.44),
            height: Math.round(size * 0.7),
            borderRadius: Math.round(size * 0.11),
            backgroundColor: "#FFFFFF",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: Math.round(size * 0.07),
          }}
        >
          <div
            style={{
              width: Math.round(size * 0.17),
              height: Math.max(4, Math.round(size * 0.035)),
              borderRadius: 999,
              backgroundColor: KLEIN,
            }}
          />
        </div>
      </div>
    ),
    { width: size, height: size }
  );
}
