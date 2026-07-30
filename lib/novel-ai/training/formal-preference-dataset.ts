import { sha256Hex, stableStringify } from "../closed-ai-cache/hashing";

export const FORMAL_PREFERENCE_DATASET_SCHEMA =
  "novel-formal-preference-dataset-v1" as const;

export type FormalPreferenceSample = {
  chosen: string;
  rejected: string;
};

export type FormalPreferenceDatasetManifest = {
  schemaVersion: typeof FORMAL_PREFERENCE_DATASET_SCHEMA;
  datasetId: string;
  datasetVersion: string;
  projectId: string;
  baseModelId: string;
  purpose: "private_story_personalization";
  ownerScope: "project_private";
  rightsBasis: "author_owned_or_explicitly_licensed";
  rightsConfirmed: true;
  humanApproved: true;
  sampleCount: number;
  datasetDigest: string;
  sampleDigests: Array<{ chosen: string; rejected: string }>;
  qualityGates: {
    minimumPairs: true;
    distinctPairs: true;
    credentialScanPassed: true;
    projectIsolationPassed: true;
  };
  privacy: {
    rawSamplesStored: false;
    rawSamplesReturned: false;
    externalRequest: false;
    dataLeftDevice: false;
    chainOfThoughtStored: false;
  };
  createdAt: string;
  status: "sealed";
  manifestHash: string;
};

const CREDENTIAL_PATTERN =
  /(?:\b(?:vcp|sbp|sk)_[A-Za-z0-9_-]{12,}\b|bearer\s+[A-Za-z0-9._-]{12,}|password\s*[:=]|cookie\s*[:=]|-----BEGIN [A-Z ]+PRIVATE KEY-----)/iu;

function normalizeSampleText(value: string) {
  return value.normalize("NFKC").replace(/\r\n?/gu, "\n").trim();
}

export async function digestPreferenceSamples(samples: FormalPreferenceSample[]) {
  const sampleDigests = await Promise.all(samples.map(async (sample) => ({
    chosen: await sha256Hex(normalizeSampleText(sample.chosen)),
    rejected: await sha256Hex(normalizeSampleText(sample.rejected)),
  })));
  return {
    sampleDigests,
    datasetDigest: await sha256Hex(stableStringify(sampleDigests)),
  };
}

export async function sealFormalPreferenceDataset(input: {
  projectId: string;
  baseModelId: string;
  datasetVersion: string;
  samples: FormalPreferenceSample[];
  rightsConfirmed: boolean;
  createdAt?: string;
}): Promise<FormalPreferenceDatasetManifest> {
  if (!input.rightsConfirmed) {
    throw Object.assign(new Error("必須先確認訓練文字的所有權或授權。"), {
      code: "TRAINING_RIGHTS_CONFIRMATION_REQUIRED",
    });
  }
  if (input.samples.length < 2) {
    throw Object.assign(new Error("正式訓練資料集至少需要兩組偏好對照。"), {
      code: "OFFLINE_TRAINING_SAMPLE_MINIMUM",
    });
  }
  const samples = input.samples.map((sample) => ({
    chosen: normalizeSampleText(sample.chosen),
    rejected: normalizeSampleText(sample.rejected),
  }));
  if (samples.some((sample) =>
    sample.chosen.length < 8
    || sample.rejected.length < 8
    || sample.chosen === sample.rejected)) {
    throw Object.assign(new Error("偏好對照必須不同，且每段至少 8 個字元。"), {
      code: "OFFLINE_TRAINING_SAMPLE_INVALID",
    });
  }
  if (samples.some((sample) =>
    CREDENTIAL_PATTERN.test(`${sample.chosen}\n${sample.rejected}`))) {
    throw Object.assign(new Error("訓練文字疑似包含憑證或密鑰，已阻擋封印。"), {
      code: "TRAINING_CREDENTIAL_INPUT_BLOCKED",
    });
  }
  const { sampleDigests, datasetDigest } = await digestPreferenceSamples(samples);
  const pairKeys = sampleDigests.map((sample) => `${sample.chosen}:${sample.rejected}`);
  if (new Set(pairKeys).size !== pairKeys.length) {
    throw Object.assign(new Error("正式訓練資料集含重複對照。"), {
      code: "DATASET_DUPLICATE_EXAMPLES",
    });
  }
  const createdAt = input.createdAt ?? new Date().toISOString();
  const body = {
    schemaVersion: FORMAL_PREFERENCE_DATASET_SCHEMA,
    datasetId: `preference-${input.projectId}-${datasetDigest.slice(0, 16)}`,
    datasetVersion: input.datasetVersion,
    projectId: input.projectId,
    baseModelId: input.baseModelId,
    purpose: "private_story_personalization",
    ownerScope: "project_private",
    rightsBasis: "author_owned_or_explicitly_licensed",
    rightsConfirmed: true,
    humanApproved: true,
    sampleCount: samples.length,
    datasetDigest,
    sampleDigests,
    qualityGates: {
      minimumPairs: true,
      distinctPairs: true,
      credentialScanPassed: true,
      projectIsolationPassed: true,
    },
    privacy: {
      rawSamplesStored: false,
      rawSamplesReturned: false,
      externalRequest: false,
      dataLeftDevice: false,
      chainOfThoughtStored: false,
    },
    createdAt,
    status: "sealed",
  } as const;
  return {
    ...body,
    manifestHash: await sha256Hex(stableStringify(body)),
  };
}

export async function verifyFormalPreferenceDataset(
  manifest: FormalPreferenceDatasetManifest,
  samples?: FormalPreferenceSample[],
) {
  const { manifestHash, ...body } = manifest;
  if (
    manifest.schemaVersion !== FORMAL_PREFERENCE_DATASET_SCHEMA
    || manifest.status !== "sealed"
    || manifest.rightsConfirmed !== true
    || manifest.humanApproved !== true
    || manifest.sampleCount < 2
    || manifest.privacy.rawSamplesStored
    || manifest.privacy.externalRequest
    || manifest.privacy.dataLeftDevice
  ) {
    return false;
  }
  if (manifestHash !== await sha256Hex(stableStringify(body))) return false;
  if (!samples) return true;
  const digests = await digestPreferenceSamples(samples);
  return manifest.sampleCount === samples.length
    && manifest.datasetDigest === digests.datasetDigest
    && stableStringify(manifest.sampleDigests) === stableStringify(digests.sampleDigests);
}
