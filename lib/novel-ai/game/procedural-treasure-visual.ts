import {
  PROCEDURAL_TREASURE_KIND_DEFINITIONS,
  PROCEDURAL_TREASURE_RARITY_DEFINITIONS,
  type ProceduralTreasureKind,
  type ProceduralTreasureRarity,
} from "./procedural-treasure-classification";
import type { ProceduralTreasureEra } from "./procedural-treasure-era";

export const PROCEDURAL_TREASURE_VISUAL_VERSION =
  "procedural-treasure-visual-v1" as const;
export const PROCEDURAL_TREASURE_VISUAL_VARIANTS_PER_ASSET = 96 as const;

export const PROCEDURAL_TREASURE_ELEMENT_DEFINITIONS = [
  { id: "metal", label: "金", primary: "#f2cf79", secondary: "#8a6a29", hueRotate: 42 },
  { id: "wood", label: "木", primary: "#75d58a", secondary: "#26754c", hueRotate: 348 },
  { id: "water", label: "水", primary: "#70d8f4", secondary: "#246da5", hueRotate: 0 },
  { id: "fire", label: "火", primary: "#ff846d", secondary: "#a63a33", hueRotate: 132 },
  { id: "earth", label: "土", primary: "#d7ad72", secondary: "#755333", hueRotate: 72 },
  { id: "wind", label: "風", primary: "#82e5ce", secondary: "#328e83", hueRotate: 326 },
  { id: "lightning", label: "雷", primary: "#bd8cff", secondary: "#6642b4", hueRotate: 72 },
  { id: "ice", label: "冰", primary: "#c1efff", secondary: "#5f9fc4", hueRotate: 8 },
  { id: "light", label: "光", primary: "#fff0a3", secondary: "#c8943f", hueRotate: 48 },
  { id: "shadow", label: "影", primary: "#b4a1d8", secondary: "#51446f", hueRotate: 86 },
] as const;

export type ProceduralTreasureElement =
  (typeof PROCEDURAL_TREASURE_ELEMENT_DEFINITIONS)[number]["id"];

type RarityPalette = {
  border: string;
  glow: string;
  badgeBackground: string;
  badgeText: string;
  frameBackground: string;
  brightness: number;
  saturation: number;
};

const RARITY_PALETTES: Record<ProceduralTreasureRarity, RarityPalette> = {
  common: {
    border: "#8095a5",
    glow: "rgba(128, 149, 165, .28)",
    badgeBackground: "#334552",
    badgeText: "#e1e9ee",
    frameBackground: "rgba(25, 43, 57, .88)",
    brightness: 0.92,
    saturation: 0.88,
  },
  uncommon: {
    border: "#58c994",
    glow: "rgba(88, 201, 148, .36)",
    badgeBackground: "#185b43",
    badgeText: "#d9ffec",
    frameBackground: "rgba(14, 57, 47, .9)",
    brightness: 0.98,
    saturation: 1,
  },
  rare: {
    border: "#5c9cff",
    glow: "rgba(75, 139, 255, .45)",
    badgeBackground: "#204e91",
    badgeText: "#e5f0ff",
    frameBackground: "rgba(17, 45, 84, .92)",
    brightness: 1.03,
    saturation: 1.08,
  },
  epic: {
    border: "#b37aff",
    glow: "rgba(165, 102, 255, .52)",
    badgeBackground: "#603696",
    badgeText: "#f4e8ff",
    frameBackground: "rgba(55, 28, 83, .93)",
    brightness: 1.08,
    saturation: 1.16,
  },
  legendary: {
    border: "#ffb84f",
    glow: "rgba(255, 168, 49, .62)",
    badgeBackground: "#8b5313",
    badgeText: "#fff2cf",
    frameBackground: "rgba(84, 49, 14, .94)",
    brightness: 1.13,
    saturation: 1.24,
  },
  mythic: {
    border: "#fff0a8",
    glow: "rgba(255, 112, 213, .72)",
    badgeBackground: "linear-gradient(135deg, #8c3f95, #a36a17)",
    badgeText: "#fffbe7",
    frameBackground: "linear-gradient(145deg, rgba(88, 35, 95, .95), rgba(91, 57, 13, .95))",
    brightness: 1.18,
    saturation: 1.34,
  },
};

const ANCIENT_ASSET_BY_KIND: Record<ProceduralTreasureKind, string> = {
  weapon: "/item-icons/weapon.webp",
  artifact: "/item-icons/artifact.webp",
  talisman: "/item-icons/talisman.webp",
  pill: "/item-icons/pill.webp",
  herb: "/item-icons/herb.webp",
  formation: "/item-icons/formation.webp",
  armor: "/item-icons/armor.webp",
  material: "/item-icons/material.webp",
  manual: "/item-icons/manual.webp",
  "special-opportunity": "/item-icons/special-opportunity.webp",
};

const MODERN_ASSETS = {
  weapon: "/item-icons/modern-weapon.webp",
  medicine: "/item-icons/modern-medicine.webp",
  electronics: "/item-icons/modern-electronics.webp",
  communications: "/item-icons/modern-communications.webp",
  vehicle: "/item-icons/modern-vehicle.webp",
  tool: "/item-icons/modern-tool.webp",
  lab: "/item-icons/modern-lab.webp",
  credential: "/item-icons/modern-credential.webp",
} as const;

function technologyAssetFor(kind: ProceduralTreasureKind, subtype: string) {
  if (kind === "weapon") return MODERN_ASSETS.weapon;
  if (kind === "pill") return MODERN_ASSETS.medicine;
  if (kind === "herb") return MODERN_ASSETS.lab;
  if (kind === "talisman") return /證|通行|身分|門禁/iu.test(subtype)
    ? MODERN_ASSETS.credential
    : MODERN_ASSETS.communications;
  if (kind === "manual") return MODERN_ASSETS.credential;
  if (kind === "special-opportunity") return MODERN_ASSETS.vehicle;
  if (kind === "armor") return MODERN_ASSETS.tool;
  if (kind === "material") return /晶|半導體|量子|超導|電子/iu.test(subtype)
    ? MODERN_ASSETS.electronics
    : MODERN_ASSETS.tool;
  if (kind === "formation") return MODERN_ASSETS.electronics;
  return /實驗|分析|感測|顯微|樣本/iu.test(subtype)
    ? MODERN_ASSETS.lab
    : MODERN_ASSETS.electronics;
}

function baseAssetFor(input: {
  kind: ProceduralTreasureKind;
  subtype: string;
  era: ProceduralTreasureEra;
}) {
  if (input.era === "ancient") return ANCIENT_ASSET_BY_KIND[input.kind];
  if (input.era === "early-modern") {
    if (input.kind === "artifact" && /顯微|測距|儀/iu.test(input.subtype)) return MODERN_ASSETS.lab;
    if (input.kind === "talisman" && /證|通行|公文/iu.test(input.subtype)) return MODERN_ASSETS.credential;
  }
  return technologyAssetFor(input.kind, input.subtype);
}

function hashText(value: string) {
  let hash = 0x811c9dc5;
  for (const character of value.normalize("NFKC")) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export type ProceduralTreasureVisual = {
  schemaVersion: typeof PROCEDURAL_TREASURE_VISUAL_VERSION;
  baseAsset: string;
  assetCount: 18;
  assetTheme: "ancient" | "industrial" | "modern" | "future";
  variant: number;
  variantsPerAsset: typeof PROCEDURAL_TREASURE_VISUAL_VARIANTS_PER_ASSET;
  kind: ProceduralTreasureKind;
  kindLabel: string;
  rarity: ProceduralTreasureRarity;
  rarityLabel: string;
  era: ProceduralTreasureEra;
  eraLabel: string;
  eraOverlayLabel: string;
  isCrossEra: boolean;
  subtype?: string;
  element: ProceduralTreasureElement;
  elementLabel: string;
  palette: RarityPalette & {
    elementPrimary: string;
    elementSecondary: string;
  };
  transform: {
    rotationDeg: number;
    scale: number;
    offsetXPercent: number;
    offsetYPercent: number;
    mirrored: boolean;
    hueRotateDeg: number;
  };
  alt: string;
};

export function proceduralTreasureVisualAt(input: {
  storySeed: string;
  treasureId: string;
  ordinal: number;
  kind: ProceduralTreasureKind;
  subtype?: string;
  rarity: ProceduralTreasureRarity;
  era: ProceduralTreasureEra;
  eraLabel: string;
  isCrossEra: boolean;
}): ProceduralTreasureVisual {
  if (!input.storySeed.trim()) throw new Error("TREASURE_VISUAL_STORY_SEED_REQUIRED");
  if (!input.treasureId.trim()) throw new Error("TREASURE_VISUAL_ID_REQUIRED");
  if (!Number.isSafeInteger(input.ordinal) || input.ordinal < 0) {
    throw new RangeError(`TREASURE_VISUAL_ORDINAL_INVALID:${input.ordinal}`);
  }
  const kind = PROCEDURAL_TREASURE_KIND_DEFINITIONS.find(
    (candidate) => candidate.id === input.kind,
  );
  const rarity = PROCEDURAL_TREASURE_RARITY_DEFINITIONS.find(
    (candidate) => candidate.id === input.rarity,
  );
  if (!kind) throw new Error(`TREASURE_VISUAL_KIND_INVALID:${input.kind}`);
  if (!rarity) throw new Error(`TREASURE_VISUAL_RARITY_INVALID:${input.rarity}`);

  const visualHash = hashText(
    `${input.storySeed}|${input.treasureId}|${input.ordinal}|${input.kind}|${input.subtype ?? ""}|${input.era}|visual`,
  );
  const variant = visualHash % PROCEDURAL_TREASURE_VISUAL_VARIANTS_PER_ASSET;
  const element = PROCEDURAL_TREASURE_ELEMENT_DEFINITIONS[
    Math.floor(visualHash / PROCEDURAL_TREASURE_VISUAL_VARIANTS_PER_ASSET)
      % PROCEDURAL_TREASURE_ELEMENT_DEFINITIONS.length
  ];
  const rarityPalette = RARITY_PALETTES[input.rarity];
  const eraHueOffset: Record<ProceduralTreasureEra, number> = {
    ancient: 0,
    "early-modern": 18,
    modern: 44,
    future: 88,
  };
  return {
    schemaVersion: PROCEDURAL_TREASURE_VISUAL_VERSION,
    baseAsset: baseAssetFor({ kind: input.kind, subtype: input.subtype ?? "", era: input.era }),
    assetCount: 18,
    assetTheme: input.era === "ancient"
      ? "ancient"
      : input.era === "early-modern"
        ? "industrial"
        : input.era,
    variant,
    variantsPerAsset: PROCEDURAL_TREASURE_VISUAL_VARIANTS_PER_ASSET,
    kind: input.kind,
    subtype: input.subtype,
    kindLabel: kind.label,
    rarity: input.rarity,
    rarityLabel: rarity.label,
    era: input.era,
    eraLabel: input.eraLabel,
    eraOverlayLabel: input.isCrossEra ? `跨時代 · ${input.eraLabel}` : input.eraLabel,
    isCrossEra: input.isCrossEra,
    element: element.id,
    elementLabel: element.label,
    palette: {
      ...rarityPalette,
      elementPrimary: element.primary,
      elementSecondary: element.secondary,
    },
    transform: {
      rotationDeg: ((variant % 9) - 4) * 1.4,
      scale: 0.94 + (Math.floor(variant / 9) % 7) * 0.012,
      offsetXPercent: ((variant * 7) % 11) - 5,
      offsetYPercent: ((variant * 13) % 9) - 4,
      mirrored: Math.floor(variant / 63) % 2 === 1,
      hueRotateDeg: element.hueRotate + eraHueOffset[input.era] + (variant % 5) * 3,
    },
    alt: `${input.isCrossEra ? "跨時代" : ""}${input.eraLabel}${rarity.label}${element.label}屬性${kind.label}圖案`,
  };
}

export function proceduralTreasureVisualCssVariables(
  visual: ProceduralTreasureVisual,
) {
  return {
    "--treasure-border": visual.palette.border,
    "--treasure-glow": visual.palette.glow,
    "--treasure-badge-bg": visual.palette.badgeBackground,
    "--treasure-badge-text": visual.palette.badgeText,
    "--treasure-frame-bg": visual.palette.frameBackground,
    "--treasure-element-primary": visual.palette.elementPrimary,
    "--treasure-element-secondary": visual.palette.elementSecondary,
    "--treasure-brightness": String(visual.palette.brightness),
    "--treasure-saturation": String(visual.palette.saturation),
    "--treasure-rotation": `${visual.transform.rotationDeg}deg`,
    "--treasure-scale-x": visual.transform.mirrored
      ? String(-visual.transform.scale)
      : String(visual.transform.scale),
    "--treasure-scale-y": String(visual.transform.scale),
    "--treasure-offset-x": `${visual.transform.offsetXPercent}%`,
    "--treasure-offset-y": `${visual.transform.offsetYPercent}%`,
    "--treasure-hue": `${visual.transform.hueRotateDeg}deg`,
  } as const;
}
