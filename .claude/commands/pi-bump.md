---
description: Bump the vendored Pi runtime pins (pi-coding-agent / pi-subagents / pi-mcp-adapter) and find what the bump silently broke
---

Bump one or more vendored Pi pins: **$ARGUMENTS** (empty = audit what's available and ask).

The pins live in `pi-runtime/package.json`. A bump is never just a version number — the
2026-08-02 `pi-subagents` 0.34→0.40 bump changed four behaviours and **not one test failed**.
The whole point of this command is finding those before a user does.

**Stop at the first real failure** — report it, don't work around it. But read §6 first: three of
the four things found that day were *not* where the tests were looking, and one "regression" was
my own bad reasoning.

---

### 1. Read the changelog before touching anything

The package ships one, and it is the cheapest possible source of truth:

```
pi-runtime/node_modules/<pkg>/CHANGELOG.md    # 149KB for pi-subagents
pi-runtime/node_modules/<pkg>/README.md       # 130KB
```

Read **every entry between the current pin and the target**, not just the latest. Write down each
entry that touches: a tool name, a config key, an event payload shape, a validation rule, or
anything gated on `hasUI`. Those are the four shapes that break us.

Also fetch the published docs (`https://pi.dev/packages/<pkg>`) — they state *intent*, which the
source doesn't. On 2026-08-02 the docs were what revealed that a suspected blocker wasn't one.

Nothing that follows is a substitute for this step. Skipping it is what turned a one-line fix
into a day.

### 2. Branch, then bump one package at a time

On `main`? `git checkout -b chore/bump-<pkg>-<version>`. Never commit to `main`.

```
cd pi-runtime && npm install <pkg>@<version> --save-exact
```

Then **check the lockfile diff for collateral**:

```
git diff pi-runtime/package-lock.json | grep -E '^[+-]\s+"(version|resolved)"'
```

A pin bump moves *transitive* deps too. The 0.40 bump silently moved the bridge's `typebox`
1.1.24 → 1.1.38 — the library that builds every registered tool's schema — because `typebox`
wasn't a direct dependency. Any moved package that our own code imports **bare** is a finding.

### 3. Run the gate, then the live batch

`npm run gate` (don't run `typecheck` first — `build` already does it).

Then `npm run live:why`. It greps `main...HEAD`, so **it lies before you commit** — if the working
tree touches `pi-runtime/extensions/` or `src/main/pi/`, the batch is required regardless of what
it prints. A pin bump always requires it.

`npm run test:live` — batched, serial, once. Redirect, never pipe to `tail` (you'd get tail's exit
code and a green-looking red suite):

```
L=/tmp/live.log; npm run test:live > $L 2>&1; echo "REAL_EXIT=$?" >> $L; tail -30 $L
```

### 4. Then go look at the running app — the tests will not find everything

**This is the step that earns its keep.** On 2026-08-02 the worst regression (delegation failing
outright, `"requested unavailable child tools: glob, list"`) was invisible to all 13 live files and
surfaced within a minute of driving a real delegation in the GUI.

Follow `uicheck.md`: `attach {debugPort: 9222}`, never `start_app`. Then exercise whatever the
changelog touched — for a subagents bump that means dispatching a real delegation and watching the
card, not just checking the app boots.

Then check the artifacts the UI doesn't show you:

```
ls -t <tmpdir>/pi-subagents-uid-$(id -u)/async-subagent-runs/ | head
# read the newest status.json: state, error, steps[].error
```

A run can report a plausible answer in the UI while its `status.json` says `state: "failed"`.

### 5. Fix, with a contract test per finding

Every finding gets a **key-free** test in `tests/pi-subagents-contract.test.ts` (or a sibling) that
would have caught it. Derive the expectation from the vendored package or from Pi's own
registrations — never hardcode what you believe, assert what is installed:

- a tool name → grep the name upstream actually registers, assert our matcher covers it
- a tool list → derive the legal set from Pi's `dist/core/tools/*.js` registrations
- a wire shape → assert the field's presence *or absence*, so a future restore is noticed
- a deep import → import it by the same path the bridge uses, so a move fails at import

Never edit a test to make new code pass. Updating a test because *upstream* deliberately changed a
contract is legitimate — say so in the commit and record the new shape in `docs/validation/d1.md`.

### 6. The four traps, all paid for in real time

**`ctx.hasUI` is TRUE in `--mode rpc`.** Upstream code and docs say "headless sessions do X" and
gate X on `ctx.hasUI`; Pi's headless mode is **print** mode, and rpc binds a real `uiContext`.
I read one such gate, assumed it applied to us, and burned hours on a mitigation for a
non-problem. **Measure the boolean with a throwaway probe extension — never infer it from a mode
name:**

```ts
export default function activate(pi) {
  pi.on("agent_end", (_e, ctx) =>
    ctx.ui.notify(JSON.stringify({ hasUI: ctx.hasUI }), "info"));
}
```

**A test that bypasses the branch in question proves nothing.** I "confirmed" that same
non-problem by calling the drain function directly — skipping the `hasUI` guard that made it
unreachable. If a gate is what you're reasoning about, your test must go *through* it.

**Explaining away disconfirming evidence is the real failure.** The GUI showed no problem and I
invented a reason ("the run failed, so it threw") to keep my premise alive. When the app disagrees
with your model, the app is right.

**An exports map only gates BARE specifiers.** If a bump makes a deep import unresolvable
(`ERR_PACKAGE_PATH_NOT_EXPORTED`), a relative path (`../node_modules/<pkg>/src/...`) still works,
and fails *loudly at import* rather than silently degrading. Check this before considering a
reimplementation, a fork, or `patch-package`.

### 7. Land

`npm run gate` green + live batch run (state honestly if amber, with the isolation reruns and any
probe evidence — a reproducing prose-turn failure is not the same as a regression, and isolation
alone cannot tell them apart).

Fold the durable lessons into `CLAUDE.md` and the wire shapes into `docs/validation/d1.md` in the
same session. One commit per logical change; `/land` is the close-out gate.

The changelog is written at release time, not here (PRD §30) — but if the bump changes
something a USER can see (new builtin agents, a new provider, a new tool), say so in the commit
body, because that is what the `changelog` skill will be reading months later.
