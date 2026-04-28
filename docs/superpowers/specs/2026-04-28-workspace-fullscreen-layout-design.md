# Workspace Fullscreen Layout Design

## Summary

Adjust the web workspace layout so the application occupies the full browser viewport on desktop while preserving a small outer gutter. This applies to the full workspace shell, including the landing state, the left history sidebar, and the conversation/result split view.

The change is intentionally narrow:

- remove the desktop max-width constraint from the workspace shell
- preserve a thin desktop gutter instead of edge-to-edge rendering
- keep mobile behavior structurally unchanged
- avoid redesigning internal cards or changing component hierarchy

## Goals

- Make the workspace feel like a full-screen application on desktop.
- Ensure the landing state and conversation state both consume the available viewport cleanly.
- Preserve the current visual language instead of turning the workspace into a borderless layout.
- Minimize implementation risk by changing container layout styles first.

## Non-Goals

- Reworking the hero card composition or typography
- Changing history sidebar width or mobile drawer interaction
- Redesigning the conversation panel, result panel, or internal card spacing
- Introducing new responsive breakpoints or layout modes

## Approved Direction

The approved direction is "full width with a safety gutter":

- desktop removes the workspace `max-width`
- desktop keeps a small outer padding, with `24px` as the default large-screen gutter and `16px` on smaller desktop widths
- mobile keeps the existing compact padding and drawer behavior

This preserves the current product character while making the workspace visibly fill the screen.

## Current Problem

The root workspace shell is constrained by a fixed `max-width` and centered layout styling. Even though parts of the page already use `100dvh`, the shell never expands to the full viewport width, so:

- the landing page looks inset inside a large browser window
- the conversation layout does not read as a full-screen workspace
- the history sidebar and split panels inherit unnecessary outer whitespace

## Proposed Layout Changes

### 1. Workspace Shell

Update the global workspace shell so desktop uses the full available width:

- remove the desktop `max-width` constraint from `.page-shell`
- keep `min-height: 100dvh`
- retain a small outer padding on desktop instead of edge-to-edge rendering
- keep the shell as a flex column container so children can consume remaining height

Expected result:

- the application spans the browser width on desktop
- the shell still has visual breathing room from the viewport edge

### 2. Landing State

Update the landing workspace so it behaves like a true full-screen first view:

- keep the shared full-width shell
- ensure the main content area expands to the available viewport height beneath the top bar
- allow the landing stack to center or balance vertically within the remaining height without forcing a redesign of the hero component

Expected result:

- the homepage reads as a complete full-screen workspace, not a centered narrow canvas
- the hero card remains visually familiar, but the surrounding layout uses the full screen better

### 3. Conversation State

Keep the conversation workspace as a fixed-height application layout:

- preserve `100dvh` behavior for the conversation state
- allow the page body to fill the remaining shell height
- let the history sidebar and page main area stretch to full available height
- keep the existing split-resize behavior unchanged

Expected result:

- top bar, history sidebar, conversation panel, and result panel occupy the full viewport cleanly
- no extra outer centering limits remain on desktop

### 4. Mobile Behavior

Do not convert mobile to a borderless full-screen layout:

- keep the existing reduced padding on small screens
- keep the sidebar as a drawer
- keep stacked panel behavior on small viewports

Expected result:

- no behavioral regressions on phones
- the desktop enhancement does not force a mobile redesign

## Components and Files in Scope

Primary implementation targets:

- `/Users/bill/travel-agent/apps/web/assets/css/main.css`
- `/Users/bill/travel-agent/apps/web/pages/index.vue`

Likely ownership by file:

- `main.css`: global shell sizing, desktop gutter, state-specific height behavior
- `index.vue`: local page layout styles that determine how `page-body`, `page-main`, and landing containers consume height

Internal components such as `HeroPlannerCard`, `TripHistoryGrid`, `ChatPanel`, and `PlanningPreview` should only be touched if a container sizing issue makes it necessary.

## Layout/Data Flow Impact

This change does not alter product data flow. The only runtime impact is layout sizing:

- viewport height flows into `.page-shell`
- remaining height flows into `.page-body`
- remaining width flows into `history-sidebar` and `page-main`
- existing split layout logic continues to determine conversation/result proportions

Because no business state or API behavior changes, regressions should be limited to layout rendering and overflow behavior.

## Error Handling and Risk Areas

Primary risks:

- landing state may still appear vertically compressed if only width is changed
- conversation view may introduce nested overflow issues if `min-height: 0` is broken
- small-screen layouts may regress if desktop rules are not isolated by breakpoint
- removing `max-width` may expose overly large empty areas on ultra-wide displays if gutters are too small

Mitigations:

- keep the desktop gutter instead of going edge-to-edge
- preserve existing `min-height: 0` and overflow contracts on flex children
- avoid changing split panel internals
- validate desktop and mobile layouts with browser checks after implementation

## Testing Strategy

Manual verification is the primary testing method for this change.

Required checks:

- desktop landing page fills the viewport width and reads as full-screen
- desktop conversation layout fills the viewport with sidebar and split panels stretching correctly
- split resize handle still works
- mobile sidebar drawer still opens and overlays correctly
- mobile stacked layout still scrolls correctly

Recommended verification tools:

- Playwright visual check for landing and conversation states
- existing web tests only if touched files imply a broader regression risk

## Implementation Boundaries

Implementation should prefer the smallest viable diff:

- start with global shell and page container styles
- only adjust local landing/container styles if full-height behavior is still incomplete
- do not expand scope into component redesign

If a component needs modification to respect parent height, keep the change local and structural rather than visual.

## Acceptance Criteria

- On desktop, the workspace shell no longer has a centered max-width constraint.
- On desktop, the workspace retains a thin outer gutter rather than rendering flush to the viewport edge.
- The landing state uses the full browser width and cleanly occupies the viewport height below the top bar.
- The conversation state uses the full browser width and full viewport height, including the left history sidebar and main split layout.
- Mobile layout and drawer behavior remain functionally unchanged.
