/**
 * PRD §33 — the policy tells the model "do not save secrets"; this is what makes that a RULE
 * rather than a request (§20 Principle 11: guidance that describes a gate is derived from it).
 * A hit refuses the save with the reason and audits `memory.refused`.
 *
 * Exported so the How-memory-works disclosure test can pin its copy to this list.
 *
 * The length floors are load-bearing: the repo's own docs and tests are full of `sk-REPLACE`,
 * and a scanner that refuses to save a sentence ABOUT a key is worse than no scanner — the
 * user learns to distrust it and turns memory off.
 */
export const SECRET_PATTERNS = [
  { id: "openai", label: "an API key (sk-…)", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { id: "github", label: "a GitHub token (ghp_/gho_/ghs_…)", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { id: "aws", label: "an AWS access key (AKIA…)", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "bearer", label: "a bearer token", re: /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/ },
  { id: "pem", label: "a private key block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: "slack", label: "a Slack token (xox…)", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
] as const;

export function findSecret(text: string): { id: string; label: string } | null {
  for (const p of SECRET_PATTERNS) if (p.re.test(text)) return { id: p.id, label: p.label };
  return null;
}
