# AI Story Generation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a logged-in AI novel generator that stores users, stories, chapters, choices, memories, and generation events in Supabase.

**Architecture:** Migrate the current static HTML tool into a Next.js app deployed on Vercel. The browser authenticates with Supabase and calls Vercel API routes; server routes validate the user, enforce quota, call OpenAI Responses API, stream text back to the UI, and persist results to Supabase.

**Tech Stack:** Next.js, React, TypeScript, Supabase Auth/Postgres/RLS, OpenAI Responses API, Vitest, React Testing Library, Playwright.

---

### Task 1: Scaffold Next.js App

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`
- Modify: `.gitignore`

**Step 1: Create package metadata**

Add `package.json`:

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  },
  "dependencies": {
    "@supabase/ssr": "^0.7.0",
    "@supabase/supabase-js": "^2.75.0",
    "next": "^15.5.0",
    "openai": "^5.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.54.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.3.0",
    "@types/node": "^24.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

**Step 2: Add base Next files**

Create minimal `src/app/layout.tsx`, `src/app/page.tsx`, and `src/app/globals.css` that render the existing app name and a placeholder.

**Step 3: Install dependencies**

Run: `npm install`

Expected: `package-lock.json` is created and install succeeds.

**Step 4: Build**

Run: `npm run build`

Expected: Next.js build succeeds.

**Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts src/app .gitignore
git commit -m "chore: scaffold next app"
```

### Task 2: Extract Offline Story Data

**Files:**
- Create: `src/lib/story-data.ts`
- Create: `src/lib/story-data.test.ts`
- Read: `諸天萬界小說生成系統_v4精簡可用離線故事資料庫版_v2完成版/諸天萬界小說生成系統_v4豪華版_主題相容ChatGPT接力版.html`

**Step 1: Write failing tests**

Test that exported data includes the 16 theme categories and that `附身變身` contains `男生附身女生`.

**Step 2: Extract constants**

Move `DB`, `THEME_RULES`, `COMMON_BANK`, and `STORY_BANK` into typed exports.

**Step 3: Run tests**

Run: `npm test -- src/lib/story-data.test.ts`

Expected: tests pass.

**Step 4: Commit**

```bash
git add src/lib/story-data.ts src/lib/story-data.test.ts
git commit -m "refactor: extract offline story data"
```

### Task 3: Add Supabase Schema

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/<generated>_ai_story_generation.sql`

**Step 1: Initialize Supabase project files**

Run: `supabase init`

Expected: `supabase/config.toml` exists.

**Step 2: Create migration**

Run: `supabase migration new ai_story_generation`

Expected: CLI creates a timestamped SQL file.

**Step 3: Add SQL**

Create tables: `profiles`, `stories`, `chapters`, `story_memories`, `generation_events`.

Enable RLS on all tables. Add ownership policies using `to authenticated` and `(select auth.uid()) = user_id`.

**Step 4: Verify locally or against linked project**

Run: `supabase db lint` if available, otherwise run `supabase db push --dry-run` after linking.

Expected: SQL parses without errors.

**Step 5: Commit**

```bash
git add supabase
git commit -m "feat: add story generation schema"
```

### Task 4: Add Supabase Clients

**Files:**
- Create: `src/lib/env.ts`
- Create: `src/lib/supabase/browser.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/admin.ts`
- Create: `src/lib/env.test.ts`

**Step 1: Write env tests**

Validate that server-only keys are not exposed through `NEXT_PUBLIC_*`.

**Step 2: Implement env helpers**

Export validated env accessors with `zod`.

**Step 3: Implement clients**

Use `@supabase/ssr` for browser/server cookie-aware clients. Use service role only in `admin.ts`.

**Step 4: Run tests**

Run: `npm test -- src/lib/env.test.ts`

Expected: tests pass.

**Step 5: Commit**

```bash
git add src/lib/env.ts src/lib/supabase src/lib/env.test.ts
git commit -m "feat: add supabase clients"
```

### Task 5: Implement Authentication UI

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/app/auth/callback/route.ts`
- Create: `src/components/auth/sign-in-form.tsx`
- Create: `src/components/auth/sign-out-button.tsx`
- Modify: `src/app/page.tsx`

**Step 1: Add sign-in form test**

Test that the form renders an email input and submit button.

**Step 2: Build email magic link flow**

Use Supabase Auth OTP sign-in. Redirect callback to `/`.

**Step 3: Protect app page**

If no user is present, show sign-in CTA.

**Step 4: Run build**

Run: `npm run build`

Expected: build succeeds.

**Step 5: Commit**

```bash
git add src/app/login src/app/auth src/components/auth src/app/page.tsx
git commit -m "feat: add supabase auth"
```

### Task 6: Build Story CRUD

**Files:**
- Create: `src/lib/stories/schema.ts`
- Create: `src/lib/stories/queries.ts`
- Create: `src/lib/stories/schema.test.ts`
- Create: `src/app/api/stories/route.ts`
- Create: `src/app/api/stories/[storyId]/route.ts`

**Step 1: Write schema tests**

Validate required fields for story creation and reject overlong text input.

**Step 2: Implement schemas**

Use `zod` to validate title, genre, theme fields, and core idea.

**Step 3: Implement API routes**

Routes must use authenticated Supabase server client and rely on RLS for final enforcement.

**Step 4: Run tests**

Run: `npm test -- src/lib/stories/schema.test.ts`

Expected: tests pass.

**Step 5: Commit**

```bash
git add src/lib/stories src/app/api/stories
git commit -m "feat: add story crud api"
```

### Task 7: Add Prompt Builder

**Files:**
- Create: `src/lib/ai/prompt.ts`
- Create: `src/lib/ai/prompt.test.ts`

**Step 1: Write prompt tests**

Test that prompts include Traditional Chinese instruction, story settings, latest memory, latest chapter, and selected choice.

**Step 2: Implement prompt builder**

Export `buildGenerationPrompt(input)` returning system and user messages.

**Step 3: Run tests**

Run: `npm test -- src/lib/ai/prompt.test.ts`

Expected: tests pass.

**Step 4: Commit**

```bash
git add src/lib/ai/prompt.ts src/lib/ai/prompt.test.ts
git commit -m "feat: add ai prompt builder"
```

### Task 8: Add Quota Enforcement

**Files:**
- Create: `src/lib/ai/quota.ts`
- Create: `src/lib/ai/quota.test.ts`

**Step 1: Write quota tests**

Test that a user with 20 successful daily events is blocked and a user with 19 is allowed.

**Step 2: Implement quota function**

Export `assertGenerationQuota({ userId, supabaseAdmin })`.

**Step 3: Run tests**

Run: `npm test -- src/lib/ai/quota.test.ts`

Expected: tests pass with mocked Supabase responses.

**Step 4: Commit**

```bash
git add src/lib/ai/quota.ts src/lib/ai/quota.test.ts
git commit -m "feat: add generation quota checks"
```

### Task 9: Implement AI Generate Route

**Files:**
- Create: `src/app/api/generate/route.ts`
- Create: `src/app/api/generate/route.test.ts`
- Modify: `src/lib/ai/prompt.ts`
- Modify: `src/lib/ai/quota.ts`

**Step 1: Write route tests**

Cover unauthenticated request, forbidden story access, quota exceeded, and mocked successful generation.

**Step 2: Implement OpenAI call**

Use the OpenAI SDK and `OPENAI_MODEL`. Do not expose `OPENAI_API_KEY` to the client.

**Step 3: Persist result**

Insert `chapters` and `generation_events`. Update `stories.current_chapter`.

**Step 4: Run tests**

Run: `npm test -- src/app/api/generate/route.test.ts`

Expected: tests pass.

**Step 5: Commit**

```bash
git add src/app/api/generate src/lib/ai
git commit -m "feat: add ai generation route"
```

### Task 10: Rebuild Main App UI

**Files:**
- Create: `src/components/story/story-form.tsx`
- Create: `src/components/story/story-list.tsx`
- Create: `src/components/story/chapter-viewer.tsx`
- Create: `src/components/story/generate-panel.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/globals.css`

**Step 1: Write component tests**

Test that story form renders theme selectors and that generate panel renders disabled state without a story.

**Step 2: Build UI**

Port existing labels, tabs, selectors, and dark visual style into React components.

**Step 3: Wire API calls**

Create story, load stories, generate first chapter, choose next route, and refresh chapter list.

**Step 4: Run tests and build**

Run: `npm test && npm run build`

Expected: all tests and build pass.

**Step 5: Commit**

```bash
git add src/components/story src/app/page.tsx src/app/globals.css
git commit -m "feat: rebuild story generation ui"
```

### Task 11: Add E2E Smoke Test

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/story-generation.spec.ts`

**Step 1: Write smoke test**

Mock AI route if needed. Verify sign-in placeholder, story creation form, and generated chapter display.

**Step 2: Run E2E**

Run: `npm run e2e`

Expected: smoke test passes.

**Step 3: Commit**

```bash
git add playwright.config.ts tests/e2e
git commit -m "test: add story generation e2e smoke test"
```

### Task 12: Configure Vercel and Supabase Deploy

**Files:**
- Modify: `README.md`
- Modify: `vercel.json`

**Step 1: Add env documentation**

Document required Vercel env vars:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`

**Step 2: Apply Supabase migration**

Run: `supabase link --project-ref <project-ref>`

Run: `supabase db push`

Expected: migration applies successfully.

**Step 3: Set Vercel env vars**

Run `vercel env add` for each variable in `production`.

Expected: all variables are configured in `lqtechs-projects/novel`.

**Step 4: Deploy**

Run:

```bash
vercel deploy --prod --scope lqtechs-projects --project novel
```

Expected: production deployment is ready.

**Step 5: Verify**

Open production URL and complete: sign in, create story, generate first chapter.

**Step 6: Commit docs**

```bash
git add README.md vercel.json
git commit -m "docs: add deployment configuration"
```
