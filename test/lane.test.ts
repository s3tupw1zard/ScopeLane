import { describe, expect, test } from "bun:test"
import { DEFAULT_CONFIG } from "../src/config"
import { ensureLane, type BranchClient, type WorktreeClient, type WorktreeInfo } from "../src/lane/orchestrator"

function fakeGit(created: boolean): BranchClient {
  return {
    async ensureBranch(branch, startPoint) {
      return { branch, startPoint, created }
    },
  }
}

function fakeWorktrees(initial: WorktreeInfo[] = []) {
  const items = [...initial]
  let creates = 0

  const client: WorktreeClient = {
    async refresh() {},
    async list() {
      return items
    },
    async create(input) {
      creates += 1
      const value = {
        name: input.name,
        branch: input.branch,
        directory: `/worktrees/${input.name}`,
      }
      items.push(value)
      return value
    },
  }

  return { client, creates: () => creates }
}

describe("lane orchestration", () => {
  test("creates a worktree for a safe feature branch", async () => {
    const worktrees = fakeWorktrees()

    const result = await ensureLane(
      {
        projectID: "project-1",
        branch: "feat/F001-panel-auth",
        baseBranch: "main",
      },
      DEFAULT_CONFIG.branches,
      fakeGit(true),
      worktrees.client,
    )

    expect(result.branchCreated).toBe(true)
    expect(result.worktreeCreated).toBe(true)
    expect(result.worktreeName).toBe("scopelane-feat-f001-panel-auth")
    expect(worktrees.creates()).toBe(1)
  })

  test("reuses an existing worktree for the same branch", async () => {
    const worktrees = fakeWorktrees([
      {
        name: "scopelane-feat-f001-a-token-lifecycle",
        branch: "feat/F001-A-token-lifecycle",
        directory: "/worktrees/f001-a",
      },
    ])

    const result = await ensureLane(
      {
        projectID: "project-1",
        branch: "feat/F001-A-token-lifecycle",
        baseBranch: "feat/F001-panel-auth",
      },
      DEFAULT_CONFIG.branches,
      fakeGit(false),
      worktrees.client,
    )

    expect(result.directory).toBe("/worktrees/f001-a")
    expect(result.worktreeCreated).toBe(false)
    expect(worktrees.creates()).toBe(0)
  })

  test("reuses a concurrently-created worktree after a creation race", async () => {
    const winner: WorktreeInfo = {
      name: "scopelane-feat-f001-panel-auth",
      branch: "feat/F001-panel-auth",
      directory: "/worktrees/race-winner",
    }

    let listed = false
    const worktree: WorktreeClient = {
      async refresh() {},
      async list() {
        if (!listed) {
          listed = true
          return []
        }
        return [winner]
      },
      async create() {
        throw new Error("already checked out")
      },
    }

    const result = await ensureLane(
      {
        projectID: "project-1",
        branch: "feat/F001-panel-auth",
        baseBranch: "main",
      },
      DEFAULT_CONFIG.branches,
      fakeGit(false),
      worktree,
    )

    expect(result.directory).toBe("/worktrees/race-winner")
    expect(result.worktreeCreated).toBe(false)
  })

  test("never creates a lane on a protected branch", async () => {
    const worktrees = fakeWorktrees()

    await expect(
      ensureLane(
        {
          projectID: "project-1",
          branch: "main",
          baseBranch: "feat/F001-panel-auth",
        },
        DEFAULT_CONFIG.branches,
        fakeGit(false),
        worktrees.client,
      ),
    ).rejects.toThrow("protected branch")

    expect(worktrees.creates()).toBe(0)
  })
})
