# Round 04 Review

## Focus

- Residual message consistency after the round 03 state recovery.

## Finding

- Even after the phase recovered to `result`, a stale system error bubble like `连接中断，请重试` could still persist in chat alongside a valid plan.

## Fix Direction

- Strip persisted system error bubbles and clear persisted error text when a saved plan already exists.
