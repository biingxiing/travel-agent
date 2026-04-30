# Progressive Results Panel Layout Design

## Summary

Adjust the desktop workspace so the conversation view stays single-column while the planner is still gathering and generating the first itinerary. The results panel should not reserve space or render an empty shell during that phase. As soon as the first itinerary artifact is available in `currentPlan`, the workspace should automatically expand into the existing dual-panel layout with chat on the left and the itinerary preview on the right.

This is a layout-timing change, not a content redesign:

- planning without a plan artifact stays single-column
- the results panel appears only after the first plan artifact exists
- once revealed, the dual-panel layout stays open for the rest of that session until the user starts a new conversation
- mobile stacked behavior stays unchanged

## Goals

- Remove the large empty desktop area currently shown on the right while planning is in progress.
- Make the chat area the only focal point until the first itinerary exists.
- Automatically reveal the results panel as soon as the first complete itinerary is generated.
- Preserve the current split-workspace model after a plan exists.
- Keep the implementation narrow and low-risk by avoiding plan-content redesign.

## Non-Goals

- Redesigning the internal content structure of `PlanningPreview`
- Adding new summary cards, placeholders, or temporary right-side content during planning
- Changing the left history sidebar interaction or mobile drawer behavior
- Altering planner data flow, SSE events, or session persistence
- Introducing a new manual open/close control for the results panel

## Approved Direction

The approved direction is "conversation-first progressive reveal":

- no `currentPlan` means single-column workspace
- planner progress continues inside the chat panel only
- first `currentPlan` creation immediately switches the main workspace to dual-panel mode
- after that first reveal, the results panel remains open through later planning, refinement, and clarification turns
- starting a new conversation returns the workspace to single-column mode

This direction preserves the current product model while removing the empty right-side shell that makes the page feel unbalanced.

## Current Problem

The current desktop layout renders the results-side panel during planning whenever `phase === 'planning'`, even before any actual itinerary artifact exists. That causes:

- a large empty right-hand region with only a small amount of loading content
- reduced chat width at the exact moment when the user most needs to focus on the conversation
- a visual mismatch between "no results yet" and a fully reserved results column

The issue is primarily about layout timing, not about missing content.

## Proposed Behavior

### 1. Pre-Plan Conversation State

When the workspace has no `currentPlan`:

- render the main content as a true single-column conversation layout
- do not render the right-side results panel
- do not render the split divider
- allow the chat panel to occupy the full main workspace width

This applies both before the first user message and while the planner is actively generating the first itinerary.

### 2. First Plan Reveal

When `currentPlan` becomes available for the first time in the active session:

- switch the main workspace from single-column to dual-panel mode automatically
- render `PlanningPreview` on the right immediately
- restore the resize divider in the center
- animate the transition with a short width/opacity reveal so the mode change feels intentional rather than abrupt

The first reveal trigger is the existence of the first plan artifact, not the planning phase flag.

### 3. Post-Reveal Workspace State

After the first plan has appeared:

- keep the dual-panel layout visible during later refine/evaluate/clarify turns
- do not collapse back to single-column if the planner re-enters `planning`
- keep the stored split ratio behavior intact for the revealed dual-panel mode

This keeps the workspace stable once the user has started reading or comparing plan output.

### 4. Reset State

When the user starts a new conversation:

- clear the current workspace plan state as today
- return the main workspace to the pre-plan single-column layout
- hide the divider and results panel again until a new plan is generated

## Layout Details

### Desktop Main Area

Desktop should support two structural modes:

- `single-panel`: chat only, full-width main workspace
- `dual-panel`: chat plus results, resizable split

The current `is-single-panel` condition should be simplified so it is based on the presence of `currentPlan`, not on a combination of `phase` and plan state.

### Split Ratio

When the dual-panel layout first appears:

- default to a slightly more balanced split than the current `42 / 58`
- recommended initial ratio is `46 / 54`

This gives the chat panel enough room to remain useful immediately after expansion while still allowing the plan preview to feel primary.

### Reveal Motion

Use a lightweight transition only:

- chat width adjusts over approximately `180ms - 220ms`
- results panel uses a subtle `opacity` plus small `translateX` entrance
- no elaborate staged animation or modal behavior

The purpose is to make the mode change legible, not decorative.

## State Rules

- `currentPlan` is the only signal that reveals the results panel.
- `phase === 'planning'` alone must not reserve right-side layout space.
- `PlanningPreview` should not render before a plan artifact exists.
- The resize divider is only visible and interactive in dual-panel mode.
- Hydrating an existing session that already has `currentPlan` should open directly in dual-panel mode.
- Mobile layout keeps the existing stacked behavior and should not gain a new reveal mode.

## Files in Scope

Primary implementation targets:

- `/Users/bill/travel-agent/apps/web/pages/index.vue`
- `/Users/bill/travel-agent/apps/web/assets/css/main.css`

Likely responsibilities by file:

- `index.vue`: change rendering conditions for the main split, results panel, and divider
- `main.css`: define the single-panel vs dual-panel desktop behavior and the reveal transition

`PlanningPreview.vue` should stay structurally unchanged unless a small container-class hook is needed.

## Risks and Mitigations

### Risks

- abrupt mode switching could feel jarring if the first plan appears mid-stream
- resizing logic could break if the single-panel and dual-panel states share the wrong flex rules
- later planning passes might accidentally collapse the layout if `phase` checks are left in place
- mobile layout could regress if desktop-only rules are not isolated cleanly

### Mitigations

- base reveal strictly on `currentPlan`
- keep single-panel and dual-panel styles explicit rather than overloading one condition
- preserve existing resize code and only gate its visibility/activation
- validate desktop and mobile separately after the CSS change

## Testing Strategy

Manual verification is the primary testing method for this change.

Required checks:

- desktop conversation state with no plan shows only the chat panel
- desktop planning state before first plan still shows only the chat panel
- the first generated itinerary causes the results panel to appear immediately
- once visible, the results panel stays open during later planning/refinement passes
- starting a new conversation returns the workspace to single-column mode
- desktop divider only appears in dual-panel mode and still resizes correctly
- mobile layout remains stacked and functional

## Acceptance Criteria

- While `currentPlan` is absent, the desktop workspace renders as a single-column chat-first layout.
- The desktop results panel does not render or reserve horizontal space before the first itinerary artifact exists.
- The first complete itinerary automatically reveals the right-side results panel.
- After the first reveal, later planning or refinement turns do not collapse the results panel.
- Starting a new conversation resets the workspace to single-column mode.
- Mobile behavior remains functionally unchanged.
