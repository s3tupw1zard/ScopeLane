# Configuration

ScopeLane options are supplied through the OpenCode plugin object.

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

ScopeLane never invents ScopeSeed IDs. A model-proposed feature ID must exist in the parsed accepted-feature registry. Non-feature work falls back to `fix`, `refactor`, `docs`, or `chore`.

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

When `autoCreatePullRequest` is enabled, a successful pushed checkpoint creates/reuses the forward PR for the current lane. Merging remains explicit.

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

ScopeLane then changes agent-owned Git mutations to `deny` while leaving inspection available.
