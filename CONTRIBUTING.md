# Contributing to HappyVibe

Thanks for looking. HappyVibe is a desktop app for coding with AI where everything is already set up
and you can see everything it does. Bug reports, fixes and ideas are all welcome.

## Set up

```bash
npm install
cd pi-runtime && npm ci && cd ..   # BOTH installs are required
npm run dev
```

`pi-runtime/` is a separate, vendored tree holding the pinned Pi coding agent and its extensions. A
clone without its install fails in confusing ways.

On **Linux** the first install compiles `node-pty`, so you need `build-essential` and `python3`
(`sudo apt install -y build-essential python3`). On **Windows**, install from Windows itself, not
from WSL — one `node_modules` cannot serve both.

## Before you open a pull request

```bash
npm run gate   # both typechecks, the build, and the non-live test suite — one command
```

It must pass. The suite never calls a model and needs no key.

There is also a **live** suite (`npm run test:live`) that drives the real agent against a real
model. It needs `OPENROUTER_API_KEY` or `DEEPSEEK_API_KEY` in `.env` and costs a few cents. You do
not need to run it; a maintainer will when your change touches the agent (`npm run live:why` lists
the files that make it necessary).

- Match the code around you: its naming, its comment density, its idiom.
- A behaviour change comes with a test that fails without it.
- `npm run lint` and `npm run format` are scaffold leftovers — please don't run them in a PR; they
  rewrite most of the repository.

## Sign your commits (DCO)

Every commit must carry a `Signed-off-by` line:

```bash
git commit -s -m "fix: the thing"
```

That line certifies the [Developer Certificate of Origin](https://developercertificate.org/): you
wrote the change, or have the right to submit it, under the project's licence (Apache-2.0). A check
on every pull request looks for it. There is no CLA to sign.

Forgot? `git commit --amend -s` for the last commit, or `git rebase --signoff main` for all of them.

## Reporting a security issue

Please don't open a public issue — see [SECURITY.md](SECURITY.md).
