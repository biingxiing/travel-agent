# Workspace Fullscreen Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the web workspace fill the desktop viewport width and height while keeping a thin outer gutter and preserving existing mobile behavior.

**Architecture:** Keep the change at the container-layout layer. `main.css` removes the centered max-width shell and defines desktop/full-height shell behavior; `pages/index.vue` makes the landing workspace consume the remaining viewport height cleanly without redesigning internal cards or split-panel logic.

**Tech Stack:** Vue 3, Nuxt 3, scoped CSS, global CSS, Vitest, Playwright/manual browser verification

---

## File Map

| File | Change |
| --- | --- |
| `apps/web/assets/css/main.css` | Remove desktop `max-width` constraint from `.page-shell`, define desktop safety gutters, make landing and conversation shells full-height on desktop, remove extra bottom whitespace from the main content container |
| `apps/web/pages/index.vue` | Add a landing-state class to `page-main`, let the landing stack fill remaining height, center landing content within the full-height workspace, preserve small-screen behavior |

> No new unit test file is required for this change. Existing `vitest` coverage does not assert CSS layout geometry, so regression protection comes from running the current web test suite plus manual browser verification after the CSS change.

---

## Task 1: Expand the global workspace shell to full desktop width

**Files:**
- Modify: `apps/web/assets/css/main.css`

- [ ] **Step 1: Replace the desktop `.page-shell` block**

Find the existing `.page-shell` block in `apps/web/assets/css/main.css` and replace it with:

```css
.page-shell {
  width: 100%;
  max-width: none;
  margin: 0;
  min-height: 100dvh;
  padding: 24px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 0;
}
```

- [ ] **Step 2: Replace the landing/conversation shell state blocks**

Find the current `.page-shell.is-landing` and `.page-shell.is-conversation` blocks and replace them with:

```css
.page-shell.is-landing,
.page-shell.is-conversation {
  height: 100dvh;
  overflow: hidden;
}
```

This keeps both desktop workspace states inside the viewport instead of letting the landing state fall back to `height: auto`.

- [ ] **Step 3: Remove the extra bottom padding from the main workspace section**

Find the `.main-section` block and replace it with:

```css
.main-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding-bottom: 0;
}
```

- [ ] **Step 4: Add the smaller desktop gutter breakpoint**

Immediately before the existing `@media (max-width: 640px)` block, add:

```css
@media (max-width: 1200px) {
  .page-shell {
    padding: 20px 16px 24px;
  }
}
```

This preserves the approved `24px` large-screen gutter while collapsing to `16px` on smaller desktop widths.

- [ ] **Step 5: Run the existing web test suite**

Run: `pnpm --filter @travel-agent/web test`  
Expected: `vitest` exits successfully with passing tests.

- [ ] **Step 6: Commit the shell-width change**

```bash
git add apps/web/assets/css/main.css
git commit -m "feat(web): make workspace shell full-width on desktop"
```

---

## Task 2: Make the landing workspace consume the remaining viewport height

**Files:**
- Modify: `apps/web/pages/index.vue`

- [ ] **Step 1: Add a landing-state class to the page main container**

Find this template line in `apps/web/pages/index.vue`:

```html
<div class="page-main">
```

Replace it with:

```html
<div class="page-main" :class="{ 'is-landing': isLanding }">
```

- [ ] **Step 2: Replace the `.page-main` and `.landing-stack` scoped styles**

In the `<style scoped>` block, replace the current `.page-main` and `.landing-stack` rules with:

```css
.page-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.page-main.is-landing {
  overflow-y: auto;
}

.landing-stack {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 32px;
  padding: 8px 0 24px;
}
```

- [ ] **Step 3: Update the small-screen landing override**

Inside the existing `@media (max-width: 640px)` block in `apps/web/pages/index.vue`, replace the current `.landing-stack` rule with:

```css
.page-main.is-landing {
  overflow: visible;
}

.landing-stack {
  justify-content: flex-start;
  gap: 22px;
  padding-bottom: 24px;
}
```

This keeps mobile behavior aligned with the approved design: the landing page stays compact and scrollable instead of forcing full-screen centering.

- [ ] **Step 4: Run the existing web test suite again**

Run: `pnpm --filter @travel-agent/web test`  
Expected: `vitest` exits successfully with passing tests.

- [ ] **Step 5: Commit the landing-height change**

```bash
git add apps/web/pages/index.vue
git commit -m "feat(web): make landing workspace fill viewport height"
```

---

## Task 3: Verify desktop and mobile workspace behavior in the browser

**Files:**
- Verify: `apps/web/assets/css/main.css`
- Verify: `apps/web/pages/index.vue`

- [ ] **Step 1: Start the local web + api stack**

Run: `pnpm dev`  
Expected: the terminal prints a web URL in the form `[dev] Web: http://localhost:3000` and an API URL in the form `[dev] API: http://127.0.0.1:3001` (ports may increment if those are already taken).

- [ ] **Step 2: Verify the desktop landing workspace**

Open the printed web URL in a browser, log in with `AUTH_USERNAME` and `AUTH_PASSWORD` from `apps/api/.env`, and confirm all of the following at a desktop viewport around `1440x900`:

- the workspace shell spans the full browser width
- the shell keeps a thin outer gutter instead of touching the viewport edge
- the left history sidebar stretches vertically with the page body
- the landing hero area occupies the remaining height beneath the top bar instead of sitting inside a centered narrow canvas

- [ ] **Step 3: Verify the desktop conversation workspace**

Still on desktop, either click an existing session from the history sidebar or submit this prompt from the landing page:

```text
顺德 3 天 2 人，预算 4000，偏向美食
```

Once the conversation workspace is visible, confirm:

- the top bar, history sidebar, chat panel, and result panel fill the viewport height
- the split layout uses the extra screen width rather than staying inside a centered max-width shell
- the resize handle still appears and can be dragged without collapsing the layout

- [ ] **Step 4: Verify mobile behavior remains unchanged**

Resize the browser to a mobile viewport around `390x844` and confirm:

- the hamburger button still opens the history drawer
- the overlay still covers the page behind the drawer
- the landing stack is top-aligned and scrolls normally
- the conversation panels stack vertically and remain readable

- [ ] **Step 5: Run a final status check**

Run: `git status --short`  
Expected: no output, because the Task 1 and Task 2 commits already captured the source changes and verification should not leave the worktree dirty.
