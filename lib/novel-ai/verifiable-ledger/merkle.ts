import { sha256Hex } from "../closed-ai-cache";

export type MerkleProofItem = {
  hash: string;
  side: "left" | "right";
};

async function hashPair(left: string, right: string) {
  return sha256Hex(`merkle:${left}:${right}`);
}

export async function merkleRoot(leaves: string[]): Promise<string> {
  if (!leaves.length) return sha256Hex("merkle:empty");
  let level = await Promise.all(leaves.map((leaf) => sha256Hex(`leaf:${leaf}`)));
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] ?? left;
      next.push(await hashPair(left, right));
    }
    level = next;
  }
  return level[0];
}

export async function createMerkleProof(leaves: string[], leafIndex: number) {
  if (leafIndex < 0 || leafIndex >= leaves.length) {
    throw Object.assign(new Error("Merkle leaf index is out of range."), {
      code: "MERKLE_LEAF_INDEX_INVALID",
    });
  }
  let index = leafIndex;
  let level = await Promise.all(leaves.map((leaf) => sha256Hex(`leaf:${leaf}`)));
  const proof: MerkleProofItem[] = [];
  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    const sibling = level[siblingIndex] ?? level[index];
    proof.push({ hash: sibling, side: index % 2 === 0 ? "right" : "left" });
    const next: string[] = [];
    for (let cursor = 0; cursor < level.length; cursor += 2) {
      const left = level[cursor];
      const right = level[cursor + 1] ?? left;
      next.push(await hashPair(left, right));
    }
    index = Math.floor(index / 2);
    level = next;
  }
  return { root: level[0], proof };
}

export async function verifyMerkleProof(
  leaf: string,
  proof: MerkleProofItem[],
  expectedRoot: string,
) {
  let hash = await sha256Hex(`leaf:${leaf}`);
  for (const item of proof) {
    hash = item.side === "left"
      ? await hashPair(item.hash, hash)
      : await hashPair(hash, item.hash);
  }
  return hash === expectedRoot;
}
