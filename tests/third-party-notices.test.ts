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

test("every bundled agent adapted from someone else's file is in the notices, with its source and license", () => {
  // Agents carry no manifest; the "# Adapted from" frontmatter line IS the provenance.
  const dir = path.join(RUNTIME, "agents");
  const adapted = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).flatMap((f) => {
    const m = fs.readFileSync(path.join(dir, f), "utf8").match(/^# Adapted from (\S+) .*?\((Apache-2\.0|MIT)/m);
    return m ? [{ name: f.replace(/\.md$/, ""), repo: m[1], license: m[2] }] : [];
  });
  expect(adapted.map((a) => a.name).sort()).toEqual(["plan-critic", "reviewer", "security-auditor", "silent-failure-hunter"]);
  for (const a of adapted) {
    const entry = NOTICES.split(/\n(?=## )/).find((s) => s.startsWith(`## agent: ${a.name}\n`));
    expect(entry, `${a.name} has no "## agent: ${a.name}" entry`).toBeTruthy();
    expect(entry, a.name).toContain(a.repo);
    expect(entry, a.name).toContain(a.license);
  }
});
