import { writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

const args = Object.fromEntries(process.argv.slice(2).map((value, index, all) => value.startsWith("--") ? [value.slice(2), all[index + 1]] : null).filter(Boolean));
for (const required of ["browser", "profile", "url", "output"]) {
  if (!args[required]) throw new Error(`Missing --${required}`);
}

const executablePath = args.browser === "edge"
  ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const context = await chromium.launchPersistentContext(path.resolve(args.profile), {
  executablePath,
  headless: false,
  args: ["--no-first-run", "--no-default-browser-check"],
});

try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  const audit = await page.evaluate(async () => {
    const databases = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
    const indexedDatabases = [];
    for (const database of databases) {
      if (!database.name) continue;
      const stores = await new Promise((resolve) => {
        const request = indexedDB.open(database.name);
        request.onerror = () => resolve([]);
        request.onsuccess = async () => {
          const db = request.result;
          const rows = [];
          for (const storeName of Array.from(db.objectStoreNames)) {
            rows.push(await new Promise((done) => {
              const count = db.transaction(storeName, "readonly").objectStore(storeName).count();
              count.onsuccess = () => done({ name: storeName, count: count.result });
              count.onerror = () => done({ name: storeName, count: null, error: count.error?.name ?? "COUNT_FAILED" });
            }));
          }
          db.close();
          resolve(rows);
        };
      });
      indexedDatabases.push({ name: database.name, version: database.version ?? null, stores });
    }
    return {
      capturedAt: new Date().toISOString(),
      localStorageKeys: Object.keys(localStorage).sort(),
      sessionStorageKeys: Object.keys(sessionStorage).sort(),
      indexedDatabases,
    };
  });
  await writeFile(path.resolve(args.output), `${JSON.stringify(audit, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: "PASS", output: path.resolve(args.output) }));
} finally {
  await context.close();
}
