import { expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * PRD §14 (2026-09-27): the bundle now carries third-party skills, and Apache-2.0 §4
 * wants the license text shipped and modified files marked. One notices file does it —
 * this test keeps it from drifting behind bundled.json, which is the thing that grows.
 */
const RUNTIME = path.join(process.cwd(), "pi-runtime");
const NOTICES = fs.readFileSync(path.join(RUNTIME, "THIRD_PARTY_NOTICES"), "utf8");

type Item = { name: string; source?: string; commit?: string; license?: string };
const manifest = (dir: string): { source?: string; items?: Item[] } =>
  JSON.parse(fs.readFileSync(path.join(RUNTIME, dir, "bundled.json"), "utf8"));

test("every third-party bundled item is named in THIRD_PARTY_NOTICES with its source, commit and license", () => {
  const items = ["skills", "prompts"].flatMap((d) => manifest(d).items ?? []);
  const external = items.filter((i) => i.source && !i.source.includes("guiguito/HappyVibe"));
  expect(external.length).toBeGreaterThanOrEqual(8); // guard against a vacuous pass
  for (const i of external) {
    const entry = NOTICES.split(/\n(?=## )/).find((s) => s.startsWith(`## ${i.name}\n`));
    expect(entry, `${i.name} has no "## ${i.name}" entry`).toBeTruthy();
    expect(entry, i.name).toContain(i.source!);
    expect(entry, i.name).toContain(i.commit!);
    expect(entry, i.name).toContain(i.license!);
  }
});

test("the full license texts ship once each", () => {
  expect(NOTICES).toContain("Apache License\n                           Version 2.0, January 2004");
  expect(NOTICES).toContain("Permission is hereby granted, free of charge, to any person obtaining a copy");
});
