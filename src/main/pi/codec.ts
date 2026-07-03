export class NdjsonDecoder {
  private buf = "";
  push(chunk: string): unknown[] {
    this.buf += chunk;
    const lines = this.buf.split("\n");
    this.buf = lines.pop() ?? "";
    const out: unknown[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); }
      catch { console.error("[codec] skipped malformed line:", line.slice(0, 200)); }
    }
    return out;
  }
}
export function encodeCommand(cmd: object): string { return JSON.stringify(cmd) + "\n"; }
