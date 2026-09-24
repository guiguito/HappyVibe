/**
 * §38 — every word the updater says, in one record (§20's rule). The
 * no-dead-copy test in tests/update-row.test.ts scans UpdateRow.tsx and
 * ChangelogView.tsx for each key.
 */
export const UPDATE_COPY = {
  ready: (v: string) => `HappyVibe ${v} is ready`,
  restart: "Restart to update",
  waiting: (n: number) => (n === 1 ? "Restart when the running session finishes" : `Restart when the ${n} running sessions finish`),
  armed: "Will restart when they finish",
  terminals: "open terminals will close",
  available: (v: string) => `HappyVibe ${v} is out`,
  download: "Download",
  downloading: (v: string, p: number) => `Downloading HappyVibe ${v} — ${Math.round(p)}%`,
  hide: "Hide until next launch",
  never: "Not checked yet",
  justNow: "Last checked just now",
  minutesAgo: (n: number) => `Last checked ${n} min ago`,
  hoursAgo: (n: number) => `Last checked ${n} h ago`,
  checkNow: "Check now",
  checking: "Checking…",
  upToDate: "You're on the latest version.",
  auto: "Download updates automatically",
  devOff: "Updates are off in development builds.",
} as const;
