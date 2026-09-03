export const LOCAL_AI_COMPANION_RELEASE = {
  schemaVersion: "novel-local-ai-companion-release-v1",
  version: "1.4.7",
  filename: "novel-local-ai-companion-setup-v1.4.7.cmd",
  downloadPath: "/downloads/novel-local-ai-companion-setup-v1.4.7.cmd",
  checksumPath: "/downloads/novel-local-ai-companion-setup-v1.4.7.sha256",
  sha256: "B7B2276A320BEFBDEE5DBFB1D4BB8C114F2D91D5BB7200221DF49EC3DB80A706",
  installScriptPath: "/downloads/novel-local-ai-companion-install-v1.4.7.ps1",
  installScriptSha256: "BFE21B68D2316002B6CFF10960E2B49B7AC3B8C3F9C6534A33C9DBAD44C97011",
  archiveFilename: "novel-local-ai-companion-v1.4.7.zip",
  archiveDownloadPath: "/downloads/novel-local-ai-companion-v1.4.7.zip",
  archiveChecksumPath: "/downloads/novel-local-ai-companion-v1.4.7.sha256",
  archiveSha256: "9B1245EA7D68957A007D5703D63B673D7EE5C1872A1C1A9BE83AC0E001265D8F",
  installer: true,
  windowsLogonAutostart: true,
  signed: false,
  minimumNodeMajor: 22,
  minimumBridgeVersion: "1.2.4",
  recommendedBridgeVersion: "1.2.4",
  minimumPrivateHubVersion: "1.1.0",
  recommendedPrivateHubVersion: "1.4.0",
  releaseNotes: [
    "1.4.7 收到 Ollama 完成訊號後立即結束串流，保留無換行的尾端資料；截斷或破損串流會安全失敗並釋放連線，不再停在最後字數。",
    "1.4.6 讓健康檢查、模型探索與模型驗證逾時涵蓋完整回應內容；瀏覽器中止後會停止無人等待的本機工作，並留下終結紀錄。",
    "1.4.5 會並行啟動並健康檢查 Local Bridge 與 Private Hub，修正只啟動第一個服務卻顯示完成的問題。",
    "新增 Windows 單檔安裝指令：SHA-256 核對後執行目前使用者安裝、登入自動啟動與立即啟動。",
    "首次沒有可用模型時安裝 qwen2.5:3b；完成後正式網址會免密碼自動連線。",
    "RPG: enforces schema-valid A/B/C director output and removes duplicate quality passes from interactive turns.",
    "RC5: separates control-plane and inference rate limits, retries safe failed requests, and caches verified model proofs.",
    "正式站精確 Origin 可免配對碼自動取得短期本機工作階段。",
    "Bridge 或 Private Hub 重啟後可自動恢復連線與模型驗證。",
    "新增版本相容性與更新提示，不相容版本不會執行模型請求。",
    "Private Hub 新增去識別化自動練習摘要的 append-only 雜湊鏈帳本。",
    "Private Hub 開機期間會持續聚合新經驗，僅在資料變化時建立可回滾的策略候選。",
    "互動故事會在選擇畫面預熱模型，並讓 Local Bridge 保留模型三十分鐘，大幅降低下一次等待。",
  ],
  bridgeEndpoint: "http://127.0.0.1:3217",
  ollamaEndpoint: "http://127.0.0.1:11434",
} as const;

export const PASSWORDLESS_LOCAL_AI_ORIGINS = [
  "https://novel-orcin.vercel.app",
  "https://novel-lqtechs-projects.vercel.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
] as const;

export type LocalAIRuntimeVersionStatus =
  | "unknown"
  | "current"
  | "update_available"
  | "incompatible";

function semverParts(value: string | null | undefined) {
  const match = String(value ?? "").trim().match(/^(\d+)\.(\d+)\.(\d+)/u);
  return match ? match.slice(1).map(Number) as [number, number, number] : null;
}

function compareSemver(left: [number, number, number], right: [number, number, number]) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

export function evaluateLocalAIRuntimeVersion(input: {
  reportedVersion: string | null | undefined;
  minimumVersion: string;
  recommendedVersion: string;
}): LocalAIRuntimeVersionStatus {
  const reported = semverParts(input.reportedVersion);
  const minimum = semverParts(input.minimumVersion);
  const recommended = semverParts(input.recommendedVersion);
  if (!reported || !minimum || !recommended) return "unknown";
  if (compareSemver(reported, minimum) < 0) return "incompatible";
  if (compareSemver(reported, recommended) < 0) return "update_available";
  return "current";
}
