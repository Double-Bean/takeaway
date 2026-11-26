import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "今天中午吃什么 · 午餐助手",
  description: "一句话找到适合今天的午餐。",
  icons: { icon: "/favicon.svg" }
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", interactiveWidget: "resizes-content", themeColor: "#f7f8f4" };

export default function RootLayout({children}: Readonly<{children:React.ReactNode}>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
