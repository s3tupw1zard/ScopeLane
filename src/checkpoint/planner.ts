import type { CheckpointConfig } from "../config"
import type { ChangeUnit } from "./changes"

export interface PlannedCommit {
  message: string
  units: string[]
}

export interface CommitPlan {
  commits: PlannedCommit[]
  pending: string[]
  reason: string
}

export interface CommitPlanGenerator {
  text(prompt: string): Promise<string>
}

export interface CommitPlanningContext {
  branch?: string
  baseBranch?: string
  featureId?: string
  part?: string
  taskSummary?: string
  recentCommits?: string[]
}

type RawPlan = {
  commits?: Array<{ message?: unknown; units?: unknown }>
  pending?: unknown
  reason?: unknown
}

const conventional = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?: .+/

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const source = fenced ?? text
  const start = source.indexOf("{")
  const end = source.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("ScopeLane: commit planner did not return JSON")
  return JSON.parse(source.slice(start, end + 1))
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === "string"))]
}

export function validateCommitPlan(
  raw: unknown,
  units: readonly ChangeUnit[],
  config: CheckpointConfig,
): CommitPlan {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("ScopeLane: invalid commit plan object")
  }

  const input = raw as RawPlan
  const known = new Set(units.map((unit) => unit.id))
  const assigned = new Set<string>()
  const commits: PlannedCommit[] = []

  for (const candidate of input.commits ?? []) {
    if (commits.length >= config.maxCommits) {
      throw new Error("ScopeLane: commit plan exceeds configured commit budget")
    }
    if (typeof candidate.message !== "string" || !candidate.message.trim()) {
      throw new Error("ScopeLane: planned commit has no message")
    }
    const message = candidate.message.trim()
    if (message.includes("\n")) throw new Error("ScopeLane: commit subjects must be one line")
    if (config.conventionalCommits && !conventional.test(message)) {
      throw new Error("ScopeLane: planned commit message is not Conventional Commits compatible")
    }

    const ids = uniqueStrings(candidate.units)
    if (ids.length === 0) throw new Error("ScopeLane: planned commit has no change units")
    for (const id of ids) {
      if (!known.has(id)) throw new Error("ScopeLane: commit plan references unknown unit " + id)
      if (assigned.has(id)) throw new Error("ScopeLane: change unit assigned more than once: " + id)
      assigned.add(id)
    }
    commits.push({ message, units: ids })
  }

  const pending = uniqueStrings(input.pending)
  for (const id of pending) {
    if (!known.has(id)) throw new Error("ScopeLane: pending list references unknown unit " + id)
    if (assigned.has(id)) throw new Error("ScopeLane: change unit is both committed and pending: " + id)
    assigned.add(id)
  }

  for (const unit of units) {
    if (!assigned.has(unit.id)) pending.push(unit.id)
  }

  return {
    commits,
    pending,
    reason: typeof input.reason === "string" ? input.reason.trim() : "",
  }
}

export async function planCheckpoint(
  units: readonly ChangeUnit[],
  config: CheckpointConfig,
  generator?: CommitPlanGenerator,
  context: CommitPlanningContext = {},
): Promise<CommitPlan> {
  if (units.length === 0) return { commits: [], pending: [], reason: "No changes." }
  if (!generator) {
    return {
      commits: [],
      pending: units.map((unit) => unit.id),
      reason: "No model was available for semantic commit planning.",
    }
  }

  const inventory = units
    .map((unit) => {
      const detail =
        unit.kind === "patch"
          ? unit.patch
          : unit.preview
            ? unit.preview
            : "(untracked file content preview unavailable)"
      return [
        "### " + unit.id + " | " + unit.path,
        unit.summary,
        "~~~diff",
        detail,
        "~~~",
      ].join("\n")
    })
    .join("\n\n")

  const response = await generator.text(
    [
      "You are ScopeLane\u0027s semantic Git checkpoint planner.",
      "",
      "Group only completed, coherent changes into a small number of atomic commits.",
      "Do not create one commit per file or per tiny edit. Prefer fewer commits when changes belong to one logical unit.",
      "Split changes when they are independently understandable, revertible, or represent different concerns.",
      "Leave unfinished or uncertain units in pending. It is valid to return zero commits.",
      "Never assign one unit to multiple commits. Preserve dependency order.",
      config.conventionalCommits ? "Commit subjects must use Conventional Commits." : "",
      "Maximum commits at this checkpoint: " + config.maxCommits + ".",
      "",
      "LANE CONTEXT:",
      "Branch: " + (context.branch ?? "(unknown)"),
      "Base: " + (context.baseBranch ?? "(unknown)"),
      "Feature: " + (context.featureId ?? "(none)") + (context.part ? "-" + context.part : ""),
      "Task: " + (context.taskSummary ?? "(not recorded)"),
      "Recent commits:",
      context.recentCommits?.length ? context.recentCommits.join("\n") : "(none)",
      "",
      "Use this context to keep commit boundaries consistent with the task and existing history.",
      "Do not split merely because files differ; split only when the changes form independently meaningful units.",
      "",
      "Return JSON only:",
      JSON.stringify({ commits: [{ message: "feat(scope): concise subject", units: ["p1"] }], pending: ["p2"], reason: "short reason" }),
      "",
      "CHANGE UNITS:",
      inventory,
    ].filter(Boolean).join("\n"),
  )

  return validateCommitPlan(extractJson(response), units, config)
}
