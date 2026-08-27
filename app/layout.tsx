import type { Metadata, Viewport } from "next";
import "./globals.css";
import OfflineRuntime from "./offline-runtime";
import CloudSyncRuntime from "./cloud-sync-runtime";
import { RELEASE_MANIFEST } from "@/lib/release-manifest";

export const metadata: Metadata = {
  title: "諸天萬界小說生成系統",
  description: "創作、互動、養成與經營的 AI 故事平台",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/app-icon.svg", type: "image/svg+xml" },
      { url: "/app-icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/app-icon-192.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black",
    title: "諸天萬界",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#07101f",
  colorScheme: "dark",
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
        <CloudSyncRuntime />
        {children}
      </body>
    </html>
  );
}
