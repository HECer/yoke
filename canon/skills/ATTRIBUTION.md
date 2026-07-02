# Attribution

The skills in this directory are ported from two MIT-licensed open-source projects.
Their content is used under the terms of the MIT License reproduced below.

---

## gstack

**Source:** https://github.com/garrytan/gstack

**Skills ported:** review, ship, health, retro, document-release, plan-ceo-review,
plan-eng-review

---

## superpowers

**Source:** https://github.com/obra/superpowers

**Skills ported:** tdd (from test-driven-development), brainstorming, writing-plans,
executing-plans, subagent-driven-development, systematic-debugging,
verification-before-completion, using-git-worktrees, requesting-code-review,
receiving-code-review, dispatching-parallel-agents, finishing-a-development-branch,
writing-skills

---

## vibecoded-design-tells (research credit)

**Source:** https://github.com/JCarterJohnson/vibecoded-design-tells (MIT © 2026 Carter Johnson)

The `unslop-ui` rubric and the `yoke design-scan` tell set are **informed by** this data-ranked
study of AI-generated-UI tells. Yoke implements the idea **natively in TypeScript** and copies no
code or data — credited here in the spirit of the MIT license.

---

### gstack (cross-model review, idea credit)

The interactive `yoke review` command is inspired by gstack's `/codex` skill
(https://github.com/garrytan/gstack, MIT © Garry Tan) — an independent second-model
review with a pass/fail gate. Yoke's implementation is native and cross-agent; no code
or data was copied.

Likewise, the browser-QA-as-gate idea behind gstack's `/qa` skill is natively
re-implemented as `yoke flow-smoke` — cross-agent, with a proof-artifact contract
(screenshots always, video kept on failure, under `.yoke/proof/<story>/`); no code
was copied.

---

## MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
