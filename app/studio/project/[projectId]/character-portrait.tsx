"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
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
  const atlasRef = useRef<SVGSVGElement>(null);
  const [atlasVisible, setAtlasVisible] = useState(false);
  const label = decorative ? "" : portrait.visualDescription;
  const variantFilter = portrait.visualVariant
    ? `hue-rotate(${portrait.visualVariant.hueRotate}deg) saturate(${portrait.visualVariant.saturation}) brightness(${portrait.visualVariant.brightness}) contrast(${portrait.visualVariant.contrast})`
    : undefined;

  useEffect(() => {
    if (!portrait.atlas || atlasVisible) return;
    const element = atlasRef.current;
    if (!element || !("IntersectionObserver" in window)) {
      setAtlasVisible(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setAtlasVisible(true);
      observer.disconnect();
    }, { rootMargin: "320px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [atlasVisible, portrait.atlas]);

  if (!portrait.atlas) {
    return (
      <img
        className={`characterPortraitImage ${className}`.trim()}
        src={portrait.assetUri}
        alt={label}
        width={96}
        height={96}
        loading="lazy"
        decoding="async"
        data-portrait-source={portrait.source}
        style={variantFilter ? { filter: variantFilter } : undefined}
      />
    );
  }

  const cellWidth = portrait.atlas.width / portrait.atlas.columns;
  const cellHeight = portrait.atlas.height / portrait.atlas.rows;
  const x = portrait.atlas.column * cellWidth;
  const y = portrait.atlas.row * cellHeight;
  return (
    <svg
      ref={atlasRef}
      className={`characterPortraitImage ${className}`.trim()}
      viewBox={`${x} ${y} ${cellWidth} ${cellHeight}`}
      preserveAspectRatio="xMidYMid slice"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      data-portrait-source={portrait.source}
    >
      {decorative ? null : <title>{label}</title>}
      <rect x={x} y={y} width={cellWidth} height={cellHeight} fill="#18283c" />
      {atlasVisible ? <image
        href={portrait.assetUri}
        x="0"
        y="0"
        width={portrait.atlas.width}
        height={portrait.atlas.height}
        preserveAspectRatio="none"
        style={variantFilter ? { filter: variantFilter } : undefined}
      /> : null}
    </svg>
  );
}
