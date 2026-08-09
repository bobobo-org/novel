import assert from "node:assert/strict";

export { assert };

export class Rc6TestHarness {
  #tests = [];

  constructor(suiteName, selectedMode = "all") {
    this.suiteName = suiteName;
    this.selectedMode = selectedMode;
  }

  test(mode, name, run) {
    this.#tests.push({ mode, name, run });
  }

  async run() {
    const selected = this.#tests.filter(({ mode }) =>
      this.selectedMode === "all" || mode === this.selectedMode);
    if (!selected.length) {
      throw new Error(`RC6_TEST_MODE_UNKNOWN:${this.selectedMode}`);
    }

    const results = [];
    for (const item of selected) {
      const startedAt = performance.now();
      try {
        await item.run();
        const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
        results.push({ ...item, status: "PASS", durationMs });
        console.log(`PASS [${item.mode}] ${item.name} (${durationMs} ms)`);
      } catch (error) {
        const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
        results.push({ ...item, status: "FAIL", durationMs, error });
        console.error(`FAIL [${item.mode}] ${item.name} (${durationMs} ms)`);
        console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      }
    }

    const pass = results.filter(({ status }) => status === "PASS").length;
    const fail = results.length - pass;
    console.log(`${this.suiteName}: ${pass} PASS / ${fail} FAIL / ${results.length} TOTAL`);
    if (fail) process.exitCode = 1;
    return { pass, fail, total: results.length };
  }
}

export async function expectErrorCode(run, expectedCode) {
  await assert.rejects(run, (error) => {
    assert.equal(error?.code ?? error?.message, expectedCode);
    return true;
  });
}

export function assertNoForbiddenKeys(value, forbiddenKeys) {
  const seen = [];
  const visit = (current, path = "$") => {
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!current || typeof current !== "object") return;
    for (const [key, item] of Object.entries(current)) {
      if (forbiddenKeys.has(key.toLowerCase())) seen.push(`${path}.${key}`);
      visit(item, `${path}.${key}`);
    }
  };
  visit(value);
  assert.deepEqual(seen, []);
}
