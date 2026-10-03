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

function fakeWorktrees(initial: Array<WorktreeInfo & { branch?: string }> = []) {
  const items = [...initial]
  let creates = 0
  const client: WorktreeClient = {
    async refresh() {},
    async list() { return items }
    async branchAt(directory) { return items.find((item) => item.directory === directory)?.branch }
    async create(input) {
      creates += 1
      const value = {
        directory: "/worktrees/" + input.name,
        branch: input.branch,
      }
      items.push(value)
      return { directory: value.directory }
    },
  }
  return { client, creates: () => creates }
}

