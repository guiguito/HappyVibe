import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { NdjsonDecoder, encodeCommand } from "./codec";
import type { PiResponse } from "./types";

interface SpawnSpec { execPath: string; args: string[]; env: Record<string, string>; cwd: string }
type Pending = { resolve: (r: PiResponse) => void; reject: (e: Error) => void };

export class PiClient extends EventEmitter {
  private child?: ChildProcess;
  private decoder = new NdjsonDecoder();
  private pending = new Map<string, Pending>();
  private seq = 0;

  constructor(private spec: SpawnSpec) { super(); }

  /** OS pid of the Pi subprocess (for persisted pid tracking / orphan sweep). */
  get pid(): number | undefined { return this.child?.pid; }

  async start(): Promise<void> {
    this.child = spawn(this.spec.execPath, this.spec.args, {
      cwd: this.spec.cwd, env: this.spec.env, stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout!.setEncoding("utf8");
    this.child.stdout!.on("data", (chunk: string) => {
      for (const msg of this.decoder.push(chunk)) this.route(msg as Record<string, unknown>);
    });
    this.child.stderr!.setEncoding("utf8");
    this.child.stderr!.on("data", (d: string) => console.error("[pi:stderr]", d.trim()));
    this.child.on("exit", (code) => {
      for (const p of this.pending.values()) p.reject(new Error("pi exited"));
      this.pending.clear();
      this.emit("exit", { code });
    });
  }

  private route(msg: Record<string, unknown>): void {
    if (msg.type === "response" && typeof msg.id === "string" && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      p.resolve(msg as unknown as PiResponse);
    } else if (msg.type === "extension_ui_request") {
      this.emit("ui-request", msg);
    } else {
      this.emit("event", msg);
    }
  }

  send(cmd: { type: string; [k: string]: unknown }): Promise<PiResponse> {
    const id = `req-${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child!.stdin!.write(encodeCommand({ id, ...cmd }));
    });
  }

  // Field names must match docs/validation/d1.md (observed wire shape).
  respondUi(id: string, payload: object): void {
    this.child!.stdin!.write(encodeCommand({ type: "extension_ui_response", id, ...payload }));
  }

  stop(): void { this.child?.kill(); }
}
