"use client";

import { useEffect, useMemo, useState } from "react";
import {
  makeRecord,
  optionalValue,
  type Character,
  type CharacterRelationship,
  type NovelProject,
  type StoryBible,
  type World,
} from "@/lib/novel-ai/domain";
import {
  CULTIVATION_PROFESSIONS,
  FUTURE_ORGANIZATION_CATALOG,
  HISTORICAL_ORGANIZATION_CATALOG,
  professionContinuityError,
  professionSuggestions,
  professionWorldContext,
  MODERN_ORGANIZATION_CATALOG,
} from "@/lib/novel-ai/game/character-profession";
import { managementInvestmentCatalog, resolveManagementEra } from "@/lib/novel-ai/game/management-investments";
import { CULTIVATION_OPPORTUNITIES } from "@/lib/novel-ai/game/cultivation-opportunities";
import {
  CULTIVATION_REALMS,
  SECT_RANK_CATALOG,
  SPIRIT_ROOT_CATALOG,
  sectBranchCatalog,
  sectTechniqueCatalog,
} from "@/lib/novel-ai/game/cultivation-canon";
import { createNovelRepository } from "@/lib/novel-ai/repository";

const RELATIONSHIP_KINDS = [
  "兄弟", "姊妹", "兄妹／姊弟", "夫妻", "戀人", "前任", "父子", "父女", "母子", "母女",
  "祖孫", "師徒", "同門", "盟友", "敵人", "宿敵", "競爭者", "主僕", "同事", "上下屬",
  "恩人", "仇人", "債務", "交易夥伴",
] as const;

type WorkbenchData = {
  characters: Character[];
  relationships: CharacterRelationship[];
  storyBibles: StoryBible[];
  worlds: World[];
};

export default function CharacterRelationshipWorkbench({
  project,
  compact = false,
  onChanged,
}: {
  project: NovelProject;
  compact?: boolean;
  onChanged?: () => void | Promise<void>;
}) {
  const repository = useMemo(() => createNovelRepository(), []);
  const [data, setData] = useState<WorkbenchData>({ characters: [], relationships: [], storyBibles: [], worlds: [] });
  const [selectedCharacterId, setSelectedCharacterId] = useState("");
  const [name, setName] = useState("");
  const [profession, setProfession] = useState("");
  const [spiritRootId, setSpiritRootId] = useState("root.mixed");
  const [realmId, setRealmId] = useState("realm.qi-refining");
  const [realmStage, setRealmStage] = useState<"初期" | "中期" | "後期" | "圓滿">("初期");
  const [sectBranchId, setSectBranchId] = useState("");
  const [sectRankId, setSectRankId] = useState("sect.outer-disciple");
  const [techniqueId, setTechniqueId] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [kind, setKind] = useState("兄弟");
  const [summary, setSummary] = useState("");
  const [trust, setTrust] = useState("50");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  function applyCharacterForm(character: Character | null) {
    setName(character?.name ?? "");
    setProfession(character?.identity.value ?? "");
    setSpiritRootId(character?.cultivationProfile?.spiritRootId ?? "root.mixed");
    setRealmId(character?.cultivationProfile?.realmId ?? "realm.qi-refining");
    setRealmStage(character?.cultivationProfile?.realmStage ?? "初期");
    setSectBranchId(character?.cultivationProfile?.sectBranchId ?? "");
    setSectRankId(character?.cultivationProfile?.sectRankId ?? "sect.outer-disciple");
    setTechniqueId(character?.cultivationProfile?.techniqueIds[0] ?? "");
  }

  function selectCharacter(characterId: string) {
    setSelectedCharacterId(characterId);
    applyCharacterForm(data.characters.find((character) => character.id === characterId) ?? null);
  }

  async function load() {
    const [characters, relationships, storyBibles, worlds] = await Promise.all([
      repository.list<Character>("characters", project.id),
      repository.list<CharacterRelationship>("relationships", project.id),
      repository.list<StoryBible>("storyBibles", project.id),
      repository.list<World>("worlds", project.id),
    ]);
    const ordered = characters.sort((left, right) => left.name.localeCompare(right.name, "zh-Hant"));
    const nextSelectedId = selectedCharacterId || ordered[0]?.id || "";
    setData({ characters: ordered, relationships, storyBibles, worlds });
    setSelectedCharacterId(nextSelectedId);
    applyCharacterForm(ordered.find((character) => character.id === nextSelectedId) ?? null);
    setFromId((current) => current || ordered[0]?.id || "");
    setToId((current) => current || ordered.find((character) => character.id !== (ordered[0]?.id || ""))?.id || "");
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedCharacter = data.characters.find((character) => character.id === selectedCharacterId) ?? null;

  const suggestions = professionSuggestions(project, data.worlds);
  const worldContext = professionWorldContext(project, data.worlds);
  const worldSignal = [project.coreIdea.value, ...data.worlds.flatMap((world) => [world.name.value, world.era.value, world.summary.value])].filter(Boolean).join(" ");
  const managementEra = resolveManagementEra(worldSignal);
  const investmentCatalog = managementInvestmentCatalog(worldSignal);
  const techniques = useMemo(
    () => sectTechniqueCatalog(project.proceduralRootSeed ?? project.id),
    [project.id, project.proceduralRootSeed],
  );
  const sectBranches = useMemo(
    () => sectBranchCatalog(project.proceduralRootSeed ?? project.id),
    [project.id, project.proceduralRootSeed],
  );
  const selectedTechniqueId = techniqueId || techniques[0]?.id || "";
  const selectedSectBranchId = sectBranchId || sectBranches[0]?.id || "";
  const names = new Map(data.characters.map((character) => [character.id, character.name]));
  const usesCultivationCanon = worldContext === "cultivation"
    || (worldContext === "cross-era" && (
      Boolean(selectedCharacter?.cultivationProfile)
      || CULTIVATION_PROFESSIONS.some((item) => profession.includes(item))
    ));
  const organizationCatalog = worldContext === "historical"
    ? HISTORICAL_ORGANIZATION_CATALOG
    : worldContext === "future"
      ? FUTURE_ORGANIZATION_CATALOG
      : worldContext === "cross-era"
        ? [...MODERN_ORGANIZATION_CATALOG, ...HISTORICAL_ORGANIZATION_CATALOG, ...FUTURE_ORGANIZATION_CATALOG]
        : MODERN_ORGANIZATION_CATALOG;
  const worldContextLabel = worldContext === "cultivation"
    ? "修仙職業庫"
    : worldContext === "historical"
      ? "古代／歷史職業庫"
      : worldContext === "future"
        ? "未來職業庫"
        : worldContext === "modern"
          ? "現代職業庫"
          : "跨時代職業庫";
  const organizationContextLabel = worldContext === "historical"
    ? "古代宗族、朝廷、商會與書院"
    : worldContext === "future"
      ? "未來企業、星際政體與自治群落"
      : worldContext === "cross-era"
        ? "各時代公司、宗族、勢力與國家"
        : "現代公司、家族企業、勢力與國家";

  async function finish(nextMessage: string) {
    await load();
    await onChanged?.();
    setMessage(nextMessage);
  }

  async function saveCharacter(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedCharacter) return;
    const continuityError = professionContinuityError(profession, project, data.worlds);
    if (continuityError) {
      setMessage(continuityError);
      return;
    }
    const normalizedProfession = profession.trim();
    const duplicateProfession = normalizedProfession
      ? data.characters.find((character) => character.id !== selectedCharacter.id
        && character.identity.value?.trim() === normalizedProfession)
      : null;
    if (duplicateProfession) {
      setMessage(`「${normalizedProfession}」已由${duplicateProfession.name}擔任；請替每位人物安排不同職業或專長。`);
      return;
    }
    if (usesCultivationCanon) {
      const rank = SECT_RANK_CATALOG.find((item) => item.id === sectRankId);
      const realmIndex = CULTIVATION_REALMS.findIndex((item) => item.id === realmId);
      const minimumIndex = CULTIVATION_REALMS.findIndex((item) => item.id === rank?.minimumRealmId);
      if (rank && realmIndex >= 0 && minimumIndex > realmIndex) {
        setMessage(`${rank.name}至少需要達到${CULTIVATION_REALMS[minimumIndex]?.name}；請調整境界或宗門位階。`);
        return;
      }
      const technique = techniques.find((item) => item.id === selectedTechniqueId);
      if (technique && !["root.dual", "root.mixed", technique.compatibleSpiritRootId].includes(spiritRootId)) {
        const requiredRoot = SPIRIT_ROOT_CATALOG.find((item) => item.id === technique.compatibleSpiritRootId)?.name;
        setMessage(`${technique.name}主要相容${requiredRoot}；目前靈根不符。可改選功法，或使用雙靈根／雜靈根並在故事中承擔修煉代價。`);
        return;
      }
    }
    setBusy(true);
    try {
      await repository.put<Character>("characters", {
        ...selectedCharacter,
        name: name.trim() || selectedCharacter.name,
        identity: optionalValue(profession.trim() || null, profession.trim() ? "user_defined" : "unset"),
        cultivationProfile: usesCultivationCanon ? {
          schemaVersion: "character-cultivation-profile-v1",
          spiritRootId,
          realmId,
          realmStage,
          sectBranchId: selectedSectBranchId,
          sectRankId,
          techniqueIds: selectedTechniqueId ? [selectedTechniqueId] : [],
          approvedAt: new Date().toISOString(),
        } : null,
      }, selectedCharacter.revision);
      await finish("人物姓名與職業已寫入正式角色資料，故事工作台會讀到同一筆內容。");
    } catch (cause) {
      setMessage(`人物儲存失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveRelationship(event: React.FormEvent) {
    event.preventDefault();
    if (!fromId || !toId || fromId === toId) {
      setMessage("關係必須連接兩個不同人物。");
      return;
    }
    setBusy(true);
    try {
      const existing = data.relationships.find((relationship) =>
        (relationship.fromCharacterId === fromId && relationship.toCharacterId === toId)
        || (relationship.fromCharacterId === toId && relationship.toCharacterId === fromId));
      const base = existing ?? makeRecord(project.id, "user");
      const saved = await repository.put<CharacterRelationship>("relationships", {
        ...base,
        fromCharacterId: fromId,
        toCharacterId: toId,
        kind,
        summary: summary.trim() || `${names.get(fromId)}與${names.get(toId)}的${kind}關係。`,
        trust: Math.max(-100, Math.min(100, Number(trust) || 0)),
      }, existing?.revision);
      for (const bible of data.storyBibles) {
        if (bible.relationshipIds.includes(saved.id)) continue;
        await repository.put<StoryBible>("storyBibles", {
          ...bible,
          relationshipIds: [...bible.relationshipIds, saved.id],
        }, bible.revision);
      }
      setSummary("");
      await finish(existing ? "人物關係已更新，故事記憶仍指向同一條關係。" : "人物關係已建立並接入故事記憶，後續敘事會使用這條關係。");
    } catch (cause) {
      setMessage(`關係儲存失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  async function removeRelationship(relationship: CharacterRelationship) {
    if (!confirm(`確定刪除「${names.get(relationship.fromCharacterId)}－${relationship.kind}－${names.get(relationship.toCharacterId)}」嗎？`)) return;
    setBusy(true);
    try {
      for (const bible of data.storyBibles) {
        if (!bible.relationshipIds.includes(relationship.id)) continue;
        await repository.put<StoryBible>("storyBibles", {
          ...bible,
          relationshipIds: bible.relationshipIds.filter((id) => id !== relationship.id),
        }, bible.revision);
      }
      await repository.remove("relationships", relationship.id);
      await finish("關係已移除；人物本身與既有正文沒有被刪除。");
    } catch (cause) {
      setMessage(`關係刪除失敗：${cause instanceof Error ? cause.message : "請重試"}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="characterRelationWorkbench" data-compact={compact} data-testid="character-relationship-workbench">
      <header>
        <div><small>CHARACTER NETWORK · SAME CANON</small><h2>人物、職業與關係網</h2></div>
        <span>{worldContextLabel} · {data.characters.length} 人 · {data.relationships.length} 條關係</span>
      </header>
      <p>這裡直接修改正式人物資料。兄弟姊妹、夫妻、師徒、敵人等關係會接入 Story Bible，供續寫、三選一與一致性檢查使用。</p>
      {data.characters.length ? <div className="characterRelationForms">
        <form onSubmit={saveCharacter}>
          <h3>快速編修人物</h3>
          <label>人物<select value={selectedCharacterId} onChange={(event) => selectCharacter(event.target.value)}>{data.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
          <label>姓名<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label>職業／身分<input list={`profession-${project.id}`} value={profession} onChange={(event) => setProfession(event.target.value)} placeholder={suggestions.slice(0, 4).join("、")} /></label>
          <datalist id={`profession-${project.id}`}>{suggestions.map((item) => <option key={item} value={item} />)}</datalist>
          {usesCultivationCanon ? <>
            <label>靈根<select value={spiritRootId} onChange={(event) => setSpiritRootId(event.target.value)}>{SPIRIT_ROOT_CATALOG.map((item) => <option key={item.id} value={item.id}>{item.name}｜{item.strength}</option>)}</select></label>
            <label>修仙境界<select value={realmId} onChange={(event) => setRealmId(event.target.value)}>{CULTIVATION_REALMS.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>境界階段<select value={realmStage} onChange={(event) => setRealmStage(event.target.value as typeof realmStage)}>{["初期", "中期", "後期", "圓滿"].map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>所屬峰／堂／院／谷<select value={selectedSectBranchId} onChange={(event) => setSectBranchId(event.target.value)}>{sectBranches.map((item) => <option key={item.id} value={item.id}>{item.name}｜{item.discipline}</option>)}</select></label>
            <label>宗門位階<select value={sectRankId} onChange={(event) => setSectRankId(event.target.value)}>{SECT_RANK_CATALOG.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="wide">主修功法<select value={selectedTechniqueId} onChange={(event) => setTechniqueId(event.target.value)}>{techniques.map((item) => <option key={item.id} value={item.id}>{item.name}｜{item.profession}</option>)}</select></label>
          </> : null}
          <button disabled={busy} type="submit">儲存人物</button>
        </form>
        <form onSubmit={saveRelationship}>
          <h3>建立或更新關係</h3>
          <label>人物甲<select value={fromId} onChange={(event) => setFromId(event.target.value)}>{data.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
          <label>關係<select value={kind} onChange={(event) => setKind(event.target.value)}>{RELATIONSHIP_KINDS.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>人物乙<select value={toId} onChange={(event) => setToId(event.target.value)}>{data.characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}</select></label>
          <label>信任值（-100～100）<input type="number" min="-100" max="100" value={trust} onChange={(event) => setTrust(event.target.value)} /></label>
          <label className="wide">關係歷史／目前矛盾<input value={summary} onChange={(event) => setSummary(event.target.value)} placeholder="例：同門多年，因掌門繼承問題成為競爭者" /></label>
          <button disabled={busy || data.characters.length < 2} type="submit">儲存關係</button>
        </form>
      </div> : <p className="characterRelationEmpty">尚未建立人物。請先到「角色與關係」建立第一位人物，再回此處連接關係。</p>}
      {message ? <p className="characterRelationMessage" role="status">{message}</p> : null}
      {usesCultivationCanon ? <details className="cultivationCanonPanel" open={!compact}>
        <summary>查看宗門功法、靈根、境界與位階規則</summary>
        <div>
          <section><h3>宗門峰／堂／院／谷</h3>{sectBranches.map((item) => <p key={item.id}><b>{item.name}</b><span>{item.duty}</span></p>)}</section>
          <section><h3>宗門功法</h3>{techniques.map((item) => <p key={item.id}><b>{item.name}</b><span>{item.profession} · {SPIRIT_ROOT_CATALOG.find((root) => root.id === item.compatibleSpiritRootId)?.name} · {CULTIVATION_REALMS.find((realm) => realm.id === item.entryRealmId)?.name}可入門</span></p>)}</section>
          <section><h3>靈根</h3>{SPIRIT_ROOT_CATALOG.map((item) => <p key={item.id}><b>{item.name}</b><span>{item.strength}；限制：{item.limitation}</span></p>)}</section>
          <section><h3>境界</h3>{CULTIVATION_REALMS.map((item) => <p key={item.id}><b>{item.name}</b><span>突破：{item.requirements.join("、")}；風險：{item.risks.join("、")}</span></p>)}</section>
          <section><h3>宗門位階</h3>{SECT_RANK_CATALOG.map((item) => <p key={item.id}><b>{item.name}</b><span>{item.authority}</span></p>)}</section>
        </div>
      </details> : null}
      {!usesCultivationCanon || worldContext === "cross-era" ? <details className="cultivationCanonPanel" open={!compact}>
        <summary>查看{organizationContextLabel}規則</summary>
        <div>
          {organizationCatalog.map((item) => <section key={item.id}><h3>{item.name}</h3><p><b>職位</b><span>{item.roles.join("、")}</span></p><p><b>戰略資產</b><span>{item.strategicAssets}</span></p></section>)}
        </div>
      </details> : null}
      {usesCultivationCanon ? <details className="cultivationCanonPanel">
        <summary>查看宗門機緣、大比、洞府與秘境事件</summary>
        <div>{CULTIVATION_OPPORTUNITIES.map((item) => <section key={item.id}><h3>{item.name}</h3><p><b>准入</b><span>{item.eligibleRanks.join("、")} · 最低 {CULTIVATION_REALMS.find((realm) => realm.id === item.minimumRealmId)?.name}</span></p><p><b>收益</b><span>{item.rewards.join("、")}</span></p><p><b>風險</b><span>{item.risks.join("、")}</span></p><p><b>勢力後果</b><span>{item.factionEffects.join("、")}</span></p></section>)}</div>
      </details> : null}
      <details className="cultivationCanonPanel">
        <summary>查看{managementEra === "cultivation" ? "修仙" : managementEra === "ancient" ? "古代" : "現代"}經營投資規則</summary>
        <div>{investmentCatalog.map((item) => <section key={item.id}><h3>{item.name}</h3><p><b>{item.category}</b><span>投入：{item.capital}</span></p><p><b>週期／流動性</b><span>{item.returnCycle}／{item.liquidity}</span></p><p><b>風險</b><span>{item.principalRisk}</span></p><p><b>關係人</b><span>{item.stakeholders}</span></p></section>)}</div>
      </details>
      <div className="characterRelationNetwork" aria-label="目前人物關係">
        {data.relationships.map((relationship) => <article key={relationship.id}>
          <b>{names.get(relationship.fromCharacterId) ?? "未命名人物"}</b><span>{relationship.kind}</span><b>{names.get(relationship.toCharacterId) ?? "未命名人物"}</b>
          <p>{relationship.summary}</p><small>信任 {relationship.trust ?? "未設定"}</small>
          <button type="button" disabled={busy} onClick={() => void removeRelationship(relationship)}>移除</button>
        </article>)}
      </div>
    </section>
  );
}
