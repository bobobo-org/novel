import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '諸天萬界小說生成系統',
  description: 'AI and Supabase rebuild baseline for the story generation system.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
