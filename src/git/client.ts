import { execFile } from "node:child_process"
import { promisify } from "node:util"
import type { BranchConfig } from "../config"
import { isProtectedBranch } from "./branch"

const execFileAsync = promisify(execFile)

export interface GitCommandResult {
  stdout: string
  stderr: string
}

export interface EnsureBranchResult {
  branch: string
  startPoint: string
  created: boolean
}

export class GitClient {
  constructor(
    readonly directory: string,
    private readonly branchConfig: BranchConfig,
  ) {}

  private async run(args: string[]): Promise<GitCommandResult> {
    const result = await execFileAsync("git", args, {
      cwd: this.directory,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    })

    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    }
  }

  private async succeeds(args: string[]): Promise<boolean> {
    try {
      await this.run(args)
      return true
    } catch {
      return false
    }
  }

  async validateBranchName(branch: string): Promise<void> {
    if (!branch || isProtectedBranch(branch, this.branchConfig)) {
      throw new Error(`ScopeLane: refusing protected or empty target branch "${branch}"`)
    }

    if (!(await this.succeeds(["check-ref-format", "--branch", branch]))) {
      throw new Error(`ScopeLane: invalid Git branch name "${branch}"`)
    }
  }

  async hasLocalBranch(branch: string): Promise<boolean> {
    return this.succeeds(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`])
  }

  async resolveStartPoint(branch: string, remote = "origin"): Promise<string> {
    const localRef = `refs/heads/${branch}`
    if (await this.succeeds(["rev-parse", "--verify", "--quiet", `${localRef}^{commit}`])) {
      return branch
    }

    const remoteRef = `refs/remotes/${remote}/${branch}`
    if (await this.succeeds(["rev-parse", "--verify", "--quiet", `${remoteRef}^{commit}`])) {
      return remoteRef
    }

    throw new Error(`ScopeLane: base branch "${branch}" is not available locally or on ${remote}`)
  }

  async ensureBranch(branch: string, baseBranch: string): Promise<EnsureBranchResult> {
    await this.validateBranchName(branch)

    if (await this.hasLocalBranch(branch)) {
      return { branch, startPoint: branch, created: false }
    }

    const startPoint = await this.resolveStartPoint(baseBranch)

    try {
      await this.run(["branch", "--no-track", branch, startPoint])
      return { branch, startPoint, created: true }
    } catch (error) {
      // Another ScopeLane session may have created the same branch between the
      // existence check and branch creation. Treat that race as idempotent.
      if (await this.hasLocalBranch(branch)) {
        return { branch, startPoint: branch, created: false }
      }
      throw error
    }
  }
}
