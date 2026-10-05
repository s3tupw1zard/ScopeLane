export type FeatureMode = "single" | "split" | "integration-only" | "ready-for-main" | "merged"

export interface FeaturePartState {
  part: string
  branch: string
  slug?: string
  description?: string
}

export interface FeatureState {
  featureId: string
  parentBranch: string
  baseBranch?: string
  mode: FeatureMode
  parts: FeaturePartState[]
}

export interface SessionLaneState {
  sessionId: string
  branch: string
  baseBranch: string
  worktree: string
  featureId?: string
  part?: string
  branchNameLocked: boolean
  taskSummary?: string
  lastCheckpointHead?: string
  lastCheckpointAt?: number
  lastPlannedFingerprint?: string
  lastPlanReason?: string
}
