/**
 * The hunks of HappyVibe's owned patch to @tintinweb/pi-subagents 0.19.0 (PRD §3 2026-09-26;
 * spec: Notion "tintinweb/pi-subagents — evaluation & migration plan" §3.4). Anchors are copied
 * verbatim from the pinned version; a pin bump that moves one fails `npm ci` loudly.
 *
 *  P1  children inherit the parent's project trust (loader AND session share one manager)
 *  P2  an `extensions:` list of paths only stops discovery (upstream-worthy on its own)
 *  P3  the host's child policy decides what loads, who is being built, and what is refused
 *  P4  a project's own subagents.json is never read under HappyVibe
 *  P5  workflow gate commands never run; saved workflows only from the agent dir
 *  P6  host control verbs on the bus: steer a running agent, stop a workflow
 */
export const HUNKS = [
  {
    id: "P3-context",
    file: "src/child-context.ts",
    find: `const childSessionContext = new AsyncLocalStorage<boolean>();

export function inChildSessionContext(): boolean {
  return childSessionContext.getStore() === true;
}

export function runInChildSessionContext<T>(fn: () => Promise<T>): Promise<T> {
  return childSessionContext.run(true, fn);
}`,
    replace: `// hv-patch:P3-context — the store names the child being built, so a host guard loaded into it knows its run.
export interface ChildSpawnInfo { agentId?: string; type?: string }
const childSessionContext = new AsyncLocalStorage<ChildSpawnInfo>();
(globalThis as any)[Symbol.for("pi-subagents:child-spawn")] = (): ChildSpawnInfo | undefined => childSessionContext.getStore();

export function inChildSessionContext(): boolean {
  return childSessionContext.getStore() !== undefined;
}

export function runInChildSessionContext<T>(fn: () => Promise<T>, info: ChildSpawnInfo = {}): Promise<T> {
  return childSessionContext.run(info, fn);
}`,
  },
  {
    id: "P3-helper",
    file: "src/agent-runner.ts",
    find: `import { runInChildSessionContext } from "./child-context.js";`,
    replace: `import { runInChildSessionContext } from "./child-context.js";
// hv-patch:P3-helper — HappyVibe's host child policy. Under HV_HOST=1 a missing policy fails closed.
const hvChildPolicy = (): undefined | { extensionPaths(): string[]; skillPaths(): string[] } => {
  const p = (globalThis as any)[Symbol.for("hv:child-policy")];
  if (!p && process.env.HV_HOST === "1") throw new Error("HappyVibe: child policy missing — refusing to build a sub-agent without its guard");
  return p;
};`,
  },
  {
    id: "P3-memory",
    file: "src/agent-runner.ts",
    find: `  if (agentConfig?.memory) {`,
    replace: `  if (agentConfig?.memory && !hvChildPolicy()) { // hv-patch:P3-memory — agent memory is HappyVibe's (§33), never an agent file's`,
  },
  {
    id: "P1-loader",
    file: "src/agent-runner.ts",
    find: `  const loader = new DefaultResourceLoader({
    cwd: configCwd,
    agentDir,
    noExtensions,
    additionalExtensionPaths,
    extensionsOverride,
    noSkills,
`,
    replace: `  // hv-patch:P1-loader — P1 inherit the parent's trust; P2 no discovery for path-only lists; P3 the host decides what loads.
  const hvPolicy = hvChildPolicy();
  const hvSettings = SettingsManager.create(configCwd, agentDir, { projectTrusted: ctx.isProjectTrusted?.() ?? false });
  const loader = new DefaultResourceLoader({
    cwd: configCwd,
    agentDir,
    settingsManager: hvSettings,
    // P2: path entries put their canonical name in keepNames too, so "path-only" = every kept name came from a path.
    noExtensions: hvPolicy ? true : noExtensions || (!!additionalExtensionPaths && !loadAll && [...keepNames].every((n) => additionalExtensionPaths.some((p) => extensionCanonicalName(p) === n))),
    additionalExtensionPaths: hvPolicy ? hvPolicy.extensionPaths() : additionalExtensionPaths,
    extensionsOverride: hvPolicy ? undefined : extensionsOverride,
    noSkills: hvPolicy ? true : noSkills,
    ...(hvPolicy ? { additionalSkillPaths: hvPolicy.skillPaths() } : {}),
`,
  },
  {
    id: "P3-identity",
    file: "src/agent-runner.ts",
    find: `  await runInChildSessionContext(() => loader.reload());`,
    replace: `  await runInChildSessionContext(() => loader.reload(), { agentId: options.agentId, type }); // hv-patch:P3-identity`,
  },
  {
    id: "P1-settings",
    file: "src/agent-runner.ts",
    find: `  const settingsManager = SettingsManager.create(configCwd, agentDir);`,
    replace: `  const settingsManager = hvSettings; // hv-patch:P1-settings — one trust-inheriting manager for the loader AND the session`,
  },
  {
    id: "P3-sessiondir",
    file: "src/agent-runner.ts",
    find: `  const configuredSessionDir = resolveConfiguredSessionDir(agentConfig?.sessionDir, effectiveCwd);`,
    replace: `  const configuredSessionDir = hvChildPolicy() ? undefined : resolveConfiguredSessionDir(agentConfig?.sessionDir, effectiveCwd); // hv-patch:P3-sessiondir`,
  },
  {
    id: "P3-model",
    file: "src/model-resolver.ts",
    find: `  // 2. Fuzzy match against available models.`,
    replace: `  // hv-patch:P3-model — under HappyVibe only an exact, usable provider/modelId is accepted (PRD §16: refuse, never substitute).
  if ((globalThis as any)[Symbol.for("hv:child-policy")]) return \`Model "\${input}" is not an exact provider/modelId HappyVibe can use. Name it exactly as provider/model, or omit it to use the agent's default.\`;
  // 2. Fuzzy match against available models.`,
  },
  {
    id: "P3-refuse",
    file: "src/agent-manager.ts",
    // Anchored on spawn()'s own comment: the same call recurs in the queued-start re-check (:674), which
    // needs no refusal of its own — every queued spawn already passed through spawn().
    find: `    // can fix and retry; the RPC layer converts throws into error envelopes.
    assertValidSpawnCwd(options.cwd);
`,
    replace: `    // can fix and retry; the RPC layer converts throws into error envelopes.
    assertValidSpawnCwd(options.cwd);
    { const hvRefusal = (globalThis as any)[Symbol.for("hv:child-policy")]?.refuseSpawn?.(type); if (hvRefusal) throw new Error(hvRefusal); } // hv-patch:P3-refuse
`,
  },
  {
    id: "P4-settings",
    file: "src/settings.ts",
    find: `  return { ...readSettingsFile(globalPath()), ...readSettingsFile(projectPath(cwd)) };`,
    replace: `  // hv-patch:P4-settings — under HappyVibe a project's own subagents.json is never read (the project is never trusted).
  if (process.env.HV_HOST === "1") return readSettingsFile(globalPath());
  return { ...readSettingsFile(globalPath()), ...readSettingsFile(projectPath(cwd)) };`,
  },
  {
    id: "P5-gate",
    file: "src/workflow/host.ts",
    find: `  async function executeGate(command: string, cwd: string): Promise<WorkflowGateResult> {
`,
    replace: `  async function executeGate(command: string, cwd: string): Promise<WorkflowGateResult> {
    // hv-patch:P5-gate — a gate is a shell command that would never reach HappyVibe's bash rules.
    if (process.env.HV_HOST === "1") return { ok: false, output: \`HappyVibe does not run workflow gate commands — run the check with the bash tool instead: \${command}\` };
`,
  },
  {
    id: "P5-saved",
    file: "src/workflow/saved.ts",
    find: `    join(cwd, ".pi", "workflows"),
    join(cwd, ".agents", "workflows"),
`,
    replace: `    ...(process.env.HV_HOST === "1" ? [] : [join(cwd, ".pi", "workflows"), join(cwd, ".agents", "workflows")]), // hv-patch:P5-saved
`,
  },
  {
    id: "P6-types",
    file: "src/cross-extension-rpc.ts",
    find: `  consumeResult(id: string): boolean;
}`,
    replace: `  consumeResult(id: string): boolean;
  /** hv-patch:P6-types — host control verbs. */
  steer?(id: string, message: string): boolean;
  stopWorkflow?(runId: string): boolean;
}`,
  },
  {
    id: "P6-handle",
    file: "src/cross-extension-rpc.ts",
    find: `  unsubConsume: () => void;
}`,
    replace: `  unsubConsume: () => void;
  unsubSteer: () => void; // hv-patch:P6-handle
  unsubWorkflowStop: () => void;
}`,
  },
  {
    id: "P6-control",
    file: "src/cross-extension-rpc.ts",
    find: `  return { unsubPing, unsubSpawn, unsubStop, unsubConsume };`,
    replace: `  // hv-patch:P6-control — steer a running top-level agent; stop a workflow run (the TUI menu was the only way).
  const unsubSteer = handleRpc<{ requestId: string; agentId: string; message: string }>(
    events, "subagents:rpc:steer", ({ agentId, message }) => {
      const record = manager.getRecord(agentId);
      if (!record) throw new Error("Agent not found");
      if (!isTopLevelAgent(record)) throw new Error("Agent is owned by another agent or workflow");
      if (!manager.steer?.(agentId, message)) throw new Error("Agent is not running");
    },
  );
  const unsubWorkflowStop = handleRpc<{ requestId: string; runId: string }>(
    events, "subagents:rpc:workflow-stop", ({ runId }) => {
      if (!manager.stopWorkflow?.(runId)) throw new Error("Workflow is not running");
    },
  );
  return { unsubPing, unsubSpawn, unsubStop, unsubConsume, unsubSteer, unsubWorkflowStop };`,
  },
  {
    id: "P6-facade",
    file: "src/index.ts",
    find: `          abort: (id) => manager.abort(id),
`,
    replace: `          abort: (id) => manager.abort(id),
          // hv-patch:P6-facade — same semantics as the @handle steer path (un-consume so the reply is relayed).
          steer: (id: string, message: string) => {
            const rec = manager.getRecord(id) as any;
            if (rec) rec.resultConsumed = false;
            const ok = manager.steer(id, message);
            if (ok) pi.events.emit("subagents:steered", { id, message });
            return ok;
          },
          stopWorkflow: (runId: string) => {
            const t = workflowTasks.get(runId);
            if (!t || t.abortController.signal.aborted) return false;
            t.abortController.abort();
            return true;
          },
`,
  },
  {
    // A SubagentWorkflow TOOL call writes no session entry while it runs, and its children emit no bus
    // events (measured, docs/validation/tw1.md) — so the only live progress is this in-memory callback.
    id: "P6-progress",
    file: "src/index.ts",
    find: `        onProgress: entries => updateWorkflowProgressBatch(task, entries),`,
    replace: `        onProgress: entries => { updateWorkflowProgressBatch(task, entries); pi.events.emit("subagents:workflow-progress", { runId: task.id, entries }); }, // hv-patch:P6-progress`,
  },
  {
    // The workflow TOOL path's completion is otherwise visible only as a model-facing
    // notification; the host needs it on the bus to end the run's busy state and card.
    id: "P6-settled",
    file: "src/index.ts",
    find: `      void runWorkflowTask(ctx, task).then(() => notifyWorkflowFinished(task));`,
    replace: `      void runWorkflowTask(ctx, task).then(() => { pi.events.emit("subagents:workflow-settled", { runId: task.id, status: task.status }); notifyWorkflowFinished(task); }); // hv-patch:P6-settled`,
  },
  {
    id: "P6-teardown",
    file: "src/index.ts",
    find: `    rpcHandle?.unsubConsume();
`,
    replace: `    rpcHandle?.unsubConsume();
    rpcHandle?.unsubSteer(); // hv-patch:P6-teardown
    rpcHandle?.unsubWorkflowStop();
`,
  },
];
