# ScopeLane

ScopeLane is an OpenCode V2 plugin for safe parallel Git work: intelligent branch selection, isolated worktrees, semantic checkpoint commits, controlled pushes, and optional GitHub pull-request orchestration.

> **Status:** public development prerelease. ScopeLane is still WIP and has not yet had broad real-world validation. Use the `dev` npm dist-tag until a stable release is explicitly published.

## Branch model

```text
main
└── feat/F001-panel-auth
    ├── feat/F001-A-token-lifecycle
    └── feat/F001-B-auth-ui
```

A ScopeSeed-backed feature may split exactly one level. Once it is split, the top-level feature branch becomes integration-only; implementation continues on its part branches. If a part itself would need another split, that work should become a separate ScopeSeed feature instead. Standalone repositories use normal branches such as `feat/companion-authentication` without an `F001`/`C001`-style ID.

## Install the current prerelease

The recommended prerelease installation is the npm package:

```bash
opencode plugin add opencode-scopelane@dev
```

For repository-based development, the current implementation branch remains available:

```bash
opencode plugin add 'github:s3tupw1zard/ScopeLane#feat/bootstrap-scopelane'
```

Or configure it explicitly with options:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-scopelane@dev",
      "options": {
        "branches": {
          "protected": ["main", "master", "trunk"],
          "prefixes": {
            "feature": "feat",
            "fix": "fix",
            "refactor": "refactor",
            "docs": "docs",
            "chore": "chore"
          },
          "featureIdPattern": "^F\\d{3,}$",
          "featurePartPattern": "^[A-Z]$",
          "lockNameAfterPush": true
        },
        "scope": {
          "registryPath": "specs/FEATURES.md",
          "projectPath": "specs/PROJECT.md",
          "confidenceThreshold": 0.62,
          "autoSplit": true,
          "maxParts": 4,
          "fallbackKind": "chore"
        },
        "checkpoint": {
          "onIdle": true,
          "idleDelaySeconds": 90,
          "minIntervalSeconds": 180,
          "push": true,
          "remote": "origin",
          "maxCommits": 4,
          "maxDiffBytes": 200000,
          "conventionalCommits": true
        },
        "github": {
          "enabled": false,
          "autoCreatePullRequest": false,
          "cli": "gh"
        }
      }
    }
  ]
}
```

Do not configure Git as a hard OpenCode `deny` when using ScopeLane. ScopeLane's permission hook must receive `allow` or `ask` decisions so it can distinguish read-only Git inspection from mutations. A broad `git * -> ask` or `allow` rule is compatible; ScopeLane denies agent-owned mutations itself.

## How it works

On the first primary prompt of a session, ScopeLane checks whether the configured ScopeSeed registry exists. With ScopeSeed, it resolves against the accepted feature registry and project context; without ScopeSeed, it falls back to an ordinary `feat/<slug>`/`fix/<slug>` style lane without inventing a feature ID. It then creates or reuses a safe branch/worktree lane and moves the OpenCode session into it before normal implementation work proceeds.

Coding agents can inspect Git state but do not own branch creation, staging, commits, pushes, worktrees, merges, or rebases. ScopeLane performs controlled Git mutations directly and refuses to commit or push protected branches. If a protected checkout already has uncommitted changes, ScopeLane keeps the session usable in protected read-only mode instead of failing setup; the agent can inspect files/diffs and propose a branch or commit plan while edits and shell mutations remain blocked.

When a session becomes idle, ScopeLane does **not** immediately commit. It starts a configurable debounce window. A new prompt cancels that pending checkpoint. After the delay (and any commit cooldown), ScopeLane:

1. snapshots tracked hunks and untracked files;
2. asks the active model for a small semantic commit plan;
3. validates every change-unit assignment deterministically;
4. commits only complete logical units;
5. leaves unfinished units in the working tree;
6. pushes the resulting commit batch once.

An unchanged diff that was already classified as incomplete is not repeatedly sent to the model.

## ScopeSeed integration

ScopeLane reads ScopeSeed's normal repository artifacts; ScopeSeed does not need a private programmatic API.

- accepted feature IDs come from `specs/FEATURES.md`;
- project context comes from `specs/PROJECT.md`;
- the model may select only registered feature IDs;
- the feature ID format is configurable (`F001`, `C001`, `APP-0001`, ...);
- a split appends one configured part label such as `C001-A`;
- split depth is capped at one level.

If the registry is absent, ScopeSeed is treated as not in use and ScopeLane does not add any feature ID. Repository-specific ID formats are configured in `.opencode/opencode.jsonc`; see [docs/feature-id-prefixes.md](docs/feature-id-prefixes.md).

A feature can start as `feat/F001-name` and later be promoted to an integration parent with child part lanes when the work proves large enough.

## Commands

```text
/scopelane
/scopelane status
/scopelane checkpoint
/scopelane split [optional split guidance]
/scopelane pr
/scopelane sync
/scopelane feature-pr
/scopelane feature-sync
```

- `checkpoint`: immediately re-evaluate the working tree and commit complete semantic units.
- `split`: checkpoint the current top-level feature, then promote it to an integration parent if a useful one-level split is identified.
- `pr`: create/reuse a PR from the current lane into its base (for example `F001-A -> F001`).
- `sync`: create/reuse a PR from the lane's base into the current lane (for example `F001 -> F001-A`).
- `feature-pr`: create/reuse the feature-parent PR into the repository default branch (`F001 -> main`).
- `feature-sync`: create/reuse the default-branch PR into the feature parent (`main -> F001`).

ScopeLane never locally merges those relationships. GitHub integration uses the `gh` CLI and remains disabled by default. Automatic PR creation intentionally skips a top-level feature lane (`F001 -> main`); use `feature-pr` when the integrated feature is actually ready.

## Safety invariants

- no ScopeLane commit or push targets a configured protected branch;
- a dirty protected checkout remains available for read/search/diff analysis instead of failing session setup;
- feature parts never split another level;
- split feature parents are integration-only;
- agent-issued Git mutations are denied even when wrapped through nested shell commands;
- a checkpoint trigger is analysis, not an unconditional commit;
- commit plans cannot duplicate, invent, or silently drop change units;
- the working-tree fingerprint must remain unchanged between planning and execution;
- concurrent sessions reuse/race-resolve worktrees rather than creating duplicate lanes;
- explicit prompts targeting another feature/part are rejected in an already assigned session.

See [docs/architecture.md](docs/architecture.md) and [docs/configuration.md](docs/configuration.md).


## npm releases

ScopeLane uses CalVer-compatible SemVer prereleases such as `2026.1.0-dev.1`. Development releases publish to the npm `dev` dist-tag; stable releases publish to `latest`.

Before publishing or creating a release, run:

```bash
bun install
bun run verify
```

Publishing automation and first-release setup are documented in [docs/publishing.md](docs/publishing.md).

## License

ScopeLane is licensed under the **GNU General Public License v2.0 only (`GPL-2.0-only`)**. See [LICENSE](LICENSE).
