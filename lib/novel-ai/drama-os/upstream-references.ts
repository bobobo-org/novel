import { z } from "zod";

export const PRODUCT_LOOP_REFERENCE_SCHEMA_VERSION = "product-loop-reference-v1" as const;

export const upstreamReferenceStatusSchema = z.enum([
  "CURRENT",
  "STALE",
  "DEFERRED",
  "NOT_APPLICABLE",
]);

export const upstreamReferenceSourceSchema = z.enum([
  "user",
  "ai_candidate",
  "migration",
  "system",
]);

export const upstreamReferenceSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().uuid(),
  revision: z.number().int().positive(),
  status: upstreamReferenceStatusSchema,
  source: upstreamReferenceSourceSchema,
  updatedAt: z.string().datetime(),
}).strict();

export type UpstreamReferenceStatus = z.infer<typeof upstreamReferenceStatusSchema>;
export type UpstreamReferenceSource = z.infer<typeof upstreamReferenceSourceSchema>;
export type ProductLoopReference = z.infer<typeof upstreamReferenceSchema>;

export type CreationPreferenceReference = ProductLoopReference;
export type StoryBlueprintReference = ProductLoopReference;
export type WorldStateReference = ProductLoopReference;
export type CharacterStateReference = ProductLoopReference;
export type CharacterKnowledgeScopeReference = ProductLoopReference;
export type NarrativePlanReference = ProductLoopReference;
export type ProposalReference = ProductLoopReference;
export type PublicationProjectionReference = ProductLoopReference;

export type DramaUpstreamReferences = {
  creationPreferenceRef?: CreationPreferenceReference;
  storyBlueprintRef?: StoryBlueprintReference;
  worldStateRefs?: WorldStateReference[];
  characterStateRefs?: CharacterStateReference[];
  narrativePlanRef?: NarrativePlanReference;
};

export function collectDramaUpstreamReferences(input: DramaUpstreamReferences): ProductLoopReference[] {
  return [
    input.creationPreferenceRef,
    input.storyBlueprintRef,
    ...(input.worldStateRefs ?? []),
    ...(input.characterStateRefs ?? []),
    input.narrativePlanRef,
  ].filter((reference): reference is ProductLoopReference => reference !== undefined);
}

export function findStaleUpstreamReferenceIds(
  input: DramaUpstreamReferences,
  currentReferenceRevisions: Readonly<Record<string, number>> = {},
): string[] {
  return collectDramaUpstreamReferences(input)
    .filter((reference) => (
      reference.status === "STALE"
      || (
        currentReferenceRevisions[reference.id] !== undefined
        && currentReferenceRevisions[reference.id] !== reference.revision
      )
    ))
    .map((reference) => reference.id);
}

export function validateUpstreamReference(input: unknown) {
  return upstreamReferenceSchema.safeParse(input);
}
