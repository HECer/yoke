---
name: unslop-ui
description: Review visual consistency, hierarchy, and fit to an explicit design brief. Use when asked to improve visual design or assess repetitive template choices; do not infer authorship or block functionality from colors alone.
---

# Review intentional UI design

Read the brand, design brief, target users, and relevant existing screens. Inspect the rendered result, including responsive states, accessibility, content hierarchy, and the primary action.

Use the project's tokens and component system. Look for inconsistent spacing, weak contrast, unclear navigation, overloaded decoration, and layouts that obscure the actual content. Recommend a change because it improves the intended experience, not because purple, gradients, rounded cards, or a particular icon style supposedly prove AI authorship.

`yoke design-scan .` is a deterministic heuristic report. It is optional and only becomes an acceptance gate when the operator explicitly chooses its policy and budget. Treat findings as prompts for inspection; preserve deliberate, accessible brand choices. Do not rewrite unrelated UI or add browser/model passes merely to satisfy a style ritual.

Verify concrete improvements against the brief and relevant user flows. Preserve screenshot evidence where useful and distinguish an aesthetic judgment from a functional defect.

*The original heuristic inspiration is the MIT-licensed [vibecoded-design-tells](https://github.com/JCarterJohnson/vibecoded-design-tells) research (© Carter Johnson). No code or data is copied.*
