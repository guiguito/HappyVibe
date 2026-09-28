// The v1 media (Notion: Documentation → Media), checked before the docs plan's Task 16 places it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const MEDIA = new URL("../public/media/", import.meta.url).pathname;
const FFPROBE = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";
const STILLS = [
  "install/install-smartscreen",
  "first-launch/onboarding-setup",
  "models/models-populated",
  "first-session/session-running",
  "approve-a-tool-call/permission-modal",
  "memory/memory-save-prompt",
  "built-in-tools/builtin-tools",
  "plugins/plugins-marketplace",
  "permissions/permissions-rules",
  "audit-log/audit-log",
];
const CLIPS = ["approve-a-tool-call/permission-approve", "mcp/mcp-add"];

for (const s of STILLS) {
  const f = `${MEDIA}${s}.png`;
  assert.ok(existsSync(f), `missing ${s}.png`);
  const b = readFileSync(f);
  assert.equal(b.toString("ascii", 1, 4), "PNG", `${s}.png is not a PNG`);
  const [w, h] = [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (s !== "install/install-smartscreen") assert.deepEqual([w, h], [2880, 1800], `${s}.png is ${w}×${h}, want 2880×1800`);
}

const probe = (f) => JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_streams", "-show_format", "-of", "json", f], { encoding: "utf8" }));
for (const c of CLIPS) {
  for (const [ext, codec] of [["mp4", "h264"], ["webm", "vp9"]]) {
    const f = `${MEDIA}${c}.${ext}`;
    assert.ok(existsSync(f), `missing ${c}.${ext}`);
    const p = probe(f);
    const v = p.streams.find((s) => s.codec_type === "video");
    assert.ok(!p.streams.some((s) => s.codec_type === "audio"), `${c}.${ext} has an audio track`);
    assert.equal(v.codec_name, codec, `${c}.${ext} is ${v.codec_name}, want ${codec}`);
    assert.equal(v.width, 1440, `${c}.${ext} is ${v.width} px wide, want 1440`);
    assert.ok(Number(p.format.duration) <= 15, `${c}.${ext} runs ${p.format.duration} s, max 15`);
  }
  assert.ok(existsSync(`${MEDIA}${c}.jpg`), `missing ${c}.jpg (the poster)`);
}
console.log(`media check: ${STILLS.length} stills, ${CLIPS.length} clips OK`);
