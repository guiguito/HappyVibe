/**
 * Web mode — the wire format between a browser tab and main.
 *
 * Electron's IPC carries values by STRUCTURED CLONE, so main and the renderer
 * already trade bytes, dates and maps without thinking about it. A WebSocket
 * carries text, and plain JSON would turn a `Uint8Array` into an object of
 * numbered keys and a `Date` into a string — a feedback image or a file read
 * would arrive as something else entirely. So the few structured-clone types
 * JSON cannot hold are tagged on the way out and rebuilt on the way in.
 *
 * Imports nothing: the browser shim (src/renderer/web) and the server both use
 * it, and anything the renderer imports must not reach Node.
 */

const TAG = "$hv";

type Tagged =
  | { $hv: "bytes"; t: string; b: string }
  | { $hv: "ab"; b: string }
  | { $hv: "date"; v: number }
  | { $hv: "map"; v: unknown[] }
  | { $hv: "set"; v: unknown[] }
  | { $hv: "undef" }
  | { $hv: "num"; v: string }
  | { $hv: "obj"; v: Record<string, unknown> };

const VIEWS: Record<string, new (b: ArrayBuffer) => ArrayBufferView> = {
  Uint8Array,
  Int8Array,
  Uint8ClampedArray,
  Uint16Array,
  Int16Array,
  Uint32Array,
  Int32Array,
  Float32Array,
  Float64Array,
};

function toBase64(bytes: Uint8Array): string {
  let s = "";
  // Chunked: String.fromCharCode(...bytes) overflows the stack on a few MB.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

function fromBase64(b: string): ArrayBuffer {
  const s = atob(b);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

function pack(v: unknown): unknown {
  if (v === undefined) return { [TAG]: "undef" };
  // JSON writes NaN and ±Infinity as null; structured clone keeps them.
  if (typeof v === "number" && !Number.isFinite(v)) return { [TAG]: "num", v: String(v) };
  if (v === null || typeof v !== "object") return v;
  if (ArrayBuffer.isView(v)) {
    const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    // Node's Buffer is a Uint8Array subclass; the browser has no Buffer.
    const t = v.constructor.name in VIEWS ? v.constructor.name : "Uint8Array";
    return { [TAG]: "bytes", t, b: toBase64(bytes) };
  }
  if (v instanceof ArrayBuffer) return { [TAG]: "ab", b: toBase64(new Uint8Array(v)) };
  if (v instanceof Date) return { [TAG]: "date", v: v.getTime() };
  if (v instanceof Map) return { [TAG]: "map", v: [...v].map(([k, x]) => [pack(k), pack(x)]) };
  if (v instanceof Set) return { [TAG]: "set", v: [...v].map(pack) };
  if (v instanceof Error) return { message: v.message, name: v.name };
  if (Array.isArray(v)) return v.map(pack);
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    // Structured clone drops functions; so does JSON. An undefined PROPERTY is
    // dropped too rather than tagged — `"k" in o` is never what a caller reads.
    if (x === undefined || typeof x === "function") continue;
    out[k] = pack(x);
  }
  // An object that happens to carry our tag key is wrapped so it cannot be
  // mistaken for a tagged value on the way back.
  return TAG in out ? { [TAG]: "obj", v: out } : out;
}

function unpack(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(unpack);
  const o = v as Record<string, unknown>;
  if (typeof o[TAG] === "string") {
    const t = o as Tagged;
    switch (t.$hv) {
      case "undef":
        return undefined;
      case "num":
        return Number(t.v);
      case "bytes":
        return new (VIEWS[t.t] ?? Uint8Array)(fromBase64(t.b));
      case "ab":
        return fromBase64(t.b);
      case "date":
        return new Date(t.v);
      case "map":
        return new Map((t.v as Array<[unknown, unknown]>).map(([k, x]) => [unpack(k), unpack(x)]));
      case "set":
        return new Set(t.v.map(unpack));
      case "obj":
        return plainObject(t.v);
    }
  }
  return plainObject(o);
}

/**
 * A received object, rebuilt key by key. `__proto__` is DEFINED as an own
 * property, never assigned: assigning it would swap the object's prototype —
 * the classic way a payload smuggles behaviour into an ordinary object.
 */
function plainObject(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) {
    if (k === "__proto__") Object.defineProperty(out, k, { value: unpack(x), enumerable: true, writable: true, configurable: true });
    else out[k] = unpack(x);
  }
  return out;
}

/** One message on the socket, any direction. */
export type WireMessage =
  /** renderer → main: `ipcRenderer.invoke`. */
  | { t: "invoke"; id: number; ch: string; a: unknown[] }
  /** renderer → main: `ipcRenderer.send`. */
  | { t: "send"; ch: string; a: unknown[] }
  /** main → renderer: the answer to one invoke. */
  | { t: "reply"; id: number; ok: true; v: unknown }
  | { t: "reply"; id: number; ok: false; e: string }
  /** main → renderer: `webContents.send`. */
  | { t: "push"; ch: string; a: unknown[] };

export function encode(m: WireMessage | Record<string, unknown>): string {
  return JSON.stringify(pack(m));
}

export function decode(text: string): unknown {
  return unpack(JSON.parse(text));
}
