/**
 * §37 — the two renderer failure shapes, thrown from REAL module code.
 *
 * It exists because the first GUI pass triggered renderer errors with a CDP
 * `eval`, which has no file: every frame came back `{line: 1, inApp: false}`
 * and read like a broken integration. It was the probe that was broken. A
 * throw from a real module gives `{function, file, line, col, inApp: true}`,
 * so this file is what makes "are the frames any good" an answerable question
 * rather than an argument.
 *
 * Dev only, and reached from `window.hv.crashProbe(...)` — no button anywhere,
 * on the same reasoning as `hv:crash-test`: a control that renders only in
 * development is UI built for a test, on a page whose job is to be believable.
 */
import React from "react";

/** Several NAMED frames deep, so the report carries a stack worth reading. */
function innerRendererWork(): never {
  throw new Error("hv:crash-probe renderer");
}
function middleRendererWork(): never {
  return innerRendererWork();
}
export function throwFromRendererModule(): never {
  return middleRendererWork();
}

/**
 * A component that throws DURING RENDER — the error-boundary path, and the
 * only one whose frames come from React's component stack rather than from a
 * JS stack. `createErrorBoundary` turns that stack into one in-app frame per
 * component, which is what makes a render error group by the component that
 * threw instead of by React's internals.
 */
export function BrokenOnPurpose(): React.JSX.Element {
  throw new Error("hv:crash-probe render");
}
