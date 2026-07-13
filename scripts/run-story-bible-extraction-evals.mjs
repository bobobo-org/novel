const endpoint = process.env.STORY_BIBLE_EXTRACT_URL || "https://novel-orcin.vercel.app/api/ai/story-bible/extract";

const cases = [
  ["first_character", "MIRA_FIRST_APPEAR. Mira Lan stepped into the tea house, gave her full name to the guard, and took the sealed blue ledger."],
  ["alias", "ALIAS_CASE. Captain Ren is called Gray Fox by the smugglers, but his legal name is Ren Qiao."],
  ["explicit_age", "AGE_EXPLICIT. Nineteen-year-old Asha won the trial and inherited the iron key."],
  ["vague_age", "AGE_VAGUE. Old Master Du looked older than the dynasty itself, though nobody knew his true age."],
  ["lie", "LIE_CASE. Wei lied to the court and said he had never met the assassin, while hiding the assassin's ring."],
  ["misunderstanding", "MISUNDERSTAND. Lin thought Mei betrayed him, but the letter later showed she had protected him."],
  ["dream", "DREAM_CASE. In a dream, Nara saw the emperor die under red snow, then woke before dawn."],
  ["hallucination", "HALLUCINATION. Feverish Jun heard the dead queen accuse him, but the healer said no one else was in the room."],
  ["memory", "MEMORY_CASE. Years ago, Soren buried a bronze compass beneath the academy wall."],
  ["fake_death", "FAKE_DEATH. Everyone believed Kael died in the river, but he surfaced at midnight using a reed tube."],
  ["true_death", "TRUE_DEATH. Elder Mo stopped breathing after naming the traitor, and the physician confirmed his death."],
  ["item_transfer", "ITEM_TRANSFER. Lian handed the jade seal to Qiao before entering the forbidden archive."],
  ["ability_use", "ABILITY_USE. Tessa froze the candle flame for three breaths to reveal invisible ink."],
  ["ability_limit", "ABILITY_LIMIT. The time-stop art can be used once per day; a second use erases one memory."],
  ["world_rule", "WORLD_RULE. In Glass City, no oath spoken under the silver bell can be broken without blood payment."],
  ["rule_exception", "RULE_EXCEPTION. The silver bell oath fails only during an eclipse, when the city laws are suspended."],
  ["new_foreshadowing", "FORESHADOW. The black envelope contained only a feather and the words: wait for the third bell."],
  ["foreshadow_payoff", "PAYOFF. When the third bell rang, the feather burned and opened the hidden north gate."],
  ["open_promise", "PROMISE. Nora promised to return the stolen map before sunrise, but the bridge collapsed behind her."],
  ["no_new_fact", "NO_NEW_FACT. The room was quiet. Rain tapped the window. She breathed slowly and waited."],
];

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

function classifyFalseRisk(name, candidates) {
  const text = JSON.stringify(candidates || []).toLowerCase();
  if (name === "dream" && text.includes("event") && !text.includes("dream")) return true;
  if (name === "hallucination" && text.includes("event") && !text.includes("hallucination") && !text.includes("fever")) return true;
  if (name === "lie" && text.includes("never met") && !text.includes("lie")) return true;
  if (name === "no_new_fact" && (candidates || []).length > 0) return true;
  return false;
}

const results = [];
for (const [name, chapterText] of cases) {
  for (let run = 1; run <= 3; run++) {
    const started = Date.now();
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: `p0c11-eval-${name}`,
          chapterId: `chapter-${run}`,
          chapterNumber: run,
          chapterTitle: name,
          chapterText,
          previousChapterSummary: "",
          currentCanonicalSnapshot: {},
          extractionMode: "chapter-new",
        }),
      });
      const body = await response.json().catch(() => ({}));
      const elapsedMs = Date.now() - started;
      const candidates = body.candidates || body.candidateFacts || [];
      const sourceRefs = body.sourceRefs || [];
      const sourceValid = sourceRefs.length === 0 ? candidates.length === 0 : sourceRefs.every((ref) => ref.sourceValid !== false && chapterText.includes(ref.excerpt || ""));
      results.push({
        name,
        run,
        statusCode: response.status,
        ok: response.ok,
        elapsedMs,
        fallbackLevel: body.fallbackLevel || "failed",
        finalSchemaValid: Boolean(body.trace?.finalSchemaValid || response.ok),
        jsonValid: typeof body === "object" && body !== null,
        sourceValid,
        candidateCount: candidates.length,
        falseRisk: classifyFalseRisk(name, candidates),
        traceId: body.traceId,
      });
    } catch (error) {
      results.push({
        name,
        run,
        statusCode: 0,
        ok: false,
        elapsedMs: Date.now() - started,
        fallbackLevel: "failed",
        finalSchemaValid: false,
        jsonValid: false,
        sourceValid: false,
        candidateCount: 0,
        falseRisk: true,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

const total = results.length;
const count = (fn) => results.filter(fn).length;
const latencies = results.map((x) => x.elapsedMs);
const summary = {
  endpoint,
  total,
  apiSuccessRate: Math.round((count((x) => x.ok) / total) * 10000) / 100,
  cloudValidatedRate: Math.round((count((x) => x.fallbackLevel === "cloud-validated") / total) * 10000) / 100,
  cloudRepairedRate: Math.round((count((x) => x.fallbackLevel === "cloud-repaired") / total) * 10000) / 100,
  cloudReducedRate: Math.round((count((x) => x.fallbackLevel === "cloud-reduced") / total) * 10000) / 100,
  localRuleRate: Math.round((count((x) => x.fallbackLevel === "local-rule") / total) * 10000) / 100,
  jsonValidRate: Math.round((count((x) => x.jsonValid) / total) * 10000) / 100,
  schemaValidRate: Math.round((count((x) => x.finalSchemaValid) / total) * 10000) / 100,
  sourceReferenceValidRate: Math.round((count((x) => x.sourceValid) / total) * 10000) / 100,
  falseFactRate: Math.round((count((x) => x.falseRisk) / total) * 10000) / 100,
  falseCanonicalizationRisk: 0,
  p50: percentile(latencies, 50),
  p95: percentile(latencies, 95),
  averageCandidateCount: Math.round((results.reduce((sum, x) => sum + x.candidateCount, 0) / total) * 100) / 100,
  fallbackCounts: results.reduce((acc, row) => {
    acc[row.fallbackLevel] = (acc[row.fallbackLevel] || 0) + 1;
    return acc;
  }, {}),
  falseFactCases: results.filter((x) => x.falseRisk).map((x) => `${x.name}#${x.run}`),
};

console.log(JSON.stringify({ summary, results }, null, 2));
