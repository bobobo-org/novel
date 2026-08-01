/* eslint-disable @next/next/no-img-element */
import type { CharacterPortraitAsset } from "@/lib/novel-ai/domain";

export default function CharacterPortraitImage({
  portrait,
  className = "",
  decorative = false,
}: {
  portrait: CharacterPortraitAsset;
  className?: string;
  decorative?: boolean;
}) {
  const label = decorative ? "" : portrait.visualDescription;
  if (!portrait.atlas) {
    return (
      <img
        className={`characterPortraitImage ${className}`.trim()}
        src={portrait.assetUri}
        alt={label}
        loading="lazy"
        decoding="async"
        data-portrait-source={portrait.source}
      />
    );
  }

  const cellWidth = portrait.atlas.width / portrait.atlas.columns;
  const cellHeight = portrait.atlas.height / portrait.atlas.rows;
  const x = portrait.atlas.column * cellWidth;
  const y = portrait.atlas.row * cellHeight;
  return (
    <svg
      className={`characterPortraitImage ${className}`.trim()}
      viewBox={`${x} ${y} ${cellWidth} ${cellHeight}`}
      preserveAspectRatio="xMidYMid slice"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      data-portrait-source={portrait.source}
    >
      {decorative ? null : <title>{label}</title>}
      <image
        href={portrait.assetUri}
        x="0"
        y="0"
        width={portrait.atlas.width}
        height={portrait.atlas.height}
        preserveAspectRatio="none"
      />
    </svg>
  );
}
