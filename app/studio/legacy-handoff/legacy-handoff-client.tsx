"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { NovelProject } from "@/lib/novel-ai/domain";
import { createNovelRepository } from "@/lib/novel-ai/repository";
import {
  EXPLICIT_LEGACY_STUDIO_KEYS,
  migrateLegacyStudioProjects,
} from "@/lib/novel-ai/repository/migration/legacy-studio-migration";

type Target = "write" | "read" | "manage" | "backups" | "professional";

function targetHref(projectId: string, target: Target) {
  const id = encodeURIComponent(projectId);
  if (target === "read") return `/studio/read/${id}`;
  if (target === "manage") return `/professional?intent=library&projectId=${id}`;
  if (target === "backups") return `/studio/project/${id}/backups`;
  if (target === "professional") return `/professional?projectId=${id}`;
  return `/studio/project/${id}/write`;
}

export default function LegacyHandoffClient({
  projectId,
  target,
}: {
  projectId: string;
  target: Target;
}) {
  const router = useRouter();
  const repository = useMemo(() => createNovelRepository(), []);
  const [message, setMessage] = useState("正在安全銜接同一部作品……");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!projectId) throw new Error("缺少有效的作品識別碼。請回到作品清單重新選擇。");
      await migrateLegacyStudioProjects(repository, {
        sourceKeys: EXPLICIT_LEGACY_STUDIO_KEYS,
        overwriteExisting: false,
      });
      const project = await repository.get<NovelProject>("projects", projectId);
      if (!project) throw new Error("找不到這部作品；舊資料仍保留，未做覆蓋或刪除。");
      if (cancelled) return;
      localStorage.setItem("novel_p2_active_project_id", project.id);
      setMessage(`已確認《${project.title}》使用正式作品庫，正在開啟……`);
      router.replace(targetHref(project.id, target));
    })().catch((cause) => {
      if (cancelled) return;
      setError(cause instanceof Error ? cause.message : "無法銜接作品");
      setMessage("沒有修改或刪除任何舊資料。");
    });
    return () => { cancelled = true; };
  }, [projectId, repository, router, target]);

  return (
    <main className="p2CreateShell">
      <section className="p2CreateSuccess" role={error ? "alert" : "status"}>
        <span>作品資料銜接</span>
        <h1>{error ? "暫時無法開啟" : "同一部作品、同一份資料"}</h1>
        <p>{error || message}</p>
        <div>
          <Link className="primaryAction" href="/professional">回到作品管理</Link>
          <a className="secondaryAction" href="/legacy/novel-system.html?mode=professional">返回 Legacy 相容工具</a>
        </div>
      </section>
    </main>
  );
}
