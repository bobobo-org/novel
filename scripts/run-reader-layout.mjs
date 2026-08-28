import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
import {
  migrateReaderContentWidthPreference,
  READER_CONTENT_WIDTH_DEFAULT,
  READER_CONTENT_WIDTH_MAX,
  READER_CONTENT_WIDTH_PREFERENCE_VERSION,
} from "../lib/novel-ai/domain/reader-layout.ts";

const checks = [];

function check(name, run) {
  run();
  checks.push({ name, status: "PASS" });
}

check("unversioned 760px legacy default migrates once", () => {
  assert.deepEqual(
    migrateReaderContentWidthPreference(760, undefined),
    {
      contentWidth: READER_CONTENT_WIDTH_DEFAULT,
      contentWidthPreferenceVersion: READER_CONTENT_WIDTH_PREFERENCE_VERSION,
      needsSave: true,
    },
  );
});

check("deliberate 760px preference survives later loads", () => {
  const reloaded = migrateReaderContentWidthPreference(
    760,
    READER_CONTENT_WIDTH_PREFERENCE_VERSION,
  );
  assert.equal(reloaded.contentWidth, 760);
  assert.equal(reloaded.needsSave, false);
});

check("legacy custom width is marked current without being replaced", () => {
  const migrated = migrateReaderContentWidthPreference(920, undefined);
  assert.equal(migrated.contentWidth, 920);
  assert.equal(
    migrated.contentWidthPreferenceVersion,
    READER_CONTENT_WIDTH_PREFERENCE_VERSION,
  );
  assert.equal(migrated.needsSave, true);
});

check("invalid and oversized widths normalize to safe bounds", () => {
  assert.equal(
    migrateReaderContentWidthPreference(Number.NaN, READER_CONTENT_WIDTH_PREFERENCE_VERSION).contentWidth,
    READER_CONTENT_WIDTH_DEFAULT,
  );
  assert.equal(
    migrateReaderContentWidthPreference(9_999, READER_CONTENT_WIDTH_PREFERENCE_VERSION).contentWidth,
    READER_CONTENT_WIDTH_MAX,
  );
});

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true });
  } catch {
    return chromium.launch({ channel: "msedge", headless: true });
  }
}

const [rawCss, readerSource] = await Promise.all([
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../app/studio/read/[projectId]/reader-client.tsx", import.meta.url), "utf8"),
]);
const css = rawCss.replace('@import "tailwindcss";', "");

check("reader scroll persistence is throttled and flushed on leave", () => {
  assert.match(readerSource, /READER_SCROLL_SAVE_DELAY_MS\s*=\s*900/u);
  assert.match(readerSource, /addEventListener\("pagehide",\s*onPageHide\)/u);
  assert.match(readerSource, /addEventListener\("visibilitychange",\s*onVisibilityChange\)/u);
  assert.match(readerSource, /await flushScrollSaveRef\.current\(\)/u);
});

check("reader uses measured mobile header offset and deferred paragraph paint", () => {
  assert.match(readerSource, /new ResizeObserver\(syncHeaderHeight\)/u);
  assert.match(readerSource, /--reader-top-height/u);
  assert.match(css, /\.readerArticle>p\[data-reader-anchor\]\{content-visibility:auto;contain-intrinsic-size:auto 4lh\}/u);
  assert.match(css, /\.readerControls\{top:var\(--reader-top-height,/u);
});
const browser = await launchBrowser();

try {
  const page = await browser.newPage();
  const longTitle = "ChapterTitleWithoutAnyBreakOpportunity0123456789".repeat(4);
  await page.setContent(`
    <style>${css}</style>
    <main class="readerShell reader-night" style="--reader-width:1480px">
      <header class="readerTop">
        <div><a href="#">返回寫作</a><button>章節目錄</button></div>
        <span>${longTitle} · 48%</span>
        <div><button>閱讀設定</button><button class="readerResumeButton">上次位置</button><button>加入書籤</button></div>
      </header>
      <section class="readerControls" aria-label="閱讀設定">
        <label>內文寬度<input type="range" min="320" max="1480" value="1480"></label>
      </section>
      <article class="readerArticle">
        <header><h1>窄螢幕閱讀測試</h1></header>
        <p>${longTitle}</p>
        <footer>
          <button>← ${longTitle}</button>
          <button>目錄</button>
          <button>${longTitle} →</button>
        </footer>
        <div style="height:1200px" aria-hidden="true"></div>
      </article>
    </main>
  `);

  for (const width of [320, 375, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() => {
      const shell = document.querySelector(".readerShell");
      const header = document.querySelector(".readerTop");
      if (!(shell instanceof HTMLElement) || !(header instanceof HTMLElement)) throw new Error("reader header fixture is incomplete");
      shell.style.setProperty("--reader-top-height", `${Math.ceil(header.getBoundingClientRect().height)}px`);
      window.scrollTo(0, 500);
    });
    await page.waitForTimeout(50);
    const metrics = await page.evaluate(() => {
      const article = document.querySelector(".readerArticle");
      const footer = document.querySelector(".readerArticle > footer");
      const header = document.querySelector(".readerTop");
      const controls = document.querySelector(".readerControls");
      const buttons = [...document.querySelectorAll(".readerArticle > footer > button")];
      if (!(article instanceof HTMLElement) || !(footer instanceof HTMLElement) || !(header instanceof HTMLElement) || !(controls instanceof HTMLElement)) {
        throw new Error("reader fixture is incomplete");
      }
      const articleRect = article.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const controlsRect = controls.getBoundingClientRect();
      return {
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        articleClientWidth: article.clientWidth,
        articleScrollWidth: article.scrollWidth,
        footerClientWidth: footer.clientWidth,
        footerScrollWidth: footer.scrollWidth,
        footerDisplay: getComputedStyle(footer).display,
        buttons: buttons.map((button) => {
          const rect = button.getBoundingClientRect();
          return {
            clientWidth: button.clientWidth,
            scrollWidth: button.scrollWidth,
            left: rect.left,
            right: rect.right,
          };
        }),
        articleLeft: articleRect.left,
        articleRight: articleRect.right,
        headerBottom: headerRect.bottom,
        controlsTop: controlsRect.top,
        configuredHeaderHeight: getComputedStyle(document.querySelector(".readerShell")).getPropertyValue("--reader-top-height").trim(),
      };
    });

    check(`${width}px viewport has no horizontal reader overflow`, () => {
      assert.ok(metrics.documentScrollWidth <= metrics.documentClientWidth + 1, JSON.stringify(metrics));
      assert.ok(metrics.articleScrollWidth <= metrics.articleClientWidth + 1, JSON.stringify(metrics));
      assert.ok(metrics.footerScrollWidth <= metrics.footerClientWidth + 1, JSON.stringify(metrics));
      for (const button of metrics.buttons) {
        assert.ok(button.scrollWidth <= button.clientWidth + 1, JSON.stringify(metrics));
        assert.ok(button.left >= metrics.articleLeft - 1, JSON.stringify(metrics));
        assert.ok(button.right <= metrics.articleRight + 1, JSON.stringify(metrics));
      }
      assert.equal(metrics.footerDisplay, width <= 520 ? "grid" : "flex");
      assert.match(metrics.configuredHeaderHeight, /^\d+px$/u);
      assert.ok(metrics.controlsTop >= metrics.headerBottom - 1, JSON.stringify(metrics));
    });
  }
} finally {
  await browser.close();
}

console.log(JSON.stringify({ ok: true, passed: checks.length, checks }, null, 2));
