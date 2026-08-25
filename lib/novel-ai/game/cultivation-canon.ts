import { CULTIVATION_REALM_CATALOG_V3 } from "./progression/xianxia-ruleset-v3";

export const SPIRIT_ROOT_CATALOG = [
  { id: "root.metal", name: "金靈根", affinity: "金", strength: "劍器、攻伐與鍛造", limitation: "木系生機術效率較低" },
  { id: "root.wood", name: "木靈根", affinity: "木", strength: "靈植、療癒與生機", limitation: "正面爆發較慢" },
  { id: "root.water", name: "水靈根", affinity: "水", strength: "療傷、幻術與持久運轉", limitation: "受封靈與燥火環境影響" },
  { id: "root.fire", name: "火靈根", affinity: "火", strength: "煉丹、爆發與破邪", limitation: "靈力消耗快且易躁進" },
  { id: "root.earth", name: "土靈根", affinity: "土", strength: "護體、陣法與地脈感應", limitation: "身法與遠距追擊較弱" },
  { id: "root.wind", name: "風靈根", affinity: "風", strength: "身法、御器與遠距術式", limitation: "正面防禦薄弱" },
  { id: "root.thunder", name: "雷靈根", affinity: "雷", strength: "破禁、淬體與雷法", limitation: "突破天劫風險較高" },
  { id: "root.ice", name: "冰靈根", affinity: "冰", strength: "封鎖、控場與凝神", limitation: "火毒與燥熱環境相剋" },
  { id: "root.dual", name: "雙靈根", affinity: "雙屬性", strength: "可組合兩條相生術路", limitation: "必須平衡兩種靈力" },
  { id: "root.mixed", name: "雜靈根", affinity: "多屬性", strength: "功法適應面廣、可走特殊道路", limitation: "前期提純與突破較慢" },
] as const;

export const CULTIVATION_REALMS = CULTIVATION_REALM_CATALOG_V3.map((realm) => ({
  id: realm.id,
  name: realm.localizedName,
  levels: realm.levelRange,
  requirements: realm.advancementRequirements,
  risks: realm.typicalRisks,
  capabilities: realm.unlockedCapabilities,
}));

export const SECT_RANK_CATALOG = [
  { id: "sect.master", name: "宗主／掌門", authority: "統領宗門、裁定傳承與對外盟約", minimumRealmId: "realm.golden-core" },
  { id: "sect.supreme-elder", name: "太上長老", authority: "守護核心道統與宗門存亡底牌", minimumRealmId: "realm.nascent-soul" },
  { id: "sect.elder", name: "長老", authority: "主持一峰、傳功、執法或資源分配", minimumRealmId: "realm.golden-core" },
  { id: "sect.saint", name: "聖子／聖女", authority: "宗門道統與下一代領袖候選", minimumRealmId: "realm.foundation" },
  { id: "sect.true-disciple", name: "真傳弟子", authority: "修習核心功法並接受長老親授", minimumRealmId: "realm.foundation" },
  { id: "sect.inner-disciple", name: "內門弟子", authority: "使用內門設施、承接正式宗門任務", minimumRealmId: "realm.qi-refining" },
  { id: "sect.outer-disciple", name: "外門弟子", authority: "修習基礎功法並以任務取得晉升資格", minimumRealmId: "realm.qi-refining" },
  { id: "sect.servant", name: "雜役弟子", authority: "負責藥圃、膳堂、礦場與山門雜務，可累積入門功勞", minimumRealmId: "realm.mortal-body" },
  { id: "sect.guest", name: "客卿／供奉", authority: "依契約提供專長，不自動取得核心傳承", minimumRealmId: "realm.foundation" },
] as const;

const SECT_BRANCH_BLUEPRINTS = [
  { suffix: "劍峰", discipline: "劍修與護山攻伐", profession: "劍修", resource: "劍塚、試劍臺與金系靈脈" },
  { suffix: "丹峰", discipline: "丹藥、醫修與火候驗證", profession: "煉丹師", resource: "丹爐、地火與藥材庫" },
  { suffix: "符堂", discipline: "符籙、封印與傳訊", profession: "符師", resource: "符紙、靈墨與傳訊陣樞" },
  { suffix: "陣院", discipline: "護山陣、傳送陣與地脈勘驗", profession: "陣法師", resource: "陣盤、陣眼與地脈圖" },
  { suffix: "靈植谷", discipline: "靈田、藥草與種源培育", profession: "靈植師", resource: "靈田、種源與靈泉" },
  { suffix: "戒律峰", discipline: "門規、任務稽核與內門安全", profession: "執法修士", resource: "戒律卷宗、禁制與巡山令" },
] as const;

export function sectBranchCatalog(seed: string) {
  const offset = hashText(`${seed}:sect-branches`) % TECHNIQUE_ROOTS.length;
  return SECT_BRANCH_BLUEPRINTS.map((branch, index) => ({
    id: `sect-branch.${index}.${hashText(`${seed}:branch:${index}`).toString(36)}`,
    name: `${TECHNIQUE_ROOTS[(offset + index) % TECHNIQUE_ROOTS.length]}${branch.suffix}`,
    ...branch,
    duty: `負責${branch.discipline}；領用${branch.resource}必須留下用途、持有人與歸還／消耗紀錄。`,
  }));
}

const TECHNIQUE_ROOTS = ["太初", "歸元", "青霄", "玄霜", "赤陽", "滄海", "天雷", "萬象", "長生", "無相"] as const;
const TECHNIQUE_PATHS = [
  { suffix: "劍典", profession: "劍修", root: "root.metal" },
  { suffix: "丹經", profession: "煉丹師", root: "root.fire" },
  { suffix: "符籙真解", profession: "符師", root: "root.thunder" },
  { suffix: "陣圖", profession: "陣法師", root: "root.earth" },
  { suffix: "靈植錄", profession: "靈植師", root: "root.wood" },
  { suffix: "御風訣", profession: "御器修士", root: "root.wind" },
] as const;

function hashText(value: string) {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function sectTechniqueCatalog(seed: string) {
  const offset = hashText(seed) % TECHNIQUE_ROOTS.length;
  return TECHNIQUE_PATHS.map((path, index) => ({
    id: `technique.${index}.${hashText(`${seed}:${index}`).toString(36)}`,
    name: `《${TECHNIQUE_ROOTS[(offset + index) % TECHNIQUE_ROOTS.length]}${path.suffix}》`,
    profession: path.profession,
    compatibleSpiritRootId: path.root,
    entryRealmId: index < 3 ? "realm.qi-refining" : "realm.foundation",
    rule: "必須經師承核准、靈根相容且完成前卷；跨大境界前需重新校驗，不能無代價跳卷。",
  }));
}
