import type { AiProviderCapabilities } from "../providers/provider-capabilities";
import type { AiStorageMode, AiTaskType, AiPrivacyMode } from "../providers/provider-types";

export type AiRouterInput = {
  taskType: AiTaskType;
  storageMode: AiStorageMode;
  requestedPrivacyMode?: AiPrivacyMode;
  allowExternalProvider?: boolean;
  fullOfflineRequired?: boolean;
  internetAvailable?: boolean;
  providerPreference?: string[];
  availableProviders: AiProviderCapabilities[];
  contextCharacters?: {
    chapter?: number;
    recent?: number;
    storyBible?: number;
    sourceExcerpts?: number;
  };
};
