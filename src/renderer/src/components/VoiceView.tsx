import { useCallback, useEffect, useState } from "react";
import { Section } from "./Section";
// Electron-free main modules, imported rather than restated — the pattern
// TerminalView uses for DEFAULT_TERMINAL_SETTINGS. A second copy of the
// language list is how the picker starts disagreeing with what the model does.
import { VOICE_LANGUAGES, resolveLocale } from "../../../main/voice/languages";
import { VOICE_MODEL, VOICE_MODEL_SIZE_LABEL } from "../../../main/voice/manifest";

/**
 * §27 — Settings → Voice.
 *
 * Scope is GLOBAL, like §26's terminal page: every setting is a personal habit
 * or a property of this machine's microphone.
 *
 * Two things here are load-bearing rather than decorative. The language list
 * shows only the 25 the model supports and annotates the weak half, because
 * out-of-set input produces confident garbage rather than a bad transcript.
 * And the licenses block is the ONLY place in the product that names the
 * model — the chip, the activation modal and the progress UI all say
 * "voice model" (§12).
 */

function mb(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  return `${Math.ceil(bytes / 1_000_000)} MB`;
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-6 py-2.5 border-b border-line last:border-0">
      <div className="min-w-0">
        <div className="text-sm font-semibold">{label}</div>
        {hint && <div className="text-[12px] text-ink-soft mt-0.5 leading-relaxed">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`w-11 h-6 rounded-full border-2 transition-colors cursor-pointer relative ${
        on ? "bg-sky-soft border-sky" : "bg-paper-deep border-line"
      }`}
    >
      <span
        className={`absolute top-[2px] size-4 rounded-full bg-card border-2 transition-all ${
          on ? "left-[22px] border-sky" : "left-[2px] border-line"
        }`}
      />
    </button>
  );
}

export function VoiceView(): React.JSX.Element {
  const [status, setStatus] = useState<HvVoiceStatus | null>(null);
  const [settings, setSettings] = useState<HvVoiceSettings | null>(null);
  const [mic, setMic] = useState<string>("unknown");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [level, setLevel] = useState(0);
  const [testing, setTesting] = useState(false);
  const [licensesOpen, setLicensesOpen] = useState(false);

  useEffect(() => {
    void window.hv.voiceStatus().then(setStatus);
    void window.hv.getVoiceSettings().then(setSettings);
    void window.hv.voiceMicStatus().then(setMic);
    return window.hv.onVoiceStatusChanged(setStatus);
  }, []);

  // Device labels are only populated once permission has been granted, so this
  // list is deliberately enumerated after the status check rather than at mount.
  useEffect(() => {
    if (mic !== "granted") return;
    void navigator.mediaDevices
      .enumerateDevices()
      .then((d) => setDevices(d.filter((x) => x.kind === "audioinput")));
  }, [mic]);

  const patch = useCallback(async (p: Partial<HvVoiceSettings>) => {
    setSettings(await window.hv.setVoiceSettings(p as Record<string, unknown>));
  }, []);

  // A live meter for testing the chosen input — the same signal the composer
  // chip shows, so "is my microphone working" is answerable here.
  const runMeterTest = useCallback(async () => {
    if (testing) return;
    setTesting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          ...(settings?.inputDeviceId ? { deviceId: { exact: settings.inputDeviceId } } : {}),
        },
      });
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      const stop = Date.now() + 6000;
      const tick = (): void => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        setLevel(Math.sqrt(sum / buf.length));
        if (Date.now() < stop) requestAnimationFrame(tick);
        else {
          for (const t of stream.getTracks()) t.stop();
          void ctx.close();
          setLevel(0);
          setTesting(false);
        }
      };
      tick();
    } catch {
      setTesting(false);
    }
  }, [settings?.inputDeviceId, testing]);

  const localeInfo = resolveLocale(navigator.language ?? "");
  const state = status?.state ?? "unactivated";
  const pct = status && status.bytesTotal > 0 ? Math.round((status.bytesDone / status.bytesTotal) * 100) : 0;

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-black text-2xl tracking-tight mb-1">Voice</h1>
        <p className="text-sm text-ink-soft mb-6">
          Dictate into the composer. Speech is transcribed on this machine — your audio is never
          written to disk, never leaves this computer, and no transcript is ever logged.
        </p>

        <Section
          icon="voice"
          title="Speech model"
          subtitle="A one-time download. Everything else about this feature works offline."
        >
          {state === "ready" && (
            <>
              <Row label="Status" hint={`Using ${mb(status?.sizeOnDisk ?? 0)} on disk.`}>
                <span className="text-[12px] font-bold rounded-full px-2.5 py-1 bg-leaf-soft text-leaf">
                  Ready
                </span>
              </Row>
              <Row
                label="Remove downloaded model"
                hint={`Frees ${mb(status?.sizeOnDisk ?? 0)}. You can download it again at any time.`}
              >
                <button
                  type="button"
                  onClick={() => void window.hv.voiceRemoveModel()}
                  className="text-[13px] font-semibold px-3 py-1.5 rounded-xl text-berry hover:bg-berry-soft cursor-pointer transition-colors"
                >
                  Remove
                </button>
              </Row>
            </>
          )}

          {state === "downloading" && (
            <Row label="Downloading" hint={`${mb(status?.bytesDone ?? 0)} of ${VOICE_MODEL_SIZE_LABEL} — you can keep working.`}>
              <div className="flex items-center gap-3">
                <div className="w-40 h-2 rounded-full bg-paper-deep overflow-hidden">
                  <div className="h-full bg-sky transition-[width]" style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[12px] tabular-nums text-ink-soft w-9 text-right">{pct}%</span>
                <button
                  type="button"
                  onClick={() => void window.hv.voiceCancelDownload()}
                  className="text-[13px] font-semibold px-3 py-1.5 rounded-xl hover:bg-paper-deep/40 cursor-pointer transition-colors"
                >
                  Cancel
                </button>
              </div>
            </Row>
          )}

          {(state === "unactivated" || state === "error") && (
            <Row
              label={state === "error" ? "Download failed" : "Not set up yet"}
              hint={
                state === "error"
                  ? status?.error
                  : `Voice input needs a ${VOICE_MODEL_SIZE_LABEL} speech model. It runs entirely on your machine.`
              }
            >
              <button
                type="button"
                onClick={() => void window.hv.voiceDownload()}
                className="text-[13px] font-bold px-4 py-2 rounded-xl bg-sky-soft text-sky hover:brightness-95 cursor-pointer transition-all"
              >
                {state === "error" ? "Retry" : "Download"}
              </button>
            </Row>
          )}
        </Section>

        <Section
          icon="voice"
          title="Language"
          subtitle="Pick the language you speak. There is no automatic detection — see the note below."
        >
          <Row
            label="Spoken language"
            hint={
              localeInfo.supported
                ? undefined
                : `Your system language is not one of the ${VOICE_LANGUAGES.length} this model supports, so English is used by default.`
            }
          >
            <select
              value={settings?.language ?? "en"}
              onChange={(e) => void patch({ language: e.target.value })}
              className="text-sm rounded-xl border-2 border-line bg-card px-3 py-1.5 cursor-pointer"
            >
              {VOICE_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                  {l.tier === "lower" ? " — lower accuracy" : ""}
                </option>
              ))}
            </select>
          </Row>
          <p className="text-[12px] text-ink-soft mt-3 leading-relaxed">
            Accuracy varies a lot across these {VOICE_LANGUAGES.length}. The ones marked{" "}
            <em>lower accuracy</em> are noticeably weaker, and it is better to know that than to
            find out one bad prompt at a time. Languages outside this list are not offered at all:
            the model does not degrade gracefully on them, it produces confident nonsense.
          </p>
        </Section>

        <Section icon="voice" title="Microphone" subtitle="Which input to use, and how much processing to apply.">
          <Row label="Input device">
            <select
              value={settings?.inputDeviceId ?? ""}
              onChange={(e) => void patch({ inputDeviceId: e.target.value })}
              className="max-w-64 text-sm rounded-xl border-2 border-line bg-card px-3 py-1.5 cursor-pointer"
            >
              <option value="">System default</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || "Microphone"}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Test" hint="Speak — the bar should move. If it does not, the microphone is not reaching the app.">
            <div className="flex items-center gap-3">
              <div className="w-32 h-2 rounded-full bg-paper-deep overflow-hidden">
                <div
                  className="h-full bg-leaf transition-[width] duration-75"
                  style={{ width: `${Math.min(100, level * 320)}%` }}
                />
              </div>
              <button
                type="button"
                onClick={() => void runMeterTest()}
                disabled={testing}
                className="text-[13px] font-semibold px-3 py-1.5 rounded-xl hover:bg-paper-deep/40 cursor-pointer transition-colors disabled:opacity-50"
              >
                {testing ? "Listening…" : "Test"}
              </button>
            </div>
          </Row>
          <Row
            label="Echo cancellation"
            hint="Right for most people. Turn these off if you are on a dedicated audio interface."
          >
            <Toggle
              on={settings?.echoCancellation ?? true}
              onChange={(v) => void patch({ echoCancellation: v })}
              label="Echo cancellation"
            />
          </Row>
          <Row label="Noise suppression">
            <Toggle
              on={settings?.noiseSuppression ?? true}
              onChange={(v) => void patch({ noiseSuppression: v })}
              label="Noise suppression"
            />
          </Row>
          <Row label="Automatic gain control">
            <Toggle
              on={settings?.autoGainControl ?? true}
              onChange={(v) => void patch({ autoGainControl: v })}
              label="Automatic gain control"
            />
          </Row>
        </Section>

        <Section
          icon="voice"
          title="Behaviour"
          subtitle="Hold the right-hand modifier to dictate while held; tap it to keep recording until you tap again."
        >
          <Row
            label="Hold threshold"
            hint="Press for longer than this and releasing stops the recording. Shorter, and it latches on."
          >
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={100}
                max={1000}
                step={50}
                value={settings?.holdThresholdMs ?? 300}
                onChange={(e) => void patch({ holdThresholdMs: Number(e.target.value) })}
                className="w-40 cursor-pointer"
              />
              <span className="text-[12px] tabular-nums text-ink-soft w-14 text-right">
                {settings?.holdThresholdMs ?? 300} ms
              </span>
            </div>
          </Row>
          <Row
            label="Maximum recording"
            hint="A safety limit, so a forgotten microphone cannot record indefinitely."
          >
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={30}
                max={600}
                step={30}
                value={Math.round((settings?.maxRecordingMs ?? 300_000) / 1000)}
                onChange={(e) => void patch({ maxRecordingMs: Number(e.target.value) * 1000 })}
                className="w-40 cursor-pointer"
              />
              <span className="text-[12px] tabular-nums text-ink-soft w-14 text-right">
                {Math.round((settings?.maxRecordingMs ?? 300_000) / 60_000)} min
              </span>
            </div>
          </Row>
        </Section>

        <Section icon="voice" title="Permissions" subtitle="Voice input needs the operating system's permission to use the microphone.">
          <Row
            label="Microphone access"
            hint={
              mic === "denied"
                ? "Access is denied. Grant it in System Settings — macOS requires the app to be restarted before the change takes effect."
                : mic === "not-determined"
                  ? "Not requested yet. You will be asked the first time you dictate."
                  : undefined
            }
          >
            <div className="flex items-center gap-2">
              <span
                className={`text-[12px] font-bold rounded-full px-2.5 py-1 ${
                  mic === "granted" ? "bg-leaf-soft text-leaf" : "bg-honey-soft text-tangerine"
                }`}
              >
                {mic === "granted" ? "Granted" : mic === "denied" ? "Denied" : "Not requested"}
              </span>
              {mic === "denied" && (
                <button
                  type="button"
                  onClick={() => void window.hv.voiceOpenMicSettings()}
                  className="text-[13px] font-semibold px-3 py-1.5 rounded-xl hover:bg-paper-deep/40 cursor-pointer transition-colors"
                >
                  Open System Settings
                </button>
              )}
            </div>
          </Row>
        </Section>

        {/* §12: the ONE place in the product that names the model. */}
        <section className="rounded-2xl bg-card border-2 border-line shadow-sticker-lg p-6 mb-6">
          <button
            type="button"
            onClick={() => setLicensesOpen((o) => !o)}
            aria-expanded={licensesOpen}
            className="w-full flex items-center justify-between gap-2 cursor-pointer"
          >
            <span className="font-bold text-sm">Open source licenses</span>
            <span aria-hidden className="text-ink-soft text-xs">
              {licensesOpen ? "Hide" : "Show"}
            </span>
          </button>
          {licensesOpen && (
            <div className="mt-4 text-[12px] leading-relaxed text-ink-soft space-y-2">
              <p>
                Speech recognition uses{" "}
                <a
                  href={VOICE_MODEL.attribution.modelUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-sky underline"
                >
                  {VOICE_MODEL.attribution.model}
                </a>{" "}
                by NVIDIA, licensed{" "}
                <a
                  href={VOICE_MODEL.attribution.licenseUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-sky underline"
                >
                  {VOICE_MODEL.attribution.license}
                </a>
                . The weights are used unmodified, in a quantized ONNX export
                (<code className="font-mono">{VOICE_MODEL.repo}</code>).
              </p>
              <p>
                Inference uses <code className="font-mono">sherpa-onnx</code> (Apache-2.0) and ONNX
                Runtime (MIT).
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
