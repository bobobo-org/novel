export type AdultScenarioUsageRecord = {
  projectId: string;
  scenarioPackId: string;
  usedAt: string;
};

export type AdultScenarioFeedbackRecord = {
  projectId: string;
  scenarioPackId: string;
  rating: number;
  feedbackText?: string;
};

export type AdultScenarioVisibility = {
  favorite: boolean;
  hidden: boolean;
  excluded: boolean;
};
