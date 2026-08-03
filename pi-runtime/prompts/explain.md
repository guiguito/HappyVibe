---
description: Explain a file, symbol or subsystem, and how it fits the codebase
argument-hint: "<file, symbol or question>"
---
Explain `${ARGUMENTS:-the file I am currently working in}`.

**1. Find it.** If it is a path, read the whole file. If it is a symbol, locate its definition, then every place it is used — the call sites are what reveal its real contract, which is often narrower than its signature.

**2. Explain it in this order**, adjusting depth to how big the thing is:

- **What it is for** — the problem it solves, in one or two sentences, in the vocabulary of the product rather than the code.
- **How it works** — the actual flow: inputs, the steps that matter, outputs, and where the state lives. Walk one realistic path end to end instead of listing every function.
- **How it connects** — who calls it, what it calls, and which module owns the data it touches.
- **What is load-bearing** — the invariants, ordering constraints or non-obvious choices that would break something if changed. Quote the line and say what breaks.
- **Sharp edges** — error paths, edge cases, anything surprising or clearly historical.

**3. Cite as you go.** Every claim about behaviour gets a `file:line`. If something is unclear from the code, say it is unclear rather than inventing a rationale.

Do not change any files, and do not propose a refactor unless I ask — the goal is that I could confidently edit this code afterwards.
