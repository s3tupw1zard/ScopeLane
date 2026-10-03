# ScopeLane architecture

ScopeLane is an OpenCode V2 plugin that owns Git mutation while allowing coding agents to inspect repository state.

## Branch graph

A feature starts as a single branch:

```text
main
└── feat/F001-panel-auth
```

A large but still coherent feature may split exactly one level:

```text
main
└── feat/F001-panel-auth
    ├── feat/F001-A-token-lifecycle
    └── feat/F001-B-auth-ui
```

Parts merge into the feature parent through pull requests. The feature parent later merges into `main` through a pull request. No `F001-A-1` or deeper split is valid.

## Core responsibilities

1. Resolve a safe lane before coding starts.
2. Create or reuse an isolated Git worktree for that lane.
3. Keep session, worktree, branch, feature, and optional part state together.
4. Block coding agents from mutating Git directly.
5. Accumulate changes until a checkpoint trigger.
6. Ask a semantic planner whether complete, coherent commit units exist.
7. Validate the plan deterministically at hunk level.
8. Create the minimum useful set of atomic commits.
9. Push the lane in a batch.
10. Keep GitHub PR orchestration optional and outside the plain-Git core.

## Checkpoint model

Events such as `session.idle`, explicit commands, large diffs, or a meaningful scope change may trigger analysis. A trigger never means "commit now". The planner may return no commit when the current unit of work is incomplete.

## Safety model

Protected branches are configurable and default to `main`, `master`, and `trunk`. ScopeLane must reject direct commits and pushes to them. Coding sessions receive read-only Git access; ScopeLane performs controlled Git mutations itself.

The current implementation slice establishes configuration, branch naming/parsing, persistent plugin setup, the Git mutation guard, safe branch creation, and native V2 worktree orchestration. Session lifecycle binding, ScopeSeed decisions, and semantic commit planning follow on top of these invariants.
