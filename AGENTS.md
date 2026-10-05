# ScopeLane development rules

ScopeLane targets the native OpenCode V2 plugin API.

## Safety invariants

- Never implement a path that commits or pushes directly to a protected branch.
- Coding agents may inspect Git state but must not own Git mutations.
- ScopeLane owns branch creation, worktree creation, staging, commits, and pushes.
- A checkpoint trigger is not an instruction to commit. It only starts semantic analysis.
- ScopeSeed-backed feature branches may split exactly one level: `<ID>` -> `<ID>-A`, `<ID>-B`, etc.; the ID format is repository-configurable.
- If a ScopeSeed-backed feature part itself needs another split, ScopeSeed must classify the work as a separate feature instead.
- Once a split exists, the parent feature branch becomes integration-only for normal development.
- Prefer deterministic validation around every LLM decision.

## Development

- Keep the Git core independent from GitHub-specific PR automation.
- GitHub support belongs behind a provider boundary.
- Add tests for branch naming, safety guards, commit-plan validation, and state transitions.
