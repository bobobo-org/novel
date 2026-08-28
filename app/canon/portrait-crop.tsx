"use client";

import type { CharacterPortraitAsset } from "@/lib/novel-ai/domain";
import { renderPortraitResource } from "./portrait-resource";

export default function PortraitCrop({
  portrait,
  className = "",
  decorative = false,
}: {
  portrait: CharacterPortraitAsset;
  className?: string;
  decorative?: boolean;
}) {
  const label = decorative ? "" : portrait.visualDescription;
  const filter = portrait.visualVariant
    ? `hue-rotate(${portrait.visualVariant.hueRotate}deg) saturate(${portrait.visualVariant.saturation}) brightness(${portrait.visualVariant.brightness}) contrast(${portrait.visualVariant.contrast})`
    : undefined;

  return renderPortraitResource({ portrait, className, label, decorative, filter });
}
