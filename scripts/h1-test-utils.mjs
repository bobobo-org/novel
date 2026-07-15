export function createHarness(name) {
  const results = [];
  return {
    pass(test, details = {}) {
      results.push({ test, status: "PASS", details });
    },
    fail(test, details = {}) {
      results.push({ test, status: "FAIL", details });
    },
    assert(test, condition, details = {}) {
      results.push({ test, status: condition ? "PASS" : "FAIL", details });
    },
    summary(extra = {}) {
      const pass = results.filter((r) => r.status === "PASS").length;
      const fail = results.filter((r) => r.status === "FAIL").length;
      const skip = results.filter((r) => r.status === "SKIP").length;
      return { suite: name, pass, fail, skip, ...extra, results };
    },
  };
}

export function printAndExit(summary) {
  console.log(JSON.stringify(summary, null, 2));
  if (summary.fail > 0 || summary.skip > 0) process.exit(1);
}
