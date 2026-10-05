import type { BranchConfig } from "../config"
import { isProtectedBranch, slugifyBranchSegment } from "../git/branch"

export interface WorktreeInfo {
  directory: string
  strategy?: string
}

export interface WorktreeClient {
  refresh(input: { projectID: string }): Promise<unknown>
  list(input: { projectID: string }): Promise<readonly WorktreeInfo[]>
  create(input: {
    projectID: string
    name: string
    branch: string
    from?: string
  }): Promise<{ directory: string }>
  branchAt(directory: string): Promise<string | undefined>
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
  return "scopelane-" + normalized
}

async function findBranchWorktree(
  items: readonly WorktreeInfo[],
  branch: string,
  worktree: WorktreeClient,
): Promise<WorktreeInfo | undefined> {
  for (const item of items) {
    try {
      if ((await worktree.branchAt(item.directory)) === branch) return item
    } catch {
      // Inventory can contain stale/unavailable directories until refresh settles.
    }
  }
  return undefined
}

export async function ensureLane(
  input: EnsureLaneInput,
  config: BranchConfig,
  git: BranchClient,
  worktree: WorktreeClient,
): Promise<LaneResult> {
  if (isProtectedBranch(input.branch, config)) {
    throw new Error('ScopeLane: refusing to create a lane for protected branch "' + input.branch + '"')
  }
  if (input.branch === input.baseBranch) {
    throw new Error("ScopeLane: target branch must differ from its base branch")
  }

  const branch = await git.ensureBranch(input.branch, input.baseBranch)
  await worktree.refresh({ projectID: input.projectID })
  const inventory = await worktree.list({ projectID: input.projectID })
  const existing = await findBranchWorktree(inventory, input.branch, worktree)
  const name = laneName(input.branch)

  if (existing) {
    return {
      branch: input.branch,
      baseBranch: input.baseBranch,
      directory: existing.directory,
      worktreeName: name,
      branchCreated: branch.created,
      worktreeCreated: false,
    }
  }

  try {
    const created = await worktree.create({
      projectID: input.projectID,
      name,
      branch: input.branch,
      ...(input.sourceDirectory ? { from: input.sourceDirectory } : {}),
    })
    const actual = await worktree.branchAt(created.directory)
    if (actual !== input.branch) {
      throw new Error(
        'ScopeLane: created worktree is on branch "' + actual + '", expected "' + input.branch + '"',
      )
    }
    return {
      branch: input.branch,
      baseBranch: input.baseBranch,
      directory: created.directory,
      worktreeName: name,
      branchCreated: branch.created,
      worktreeCreated: true,
    }
  } catch (error) {
    await worktree.refresh({ projectID: input.projectID })
    const refreshed = await worktree.list({ projectID: input.projectID })
    const winner = await findBranchWorktree(refreshed, input.branch, worktree)
    if (winner) {
      return {
        branch: input.branch,
        baseBranch: input.baseBranch,
        directory: winner.directory,
        worktreeName: name,
        branchCreated: branch.created,
        worktreeCreated: false,
      }
    }
    throw error
  }
}
