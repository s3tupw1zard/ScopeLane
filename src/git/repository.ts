import { createHash } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import type { BranchConfig, CheckpointConfig } from "../config"
import { isProtectedBranch } from "./branch"
import { appendUntrackedUnits, parseWorkingDiff, type ChangeUnit } from "../checkpoint/changes"
import type { CommitPlan } from "../checkpoint/planner"

interface RunOptions {
  input?: string
  env?: NodeJS.ProcessEnv
}

export interface WorkingSnapshot {
  head: string
  branch: string
  diff: string
  untracked: string[]
  units: ChangeUnit[]
  fingerprint: string
}

export interface CommitExecutionResult {
  previousHead: string
  head: string
  commits: Array<{ sha: string; message: string }>
  pending: string[]
}

export class GitRepository {
  constructor(
    readonly directory: string,
    private readonly branchConfig: BranchConfig,
  ) {}

  private run(args: string[], options: RunOptions = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        cwd: this.directory,
        env: { ...process.env, ...options.env },
        stdio: ["pipe", "pipe", "pipe"],
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)))
      child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)))
      child.on("error", reject)
      child.on("close", (code) => {
        const output = Buffer.concat(stdout).toString("utf8")
        const error = Buffer.concat(stderr).toString("utf8")
        if (code === 0) {
          resolve(output)
          return
        }
        reject(new Error("git " + args.join(" ") + " failed: " + error.trim()))
      })
      if (options.input !== undefined) child.stdin.end(options.input)
      else child.stdin.end()
    })
  }

  async currentBranch(): Promise<string> {
    return (await this.run(["branch", "--show-current"])).trim()
  }

  async head(): Promise<string> {
    return (await this.run(["rev-parse", "HEAD"])).trim()
  }

  async defaultBranch(): Promise<string> {
    try {
      const remoteHead = (
        await this.run(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"])
      ).trim()
      if (remoteHead.startsWith("origin/")) return remoteHead.slice("origin/".length)
    } catch {}

    for (const candidate of this.branchConfig.protected) {
      try {
        await this.run(["show-ref", "--verify", "--quiet", "refs/heads/" + candidate])
        return candidate
      } catch {}
    }
    throw new Error("ScopeLane: could not determine the repository default branch")
  }

  async isDirty(): Promise<boolean> {
    return (await this.run(["status", "--porcelain=v1", "--untracked-files=normal"])).length > 0
  }

  private async untrackedHashes(paths: readonly string[]): Promise<string[]> {
    const result: string[] = []
    for (const path of paths) {
      const hash = (await this.run(["hash-object", "--", path])).trim()
      result.push(path + "\0" + hash)
    }
    return result
  }

  async snapshot(config: CheckpointConfig): Promise<WorkingSnapshot> {
    const [head, branch, diff, untrackedRaw] = await Promise.all([
      this.head(),
      this.currentBranch(),
      this.run(["diff", "--binary", "--no-ext-diff", "HEAD", "--"]),
      this.run(["ls-files", "--others", "--exclude-standard", "-z"]),
    ])

    if (!branch) throw new Error("ScopeLane: detached HEAD is not a writable lane")
    if (isProtectedBranch(branch, this.branchConfig)) {
      throw new Error("ScopeLane: refusing checkpoint on protected branch " + branch)
    }
    if (Buffer.byteLength(diff, "utf8") > config.maxDiffBytes) {
      throw new Error("ScopeLane: working diff exceeds checkpoint.maxDiffBytes")
    }

    const untracked = untrackedRaw.split("\0").filter(Boolean)
    const units = appendUntrackedUnits(parseWorkingDiff(diff), untracked)
    const untrackedHashes = await this.untrackedHashes(untracked)
    const fingerprint = createHash("sha256")
      .update(head)
      .update("\0")
      .update(diff)
      .update("\0")
      .update(untrackedHashes.join("\0"))
      .digest("hex")

    return { head, branch, diff, untracked, units, fingerprint }
  }

  async verify(snapshot: WorkingSnapshot, config: CheckpointConfig): Promise<void> {
    const current = await this.snapshot(config)
    if (current.fingerprint !== snapshot.fingerprint || current.head !== snapshot.head) {
      throw new Error("ScopeLane: working tree changed during checkpoint planning")
    }
  }

  async executePlan(
    snapshot: WorkingSnapshot,
    plan: CommitPlan,
    config: CheckpointConfig,
  ): Promise<CommitExecutionResult> {
    if (plan.commits.length === 0) {
      return {
        previousHead: snapshot.head,
        head: snapshot.head,
        commits: [],
        pending: plan.pending,
      }
    }

    await this.verify(snapshot, config)
    const branch = await this.currentBranch()
    if (branch !== snapshot.branch) throw new Error("ScopeLane: branch changed during checkpoint")
    if (isProtectedBranch(branch, this.branchConfig)) {
      throw new Error("ScopeLane: refusing commit on protected branch " + branch)
    }

    const unitMap = new Map(snapshot.units.map((unit) => [unit.id, unit]))
    const temp = await mkdtemp(join(tmpdir(), "scopelane-index-"))
    const indexFile = join(temp, "index")
    const env = { GIT_INDEX_FILE: indexFile }
    const created: Array<{ sha: string; message: string }> = []
    let parent = snapshot.head

    try {
      for (const planned of plan.commits) {
        await this.run(["read-tree", parent], { env })

        for (const id of planned.units) {
          const unit = unitMap.get(id)
          if (!unit) throw new Error("ScopeLane: missing validated change unit " + id)
          if (unit.kind === "untracked") {
            await this.run(["add", "--", unit.path], { env })
          } else {
            await this.run(
              ["apply", "--cached", "--whitespace=nowarn", "--recount", "-"],
              { env, input: unit.patch },
            )
          }
        }

        const tree = (await this.run(["write-tree"], { env })).trim()
        const sha = (
          await this.run(["commit-tree", tree, "-p", parent, "-m", planned.message])
        ).trim()
        created.push({ sha, message: planned.message })
        parent = sha
      }

      await this.run(["update-ref", "refs/heads/" + branch, parent, snapshot.head])
      await this.run(["reset", "--mixed", parent])
    } finally {
      await rm(temp, { recursive: true, force: true })
    }

    return {
      previousHead: snapshot.head,
      head: parent,
      commits: created,
      pending: plan.pending,
    }
  }

  async push(branch: string, config: CheckpointConfig): Promise<void> {
    if (!branch || isProtectedBranch(branch, this.branchConfig)) {
      throw new Error("ScopeLane: refusing push to protected or empty branch")
    }
    const current = await this.currentBranch()
    if (current !== branch) throw new Error("ScopeLane: refusing to push a different branch")
    await this.run([
      "push",
      "--set-upstream",
      config.remote,
      "refs/heads/" + branch + ":refs/heads/" + branch,
    ])
  }
}
