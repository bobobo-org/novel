import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "諸天萬界小說生成系統",
  description: "創作、互動、養成與經營的 AI 故事平台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
