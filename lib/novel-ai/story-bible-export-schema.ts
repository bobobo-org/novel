import { z } from "zod";

export const STORY_BIBLE_EXPORT_FORMAT = "novel-story-bible-history-package";
export const STORY_BIBLE_EXPORT_FORMAT_VERSION = "1.0.0";
export const STORY_BIBLE_EXPORT_MIME = "application/vnd.novel-story-bible-history+json";
export const STORY_BIBLE_EXPORT_MIGRATION_VERSION = "p0c2c2c_history_export_010";

const BooleanQuerySchema = z.preprocess((value) => {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["false", "0", "no", "off"].includes(normalized)) return false;
    if (["true", "1", "yes", "on"].includes(normalized)) return true;
  }
  return value;
}, z.coerce.boolean());

export const StoryBibleExportQuerySchema = z.object({
  projectId: z.string().min(1).max(120),
  fromVersionNumber: z.coerce.number().int().min(1).optional(),
  toVersionNumber: z.coerce.number().int().min(1).optional(),
  includeCurrentCanonical: BooleanQuerySchema.default(true),
  includeCandidates: BooleanQuerySchema.default(true),
  includeConflicts: BooleanQuerySchema.default(true),
  includeSources: BooleanQuerySchema.default(true),
  includeMutationRequests: BooleanQuerySchema.default(true),
  includeEntityHistory: BooleanQuerySchema.default(false),
  includeFieldHistory: BooleanQuerySchema.default(false),
  includeChapterText: BooleanQuerySchema.default(false),
  includeSourceExcerpts: BooleanQuerySchema.default(true),
  includeDiagnostics: BooleanQuerySchema.default(false),
  pretty: BooleanQuerySchema.default(false),
  download: BooleanQuerySchema.default(false),
});

export const StoryBibleExportPreviewSchema = StoryBibleExportQuerySchema.omit({
  pretty: true,
  download: true,
}).extend({
  pretty: BooleanQuerySchema.default(false).optional(),
  download: BooleanQuerySchema.default(false).optional(),
});

export type StoryBibleExportOptions = z.infer<typeof StoryBibleExportQuerySchema>;
export type StoryBibleExportPreviewOptions = z.infer<typeof StoryBibleExportPreviewSchema>;

export class StoryBibleExportError extends Error {
  constructor(
    public errorCode: string,
    message: string,
    public status = 400,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "StoryBibleExportError";
  }
}

export type StoryBibleExportPackage = {
  format: typeof STORY_BIBLE_EXPORT_FORMAT;
  formatVersion: typeof STORY_BIBLE_EXPORT_FORMAT_VERSION;
  packageId: string;
  exportedAt: string;
  exportOptions: Record<string, unknown>;
  project: Record<string, unknown>;
  authority: Record<string, unknown>;
  schemaVersions: Record<string, unknown>;
  versionRange: Record<string, unknown>;
  currentVersion: Record<string, unknown> | null;
  manifest: Record<string, unknown>;
  versions: Array<Record<string, unknown>>;
  changeSets: Array<Record<string, unknown>>;
  canonicalEntities: Record<string, Array<Record<string, unknown>>>;
  candidates: Array<Record<string, unknown>>;
  conflicts: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  mutationRequests: Array<Record<string, unknown>>;
  provenance: Array<Record<string, unknown>>;
  integrity: Record<string, unknown>;
  compatibility: Record<string, unknown>;
  hashes: Record<string, string>;
};
