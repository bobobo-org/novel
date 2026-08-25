export const SOCIAL_MATRIX_SCHEMA_VERSION = "novel-social-matrix-v1" as const;

export type SocialInstitutionKind = "宗門" | "門派" | "世家聯盟" | "商會" | "學宮" | "祕密結社";
export type SocialRelationshipKind = "血親" | "師徒" | "同門" | "盟友" | "競爭" | "債務" | "救命之恩" | "宿敵" | "監護" | "交易";
export type SocialPossessionKind =
  | "丹藥"
  | "藥丸"
  | "武器"
  | "符籙"
  | "陣法"
  | "特殊機緣"
  | "祕笈"
  | "信物"
  | "合約"
  | "道具"
  | "素材"
  | "設備"
  | "檔案"
  | "教材"
  | "器材"
  | "文件"
  | "憑證"
  | "研究資料"
  | "數據"
  | "資源"
  | "生醫製劑"
  | "航太模組"
  | "通行憑證"
  | "維生系統"
  | "異星樣本"
  | "藥材"
  | "兵器"
  | "文書"
  | "印信"
  | "輿圖"
  | "工具"
  | "證物"
  | "線索";

export type SocialMatrixPortrait = {
  source: "procedural-original-svg";
  dataUrl: string;
  palette: [string, string, string];
  description: string;
  storyLibraryVisualSeed: string;
};

export type SocialMatrixAbilities = {
  cultivation: number;
  martial: number;
  strategy: number;
  perception: number;
  medicine: number;
  crafting: number;
  leadership: number;
  influence: number;
  powerTier: "凡俗" | "初境" | "登堂" | "一方強者" | "宗師";
  specialties: string[];
};

export type SocialMatrixPersonality = {
  traits: string[];
  ambition: number;
  empathy: number;
  loyalty: number;
  caution: number;
  volatility: number;
  publicFace: string;
  privateNeed: string;
};

export type SocialMatrixRelationship = {
  relationshipId: string;
  targetCharacterId: string;
  kind: SocialRelationshipKind;
  directed: boolean;
  trust: number;
  tension: number;
  obligation: number;
  historyHook: string;
};

export type SocialMatrixRelationshipPair = {
  sourceCharacterId: string;
  targetCharacterId: string;
  forward: SocialMatrixRelationship | null;
  reverse: SocialMatrixRelationship | null;
  effectiveForward: SocialMatrixRelationship | null;
  effectiveReverse: SocialMatrixRelationship | null;
  reciprocity:
    | "EXACT_RECIPROCAL"
    | "SYNTHESIZED_RECIPROCAL"
    | "DIRECTED_NOT_REQUIRED"
    | "NO_RELATIONSHIP";
};

export type SocialMatrixPossession = {
  possessionId: string;
  treasureOrdinal: number;
  treasureRef: string;
  kind: SocialPossessionKind;
  rarity: "常見" | "稀有" | "珍品" | "傳承" | "唯一機緣";
  ownership: "持有" | "保管" | "借用" | "爭奪中" | "尚未認主";
  name: string;
  function: string;
  limitation: string;
  cost: string;
  storyHook: string;
};

export type SocialMatrixCharacter = {
  schemaVersion: typeof SOCIAL_MATRIX_SCHEMA_VERSION;
  characterId: string;
  populationIndex: number;
  fictional: true;
  originPolicy: "original-procedural-fiction-no-real-person-or-social-account";
  canonicalStatus: "VIRTUAL_CANDIDATE";
  storyProfileId: string;
  storyAffinity: string;
  name: string;
  pronouns: "她" | "他" | "其";
  age: number;
  lifeStage: "少年" | "青年" | "壯年" | "長者";
  institutionId: string;
  institutionRole: string;
  familyId: string;
  familyRole: string;
  location: string;
  identity: string;
  goal: string;
  secret: string;
  personality: SocialMatrixPersonality;
  abilities: SocialMatrixAbilities;
  relationships: SocialMatrixRelationship[];
  ownedTreasureCount: number;
  possessions: SocialMatrixPossession[];
  portrait: SocialMatrixPortrait;
};

export type SocialInstitution = {
  institutionId: string;
  institutionIndex: number;
  kind: SocialInstitutionKind;
  name: string;
  territory: string;
  doctrine: string;
  influence: number;
  publicGoal: string;
  hiddenConflict: string;
  allyInstitutionIds: string[];
  rivalInstitutionIds: string[];
  memberCount: number;
};

export type SocialFamily = {
  familyId: string;
  familyIndex: number;
  surname: string;
  name: string;
  home: string;
  reputation: string;
  inheritedTrait: string;
  institutionId: string;
  memberCount: number;
};

export type SocialMatrixPage<T> = {
  items: T[];
  nextCursor: string | null;
  total: number;
};

export type SocialCharacterCandidate = {
  schemaVersion: typeof SOCIAL_MATRIX_SCHEMA_VERSION;
  candidateId: string;
  projectId: string;
  character: SocialMatrixCharacter;
  payloadFingerprint: string;
  proposedAt: string;
  proposedBy: "closed-ai" | "rule-fallback" | "user";
  status: "PENDING_APPROVAL";
  canonicalMutation: 0;
  evidence: {
    generatorSeedTag: string;
    populationIndex: number;
    generatorVersion: typeof SOCIAL_MATRIX_SCHEMA_VERSION;
    storyLibraryVersion: "procedural-story-library-v1";
    ownershipIndexVersion: "procedural-treasure-ownership-v1";
    treasureClassificationVersion: "procedural-treasure-classification-v1";
    portraitSource: "procedural-original-svg";
  };
};

export type ApprovedSocialCharacter = Omit<SocialMatrixCharacter, "canonicalStatus"> & {
  canonicalStatus: "APPROVED";
  projectId: string;
  sourceCandidateId: string;
  payloadFingerprint: string;
  approvedAt: string;
  approvedBy: string;
};

export type SocialCharacterApproval = {
  approvalId: string;
  projectId: string;
  candidateId: string;
  payloadFingerprint: string;
  approvedAt: string;
  approvedBy: string;
  decision: "APPROVED";
  canonicalMutation: 1;
};
