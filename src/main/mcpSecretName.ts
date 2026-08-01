/**
 * Env-var naming for catalog MCP secrets (§13 round 8). Electron-free (mirrors
 * mcpStatusKey.ts) so it is unit-testable without mocking safeStorage.
 *
 * The `${...}` wrapper is load-bearing: pi-mcp-adapter interpolates `${VAR}`
 * and `$env:VAR` but NOT bare `$VAR`, which is Pi's separate models.json
 * syntax. Pinned by tests/mcp-adapter-interpolation.test.ts.
 */
const sanitize = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

export function mcpSecretEnvVar(serverKey: string, inputId: string): string {
  return `HV_MCP_${sanitize(serverKey)}_${sanitize(inputId)}`;
}

export function mcpSecretPlaceholder(serverKey: string, inputId: string): string {
  return `\${${mcpSecretEnvVar(serverKey, inputId)}}`;
}
