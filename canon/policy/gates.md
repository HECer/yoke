# Acceptance gates

- Record enough acceptance criteria to detect wrong behavior before dispatch. Existing user instructions or an approved PRD can supply them; do not demand another approval for the same scope.
- Run required checks against the candidate being accepted. Distinguish failed, unavailable, and unsupported evidence from success. Preserve protected acceptance and integration gates.
- Respect the loop's workspace ownership and clean-tree checks. Preserve unrelated changes; isolate work instead of resetting them.
- Apply configured call, time, prompt, and token admission budgets across roles. Do not restart or rename work to evade exhausted limits.
