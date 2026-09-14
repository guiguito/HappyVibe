/**
 * `npm run build:win`.
 *
 * Reads electron-builder.yml and adds Azure Trusted Signing ONLY when
 * HV_WIN_SIGN=azure. electron-builder 26 supports it natively (`win.azureSignOptions`),
 * so the yml carries no identity and an unsigned dogfood build needs no edit — it just
 * says, in one line, that it is unsigned. PRD §4 leaves the signing decision to before
 * the first public Windows download; this is what makes that decision one env var.
 *
 * Half-configured signing THROWS rather than quietly building unsigned: "I set the
 * secrets and it shipped unsigned anyway" is the failure worth being loud about.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED = ["AZURE_SIGN_ENDPOINT", "AZURE_SIGN_ACCOUNT", "AZURE_SIGN_PROFILE", "AZURE_SIGN_PUBLISHER"];

export function winBuildConfig(env) {
  const config = parse(readFileSync(path.join(ROOT, "electron-builder.yml"), "utf8"));

  if (env.HV_WIN_SIGN !== "azure") {
    return {
      config,
      note:
        "[build:win] UNSIGNED build — SmartScreen will warn on first run " +
        "(More info → Run anyway). Set HV_WIN_SIGN=azure plus the AZURE_SIGN_* secrets to sign.",
    };
  }

  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`[build:win] HV_WIN_SIGN=azure but missing: ${missing.join(", ")}`);
  }

  config.win = {
    ...(config.win ?? {}),
    azureSignOptions: {
      endpoint: env.AZURE_SIGN_ENDPOINT,
      codeSigningAccountName: env.AZURE_SIGN_ACCOUNT,
      certificateProfileName: env.AZURE_SIGN_PROFILE,
      publisherName: env.AZURE_SIGN_PUBLISHER,
    },
  };
  return { config, note: "[build:win] signing with Azure Trusted Signing" };
}

async function main() {
  const { config, note } = winBuildConfig(process.env);
  console.log(note);
  const { build, Platform } = await import("electron-builder");
  await build({ targets: Platform.WINDOWS.createTarget(), config });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
