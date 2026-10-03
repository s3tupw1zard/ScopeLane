import type { BranchConfig } from "../config"
import { isProtectedBranch, slugifyBranchSegment } from "../git/branch"

export interface WorktreeInfo {
  name: string
  branch?: string
  directory: string
}

export interface WorktreeClient {
  refresh(input: { projectID: string }): Promise<unknown>
  list(input: { projectID: string }): Promise<readonly WorktreeInfo[]>
  create(input: {
    projectID: string
    name: string
    branch: string
    from?: string
  }): Promise<WorktreeInfo>
}

export interface BranchClient {
  ensureBranch(
    branch: string,
    baseBranch: string,
  ): Promise<{ branch: string; startPoint: string; created: boolean }>
}

export interface EnsureLaneInput {
  projectID: string
  branch: string
  baseBranch: string
  sourceDirectory?: string
}

export interface LaneResult {
  branch: string
  baseBranch: string
  directory: string
  worktreeName: string
  branchCreated: boolean
  worktreeCreated: boolean
}

function laneName(branch: string): string {
  const normalized = slugifyBranchSegment(branch.replaceAll("/", "-"))
  if (!normalized) throw new Error("ScopeLane: could not derive a worktree name")
  return `scopelane-${normalized}`
}

export async function ensureLane(
  input: EnsureLaneInput,
  config: BranchConfig,
  git: BranchClient,
  worktree: WorktreeClient,
): Promise<LaneResult> {
  if (isProtectedBranch(input.branch, config)) {
    throw new Error(`ScopeLane: refusing to create a lane for protected branch "${input.branch}"`)
  }

  if (input.branch === input.baseBranch) {
    throw new Error("ScopeLane: target branch must differ from its base branch")
  }

  const branch = await git.ensureBranch(input.branch, input.baseBranch)

  await worktree.refresh({ projectID: input.projectID })
  const inventory = await worktree.list({ projectID: input.projectID })
  const existing = inventory.find((item) => item.branch === input.branch)

  if (existing) {
    return {
      branch: input.branch,
      baseBranch: input.baseBranch,
      directory: existing.directory,
      worktreeName: existing.name,
      branchCreated: branch.created,
      worktreeCreated: false,
    }
  }

  const name = laneName(input.branch)

  try {
    const created = await worktree.create({
      projectID: input.projectID,
      name,
      branch: input.branch,
      ...(input.sourceDirectory ? { from: input.sourceDirectory } : {}),
    })

    if (created.branch && created.branch !== input.branch) {
      throw new Error(
        `ScopeLane: worktree strategy returned branch "${created.branch}", expected "${input.branch}"`,
      )
    }

    return {
      branch: input.branch,
      baseBranch: input.baseBranch,
      directory: created.directory,
      worktreeName: created.name,
      branchCreated: branch.created,
      worktreeCreated: true,
    }
  } catch (error) {
    // Worktree creation can race when two sessions resolve the same lane at
    // nearly the same time. Refresh once and reuse the winner if it now exists.
    await worktree.refresh({ projectID: input.projectID })
    const refreshed = await worktree.list({ projectID: input.projectID })
    const winner = refreshed.find((item) => item.branch === input.branch)

    if (winner) {
      return {
        branch: input.branch,
        baseBranch: input.baseBranch,
        directory: winner.directory,
        worktreeName: winner.name,
        branchCreated: branch.created,
        worktreeCreated: false,
      }
    }

    throw error
  }
}
