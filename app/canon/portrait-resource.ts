import { createElement, type CSSProperties } from "react";
import type { CharacterPortraitAsset } from "@/lib/novel-ai/domain";

export function renderPortraitResource({
  portrait,
  className,
  label,
  decorative,
  filter,
}: {
  portrait: CharacterPortraitAsset;
  className: string;
  label: string;
  decorative: boolean;
  filter?: CSSProperties["filter"];
}) {
  const style = filter ? { filter } : undefined;
  if (!portrait.atlas) {
    return createElement("img", {
      className,
      src: portrait.assetUri,
      alt: label,
      loading: "lazy",
      decoding: "async",
      "data-portrait-resource": portrait.assetUri,
      style,
    });
  }

  const cellWidth = portrait.atlas.width / portrait.atlas.columns;
  const cellHeight = portrait.atlas.height / portrait.atlas.rows;
  const x = portrait.atlas.column * cellWidth;
  const y = portrait.atlas.row * cellHeight;
  return createElement(
    "svg",
    {
      className,
      viewBox: `${x} ${y} ${cellWidth} ${cellHeight}`,
      preserveAspectRatio: "xMidYMid slice",
      role: decorative ? undefined : "img",
      "aria-hidden": decorative || undefined,
      "aria-label": decorative ? undefined : label,
      "data-portrait-resource": portrait.assetUri,
      "data-portrait-atlas-cell": `${portrait.atlas.row}:${portrait.atlas.column}`,
    },
    decorative ? null : createElement("title", null, label),
    createElement("rect", { x, y, width: cellWidth, height: cellHeight, fill: "#13233a" }),
    createElement("image", {
      href: portrait.assetUri,
      x: 0,
      y: 0,
      width: portrait.atlas.width,
      height: portrait.atlas.height,
      preserveAspectRatio: "none",
      style,
    }),
  );
}
