# ScopeLane

OpenCode V2 plugin for intelligent Git branching, worktree isolation, semantic commits, and safe automated pushes.

ScopeLane is designed for parallel agent development without sacrificing a readable Git history. It gives each work stream its own branch/worktree lane, keeps coding agents away from direct Git mutations, and will create semantic checkpoint commits only when accumulated changes form coherent units.

## Target branch model

```text
main
└── feat/F001-panel-auth
    ├── feat/F001-A-token-lifecycle
    └── feat/F001-B-auth-ui
```

Feature parts are limited to one split level. If a part would need another split, the work should be classified as a separate feature instead.

## Current status

Early implementation. The first slice provides:

- OpenCode V2 plugin bootstrap
- configurable protected branches and branch prefixes
- `F001` / `F001-A` feature branch naming and parsing
- deterministic Git mutation guard for coding-agent shell access
- persistent plugin configuration
- foundation types for session lanes and feature state
- safe plain-Git branch creation from parent refs
- native OpenCode V2 worktree creation and reuse
- race-safe lane resolution for concurrent sessions
- session-move abstraction for stable `ctx.session.move()`
- tests for branch naming, Git safety, and lane orchestration

Next slices bind lane resolution to the live session lifecycle, add ScopeSeed integration, semantic checkpoint planning, hunk-level commit validation, batch pushes, and optional GitHub PR automation.

See [docs/architecture.md](docs/architecture.md) for the current design.
