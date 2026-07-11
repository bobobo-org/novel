import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "諸天萬界小說生成系統",
  description: "v5.9.1 閉端 AI 多章批量操作章節號修正版",
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
