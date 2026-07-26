import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const baseUrl = process.env.P24B_BASE_URL || "http://127.0.0.1:3125";
const evidenceDir = process.env.P24B_EVIDENCE_DIR;
if (!evidenceDir) throw new Error("P24B_EVIDENCE_DIR_REQUIRED");
fs.mkdirSync(evidenceDir, { recursive: true });

const CHARACTER_STORES = [
  "characterAgentProfiles",
  "characterAgentStates",
  "characterKnowledge",
  "characterBeliefs",
  "characterMemories",
  "characterRelationships",
  "characterRelationshipEvents",
  "characterPrivateArcs",
  "characterSimulations",
  "characterSimulationTurns",
  "characterAgentEvaluations",
  "characterProposals",
  "characterAgentApprovals",
  "characterAgentAudit",
];
const NOVEL_CANON_STORES = [
  "projects",
  "chapters",
  "characters",
  "relationships",
  "worlds",
  "worldRules",
  "lore",
  "timeline",
  "storyStates",
  "acceptedChoices",
  "storyBranches",
  "storyBibles",
  "storyBibleDeltas",
  "approvalTransactions",
  "idempotencyRecords",
];
const DRAMA_CANON_STORES = [
  "dramaProjects",
  "dramaSeasons",
  "dramaEpisodes",
  "dramaScenes",
  "dramaBeats",
  "dramaBranchCandidates",
  "dramaEvaluations",
  "dramaApprovals",
  "narrativeCanonLinks",
];
const SNAPSHOT_STORES = [...new Set([
  ...NOVEL_CANON_STORES,
  ...DRAMA_CANON_STORES,
  ...CHARACTER_STORES,
  "backups",
])];

let serverProcess = null;
async function startLocalServerIfRequested() {
  if (process.env.P24B_START_SERVER !== "1") return;
  const url = new URL(baseUrl);
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const mode = process.env.P24B_SERVER_MODE === "production" ? "start" : "dev";
  serverProcess = spawn(
    process.execPath,
    [path.join(process.cwd(), "node_modules/next/dist/bin/next"), mode, "-p", port],
    { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const serverOutput = [];
  serverProcess.stdout?.on("data", (chunk) => serverOutput.push(chunk.toString()));
  serverProcess.stderr?.on("data", (chunk) => serverOutput.push(chunk.toString()));
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`P24B_LOCAL_SERVER_EXITED:${serverOutput.join("").slice(-4000)}`);
    }
    try {
      const response = await fetch(`${baseUrl}/studio/create`);
      if (response.ok) return;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`P24B_LOCAL_SERVER_TIMEOUT:${serverOutput.join("").slice(-4000)}`);
}

const checks = [];
const flowSteps = [];
const consoleErrors = [];
const pageErrors = [];
const networkResults = [];
const screenshots = [];
const write = (name, value) => fs.writeFileSync(
  path.join(evidenceDir, name),
  `${JSON.stringify(value, null, 2)}\n`,
  "utf8",
);
const check = (name, pass, details = null) => {
  const result = { name, status: pass ? "PASS" : "FAIL", details };
  checks.push(result);
  if (!pass) throw new Error(`${name}:${JSON.stringify(details)}`);
  return result;
};
const flowStep = (number, name, pass, details = null) => {
  const result = check(`consumer-flow-${String(number).padStart(2, "0")}-${name}`, pass, details);
  flowSteps.push({ number, name, ...result });
};
const stable = (value) => Array.isArray(value)
  ? value.map(stable)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]))
    : value;
const hash = (value) => crypto.createHash("sha256")
  .update(JSON.stringify(stable(value)))
  .digest("hex");
const recordsFor = (snapshot, stores) => Object.fromEntries(
  stores.map((store) => [store, [...(snapshot[store] ?? [])].sort((left, right) => String(left.id).localeCompare(String(right.id)))]),
);
const uniqueIds = (rows) => new Set(rows.map((row) => row.id)).size === rows.length;

class NavigationController {
  active = null;
  history = [];
  conflicts = [];

  async run({ navigationOwner, navigationReason, productInitiated, harnessInitiated, adversarial = false }, action) {
    const navigationStartedAt = new Date().toISOString();
    if (this.active) {
      const conflict = {
        navigationOwner,
        navigationReason,
        navigationStartedAt,
        navigationCompletedAt: new Date().toISOString(),
        productInitiated,
        harnessInitiated,
        adversarial,
        status: "CONTROLLER_CONFLICT",
        blockedBy: {
          navigationOwner: this.active.navigationOwner,
          navigationReason: this.active.navigationReason,
        },
      };
      this.conflicts.push(conflict);
      throw new Error(`NAVIGATION_OWNER_CONFLICT:${this.active.navigationOwner}:${this.active.navigationReason}`);
    }
    const record = {
      navigationOwner,
      navigationReason,
      navigationStartedAt,
      navigationCompletedAt: null,
      productInitiated,
      harnessInitiated,
      adversarial,
      status: "PENDING",
    };
    this.active = record;
    try {
      const result = await action();
      record.status = "COMPLETED";
      return result;
    } catch (error) {
      record.status = "FAILED";
      record.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      record.navigationCompletedAt = new Date().toISOString();
      this.history.push({ ...record });
      this.active = null;
    }
  }

  harnessGoto(page, url, reason) {
    return this.run({
      navigationOwner: "HARNESS",
      navigationReason: reason,
      productInitiated: false,
      harnessInitiated: true,
    }, () => page.goto(url, { waitUntil: "networkidle" }));
  }

  harnessReload(page, reason, adversarial = false) {
    return this.run({
      navigationOwner: "HARNESS",
      navigationReason: reason,
      productInitiated: false,
      harnessInitiated: true,
      adversarial,
    }, () => page.reload({ waitUntil: "networkidle" }));
  }

  productNavigation(reason, action) {
    return this.run({
      navigationOwner: "PRODUCT",
      navigationReason: reason,
      productInitiated: true,
      harnessInitiated: false,
    }, action);
  }
}

async function storageSnapshot(page, projectId) {
  return page.evaluate(async ({ projectId, storeNames }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const result = {};
    for (const storeName of storeNames) {
      if (!db.objectStoreNames.contains(storeName)) {
        result[storeName] = [];
        continue;
      }
      result[storeName] = await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly")
          .objectStore(storeName).index("projectId").getAll(projectId);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    }
    db.close();
    return result;
  }, { projectId, storeNames: SNAPSHOT_STORES });
}

async function waitForStoreCount(page, projectId, storeName, minimumCount) {
  await page.waitForFunction(async ({ projectId, storeName, minimumCount }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("novel-intelligence-platform");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!db.objectStoreNames.contains(storeName)) {
      db.close();
      return false;
    }
    const count = await new Promise((resolve, reject) => {
      const request = db.transaction(storeName, "readonly")
        .objectStore(storeName).index("projectId").count(projectId);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return count >= minimumCount;
  }, { projectId, storeName, minimumCount });
}

async function createCharacter(page, projectId, input, expectedCount) {
  await page.getByLabel("角色姓名").fill(input.name);
  await page.getByLabel("角色目標").fill(input.goal);
  await page.getByLabel("生存狀態").selectOption(input.lifeStatus ?? "alive");
  await page.getByLabel("所在位置或現況").fill(input.location);
  await page.getByLabel("年齡（可留白）").fill(String(input.age));
  await page.getByLabel("作者已確認角色年齡").check();
  await page.getByLabel("角色性格").fill(input.personality);
  await page.getByLabel("角色恐懼").fill(input.fear);
  await page.getByLabel("角色秘密").fill(input.secret);
  await page.getByLabel("所屬勢力").fill(input.faction);
  await page.getByLabel("說話節奏").selectOption(input.voiceStyle);
  await page.getByRole("button", { name: "儲存角色", exact: true }).click();
  await waitForStoreCount(page, projectId, "characters", expectedCount);
  await page.waitForFunction(
    (count) => document.querySelectorAll("[data-testid='character-records'] article").length >= count,
    expectedCount,
  );
}

async function createWorldRule(page, projectId, title, description, expectedCount) {
  await page.getByLabel("規則名稱").fill(title);
  await page.getByLabel("規則內容").fill(description);
  await page.getByRole("button", { name: "儲存世界規則", exact: true }).click();
  await waitForStoreCount(page, projectId, "worldRules", expectedCount);
}

async function selectCharacter(page, name) {
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.waitForFunction(
    (characterName) => [...document.querySelectorAll(".characterSelector button")]
      .some((button) => button.classList.contains("active") && button.textContent?.includes(characterName)),
    name,
  );
}

async function saveKnowledge(page, projectId, claim, scope, expectedCount) {
  await page.getByLabel("資訊內容").fill(claim);
  await page.getByLabel("誰可以知道").selectOption(scope);
  await page.getByRole("button", { name: "保存知識邊界", exact: true }).click();
  await waitForStoreCount(page, projectId, "characterKnowledge", expectedCount);
}

function relationshipTargetControl(page) {
  return page.locator(".setupGrid form")
    .filter({ has: page.getByRole("heading", { name: "建立有方向的關係", exact: true }) })
    .locator("select");
}

await startLocalServerIfRequested();
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: "zh-TW",
  serviceWorkers: "block",
  acceptDownloads: true,
});
const page = await context.newPage();
const navigation = new NavigationController();
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push({ text: message.text(), url: page.url() });
});
page.on("pageerror", (error) => pageErrors.push({ message: error.message, url: page.url() }));
page.on("response", (response) => {
  networkResults.push({
    status: response.status(),
    method: response.request().method(),
    url: response.url(),
  });
});

let projectId = "";
let browserSummary = null;
let navigationSummary = null;
const mobileResults = [];

try {
  await navigation.harnessGoto(page, `${baseUrl}/studio/create`, "open-create-project");
  await page.getByRole("button", { name: /空白建立/ }).click();
  await page.getByLabel("作品名稱（可留白）").fill("P2.4B 角色視角與私人故事線驗收");
  await page.getByRole("button", { name: "建立作品", exact: true }).click();
  const writeLink = page.getByRole("link", { name: "開始寫作", exact: true });
  await writeLink.waitFor();
  const writeHref = await writeLink.getAttribute("href");
  projectId = writeHref?.match(/\/studio\/project\/([^/]+)\/write/)?.[1] || "";
  flowStep(1, "建立作品", Boolean(projectId), { route: writeHref, mutationMethod: "consumer UI" });

  await navigation.harnessGoto(page, `${baseUrl}/studio/project/${projectId}/characters`, "open-character-editor");
  const characterInputs = [
    {
      name: "林昭",
      goal: "找出舊劇院邀請者並保護同伴",
      location: "舊劇院後台",
      age: 31,
      personality: "謹慎、重視承諾、先查證再行動",
      fear: "害怕錯信線索而害死同伴",
      secret: "她曾在童年見過紅鐘密室",
      faction: "調查組",
      voiceStyle: "short",
    },
    {
      name: "蘇晴",
      goal: "揭露失蹤演員名冊的真正用途",
      location: "舊劇院觀眾席",
      age: 29,
      personality: "沉著、善於推理、說話慎重完整",
      fear: "害怕證據被權勢者抹除",
      secret: "她匿名寄出了第一封邀請",
      faction: "記錄者",
      voiceStyle: "long",
    },
    {
      name: "周野",
      goal: "在午夜前打開暗門救出失蹤演員",
      location: "舊劇院地下通道",
      age: 34,
      personality: "果斷、機敏、在衝突中保持幽默",
      fear: "害怕密閉空間與停擺的鐘聲",
      secret: "他保留著暗門的第二把鑰匙",
      faction: "調查組",
      voiceStyle: "mixed",
    },
  ];
  for (let index = 0; index < characterInputs.length; index += 1) {
    await createCharacter(page, projectId, characterInputs[index], index + 1);
  }
  const characterCards = page.getByTestId("character-records").locator("article");
  flowStep(2, "建立三位角色", await characterCards.count() === 3, {
    names: await characterCards.locator("b").allTextContents(),
  });
  const characterCreationSnapshot = await storageSnapshot(page, projectId);
  flowStep(3, "建立角色性格目標恐懼與秘密", characterCreationSnapshot.characters.every((character) =>
    character.personality?.value
    && character.goal?.value
    && character.fears?.length
    && character.privateSecrets?.length), {
    completeCharacterCount: characterCreationSnapshot.characters.filter((character) =>
      character.personality?.value
      && character.goal?.value
      && character.fears?.length
      && character.privateSecrets?.length).length,
  });

  await navigation.harnessGoto(page, `${baseUrl}/studio/project/${projectId}/world`, "open-world-rule-editor");
  await createWorldRule(page, projectId, "午夜真相規則", "午夜前說出的真相會在舞台留下不可抹除的光痕。", 1);
  await createWorldRule(page, projectId, "紅鐘密室規則", "紅鐘只會對持有兩把鑰匙的人開啟密室。", 2);
  const worldSnapshot = await storageSnapshot(page, projectId);
  flowStep(4, "建立兩條世界規則", worldSnapshot.worldRules.length === 2, {
    titles: worldSnapshot.worldRules.map((rule) => rule.title),
  });

  const storyBibleSecret = "紅鐘內藏著失蹤演員親筆名冊，真正邀請者尚未公開";
  await navigation.harnessGoto(page, `${baseUrl}/studio/project/${projectId}/story-bible`, "open-story-bible-editor");
  await page.getByLabel("伏筆").fill(storyBibleSecret);
  await page.getByLabel("未解線索").fill("匿名邀請者的身分\n第二把鑰匙由誰交給周野");
  await page.getByLabel("禁止矛盾").fill("午夜前紅鐘密室尚未正式開啟");
  await page.getByRole("button", { name: "儲存 Story Bible", exact: true }).click();
  await page.getByText("Story Bible 已保存。", { exact: true }).waitFor();
  const storyBibleSnapshot = await storageSnapshot(page, projectId);
  flowStep(5, "建立Story Bible秘密", storyBibleSnapshot.storyBibles[0]?.foreshadowing?.includes(storyBibleSecret), {
    storyBibleRevision: storyBibleSnapshot.storyBibles[0]?.revision,
  });

  await navigation.productNavigation("open-character-ai-from-project-navigation", async () => {
    await Promise.all([
      page.waitForURL(new RegExp(`/studio/project/${projectId}/character-ai$`)),
      page.getByRole("link", { name: "角色 AI", exact: true }).click(),
    ]);
    await page.getByTestId("character-agent-workspace").waitFor();
  });
  await page.getByRole("button", { name: "同步全部角色 AI 檔案", exact: true }).click();
  await waitForStoreCount(page, projectId, "characterAgentProfiles", 3);
  await waitForStoreCount(page, projectId, "characterAgentStates", 3);

  const authorOnlyClaim = storyBibleSecret;
  const aKnownClaim = "林昭知道後台暗門需要依序敲擊三次";
  const bKnownClaim = "蘇晴知道匿名邀請使用了記錄者暗號";
  await selectCharacter(page, "林昭");
  await saveKnowledge(page, projectId, authorOnlyClaim, "AUTHOR_ONLY", 1);
  await saveKnowledge(page, projectId, aKnownClaim, "CHARACTER_KNOWN", 2);
  await selectCharacter(page, "蘇晴");
  await saveKnowledge(page, projectId, bKnownClaim, "CHARACTER_KNOWN", 3);
  const scopedKnowledgeSnapshot = await storageSnapshot(page, projectId);
  flowStep(6, "設定不同Knowledge Scope",
    scopedKnowledgeSnapshot.characterKnowledge.some((row) => row.scope === "AUTHOR_ONLY")
      && scopedKnowledgeSnapshot.characterKnowledge.filter((row) => row.scope === "CHARACTER_KNOWN").length === 2,
    { scopes: scopedKnowledgeSnapshot.characterKnowledge.map((row) => row.scope) });

  await selectCharacter(page, "林昭");
  await relationshipTargetControl(page).selectOption({ label: "蘇晴" });
  await page.getByLabel("關係類型").fill("互相信任的調查搭檔");
  await page.getByLabel("信任（-100 至 100）").fill("24");
  await page.getByLabel("好感（-100 至 100）").fill("12");
  await page.getByRole("button", { name: "保存方向關係", exact: true }).click();
  await waitForStoreCount(page, projectId, "characterRelationships", 1);
  await selectCharacter(page, "蘇晴");
  await relationshipTargetControl(page).selectOption({ label: "林昭" });
  await page.getByLabel("關係類型").fill("保留秘密的合作對象");
  await page.getByLabel("信任（-100 至 100）").fill("-8");
  await page.getByLabel("好感（-100 至 100）").fill("6");
  await page.getByRole("button", { name: "保存方向關係", exact: true }).click();
  await waitForStoreCount(page, projectId, "characterRelationships", 2);
  const relationshipSetupSnapshot = await storageSnapshot(page, projectId);
  const characterByName = new Map(relationshipSetupSnapshot.characters.map((character) => [character.name, character]));
  const aId = characterByName.get("林昭")?.id;
  const bId = characterByName.get("蘇晴")?.id;
  const aToB = relationshipSetupSnapshot.characterRelationships.find((edge) => edge.fromCharacterId === aId && edge.toCharacterId === bId);
  const bToA = relationshipSetupSnapshot.characterRelationships.find((edge) => edge.fromCharacterId === bId && edge.toCharacterId === aId);
  flowStep(7, "建立兩條有方向性的關係", Boolean(aToB && bToA && aToB.trust !== bToA.trust), {
    edgeCount: relationshipSetupSnapshot.characterRelationships.length,
    aToBTrust: aToB?.trust,
    bToATrust: bToA?.trust,
  });

  await navigation.harnessReload(page, "normal-persistence-reload");
  await page.getByTestId("character-agent-workspace").waitFor();
  flowStep(8, "Reload", true, { navigationOwner: "HARNESS" });
  const afterSetupReload = await storageSnapshot(page, projectId);
  flowStep(9, "確認資料存在",
    afterSetupReload.characters.length === 3
      && afterSetupReload.worldRules.length === 2
      && afterSetupReload.characterKnowledge.length === 3
      && afterSetupReload.characterRelationships.length === 2,
    {
      characters: afterSetupReload.characters.length,
      worldRules: afterSetupReload.worldRules.length,
      knowledge: afterSetupReload.characterKnowledge.length,
      relationships: afterSetupReload.characterRelationships.length,
    });
  flowStep(10, "開啟角色AI", page.url().endsWith(`/studio/project/${projectId}/character-ai`)
    && await page.getByTestId("character-agent-workspace").isVisible(), { route: page.url() });

  await selectCharacter(page, "林昭");
  flowStep(11, "選擇角色A", await page.locator(".characterSelector button.active").getByText("林昭", { exact: true }).isVisible());
  await page.getByTestId("known-knowledge").getByText(aKnownClaim, { exact: true }).waitFor();
  const knownTextA = await page.getByTestId("known-knowledge").textContent();
  const deniedTextA = await page.getByTestId("denied-knowledge").textContent();
  flowStep(12, "角色A看不到AUTHOR_ONLY秘密",
    !knownTextA?.includes(authorOnlyClaim) && !deniedTextA?.includes(authorOnlyClaim),
    { rawSecretVisible: Boolean(knownTextA?.includes(authorOnlyClaim) || deniedTextA?.includes(authorOnlyClaim)) });
  flowStep(13, "角色A只能看到自己的CHARACTER_KN資訊",
    Boolean(knownTextA?.includes(aKnownClaim)) && !knownTextA?.includes(bKnownClaim),
    { ownKnowledgeVisible: knownTextA?.includes(aKnownClaim), otherKnowledgeVisible: knownTextA?.includes(bKnownClaim) });

  await page.getByLabel("角色目前相信").fill("邀請者可能已經背叛調查組");
  await page.getByRole("button", { name: "保存信念", exact: true }).click();
  await waitForStoreCount(page, projectId, "characterBeliefs", 1);
  await page.getByRole("button", { name: "建立私人故事線", exact: true }).click();
  await waitForStoreCount(page, projectId, "characterPrivateArcs", 1);
  const canonBeforeSimulation = await storageSnapshot(page, projectId);
  const novelHashBeforeSimulation = hash(recordsFor(canonBeforeSimulation, NOVEL_CANON_STORES));
  const dramaHashBeforeSimulation = hash(recordsFor(canonBeforeSimulation, DRAMA_CANON_STORES));
  const relationshipHashBeforeSimulation = hash(canonBeforeSimulation.characterRelationships);

  await page.getByLabel("回合數").fill("5");
  await page.getByLabel("場景").fill("三位角色在紅鐘前交換各自可公開的線索，並決定下一個查證步驟。");
  await page.getByRole("button", { name: "開始私人模擬", exact: true }).click();
  await waitForStoreCount(page, projectId, "characterSimulations", 1);
  await waitForStoreCount(page, projectId, "characterSimulationTurns", 1);
  await page.getByText("私人模擬已開始並暫停在第一回合；可繼續到設定回合數。", { exact: true }).waitFor();
  const firstSimulationSnapshot = await storageSnapshot(page, projectId);
  const firstSession = [...firstSimulationSnapshot.characterSimulations].sort((left, right) => left.createdAt.localeCompare(right.createdAt)).at(-1);
  flowStep(14, "建立私人模擬", firstSession?.privateMode === true && firstSession?.status === "PAUSED", {
    sessionId: firstSession?.sessionId,
    currentTurn: firstSession?.currentTurn,
  });

  await page.getByRole("button", { name: "繼續", exact: true }).click();
  await waitForStoreCount(page, projectId, "characterSimulationTurns", 5);
  await page.getByText("私人模擬已完成；所有內容仍是候選。", { exact: true }).waitFor();
  const completedSimulationSnapshot = await storageSnapshot(page, projectId);
  const firstSessionTurns = completedSimulationSnapshot.characterSimulationTurns
    .filter((turn) => turn.sessionId === firstSession.sessionId)
    .sort((left, right) => left.turnNumber - right.turnNumber);
  flowStep(15, "執行三角色至少5回合",
    firstSessionTurns.length >= 5 && new Set(firstSessionTurns.map((turn) => turn.speakerCharacterId)).size === 3,
    { turnCount: firstSessionTurns.length, speakerCount: new Set(firstSessionTurns.map((turn) => turn.speakerCharacterId)).size });
  const voiceLines = firstSessionTurns.map((turn) => turn.dialogue?.line).filter(Boolean);
  const voiceLengthsBySpeaker = Object.fromEntries(firstSessionTurns.map((turn) => [turn.speakerCharacterId, turn.dialogue?.line?.length ?? 0]));
  flowStep(16, "檢查不同Voice",
    new Set(voiceLines).size >= 3 && new Set(Object.values(voiceLengthsBySpeaker)).size >= 2,
    { distinctLines: new Set(voiceLines).size, voiceLengthsBySpeaker });
  const relationshipCandidates = firstSessionTurns.flatMap((turn) => turn.relationshipChangeCandidates ?? []);
  flowStep(17, "檢查關係變化候選",
    relationshipCandidates.length >= 5
      && relationshipCandidates.every((candidate) => Object.values(candidate.delta).every((delta) => Number.isInteger(delta) && Math.abs(delta) <= 12)),
    { candidateCount: relationshipCandidates.length });

  const canonImmediatelyBeforeDiscard = await storageSnapshot(page, projectId);
  await page.getByRole("button", { name: "放棄模擬", exact: true }).click();
  await page.getByText("已放棄私人模擬；正式故事、角色與關係都未被修改。", { exact: true }).waitFor();
  const afterDiscard = await storageSnapshot(page, projectId);
  const discardedSession = afterDiscard.characterSimulations.find((session) => session.sessionId === firstSession.sessionId);
  flowStep(18, "放棄模擬", discardedSession?.status === "DISCARDED", { sessionId: firstSession.sessionId, status: discardedSession?.status });
  flowStep(19, "確認Canonical不變",
    hash(recordsFor(afterDiscard, NOVEL_CANON_STORES)) === hash(recordsFor(canonImmediatelyBeforeDiscard, NOVEL_CANON_STORES))
      && hash(recordsFor(afterDiscard, DRAMA_CANON_STORES)) === hash(recordsFor(canonImmediatelyBeforeDiscard, DRAMA_CANON_STORES))
      && hash(afterDiscard.characterRelationships) === hash(canonImmediatelyBeforeDiscard.characterRelationships),
    {
      novelCanonicalMutation: hash(recordsFor(afterDiscard, NOVEL_CANON_STORES)) === hash(recordsFor(canonImmediatelyBeforeDiscard, NOVEL_CANON_STORES)) ? 0 : 1,
      dramaCanonicalMutation: hash(recordsFor(afterDiscard, DRAMA_CANON_STORES)) === hash(recordsFor(canonImmediatelyBeforeDiscard, DRAMA_CANON_STORES)) ? 0 : 1,
      relationshipMutation: hash(afterDiscard.characterRelationships) === hash(canonImmediatelyBeforeDiscard.characterRelationships) ? 0 : 1,
    });

  await page.getByRole("button", { name: "重新產生", exact: true }).click();
  await waitForStoreCount(page, projectId, "characterSimulations", 2);
  await waitForStoreCount(page, projectId, "characterSimulationTurns", 6);
  await page.getByText("私人模擬已開始並暫停在第一回合；可繼續到設定回合數。", { exact: true }).waitFor();
  const regeneratedSnapshot = await storageSnapshot(page, projectId);
  const regeneratedSession = regeneratedSnapshot.characterSimulations.find((session) => session.sessionId !== firstSession.sessionId);
  flowStep(20, "重新產生", Boolean(regeneratedSession), { previousSessionId: firstSession.sessionId, sessionId: regeneratedSession?.sessionId });
  flowStep(21, "確認新Session ID", Boolean(regeneratedSession?.sessionId && regeneratedSession.sessionId !== firstSession.sessionId), {
    previousSessionId: firstSession.sessionId,
    sessionId: regeneratedSession?.sessionId,
  });
  await page.getByRole("button", { name: "繼續", exact: true }).click();
  await page.waitForFunction(
    ({ sessionId }) => [...document.querySelectorAll("[data-testid='simulation-turns'] li")].length >= 5
      && document.querySelector(".sessionPicker select")?.value === sessionId,
    { sessionId: regeneratedSession.sessionId },
  );
  await page.getByText("私人模擬已完成；所有內容仍是候選。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "轉為候選", exact: true }).click();
  await waitForStoreCount(page, projectId, "characterProposals", 1);
  await page.getByText("私人結果已轉為候選。核准前不會修改正式故事。", { exact: true }).waitFor();
  const proposalSnapshot = await storageSnapshot(page, projectId);
  const proposal = proposalSnapshot.characterProposals[0];
  flowStep(22, "將私人結果轉成Proposal", proposal?.status === "GENERATED" && proposal?.sourceEntityIds?.includes(regeneratedSession.sessionId), {
    proposalId: proposal?.proposalId,
    status: proposal?.status,
  });

  const beforeApproval = await storageSnapshot(page, projectId);
  const novelHashBeforeApproval = hash(recordsFor(beforeApproval, NOVEL_CANON_STORES));
  const dramaHashBeforeApproval = hash(recordsFor(beforeApproval, DRAMA_CANON_STORES));
  await page.getByTestId("character-proposal").filter({ hasText: "私人模擬轉成的角色候選" })
    .getByRole("button", { name: "接受", exact: true }).click();
  await waitForStoreCount(page, projectId, "characterAgentApprovals", 1);
  await page.getByText("候選已核准；只套用明列的角色層變更。", { exact: true }).waitFor();
  const afterApproval = await storageSnapshot(page, projectId);
  flowStep(23, "核准一個Character Proposal",
    afterApproval.characterAgentApprovals.length === 1
      && afterApproval.characterProposals.some((row) => row.proposalId === proposal.proposalId && row.status === "ACCEPTED"),
    { approvalCount: afterApproval.characterAgentApprovals.length, proposalId: proposal.proposalId });

  await navigation.harnessReload(page, "approved-proposal-persistence-reload");
  await page.getByTestId("character-agent-workspace").waitFor();
  flowStep(24, "Reload", true, { navigationOwner: "HARNESS" });
  const approvalReloadSnapshot = await storageSnapshot(page, projectId);
  flowStep(25, "確認核准結果存在",
    approvalReloadSnapshot.characterAgentApprovals.length === 1
      && approvalReloadSnapshot.characterProposals.some((row) => row.status === "ACCEPTED"),
    { approvalCount: approvalReloadSnapshot.characterAgentApprovals.length });
  flowStep(26, "Novel Canon未被錯誤修改",
    hash(recordsFor(approvalReloadSnapshot, NOVEL_CANON_STORES)) === novelHashBeforeApproval
      && hash(recordsFor(approvalReloadSnapshot, NOVEL_CANON_STORES)) === novelHashBeforeSimulation,
    { novelCanonicalHash: hash(recordsFor(approvalReloadSnapshot, NOVEL_CANON_STORES)) });
  flowStep(27, "Drama Canon未被錯誤修改",
    hash(recordsFor(approvalReloadSnapshot, DRAMA_CANON_STORES)) === dramaHashBeforeApproval
      && hash(recordsFor(approvalReloadSnapshot, DRAMA_CANON_STORES)) === dramaHashBeforeSimulation,
    { dramaCanonicalHash: hash(recordsFor(approvalReloadSnapshot, DRAMA_CANON_STORES)) });

  const semanticBeforeBackup = hash(recordsFor(approvalReloadSnapshot, [...NOVEL_CANON_STORES, ...DRAMA_CANON_STORES, ...CHARACTER_STORES]));
  await navigation.harnessGoto(page, `${baseUrl}/studio/project/${projectId}/backups`, "open-backup-center");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "完整備份並下載", exact: true }).click();
  await downloadPromise;
  await page.getByText(/備份完成/).waitFor();
  await waitForStoreCount(page, projectId, "backups", 1);
  const backupSnapshot = await storageSnapshot(page, projectId);
  const fullBackup = backupSnapshot.backups.find((backup) => backup.kind === "full");
  flowStep(28, "Backup", Boolean(fullBackup)
    && CHARACTER_STORES.every((store) => Array.isArray(fullBackup.snapshot?.[store])), {
    backupId: fullBackup?.id,
    characterStoreCount: CHARACTER_STORES.filter((store) => Array.isArray(fullBackup?.snapshot?.[store])).length,
  });

  page.once("dialog", (dialog) => void dialog.accept());
  const fullBackupArticle = page.getByText("完整備份", { exact: true }).locator("..");
  await navigation.productNavigation("restore-product-owned-reload", async () => {
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle" }),
      fullBackupArticle.getByRole("button", { name: "還原", exact: true }).click(),
    ]);
  });
  await page.getByRole("heading", { name: "作品備份", exact: true }).waitFor();
  const restoredSnapshot = await storageSnapshot(page, projectId);
  flowStep(29, "Restore",
    restoredSnapshot.characterAgentApprovals.length === 1
      && restoredSnapshot.characterSimulationTurns.length === approvalReloadSnapshot.characterSimulationTurns.length
      && restoredSnapshot.characterRelationships.length === 2,
    {
      approvalCount: restoredSnapshot.characterAgentApprovals.length,
      turnCount: restoredSnapshot.characterSimulationTurns.length,
      relationshipCount: restoredSnapshot.characterRelationships.length,
      productOwnedReload: true,
      extraHarnessReload: false,
    });
  const semanticAfterRestore = hash(recordsFor(restoredSnapshot, [...NOVEL_CANON_STORES, ...DRAMA_CANON_STORES, ...CHARACTER_STORES]));
  flowStep(30, "Semantic hash一致", semanticAfterRestore === semanticBeforeBackup, {
    before: semanticBeforeBackup,
    after: semanticAfterRestore,
  });

  await navigation.harnessGoto(page, `${baseUrl}/studio/project/${projectId}/character-ai`, "open-character-ai-for-layout-gates");
  await page.getByTestId("character-agent-workspace").waitFor();
  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopMetrics = await page.evaluate(() => ({
    innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
    rootScrollWidth: document.documentElement.scrollWidth,
    relationshipGraphVisible: document.querySelector(".relationshipGraph")?.getBoundingClientRect().width > 0,
    relationshipCardCount: document.querySelectorAll("[data-testid='relationship-list'] article").length,
    technicalInformationExpanded: document.querySelector("details.characterTechnical")?.hasAttribute("open") ?? false,
  }));
  check("desktop-1440x900-horizontal-overflow-zero",
    desktopMetrics.bodyScrollWidth <= desktopMetrics.innerWidth && desktopMetrics.rootScrollWidth <= desktopMetrics.innerWidth,
    desktopMetrics);
  check("desktop-relationship-ui-operable", desktopMetrics.relationshipGraphVisible && desktopMetrics.relationshipCardCount === 2, desktopMetrics);
  check("desktop-technical-information-collapsed", !desktopMetrics.technicalInformationExpanded, desktopMetrics);
  const desktopScreenshot = "p24b-character-agent-desktop-1440x900.png";
  await page.screenshot({ path: path.join(evidenceDir, desktopScreenshot), fullPage: true });
  screenshots.push(desktopScreenshot);

  for (const [width, height] of [[360, 800], [375, 812], [390, 844], [412, 915]]) {
    await page.setViewportSize({ width, height });
    const metrics = await page.evaluate(() => ({
      innerWidth,
      bodyScrollWidth: document.body.scrollWidth,
      rootScrollWidth: document.documentElement.scrollWidth,
      relationshipGraphHidden: document.querySelector(".relationshipGraph")?.getBoundingClientRect().width === 0,
      relationshipListVisible: document.querySelector("[data-testid='relationship-list']")?.getBoundingClientRect().width > 0,
      relationshipCardCount: document.querySelectorAll("[data-testid='relationship-list'] article").length,
      technicalInformationExpanded: document.querySelector("details.characterTechnical")?.hasAttribute("open") ?? false,
      layoutDiagnostics: Object.fromEntries([
        ".characterAgentWorkspace",
        ".characterOverview",
        ".knowledgeColumns",
        ".setupGrid",
        ".simulationSetup",
        ".proposalSection",
      ].map((selector) => {
        const element = document.querySelector(selector);
        if (!element) return [selector, null];
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return [selector, {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          minWidth: style.minWidth,
          gridTemplateColumns: style.gridTemplateColumns,
          overflowX: style.overflowX,
        }];
      })),
      overflowingElements: [...document.querySelectorAll("body *")]
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            className: typeof element.className === "string" ? element.className : "",
            text: (element.textContent ?? "").trim().slice(0, 80),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            width: Math.round(rect.width),
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
          };
        })
        .filter((element) => element.left < -1 || element.right > innerWidth + 1)
        .sort((left, right) => right.right - left.right)
        .slice(0, 20),
    }));
    const controls = {
      syncProfiles: await page.getByRole("button", { name: "同步全部角色 AI 檔案", exact: true }).isEnabled(),
      characterSelector: await page.locator(".characterSelector button").first().isEnabled(),
      relationshipTarget: await relationshipTargetControl(page).isEnabled(),
      relationshipSave: await page.getByRole("button", { name: "保存方向關係", exact: true }).isEnabled(),
      simulationStart: await page.getByRole("button", { name: "開始私人模擬", exact: true }).isEnabled(),
    };
    const horizontalOverflow = metrics.bodyScrollWidth > metrics.innerWidth || metrics.rootScrollWidth > metrics.innerWidth;
    check(`mobile-${width}x${height}-horizontal-overflow-zero`, !horizontalOverflow, metrics);
    check(`mobile-${width}x${height}-main-controls-operable`, Object.values(controls).every(Boolean), controls);
    check(`mobile-${width}x${height}-relationship-ui-operable`,
      metrics.relationshipGraphHidden && metrics.relationshipListVisible && metrics.relationshipCardCount === 2,
      metrics);
    check(`mobile-${width}x${height}-technical-information-collapsed`, !metrics.technicalInformationExpanded, metrics);
    const screenshot = `p24b-character-agent-mobile-${width}x${height}.png`;
    await page.screenshot({ path: path.join(evidenceDir, screenshot), fullPage: true });
    screenshots.push(screenshot);
    mobileResults.push({
      viewport: `${width}x${height}`,
      horizontalOverflow,
      controls,
      relationshipGraphHidden: metrics.relationshipGraphHidden,
      relationshipListVisible: metrics.relationshipListVisible,
      relationshipCardCount: metrics.relationshipCardCount,
      technicalInformationExpanded: metrics.technicalInformationExpanded,
      screenshot,
      pass: true,
    });
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  const beforeAdversarialReload = await storageSnapshot(page, projectId);
  const adversarialResults = await Promise.allSettled([
    navigation.harnessReload(page, "adversarial-primary-reload", true),
    navigation.harnessReload(page, "adversarial-duplicate-reload", true),
  ]);
  await page.getByTestId("character-agent-workspace").waitFor();
  const afterAdversarialReload = await storageSnapshot(page, projectId);
  const rejectedReloads = adversarialResults.filter((result) =>
    result.status === "rejected" && String(result.reason).includes("NAVIGATION_OWNER_CONFLICT"));
  const fulfilledReloads = adversarialResults.filter((result) => result.status === "fulfilled");
  check("adversarial-duplicate-reload-controller-race-isolated", fulfilledReloads.length === 1 && rejectedReloads.length === 1, {
    fulfilled: fulfilledReloads.length,
    controllerRejected: rejectedReloads.length,
  });
  check("adversarial-reload-data-loss-zero",
    hash(recordsFor(beforeAdversarialReload, [...NOVEL_CANON_STORES, ...DRAMA_CANON_STORES, ...CHARACTER_STORES]))
      === hash(recordsFor(afterAdversarialReload, [...NOVEL_CANON_STORES, ...DRAMA_CANON_STORES, ...CHARACTER_STORES])));
  check("adversarial-reload-duplicate-approval-zero",
    afterAdversarialReload.characterAgentApprovals.length === beforeAdversarialReload.characterAgentApprovals.length
      && uniqueIds(afterAdversarialReload.characterAgentApprovals));
  check("adversarial-reload-duplicate-simulation-turn-zero",
    afterAdversarialReload.characterSimulationTurns.length === beforeAdversarialReload.characterSimulationTurns.length
      && uniqueIds(afterAdversarialReload.characterSimulationTurns));
  check("adversarial-reload-canonical-damage-zero",
    hash(recordsFor(afterAdversarialReload, [...NOVEL_CANON_STORES, ...DRAMA_CANON_STORES]))
      === hash(recordsFor(beforeAdversarialReload, [...NOVEL_CANON_STORES, ...DRAMA_CANON_STORES])));
  check("adversarial-reload-duplicate-relationship-event-zero",
    afterAdversarialReload.characterRelationshipEvents.length === beforeAdversarialReload.characterRelationshipEvents.length
      && uniqueIds(afterAdversarialReload.characterRelationshipEvents));

  const unexpectedHttpErrors = networkResults.filter(({ status, url }) => status >= 400 && !url.includes("favicon"));
  const externalRequests = networkResults.filter(({ url }) => {
    if (url.startsWith("data:") || url.startsWith("blob:")) return false;
    try {
      return new URL(url).origin !== new URL(baseUrl).origin;
    } catch {
      return true;
    }
  });
  const navigationFailurePatterns = /ERR_ABORTED|frame detached|execution context destroyed|navigation interrupted/iu;
  const normalNavigationFailures = navigation.history.filter((entry) => !entry.adversarial && entry.status !== "COMPLETED");
  const browserFailureText = JSON.stringify({ consoleErrors, pageErrors, normalNavigationFailures });
  check("normal-navigation-race-zero", normalNavigationFailures.length === 0 && !navigationFailurePatterns.test(browserFailureText), {
    normalNavigationFailures,
  });
  check("console-error-zero", consoleErrors.length === 0, consoleErrors);
  check("page-error-zero", pageErrors.length === 0, pageErrors);
  check("unexpected-4xx-5xx-zero", unexpectedHttpErrors.length === 0, unexpectedHttpErrors);
  check("unexpected-external-request-zero", externalRequests.length === 0, externalRequests);
  check("consumer-flow-has-exactly-30-steps", flowSteps.length === 30, { stepCount: flowSteps.length });

  const generatedAt = new Date().toISOString();
  navigationSummary = {
    schemaVersion: "p24b-navigation-ownership-v1",
    generatedAt,
    normalFlow: navigation.history.filter((entry) => !entry.adversarial),
    adversarialFlow: navigation.history.filter((entry) => entry.adversarial),
    controllerConflicts: navigation.conflicts,
    navigationRaceInNormalFlow: 0,
    adversarialControllerConflictCount: navigation.conflicts.filter((entry) => entry.adversarial).length,
    productOwnedRestoreReload: navigation.history.some((entry) =>
      entry.navigationOwner === "PRODUCT"
      && entry.navigationReason === "restore-product-owned-reload"
      && entry.status === "COMPLETED"),
    extraHarnessReloadAfterRestore: false,
    forbiddenNavigationErrorCount: 0,
    dataLoss: 0,
    duplicateApproval: 0,
    duplicateSimulationTurn: 0,
    canonicalDamage: 0,
    duplicateRelationshipEvent: 0,
    status: "P2.4B_BROWSER_NAVIGATION_OWNERSHIP_PASS",
  };
  browserSummary = {
    schemaVersion: "p24b-browser-full-flow-v1",
    generatedAt,
    server: baseUrl,
    projectId,
    browserProfile: "fresh isolated Playwright Chromium context",
    mutationMethod: "consumer UI only",
    indexedDbUse: "readonly transaction completion, snapshots, counts, and semantic hashes only",
    flowSteps,
    status: "PASS",
    pass: checks.filter((item) => item.status === "PASS").length,
    fail: 0,
    skip: 0,
    checks,
    screenshots,
    consoleErrorCount: 0,
    pageErrorCount: 0,
    unexpectedHttpErrorCount: 0,
    unexpectedExternalRequestCount: 0,
    unauthorizedKnowledgeLeak: 0,
    canonicalMutationBeforeApproval: 0,
    productionMutation: 0,
  };
  write("desktop-results.json", {
    schemaVersion: "p24b-desktop-gate-v1",
    generatedAt,
    viewport: "1440x900",
    metrics: desktopMetrics,
    screenshot: desktopScreenshot,
    consoleErrorCount: 0,
    unexpectedHttpErrorCount: 0,
    status: "PASS",
  });
  write("mobile-results.json", {
    schemaVersion: "p24b-mobile-gate-v1",
    generatedAt,
    requiredViewports: ["360x800", "375x812", "390x844", "412x915"],
    results: mobileResults,
    pass: mobileResults.length * 4,
    fail: 0,
    skip: 0,
    status: "PASS",
  });
  write("navigation-ownership.json", navigationSummary);
  write("browser-full-flow.json", browserSummary);
  write("canonical-isolation.json", {
    schemaVersion: "p24b-browser-canonical-isolation-v1",
    generatedAt,
    novelHashBeforeSimulation,
    novelHashBeforeApproval,
    novelHashAfterApprovalReload: hash(recordsFor(approvalReloadSnapshot, NOVEL_CANON_STORES)),
    dramaHashBeforeSimulation,
    dramaHashBeforeApproval,
    dramaHashAfterApprovalReload: hash(recordsFor(approvalReloadSnapshot, DRAMA_CANON_STORES)),
    relationshipHashBeforeSimulation,
    relationshipHashAfterDiscard: hash(afterDiscard.characterRelationships),
    canonicalMutationBeforeApproval: 0,
    novelCanonicalMutation: 0,
    dramaCanonicalMutation: 0,
    status: "P2.4B_CANONICAL_ISOLATION_PASS",
  });
  write("backup-restore-results.json", {
    schemaVersion: "p24b-browser-backup-restore-v1",
    generatedAt,
    backupId: fullBackup.id,
    formatVersion: fullBackup.manifest?.formatVersion,
    projectSchemaVersion: fullBackup.manifest?.projectSchemaVersion,
    characterStoresIncluded: CHARACTER_STORES.filter((store) => Array.isArray(fullBackup.snapshot?.[store])),
    semanticHashBeforeBackup: semanticBeforeBackup,
    semanticHashAfterRestore: semanticAfterRestore,
    semanticHashMatch: semanticAfterRestore === semanticBeforeBackup,
    productOwnedReload: true,
    extraHarnessReload: false,
    status: "PASS",
  });
  write("browser-console-results.json", {
    schemaVersion: "p24b-browser-console-v1",
    generatedAt,
    consoleErrors,
    pageErrors,
    status: "PASS",
  });
  write("browser-network-results.json", {
    schemaVersion: "p24b-browser-network-v1",
    generatedAt,
    unexpectedHttpErrors,
    externalRequests,
    status: "PASS",
  });
  write("findings.json", {
    schemaVersion: "p24b-browser-findings-v1",
    generatedAt,
    blocking: [],
    nonBlocking: [],
    status: "PASS",
  });
  console.log(JSON.stringify({
    status: browserSummary.status,
    pass: browserSummary.pass,
    fail: 0,
    skip: 0,
    flowSteps: flowSteps.length,
    mobileViewports: mobileResults.length,
    navigationRaceInNormalFlow: 0,
  }));
} catch (error) {
  const generatedAt = new Date().toISOString();
  const failure = {
    schemaVersion: "p24b-browser-findings-v1",
    generatedAt,
    status: "FAIL",
    blocking: [{
      code: "P24B_BROWSER_GATE_FAILED",
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    }],
    projectId,
    flowSteps,
    checks,
    navigationHistory: navigation.history,
    navigationConflicts: navigation.conflicts,
    consoleErrors,
    pageErrors,
    networkErrors: networkResults.filter(({ status }) => status >= 400),
  };
  write("findings.json", failure);
  write("browser-full-flow.json", {
    schemaVersion: "p24b-browser-full-flow-v1",
    generatedAt,
    server: baseUrl,
    projectId,
    status: "FAIL",
    pass: checks.filter((item) => item.status === "PASS").length,
    fail: checks.filter((item) => item.status === "FAIL").length || 1,
    skip: 0,
    flowSteps,
    checks,
    error: failure.blocking[0],
  });
  throw error;
} finally {
  await context.close();
  await browser.close();
  serverProcess?.kill();
}
