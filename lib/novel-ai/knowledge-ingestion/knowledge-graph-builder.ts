import type { KnowledgeChunk } from "./types";

export type KnowledgeGraph = {
  nodes: Array<{ id: string; kind: "source" | "chunk" | "term"; label: string }>;
  edges: Array<{ from: string; to: string; kind: "contains" | "mentions" }>;
};

export function buildKnowledgeGraph(sourceId: string, chunks: KnowledgeChunk[], terms: string[]): KnowledgeGraph {
  const nodes: KnowledgeGraph["nodes"] = [{ id: sourceId, kind: "source", label: sourceId }];
  const edges: KnowledgeGraph["edges"] = [];
  for (const chunk of chunks) {
    nodes.push({ id: chunk.chunkId, kind: "chunk", label: chunk.text.slice(0, 80) });
    edges.push({ from: sourceId, to: chunk.chunkId, kind: "contains" });
    for (const term of terms.filter((value) => value && chunk.text.includes(value))) {
      const id = `term:${knowledgeGraphTermId(term)}`;
      if (!nodes.some((node) => node.id === id)) nodes.push({ id, kind: "term", label: term });
      edges.push({ from: chunk.chunkId, to: id, kind: "mentions" });
    }
  }
  return { nodes, edges };
}

function knowledgeGraphTermId(value: string) {
  return [...value].map((character) => character.codePointAt(0)?.toString(16)).join("-");
}
