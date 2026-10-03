# ScopeLane architecture

ScopeLane owns Git mutation for OpenCode coding sessions while leaving normal Git inspection available to agents.

## Branch graph

```text
main
└── feat/F001-panel-auth           # work branch while unsplit
    ├── feat/F001-A-token-lifecycle
    └── feat/F001-B-auth-ui
```

When F001 is split, `feat/F001-panel-auth` changes role from a work branch to an integration-only parent. Parts merge into the parent through pull requests; the parent later merges into `main` through a pull request. No `F001-A-1` or deeper split is valid.

## Lane lifecycle

1. A primary session prompt enters the prompt-admission hook.
2. ScopeLane reads ScopeSeed's durable feature registry and project context.
3. A deterministic/model-assisted scope resolver chooses a registered feature or a non-feature branch kind.
4. The lane planner renders the configured branch name and optional one-level part graph.
5. Plain Git creates missing refs from their declared bases.
6. OpenCode's native V2 worktree API creates/reuses the checkout.
7. `ctx.session.move()` moves the session to that lane.
8. Session-scoped system instructions remind the agent that Git mutation belongs to ScopeLane.

Parallel sessions may therefore operate in different worktrees without sharing an index or checkout.

## Semantic checkpoint lifecycle

Idle is deliberately not an immediate commit boundary.

1. `session.idle` schedules a debounce timer.
2. Any new prompt cancels the timer.
3. A successful previous checkpoint adds a configurable cooldown.
4. ScopeLane snapshots the branch, HEAD, binary-capable diff, untracked hashes, and untracked text previews.
5. Tracked diffs are split into hunk-level change units; untracked files are whole-file units.
6. The semantic planner receives lane/task context, recent history, and all units.
7. Deterministic validation enforces the commit budget, Conventional Commit syntax, unique known unit assignment, and explicit pending work.
8. The snapshot fingerprint is verified again before execution.
9. Planned commits are built through a temporary Git index and `commit-tree`; the branch ref is updated only after all planned commit objects exist.
10. Remaining pending work stays in the worktree.
11. The branch is pushed once after the batch.

If the planner returns no commits, the fingerprint and reason are remembered so an unchanged incomplete diff is not repeatedly re-planned.

## Feature promotion and integration

A feature may initially remain a single work lane. If it later proves large enough while remaining one coherent ScopeSeed feature, ScopeLane can promote the existing branch into an integration-only parent and create A/B/etc. child lanes from it.

All integration directions are PR-based:

```text
F001-A/B -> F001
main      -> F001
F001      -> F001-A/B
F001      -> main
```

ScopeLane does not perform local merges for these relationships.

## Safety model

Protected branches default to `main`, `master`, and `trunk`. ScopeLane refuses direct checkpoint commits, pushes, or work lanes on protected branches.

Coding-agent shell Git mutations are rejected through the OpenCode permission hook. The plain-Git core executes only ScopeLane's validated operations.

A session already assigned to one explicit ScopeSeed feature/part rejects a prompt that explicitly names another feature/part, preventing obvious scope drift into the wrong Git history.
