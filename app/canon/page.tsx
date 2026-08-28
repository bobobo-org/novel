import type { Metadata } from "next";
import {
  GLOBAL_WORLD_INDEX_CAPACITY,
  globalIndexedWorldAt,
  globalIndexedWorldPage,
} from "@/lib/novel-ai/game/global-world-index";
import CanonClient from "./canon-client";

export const metadata: Metadata = {
  title: "角色、世界與記憶總編輯｜諸天萬界小說生成系統",
  description: "跨作品管理人物、關係、世界規則、記憶與時間線，再明確複製候選快照到指定作品。",
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function safeProjectId(value: string) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : "";
}

function safeWorldNumber(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed)
    ? Math.max(1, Math.min(GLOBAL_WORLD_INDEX_CAPACITY, parsed))
    : 1;
}

export default async function CanonPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const worldNumber = safeWorldNumber(first(params.world));
  const worldPageOffset = Math.floor((worldNumber - 1) / 12) * 12;
  return (
    <CanonClient
      initialTargetProjectId={safeProjectId(first(params.targetProjectId))}
      indexedWorld={globalIndexedWorldAt({ ordinal: worldNumber })}
      indexedWorldPage={globalIndexedWorldPage({ offset: worldPageOffset, limit: 12 })}
    />
  );
}
