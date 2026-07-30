import type { Metadata } from "next";
import "./globals.css";
import OfflineRuntime from "./offline-runtime";
import { RELEASE_MANIFEST } from "@/lib/release-manifest";

export const metadata: Metadata = {
  title: "諸天萬界小說生成系統",
  description: "創作、互動、養成與經營的 AI 故事平台",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <OfflineRuntime
          appCommit={RELEASE_MANIFEST.appCommit}
          assetManifestDigest={RELEASE_MANIFEST.commitProvenanceHash}
        />
        {children}
      </body>
    </html>
  );
}
