import type { BranchConfig } from "../config"
import { renderFeatureBranch, renderSimpleBranch } from "../git/branch"
import type { ScopeDecision } from "../scope/resolver"

export interface PlannedLane {
  branch: string
  baseBranch: string
  role: "work" | "integration"
  featureId?: string
  part?: string
  description?: string
}

export interface LanePlan {
  active: PlannedLane
  parent?: PlannedLane
  siblings: PlannedLane[]
}

export function planLanes(
  decision: ScopeDecision,
  defaultBranch: string,
  config: BranchConfig,
): LanePlan {
  if (decision.kind !== "feature" || !decision.featureId) {
    return {
      active: {
        branch: renderSimpleBranch(decision.kind, decision.slug, config),
        baseBranch: defaultBranch,
        role: "work",
      },
      siblings: [],
    }
  }

  const parentBranch = renderFeatureBranch(
    { featureId: decision.featureId, slug: decision.slug },
    config,
  )

  if (!decision.split?.parts.length) {
    return {
      active: {
        branch: parentBranch,
        baseBranch: defaultBranch,
        role: "work",
        featureId: decision.featureId,
      },
      siblings: [],
    }
  }

  const parent: PlannedLane = {
    branch: parentBranch,
    baseBranch: defaultBranch,
    role: "integration",
    featureId: decision.featureId,
  }

  const parts = decision.split.parts.map((part) => ({
    branch: renderFeatureBranch(
      { featureId: decision.featureId!, part: part.label, slug: part.slug },
      config,
    ),
    baseBranch: parentBranch,
    role: "work" as const,
    featureId: decision.featureId,
    part: part.label,
    description: part.description,
  }))

  const activeLabel = decision.activePart
  const active =
    (activeLabel ? parts.find((part) => part.part === activeLabel) : undefined) ?? parts[0]

  if (!active) throw new Error("ScopeLane: split decision contains no usable parts")

  return {
    active,
    parent,
    siblings: parts.filter((part) => part.branch !== active.branch),
  }
}
