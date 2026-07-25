export const KNOWLEDGE_SCOPES = [
  "PUBLIC",
  "AUTHOR_ONLY",
  "CHARACTER_KNOWN",
  "FACTION_KNOWN",
  "READER_KNOWN",
  "FUTURE_REVEAL",
] as const;

export type KnowledgeScope = typeof KNOWLEDGE_SCOPES[number];

export type KnowledgeScopeRule = {
  scope: KnowledgeScope;
  characterIds?: string[];
  factionIds?: string[];
  revealId?: string;
};

export type KnowledgeAccessContext = {
  characterId?: string;
  factionIds?: string[];
  isAuthor?: boolean;
  isReader?: boolean;
  revealedKnowledgeIds?: string[];
};

export function canAccessKnowledge(
  rule: KnowledgeScopeRule,
  context: KnowledgeAccessContext,
): boolean {
  switch (rule.scope) {
    case "PUBLIC":
      return true;
    case "AUTHOR_ONLY":
      return context.isAuthor === true;
    case "CHARACTER_KNOWN":
      return Boolean(context.characterId && rule.characterIds?.includes(context.characterId));
    case "FACTION_KNOWN":
      return Boolean(context.factionIds?.some((id) => rule.factionIds?.includes(id)));
    case "READER_KNOWN":
      return context.isReader === true || context.isAuthor === true;
    case "FUTURE_REVEAL":
      return Boolean(rule.revealId && context.revealedKnowledgeIds?.includes(rule.revealId));
  }
}
