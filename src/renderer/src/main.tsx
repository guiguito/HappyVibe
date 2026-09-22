import './styles.css'

import React, { StrictMode } from 'react'
import type { ComponentType, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { installElectronRenderer } from 'inlet-sdk/crash/electron-renderer'
import { createErrorBoundary } from 'inlet-sdk/crash/react'
import App from './App'
import { rendererAppRoot } from './crashRoot'
import { BrokenOnPurpose, throwFromRendererModule } from './crashProbe'

// §37. The renderer entry, NOT `inlet-sdk/crash/electron`: the main entry
// statically imports node:fs, node:os, node:crypto and node:path, which Vite
// cannot bundle for a browser. That is enforced upstream too, but the failure
// here would be a build error nobody sees until release, so it is also pinned
// by tests/crash-wiring.test.ts.
//
// A renderer holds no key, no queue and no transport — it builds an envelope
// and hands it to main over `inlet:crash`, which fills the release and decides
// what to do with it.
// §37 round 3: `installElectronRenderer` derives its own roots per protocol
// since inlet-sdk 0.1.3, so it is given none — that was `crashRoot.ts`'s first
// job and it is upstream's now.
//
// `createErrorBoundary` is NOT fixed the same way and still needs them: its
// `appRoots` defaults to `[]`, and with no roots `markFrames` sends every frame
// carrying a file to `<external>`. The SDK derives the right value internally
// (`defaultAppRoots`) but neither exports it nor exposes it on the capture, so
// `rendererAppRoot` survives for this one call. DO NOT delete it thinking 0.1.3
// covered it — every React render-error frame would silently become
// `<external>` and no test outside crash-sdk-contract would notice.
const capture = installElectronRenderer()
const appRoots = [rendererAppRoot(window.location)]

// Before this there was NO error boundary anywhere in the renderer, so a React
// render error was a white window with nothing on screen and nothing recorded.
// The component stack becomes one in-app frame per component, which is what
// makes a render error group by the component that threw rather than by React.
// inlet-sdk 0.1.2 types this against a structural `ReactLike` whose
// `createElement` is `(...args: unknown[]) => unknown`, which real React's
// overloaded signature does not satisfy, and it returns a class TS will not
// accept as a JSX element type. The RUNTIME is correct — this is purely the
// declaration's shape — so both ends are cast once, here, and nothing else is
// widened. Delete both casts when upstream's types accept React itself.
type BoundaryProps = { fallback?: ReactNode; children?: ReactNode }
const CrashBoundary = createErrorBoundary(
  React as unknown as Parameters<typeof createErrorBoundary>[0],
  (r) => capture.captureReport(r),
  { appRoots },
) as unknown as ComponentType<BoundaryProps>

function Broken(): React.JSX.Element {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <p className="text-lg font-bold">This view broke.</p>
      <p className="text-sm opacity-70">Your sessions are safe — they run outside this window.</p>
      <button
        className="rounded-lg border px-4 py-2 text-sm font-bold"
        onClick={() => location.reload()}
      >
        Reload
      </button>
    </div>
  )
}

const root = createRoot(document.getElementById('root')!)
root.render(
  <StrictMode>
    <CrashBoundary fallback={<Broken />}>
      <App />
    </CrashBoundary>
  </StrictMode>
)

// §37: the renderer-side crash probes, dev only. Exposed rather than wired to
// a button — see crashProbe.tsx. `render` remounts the app with a component
// that throws, which is the only way to exercise the error boundary for real.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).hvCrashProbe = (kind: 'renderer' | 'render'): string => {
    if (kind === 'renderer') { setTimeout(throwFromRendererModule, 0); return 'renderer throw scheduled' }
    if (kind === 'render') { root.render(<CrashBoundary fallback={<Broken />}><BrokenOnPurpose /></CrashBoundary>); return 'render error mounted' }
    return 'unknown probe'
  }
}
