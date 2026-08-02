export const LOCAL_AI_COMPANION_RELEASE = {
  schemaVersion: "novel-local-ai-companion-release-v1",
  version: "1.4.1",
  filename: "novel-local-ai-companion-v1.4.1.zip",
  downloadPath: "/downloads/novel-local-ai-companion-v1.4.1.zip",
  sha256: "EC7E492EAC2232065D284861130A98A3B175D7CCA96818252DEC5CC8D0B79F05",
  signed: false,
  minimumNodeMajor: 22,
  minimumBridgeVersion: "1.2.0",
  recommendedBridgeVersion: "1.2.1",
  minimumPrivateHubVersion: "1.1.0",
  recommendedPrivateHubVersion: "1.4.0",
  releaseNotes: [
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
