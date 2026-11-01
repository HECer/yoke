---
name: health
description: "Assess repository health using actual checks, dependency evidence, and trends. Use for a code health report or quality audit; do not invent numeric quality scores from impressions."
---

# Assess repository health

Inspect the project's supported runtime, dependency lockfiles, build commands, checks, and CI. Run the relevant available tools in an isolated or otherwise safe workspace. Separate baseline failures from issues introduced by the current change.

Report each check as passed, failed, unavailable, or unsupported, with command, version where relevant, exit result, and scope. A failed dependency scanner or missing report is not a clean audit. State known severity and coverage; distinguish production dependencies from development tooling.

Measure trends only when comparable historical data exists. Test counts, source lines, and static warnings are observations, not a universal quality score. Avoid arbitrary 0–10 ratings and estimates presented as measurements.

Investigate high-impact findings and propose the smallest effective repairs. Rank them by correctness/security impact, frequency, operating cost, and effort. Do not install another scanner, create a dashboard, or run every possible tool unless the evidence gap justifies it. Retain detailed reports as artifacts and summarize the actionable results.
