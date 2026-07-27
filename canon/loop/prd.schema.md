# PRD Schema

The loop is driven by a versioned PRD file. Each story:

```yaml
- id: STORY-1
  title: Short imperative description
  priority: 1            # lower = higher priority
  needs: []              # optional dependency IDs; no unknown IDs, self-links, or cycles
  area: api              # optional collision domain for parallel scheduling
  agent: codex           # optional claude|codex|gemini affinity
  acceptance:            # Definition of Done (required before implementation)
    - The endpoint returns 200 for a valid request.
  passes: false          # set true only when acceptance is met and tests are green
```

Stop condition: every story has `passes: true`.

Stories without `needs`, `area`, or `agent` retain the serial pre-1.0 behavior. A story is ready only when every ID in `needs` passes. The scheduler orders ready work by priority, avoids simultaneously active areas, and uses `agent` as an affinity hint.
