import type { Metadata } from "next";
import Link from "next/link";
import { LoungeDetailClient } from "./lounge-detail-client";
import styles from "../lounge.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "公開作品｜小說交誼廳",
  description: "閱讀作者選擇公開的正式小說章節、全書大綱與品質評分。",
};

export default async function PublicLoungeDetailPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  return (
    <main className={styles.detailShell}>
      <Link className={styles.backLink} href="/lounge">← 回小說交誼廳</Link>
      <LoungeDetailClient key={publicId} publicId={publicId} />
    </main>
  );
}
