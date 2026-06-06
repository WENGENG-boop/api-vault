# API Vault Website Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild only the API Vault marketing homepage into a bright, minimal, bilingual product website that leads individual developers to GitHub.

**Architecture:** Keep the existing static website architecture consumed by the Next.js export. `website/index.html` owns semantic page content, `website/styles.css` owns the isolated marketing visual system, and `website/app.js` owns bilingual and small progressive-enhancement interactions. Runtime CSS and JS are mirrored into `public/website`.

**Tech Stack:** Static HTML, CSS, vanilla JavaScript, Next.js static export.

---

### Task 1: Rebuild Website Content

**Files:**
- Modify: `website/index.html`

- [ ] Replace the current long homepage with the approved product-demo-first
  structure.
- [ ] Use one dominant `View on GitHub` CTA and `Quick Start` as the secondary
  action.
- [ ] Add realistic, explicitly illustrative control-plane previews.
- [ ] Keep all translatable copy attached to stable `data-i18n` keys.

### Task 2: Build The Bright Minimal Visual System

**Files:**
- Modify: `website/styles.css`

- [ ] Create website-scoped design tokens and responsive page primitives.
- [ ] Implement the split hero, product UI preview, workflow, capability cards,
  trust block, quick start, FAQ, CTA, and footer.
- [ ] Add responsive layouts for tablet and mobile, accessible focus states, and
  reduced-motion behavior.

### Task 3: Restore Bilingual Interactions

**Files:**
- Modify: `website/app.js`

- [ ] Replace the corrupted bilingual dictionary with valid English and
  Simplified Chinese strings.
- [ ] Preserve language persistence, mobile navigation, quick-start tabs, and
  copy-button behavior.
- [ ] Add accessible state updates such as `aria-expanded` and selected tab
  attributes.

### Task 4: Publish Assets And Metadata

**Files:**
- Modify: `public/website/styles.css`
- Modify: `public/website/app.js`
- Modify: `src/app/page.tsx`
- Modify: `src/app/layout.tsx`

- [ ] Mirror the final static CSS and JavaScript into `public/website`.
- [ ] Update homepage title and description to match the approved positioning.
- [ ] Use a dependable system-font setup and keep the site usable without
  external font requests.

### Task 5: Verify

**Files:**
- Inspect: `out/index.html`
- Inspect: `out/website/styles.css`
- Inspect: `out/website/app.js`

- [ ] Run `npm.cmd run build`; expect both TypeScript and Next.js static export
  to complete successfully.
- [ ] Run existing automated tests if the build succeeds.
- [ ] Open the exported or development homepage in a browser and inspect desktop
  and mobile layouts.
- [ ] Verify language switching, quick-start tabs, copy buttons, mobile
  navigation, GitHub links, and absence of obvious overflow or console errors.
