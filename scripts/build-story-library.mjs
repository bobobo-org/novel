import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = process.cwd();
const legacyPath = path.join(root, "public", "legacy", "novel-system.html");
const canonicalPath = path.join(root, "data", "story-library.json");
const publicPath = path.join(root, "public", "generated", "story-library.json");
const publicJsPath = path.join(root, "public", "generated", "story-library.js");

const packNames = ["新手推薦", "熱門常用", "世界地域", "特殊玩法", "職業現實", "古代玄幻", "科幻幻想", "情感成長", "懸疑犯罪", "平台短劇", "全部題材"];
const groupNames = ["幻想冒險", "都市現實", "情感關係", "歷史權謀", "懸疑驚悚", "科幻未來", "互動實驗", "文化地域"];
const playModes = [
  ["general", "一般小說"], ["interactive", "三選一互動"], ["rpg", "RPG 冒險"],
  ["romance", "戀愛養成"], ["management", "經營模擬"], ["adult", "成人互動"],
];

function literalValue(node, source) {
  return vm.runInNewContext(`(${node.getText(source)})`, Object.create(null), { timeout: 1000 });
}

function extractLegacyThemes() {
  const html = fs.readFileSync(legacyPath, "utf8");
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]).join("\n");
  const source = ts.createSourceFile("legacy.ts", scripts, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const found = [];
  const addObject = (node) => {
    try {
      const value = literalValue(node, source);
      if (value && typeof value === "object" && !Array.isArray(value)) found.push({ pos: node.pos, value });
    } catch {}
  };
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
      if (node.name.text === "themes" || node.name.text === "featureTheme") addObject(node.initializer);
      for (const property of node.initializer.properties) {
        if (ts.isPropertyAssignment(property) && property.name?.getText(source).replace(/["']/g, "") === "themes" && ts.isObjectLiteralExpression(property.initializer)) addObject(property.initializer);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  const merged = new Map();
  for (const entry of found.sort((a, b) => a.pos - b.pos)) {
    for (const [name, subCategories] of Object.entries(entry.value)) {
      if (Array.isArray(subCategories)) merged.set(name, subCategories.map(String));
    }
  }
  // This final legacy suite derives one array from window state and therefore is
  // intentionally normalized here instead of evaluating browser code at build time.
  merged.set("網站平台功能包", ["首頁探索牆", "分類書庫篩選", "多榜單排行", "追更書架", "標籤雲與相似推薦", "作者中心工具", "讀者互動機制", "活動徵文中心", "連載儀表板", "ChatGPT 接力遊玩", "手機閱讀優化", "IP 改編素材庫"]);
  merged.set("讀者成長系統", ["閱讀足跡回訪", "章末投票分歧", "角色人氣變化", "留言觸發番外", "粉絲稱號升級", "追更提醒事件", "相似題材推薦", "收藏轉化任務", "完本回收活動", "讀券解鎖節奏", "新書入庫曝光", "社群討論升溫"]);
  return merged;
}

function classify(name, subCategories) {
  const text = `${name} ${subCategories.join(" ")}`;
  const group = /懸疑|推理|犯罪|怪談|恐怖|詭|法庭|諜報/.test(text) ? "懸疑驚悚"
    : /科幻|星際|機甲|末日|未來|賽博|AI/.test(text) ? "科幻未來"
    : /古代|宮廷|王朝|歷史|武俠|三國|宅鬥/.test(text) ? "歷史權謀"
    : /戀愛|言情|情感|療癒|家庭|青春|百合|耽美/.test(text) ? "情感關係"
    : /都市|職場|商業|現實|生活|體育|藝術/.test(text) ? "都市現實"
    : /互動|遊戲|RPG|視覺小說|平台|讀者|短劇/.test(text) ? "互動實驗"
    : /拉美|北歐|非洲|南亞|中東|東南亞|東歐|地中海|澳洲|東亞|中亞|加勒比|北美|神話|人外/.test(text) ? "文化地域"
    : "幻想冒險";
  const packs = ["全部題材"];
  if (/熱門|爽文|言情|玄幻|都市|懸疑|推理|修仙/.test(text)) packs.unshift("熱門常用");
  if (/都市|言情|戀愛|成長|校園|生活/.test(text)) packs.unshift("新手推薦");
  if (group === "文化地域") packs.unshift("世界地域");
  if (group === "互動實驗") packs.unshift("特殊玩法");
  if (/職場|商業|現實|職業|醫療|法律|藝術|體育/.test(text)) packs.unshift("職業現實");
  if (group === "歷史權謀" || /玄幻|修仙|仙俠/.test(text)) packs.unshift("古代玄幻");
  if (group === "科幻未來" || /奇幻|魔法|異界/.test(text)) packs.unshift("科幻幻想");
  if (group === "情感關係") packs.unshift("情感成長");
  if (group === "懸疑驚悚") packs.unshift("懸疑犯罪");
  if (/平台|短劇|影視|漫畫|書庫|讀者/.test(text)) packs.unshift("平台短劇");
  const modes = ["general"];
  if (/互動|遊戲|RPG|視覺小說|讀者/.test(text)) modes.push("interactive");
  if (/RPG|遊戲|冒險|副本|系統/.test(text)) modes.push("rpg");
  if (/戀愛|言情|情感|乙女/.test(text)) modes.push("romance");
  if (/經營|商業|職場|領主|種田/.test(text)) modes.push("management");
  return { group, packs: [...new Set(packs)], modes: [...new Set(modes)] };
}

function bootstrap() {
  const themes = extractLegacyThemes();
  if (themes.size !== 218) throw new Error(`Expected 218 legacy themes, received ${themes.size}.`);
  const topics = [...themes.entries()].map(([name, subCategories], index) => {
    const classified = classify(name, subCategories);
    return {
      topicId: `classic-topic-${String(index + 1).padStart(3, "0")}`,
      name,
      description: subCategories.slice(0, 3).join("、"),
      consumerGroupId: `group-${groupNames.indexOf(classified.group) + 1}`,
      packId: `pack-${packNames.indexOf(classified.packs[0]) + 1}`,
      packIds: classified.packs.map((pack) => `pack-${packNames.indexOf(pack) + 1}`),
      subCategories,
      tags: [...new Set([classified.group, ...subCategories.slice(0, 5)])],
      supportedPlayModes: classified.modes,
      recommendedProtagonists: [], recommendedWorlds: [], recommendedConflicts: [], recommendedStyles: [],
      adultOnly: false, enabled: true, classic: true, sourceVersion: "legacy-218-audited",
      legacyAliases: [name, `theme:${name}`],
    };
  });
  const adultNames = ["成熟情感探索", "成人關係劇情", "權力與界線", "親密關係修復", "成人懸疑關係", "成熟奇幻契約", "成人互動分支"];
  for (const [index, name] of adultNames.entries()) topics.push({
    topicId: `adult-topic-${String(index + 1).padStart(2, "0")}`, name,
    description: "僅在成年使用者主動開啟並確認後顯示。", consumerGroupId: "group-3", packId: "pack-8", packIds: ["pack-8"],
    subCategories: [], tags: ["成人", "成熟關係"], supportedPlayModes: ["general", "interactive", "adult"],
    recommendedProtagonists: [], recommendedWorlds: [], recommendedConflicts: [], recommendedStyles: [],
    adultOnly: true, enabled: true, classic: false, sourceVersion: "h2p-consumer-v1", legacyAliases: [],
  });
  const data = {
    schemaVersion: "story-library-v1", generatedFrom: "legacy-218-audited", staleCountExplanation: "97 是早期公開頁的歷史統計文字；正式資料經程式稽核為 218 類經典題材。",
    consumerGroups: groupNames.map((name, index) => ({ groupId: `group-${index + 1}`, name, description: `${name}故事方向`, enabled: true, order: index + 1 })),
    packs: packNames.map((name, index) => ({ packId: `pack-${index + 1}`, name, description: index === 10 ? "全部經典題材" : `${name}篩選`, enabled: true, order: index + 1 })),
    playModes: playModes.map(([playModeId, name], index) => ({ playModeId, name, description: name, defaultStats: [], enabled: true, adultOnly: playModeId === "adult", order: index + 1 })),
    storyStats: ["stamina", "money", "affection", "reputation", "experience", "level", "turns", "questProgress"].map((statId, index) => ({ statId, name: statId, enabledByDefault: false, order: index + 1 })),
    topics,
  };
  fs.mkdirSync(path.dirname(canonicalPath), { recursive: true });
  fs.writeFileSync(canonicalPath, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

const data = process.argv.includes("--bootstrap") ? bootstrap() : JSON.parse(fs.readFileSync(canonicalPath, "utf8"));
fs.mkdirSync(path.dirname(publicPath), { recursive: true });
const serialized = `${JSON.stringify(data, null, 2)}\n`;
fs.writeFileSync(publicPath, serialized);
fs.writeFileSync(publicJsPath, `window.NOVEL_STORY_LIBRARY=${JSON.stringify(data)};\n`);
const classic = data.topics.filter((topic) => topic.classic).length;
if (classic !== 218 || data.packs.length !== 11) throw new Error(`Story library invariant failed: ${classic} topics / ${data.packs.length} packs.`);
console.log(JSON.stringify({ schemaVersion: data.schemaVersion, classicTopics: classic, adultTopics: data.topics.length - classic, packs: data.packs.length, snapshot: path.relative(root, publicPath) }));
