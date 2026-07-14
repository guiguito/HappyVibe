/**
 * Round 3 #14 — persistent "bypass all permissions" precedence (PURE, electron-free
 * so it's unit-testable). Mirrors model resolution: workspace overrides global,
 * an unset workspace inherits the global default, default is off.
 */
export function resolveBypass(global: boolean, workspace: boolean | null | undefined): boolean {
  return workspace ?? global;
}
