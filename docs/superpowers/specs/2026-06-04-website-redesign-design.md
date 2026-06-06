# API Vault Website Redesign

## Goal

Rebuild only the API Vault marketing website so an individual developer managing
multiple AI API providers can understand the product quickly and confidently
choose the primary action: **View on GitHub**.

## Positioning

- **Product:** API Vault, an open-source local-first AI API proxy and dashboard.
- **Audience:** Individual developers using multiple AI API providers.
- **Problem:** API keys, provider endpoints, usage, cost, and health are scattered.
- **Outcome:** One local control plane for routing compatible requests and seeing
  the resulting usage, cost, and latency.
- **Differentiator:** Keys and records stay under the developer's control while
  the proxy provides a consistent endpoint and useful local visibility.
- **Primary CTA:** View on GitHub.
- **Secondary CTA:** Quick Start.

## Visual Direction

Use a bright, minimal SaaS visual system: white and soft-gray surfaces, fine
borders, generous whitespace, restrained blue accents, precise typography, and
realistic product UI previews. Avoid decorative gradients, generic illustrations,
invented customer proof, and excessive animation.

## Page Structure

1. Compact sticky navigation with GitHub as the dominant action.
2. Split hero: clear positioning on the left and a realistic control-plane
   preview on the right.
3. Specific pain points for developers juggling providers, keys, and usage.
4. A three-step proxy workflow explaining how requests pass through API Vault.
5. Four benefit-led capabilities with supporting product UI previews.
6. Honest trust section covering local storage, open source, and limitations.
7. Quick-start commands for Docker and Windows.
8. Short FAQ addressing data location, compatibility, tracking, and remote use.
9. Final GitHub CTA and compact footer.

## Content And Interaction

- Preserve English and Simplified Chinese switching.
- Fix the existing corrupted Chinese strings.
- Use one primary CTA label across the page.
- Keep quick-start tabs, copy buttons, and mobile navigation.
- Product previews are illustrative and must not imply unsupported metrics.
- Mention that API Vault can only track requests routed through its proxy.

## Implementation Scope

- Rewrite `website/index.html`, `website/styles.css`, and `website/app.js`.
- Synchronize runtime assets to `public/website/styles.css` and
  `public/website/app.js`.
- Update homepage metadata in `src/app/page.tsx` and the document language/font
  setup in `src/app/layout.tsx` only where needed by the website.
- Do not change the renderer console, API routes, server behavior, or product
  features.

## Verification

- Run the production build.
- Confirm the exported homepage loads without broken assets.
- Verify English and Chinese switching, quick-start tabs, copy controls, and
  mobile navigation.
- Inspect desktop and mobile layouts in a browser.
