# PRD Schema

The loop is driven by a versioned PRD file. Each story:

```yaml
- id: STORY-1
  title: Short imperative description
  priority: 1            # lower = higher priority
  acceptance:            # Definition of Done (required before implementation)
    - The endpoint returns 200 for a valid request.
  passes: false          # set true only when acceptance is met and tests are green
```

Stop condition: every story has `passes: true`.
