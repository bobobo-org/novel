import Link from "next/link";
import { Suspense } from "react";
import { PublicLoungeAuthCallback } from "./public-lounge-auth-callback";

export default function PublicLoungeAuthCallbackPage() {
  return (
    <main style={{ maxWidth: "42rem", margin: "6rem auto", padding: "0 1.5rem" }}>
      <h1>交誼廳登入</h1>
      <Suspense fallback={<p role="status">正在讀取登入連結……</p>}>
        <PublicLoungeAuthCallback />
      </Suspense>
      <p><Link href="/lounge">返回交誼廳</Link></p>
    </main>
  );
}
