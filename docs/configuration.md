# Configuration

ScopeLane options are supplied through the OpenCode plugin object. For repository-local settings, put the plugin configuration in `.opencode/opencode.jsonc`. ScopeLane does not require a separate configuration file.

If ScopeSeed is not present in the repository, feature lanes do not receive IDs such as `F001` or `C001`; they use names such as `feat/companion-authentication`. See [Feature ID prefixes](feature-id-prefixes.md) for custom ScopeSeed ID formats.

## Branches

```jsonc
{
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
  }
}
```

With the defaults, accepted ScopeSeed feature `F001` becomes `feat/F001-<slug>`. A split becomes `feat/F001-A-<slug>`, `feat/F001-B-<slug>`, and so on.

`featureIdPattern` applies only to ScopeSeed-backed features. For example, a Companion repository can set it to `^C\\d{3,}$` so accepted features are `C001`, `C002`, and so on. When ScopeSeed is not in use, ScopeLane deliberately omits the feature ID regardless of this setting.

`maxPartDepth` is intentionally fixed to one and is not configurable.

## Scope

```jsonc
{
  "scope": {
    "registryPath": "specs/FEATURES.md",
    "projectPath": "specs/PROJECT.md",
    "confidenceThreshold": 0.62,
    "autoSplit": true,
    "maxParts": 4,
    "fallbackKind": "chore"
  }
}
```

ScopeSeed is detected automatically from the configured registry path. If that file is absent, ScopeLane uses standalone mode and feature branches are rendered without a feature ID.

ScopeLane never invents ScopeSeed IDs. A model-proposed feature ID must exist in the parsed accepted-feature registry and match `branches.featureIdPattern`. Non-feature work falls back to `fix`, `refactor`, `docs`, or `chore`.

## Protected branches

Protected branches default to `main`, `master`, and `trunk`.

When a protected checkout is clean, ScopeLane may create or reuse a safe work lane before implementation starts. When the protected checkout already contains uncommitted changes, ScopeLane does not fail session setup and does not move those changes automatically. Instead, that session enters protected read-only mode:

- file reads, globbing, grep/search, and other non-editing OpenCode tools remain available;
- standalone read-only Git inspection such as `git status`, `git diff`, and `git log` remains available;
- file edits and shell mutations are denied;
- the model may inspect the pending work and propose a branch name, commit grouping, or commit messages;
- after the user creates or switches to a work branch, the next prompt can adopt that branch normally.

This is intentionally conservative: ScopeLane never moves a dirty protected working tree into a new lane implicitly.

## Checkpoints

```jsonc
{
  "checkpoint": {
    "onIdle": true,
    "idleDelaySeconds": 90,
    "minIntervalSeconds": 180,
    "push": true,
    "remote": "origin",
    "maxCommits": 4,
    "maxDiffBytes": 200000,
    "conventionalCommits": true
  }
}
```

`idleDelaySeconds` is the quiet period before an automatic checkpoint starts. Any new prompt cancels the pending timer.

`minIntervalSeconds` is the minimum interval after a successful checkpoint before the next automatic checkpoint may run. The timer is extended rather than dropping the checkpoint entirely.

`maxCommits` is a safety budget, not a target. The semantic planner is instructed to prefer fewer coherent commits and may create zero commits.

## GitHub

```jsonc
{
  "github": {
    "enabled": true,
    "autoCreatePullRequest": false,
    "cli": "gh"
  }
}
```

GitHub support is optional and uses the authenticated GitHub CLI in the repository worktree.

When `autoCreatePullRequest` is enabled, a successful pushed checkpoint creates/reuses the forward PR for part lanes and non-feature lanes. Top-level ScopeSeed feature lanes do not automatically open the feature-parent PR into the default branch; use `/scopelane feature-pr` when integration is ready. Merging remains explicit.

## OpenCode permissions

Do not globally configure `git *` as `deny` if ScopeLane should manage agent Git behavior. OpenCode's explicit `deny` is final and does not invoke the plugin permission hook.

A compatible baseline is:

```jsonc
{
  "permissions": [
    { "action": "shell", "resource": "git *", "effect": "ask" },
    { "action": "shell", "resource": "git status *", "effect": "allow" },
    { "action": "shell", "resource": "git diff *", "effect": "allow" },
    { "action": "shell", "resource": "git log *", "effect": "allow" }
  ]
}
```

ScopeLane then changes agent-owned Git mutations to `deny` while leaving inspection available. In protected read-only mode, ScopeLane additionally denies OpenCode `edit` actions and shell commands that are not standalone read-only Git inspection.
