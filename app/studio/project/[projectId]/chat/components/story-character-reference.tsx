import type {
  Character,
  CharacterRelationship,
  NovelProject,
  World,
} from "@/lib/novel-ai/domain";
import { professionWorldContext } from "@/lib/novel-ai/game/character-profession";
import {
  CULTIVATION_REALMS,
  SECT_RANK_CATALOG,
  SPIRIT_ROOT_CATALOG,
  sectBranchCatalog,
  sectTechniqueCatalog,
} from "@/lib/novel-ai/game/cultivation-canon";
import CharacterPortraitImage from "../../character-portrait";
import styles from "../conversation.module.css";

function appearsInStory(content: string, character: Character) {
  const normalized = content.normalize("NFKC");
  return [character.name, ...character.aliases]
    .map((name) => name.normalize("NFKC").trim())
    .filter((name) => name.length >= 2)
    .some((name) => normalized.includes(name));
}

function trustLabel(trust: number | null) {
  if (trust === null) return "信任未明";
  if (trust >= 70) return `高度信任 ${trust}`;
  if (trust >= 30) return `偏向信任 ${trust}`;
  if (trust > -30) return `立場未定 ${trust}`;
  if (trust > -70) return `明顯敵意 ${trust}`;
  return `宿敵程度 ${trust}`;
}

function modernOrganizationType(identity: string) {
  if (/總統|總理|國家|外交|大使|軍方|情報/u.test(identity)) return "國家／跨國陣營";
  if (/政府|市府|公務|警察|檢察|議員|部長/u.test(identity)) return "政府／公共機構";
  if (/家主|繼承|接班|財團|家族企業/u.test(identity)) return "家族企業／財團";
  if (/幫會|堂主|勢力|社群|組織/u.test(identity)) return "勢力／社群組織";
  return "公司／現代組織";
}

export default function StoryCharacterReference({
  content,
  project,
  worlds,
  characters,
  relationships,
}: {
  content: string;
  project: NovelProject;
  worlds: World[];
  characters: Character[];
  relationships: CharacterRelationship[];
}) {
  const appeared = characters.filter((character) => appearsInStory(content, character)).slice(0, 8);
  if (!appeared.length) return null;

  const characterById = new Map(characters.map((character) => [character.id, character]));
  const context = professionWorldContext(project, worlds);
  const seed = project.proceduralRootSeed ?? project.id;
  const branches = sectBranchCatalog(seed);
  const techniques = sectTechniqueCatalog(seed);

  return (
    <details className={styles.storyCharacterReference} data-testid="story-character-reference">
      <summary>
        <span>本回合登場人物</span>
        <strong>{appeared.length} 人</strong>
        <small>展開策略資料</small>
      </summary>
      <p className={styles.storyCharacterReferenceNote}>僅列正式角色庫中的公開資料；私密祕密、未公開陰謀與角色不知道的情報不會顯示。</p>
      <div className={styles.storyCharacterGrid}>
        {appeared.map((character) => {
          const profile = character.cultivationProfile;
          const publicRelationships = relationships.filter((relationship) => (
            relationship.fromCharacterId === character.id || relationship.toCharacterId === character.id
          )).slice(0, 5);
          const identity = character.identity.value || "身分尚待確認";
          const realm = profile ? CULTIVATION_REALMS.find((item) => item.id === profile.realmId) : null;
          const root = profile ? SPIRIT_ROOT_CATALOG.find((item) => item.id === profile.spiritRootId) : null;
          const rank = profile ? SECT_RANK_CATALOG.find((item) => item.id === profile.sectRankId) : null;
          const branch = profile ? branches.find((item) => item.id === profile.sectBranchId) : null;
          const knownTechniques = profile
            ? techniques.filter((item) => profile.techniqueIds.includes(item.id))
            : [];
          return (
            <article key={character.id} className={styles.storyCharacterCard}>
              <header>
                {character.portrait
                  ? <CharacterPortraitImage portrait={character.portrait} className={styles.storyCharacterPortrait} />
                  : <span className={styles.storyCharacterInitial} aria-hidden="true">{character.name.slice(0, 1)}</span>}
                <div><h4>{character.name}</h4><p>{identity}</p></div>
              </header>
              {context !== "modern" && profile ? <dl>
                <div><dt>宗門身分</dt><dd>{rank?.name ?? "位階未明"}{branch ? ` · ${branch.name}` : ""}</dd></div>
                <div><dt>修為／靈根</dt><dd>{realm?.name ?? "境界未明"}{profile.realmStage ? ` ${profile.realmStage}` : ""} · {root?.name ?? "靈根未明"}</dd></div>
                <div><dt>已知功法</dt><dd>{knownTechniques.map((item) => item.name).join("、") || "尚未公開"}</dd></div>
              </dl> : <dl>
                <div><dt>組織類型</dt><dd>{modernOrganizationType(identity)}</dd></div>
                <div><dt>職業／職位</dt><dd>{identity}</dd></div>
              </dl>}
              <div className={styles.storyCharacterFacts}>
                <b>公開能力</b>
                <span>{character.capabilities?.slice(0, 4).join("、") || "尚無正式公開能力資料"}</span>
                {character.limitations?.length ? <><b>已知限制</b><span>{character.limitations.slice(0, 3).join("、")}</span></> : null}
              </div>
              {publicRelationships.length ? <ul className={styles.storyCharacterRelations}>
                {publicRelationships.map((relationship) => {
                  const counterpartId = relationship.fromCharacterId === character.id
                    ? relationship.toCharacterId
                    : relationship.fromCharacterId;
                  return <li key={relationship.id}><span>{relationship.kind}</span><b>{characterById.get(counterpartId)?.name ?? "未命名人物"}</b><small>{trustLabel(relationship.trust)}</small></li>;
                })}
              </ul> : <p className={styles.storyCharacterNoRelation}>尚無已核准的公開關係。</p>}
            </article>
          );
        })}
      </div>
    </details>
  );
}
