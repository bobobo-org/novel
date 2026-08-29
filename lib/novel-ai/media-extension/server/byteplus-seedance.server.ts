import "server-only";
import {
  BYTEPLUS_LAS_SEEDANCE_ENDPOINT,
  BYTEPLUS_SEEDANCE_MODEL,
  BytePlusSeedanceError,
  createBytePlusSeedanceAdapter,
} from "./byteplus-seedance-protocol";
import type { VideoJobDependencies } from "./video-job-service";
import { listVideoProviders } from "../video-provider-registry";
import { publicVideoWorkerServerStatus } from "./video-worker.server";

// No production durable job store or private validated MP4 artifact store exists yet.
// Keep this null until both are implemented; an API key alone must never make the UI ready.
const DURABLE_VIDEO_JOB_STORE: VideoJobDependencies["durableStore"] = null;
const VALIDATED_PRIVATE_VIDEO_ARTIFACT_STORE_CONFIGURED = false;
// The old LAS shape is retained only for regression tests. It is not proof of an
// official Seedance 2.5 API. Keep execution fail-closed until an official adapter
// is implemented and verified against the provider's published API contract.
const OFFICIAL_VIDEO_PROVIDER_ADAPTER_CONFIGURED = false;

type ServerEnvironment = Record<string, string | undefined>;

export function readBytePlusSeedanceServerConfiguration(environment: ServerEnvironment = process.env) {
  const apiKey = environment.BYTEPLUS_LAS_API_KEY?.trim() ?? "";
  const endpoint = (environment.BYTEPLUS_LAS_BASE_URL?.trim() || BYTEPLUS_LAS_SEEDANCE_ENDPOINT).replace(/\/$/u, "");
  const model = environment.BYTEPLUS_SEEDANCE_MODEL?.trim() || BYTEPLUS_SEEDANCE_MODEL;
  const allowlisted = endpoint === BYTEPLUS_LAS_SEEDANCE_ENDPOINT && model === BYTEPLUS_SEEDANCE_MODEL;
  return {
    apiKey,
    endpoint,
    model,
    credentialConfigured: Boolean(apiKey) && allowlisted,
  };
}

export function publicBytePlusSeedanceHealth(environment: ServerEnvironment = process.env) {
  const configuration = readBytePlusSeedanceServerConfiguration(environment);
  const selfHostedWorker = publicVideoWorkerServerStatus(environment);
  const credentialConfigured = configuration.credentialConfigured;
  const jobStoreConfigured = Boolean(DURABLE_VIDEO_JOB_STORE?.configured);
  const artifactStoreConfigured = VALIDATED_PRIVATE_VIDEO_ARTIFACT_STORE_CONFIGURED;
  return {
    schemaVersion: "novel-video-runtime-health-v2",
    configured: OFFICIAL_VIDEO_PROVIDER_ADAPTER_CONFIGURED
      && credentialConfigured
      && jobStoreConfigured
      && artifactStoreConfigured,
    executionProviderId: null,
    model: "no-official-video-model-connected",
    credentialConfigured,
    jobStoreConfigured,
    artifactStoreConfigured,
    executionBlockedReason: "OFFICIAL_VIDEO_PROVIDER_API_NOT_CONNECTED",
    providerRuntime: {
      bytePlusSeedance25: {
        contractImplemented: true,
        executionEnabled: false,
        credentialConfigured,
        model: configuration.model,
      },
      selfHostedWorker: {
        contractImplemented: true,
        executionEnabled: false,
        ...selfHostedWorker,
      },
    },
    providers: listVideoProviders(),
  } as const;
}

export function createBytePlusSeedanceServerAdapter(environment: ServerEnvironment = process.env) {
  const configuration = readBytePlusSeedanceServerConfiguration(environment);
  if (!configuration.credentialConfigured) {
    throw new BytePlusSeedanceError({
      code: "BYTEPLUS_CONFIGURATION_INVALID",
      message: "BytePlus 伺服器端設定不完整或不在允許清單中。",
      status: 503,
    });
  }
  return createBytePlusSeedanceAdapter({
    apiKey: configuration.apiKey,
    endpoint: configuration.endpoint,
    model: configuration.model,
  });
}

export function serverVideoJobDependencies(environment: ServerEnvironment = process.env): VideoJobDependencies {
  void environment;
  return {
    providerConfigured: OFFICIAL_VIDEO_PROVIDER_ADAPTER_CONFIGURED,
    executionProviderId: null,
    durableStore: DURABLE_VIDEO_JOB_STORE,
    artifactStoreConfigured: VALIDATED_PRIVATE_VIDEO_ARTIFACT_STORE_CONFIGURED,
    createAdapter: () => createBytePlusSeedanceServerAdapter(environment),
  };
}

// Same-origin checks reduce accidental cross-site calls but are not user authentication.
// Do not replace the null store until durable owner isolation and private artifact validation exist.
