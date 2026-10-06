/**
 * Env-var naming for catalog MCP secrets (§13 round 8). Electron-free (mirrors
 * mcpStatusKey.ts) so it is unit-testable without mocking safeStorage.
 *
 * The `${...}` wrapper is the form Pi's MCP resolves in `headers` and stdio `env`
 * (core/resolve-config-value.js; `$VAR` works too, `$env:VAR` does not), and a missing
 * variable fails the connection rather than sending an empty value.
 */
const sanitize = (s: string): string => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

export function mcpSecretEnvVar(serverKey: string, inputId: string): string {
  return `HV_MCP_${sanitize(serverKey)}_${sanitize(inputId)}`;
}

export function mcpSecretPlaceholder(serverKey: string, inputId: string): string {
  return `\${${mcpSecretEnvVar(serverKey, inputId)}}`;
}
