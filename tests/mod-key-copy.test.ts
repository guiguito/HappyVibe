import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { micSettingsLabel, modKey, revealLabel, shellCopy, THIS_COMPUTER, YOUR_COMPUTER } from "../src/renderer/src/platformCopy";
import { FIXED_SHORTCUTS, formatBinding } from "../src/renderer/src/shortcuts";
import { basename } from "../src/renderer/src/basename";

/**
 * PRD §4 (Windows round), key-free — the renderer suite has no DOM, so a visual
 * contract is pinned as data plus a source scan (CLAUDE.md's rule).
 *
 * Shortcut MATCHING already collapsed ⌘/Ctrl to `Mod`, so bindings worked on Windows
 * from the start. What did not travel was the printed text: `formatBinding` defaulted
 * to `mac = true` and every call site omits the argument, so the Shortcuts page, the
 * tab strip's `+` menu and half a dozen tooltips all named a key that is not on the
 * keyboard.
 *
 * The scan is the half that rots: a new `⌘` typed into a tooltip next year is exactly
 * the regression this exists to catch, and an absence cannot be screenshotted.
 */
const SRC = path.join(__dirname, "..", "src", "renderer", "src");

/** Files where the glyph is legitimately spelled out. */
const ALLOW = new Set([
  "platformCopy.ts", // defines it
  "shortcuts.ts", // formatBinding's mac branch
  "voice/useDictation.ts", // already platform-branched, and a press-and-hold, not a binding
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Source with comments removed — an explanatory ⌘ in a comment is fine. */
function code(file: string): string {
  return fs
    .readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("modKey", () => {
  it("is ⌘ on darwin and Ctrl everywhere else", () => {
    expect(modKey("darwin")).toBe("⌘");
    expect(modKey("win32")).toBe("Ctrl");
    expect(modKey("linux")).toBe("Ctrl");
  });
});

describe("formatBinding", () => {
  it("still renders both forms when told which", () => {
    expect(formatBinding("Mod-k", true)).toContain("⌘");
    expect(formatBinding("Mod-k", false)).toContain("Ctrl");
  });

  it("defaults to the running platform rather than to Mac", () => {
    // The whole bug: every call site omits the argument.
    const src = code(path.join(SRC, "shortcuts.ts"));
    expect(src).toMatch(/formatBinding\(binding: string, mac = IS_MAC\)/);
    expect(src, "a hardcoded default is the regression").not.toMatch(/mac = true/);
  });
});

describe("no literal ⌘ survives in rendered copy", () => {
  it("scans every renderer source file", () => {
    const offenders = walk(SRC)
      .filter((f) => !ALLOW.has(path.relative(SRC, f).split(path.sep).join("/")))
      .filter((f) => code(f).includes("⌘"))
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"));
    expect(offenders, "use MOD from platformCopy instead").toEqual([]);
  });

  it("and the allowlist is exactly the three places it belongs", () => {
    // Kept small deliberately: each entry is a place the glyph is CHOSEN, not typed.
    expect([...ALLOW].sort()).toEqual(["platformCopy.ts", "shortcuts.ts", "voice/useDictation.ts"]);
  });
});

describe("docs-round #28/#12/#22/#11: a key hint follows the binding", () => {
  /**
   * `${MOD}K` printed "CtrlK" off macOS — no separator — and ignored a rebound
   * shortcut, because MOD is a glyph, not a binding. MOD stays for naming the
   * key itself ("Hold right Ctrl"); a COMBINATION goes through formatBinding.
   */
  it("no hint glues MOD to a key", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const rel = path.relative(SRC, f).split(path.sep).join("/");
      for (const line of code(f).split("\n")) {
        if (/\{MOD\}[A-Za-z0-9\\,./]/.test(line)) offenders.push(`${rel}: ${line.trim().slice(0, 90)}`);
      }
    }
    expect(offenders, "use formatBinding(binding) instead").toEqual([]);
  });

  it("no ⌘ hides behind a \\u2318 escape — a JSX attribute prints it as six characters", () => {
    const offenders = walk(SRC)
      .filter((f) => /\\u2318/i.test(code(f)))
      .map((f) => path.relative(SRC, f).split(path.sep).join("/"));
    expect(offenders).toEqual([]);
  });

  it("the Built-in list names Shift the way the running platform does", () => {
    expect(code(path.join(SRC, "shortcuts.ts"))).not.toContain('"⇧Enter"');
    expect(code(path.join(SRC, "shortcuts.ts"))).toContain('formatBinding("Shift-Enter")');
    expect(FIXED_SHORTCUTS.map((s) => s.keys)).toContain(formatBinding("Shift-Enter"));
    expect(formatBinding("Shift-Enter", false)).toBe("Shift+Enter");
    expect(formatBinding("Shift-Enter", true)).toBe("⇧Enter");
  });

  it("every hinted surface gets the RESOLVED binding from App", () => {
    const app = code(path.join(SRC, "App.tsx"));
    expect(app).toContain("findSessionKey={formatBinding(bindings.findSession)}");
    expect(app).toContain("sidebarKey={formatBinding(bindings.toggleSidebar)}");
    expect(app).toContain("closeKey={bindings.closeTab}");
    const sites: Array<[string, string]> = [
      ["components/Sidebar.tsx", "Find a session (${findSessionKey})"],
      ["components/Sidebar.tsx", "Collapse sidebar (${sidebarKey})"],
      ["components/Sidebar.tsx", "Expand sidebar (${sidebarKey})"],
      ["components/FileTab.tsx", "Save (${formatBinding(saveKey)})"],
      ["components/ChatView.tsx", "Search this conversation (${formatBinding(searchKey)})"],
      ["components/ChatView.tsx", 'Previous match (${formatBinding("Shift-Enter")})'],
      ["components/TerminalTab.tsx", "{formatBinding(closeKey)} closes this tab"],
      ["components/feedbackCopy.ts", 'Paste an image (${formatBinding("Mod-v")}) or'],
      ["components/VoiceView.tsx", "Hold right ${MOD} to dictate"],
    ];
    for (const [file, hint] of sites) expect(code(path.join(SRC, file)), file).toContain(hint);
  });
});

describe("no copy claims the user is on a Mac", () => {
  /**
   * PRD §4 (Windows round). "A folder on your Mac" photographs perfectly on Windows
   * and is simply untrue — the class of bug a green suite cannot see, found by
   * looking at the running app. Where a neutral word is honest everywhere it wins
   * ("this computer" needs no Linux variant); where the thing has a platform NAME,
   * the name is what the user hunts for on screen, so it varies.
   */
  const MAC_WORDS = /\b(your Mac|this Mac|on a Mac|macOS|Finder)\b/;
  /** Two-word phrases are never identifiers, so they count as copy even without quotes (JSX text). */
  const MAC_PHRASES = /\b(your Mac|this Mac|on a Mac)\b/;

  it("scans every rendered string", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const rel = path.relative(SRC, f).split(path.sep).join("/");
      if (rel === "platformCopy.ts") continue; // where the variants are DEFINED
      for (const line of code(f).split("\n")) {
        if (!MAC_WORDS.test(line)) continue;
        if (!/["'`]/.test(line) && !MAC_PHRASES.test(line)) continue; // a bare identifier is not copy
        offenders.push(`${rel}: ${line.trim().slice(0, 90)}`);
      }
    }
    expect(offenders, "use platformCopy instead").toEqual([]);
  });

  it("the neutral words really are neutral — no platform name in them", () => {
    expect(THIS_COMPUTER).not.toMatch(MAC_WORDS);
    expect(YOUR_COMPUTER).not.toMatch(MAC_WORDS);
    expect(THIS_COMPUTER).not.toMatch(/Windows|PC\b/);
  });

  it("and the ones that SHOULD name a platform still do, per platform", () => {
    // The file manager is hunted for by name, so this is the opposite decision.
    expect(revealLabel("darwin")).toBe("Reveal in Finder");
    expect(revealLabel("win32")).toBe("Show in File Explorer");
    expect(revealLabel("linux")).toBe("Show in file manager");
  });
});

describe("a path's last segment is found on both separators", () => {
  /**
   * PRD §4 (Windows round). Fifteen renderer sites derived a basename with
   * `split("/")`, which on Windows never splits — the sidebar showed
   * `C:\Users\me\Documents\HappyVibe\winprobe` where it meant `winprobe`, and every
   * file chip, plan row, schedule row and audit line did the same. Found by looking at
   * the running app: a full path renders perfectly and reads as a bug only to a human.
   */
  it("splits on backslash and slash, and survives a trailing one", () => {
    expect(basename("C:\\Users\\me\\Documents\\HappyVibe\\winprobe")).toBe("winprobe");
    expect(basename("/Users/me/Projects/winprobe")).toBe("winprobe");
    expect(basename("C:\\ws\\")).toBe("ws");
    expect(basename("a/b/c.ts")).toBe("c.ts");
  });

  it("returns the input when there is nothing to strip", () => {
    expect(basename("winprobe")).toBe("winprobe");
    expect(basename("")).toBe("");
  });

  it("no renderer file derives a basename with a slash-only split any more", () => {
    const offenders: string[] = [];
    for (const f of walk(SRC)) {
      const rel = path.relative(SRC, f).split(path.sep).join("/");
      for (const line of code(f).split("\n")) {
        if (!/\.split\("\/"\)/.test(line)) continue;
        // Two things that only LOOK like paths and must stay forward-slash:
        // a URL's host, and a `provider/modelId` identifier.
        if (rel === "browserError.ts" || /provider:/.test(line)) continue;
        if (!/pop\(\)|\.filter\(Boolean\)/.test(line)) continue;
        offenders.push(`${rel}: ${line.trim().slice(0, 90)}`);
      }
    }
    expect(offenders, "use basename() instead").toEqual([]);
  });
});

describe("docs-round #22 — per-OS copy the Windows round missed", () => {
  it("the terminal Shell rows say what a blank path really starts, per OS", () => {
    const win = shellCopy("win32");
    expect(win.pathHint).toBe("Blank uses PowerShell 7, then Windows PowerShell, then the Command Prompt.");
    expect(win.placeholder).toBe("pwsh.exe");
    for (const s of Object.values(win)) expect(s).not.toMatch(/\$SHELL|login shell/);
    for (const p of ["darwin", "linux"]) {
      expect(shellCopy(p).pathHint, p).toBe("Blank uses your login shell ($SHELL).");
      expect(shellCopy(p).placeholder, p).toBe("$SHELL");
      expect(shellCopy(p).argsHint, p).toBe("Space-separated. -l starts a login shell, so your real PATH and version managers work.");
    }
    for (const p of ["darwin", "linux", "win32"]) {
      for (const s of Object.values(shellCopy(p))) expect(s, p).not.toContain("`"); // plain text, not markdown
    }
  });

  it("TerminalView renders them instead of its own literals", () => {
    const src = code(path.join(SRC, "components", "TerminalView.tsx"));
    for (const k of ["subtitle", "pathHint", "placeholder", "argsHint"]) expect(src).toContain(`SHELL_COPY.${k}`);
    expect(src).not.toContain("Blank uses $SHELL");
    expect(src).not.toContain("`-l`");
  });

  it("the microphone button names the OS's settings app; the crash-reports button names its file manager", () => {
    expect(micSettingsLabel("darwin")).toBe("Open System Settings");
    expect(micSettingsLabel("win32")).toBe("Open Settings");
    const voice = code(path.join(SRC, "components", "VoiceView.tsx"));
    expect(voice).toContain("{MIC_SETTINGS_BUTTON}");
    expect(voice).not.toContain("Open System Settings");
    const privacy = code(path.join(SRC, "components", "PrivacyView.tsx"));
    expect(privacy).toContain("{REVEAL_IN_FILE_MANAGER}");
    expect(privacy).not.toContain("Reveal crash reports");
  });
});
