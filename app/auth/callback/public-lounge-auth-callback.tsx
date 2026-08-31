"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  completePublicLoungePkceCallback,
  safePublicLoungeReturnPath,
} from "@/lib/novel-ai/public-lounge/auth-browser";

export function PublicLoungeAuthCallback() {
  const searchParams = useSearchParams();
  const [message, setMessage] = useState("正在完成安全登入……");

  useEffect(() => {
    let active = true;
    const code = searchParams.get("code") ?? "";
    const next = safePublicLoungeReturnPath(searchParams.get("next"));
    void completePublicLoungePkceCallback(code)
      .then(() => {
        if (!active) return;
        setMessage("登入完成，正在返回作品頁……");
        window.location.replace(next);
      })
      .catch(() => {
        if (active) setMessage("登入連結無效或已過期。請回到交誼廳重新寄送登入連結。");
      });
    return () => {
      active = false;
    };
  }, [searchParams]);

  return <p role="status" aria-live="polite">{message}</p>;
}
