# Security

HappyVibe asks before an AI agent acts on your machine, so a flaw in that layer matters.

## Reporting

Report privately through GitHub:
**https://github.com/guiguito/HappyVibe/security/advisories/new**

Please don't open a public issue for a vulnerability. You will get an answer within a week.

## What is in scope

- The permission layer: a tool call that runs without the prompt or rule that should govern it, or
  a prompt that describes something other than what actually runs.
- Path confinement: reading or writing outside the workspace without being asked.
- Secret handling: provider keys, MCP credentials, or anything else leaving the machine or landing
  in a file it should not.
- Anything that loads and runs code the user never approved (extensions, skills, prompts, MCP
  servers).

## What is not

HappyVibe is **not a sandbox** and does not claim to be — the gate asks before the agent acts; it is
not a security boundary between the agent and your computer. A command you approved doing what it
says is not a vulnerability.

Only the latest release is supported.
