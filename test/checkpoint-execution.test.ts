import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { DEFAULT_CONFIG } from "../src/config"
import { GitRepository } from "../src/git/repository"
import { validateCommitPlan } from "../src/checkpoint/planner"

const dirs: string[] = []

function git(directory: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: directory })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on("data", (chunk) => out.push(Buffer.from(chunk)))
    child.stderr.on("data", (chunk) => err.push(Buffer.from(chunk)))
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString("utf8"))
      else reject(new Error(Buffer.concat(err).toString("utf8")))
    })
  })
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("checkpoint execution", () => {
  test("commits one hunk while leaving another hunk pending", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scopelane-test-"))
    dirs.push(dir)
    await git(dir, ["init", "-b", "main"])
    await git(dir, ["config", "user.name", "ScopeLane Test"])
    await git(dir, ["config", "user.email", "scopelane@example.invalid"])

    const file = join(dir, "sample.txt")
    const original = Array.from({ length: 24 }, (_, index) => "line-" + (index + 1))
    await writeFile(file, original.join("\n") + "\n")
    await git(dir, ["add", "sample.txt"])
    await git(dir, ["commit", "-m", "initial"])
    await git(dir, ["switch", "-c", "feat/F001-checkpoint"])

    const changed = [...original]
    changed[1] = "changed-near-start"
    changed[20] = "changed-near-end"
    await writeFile(file, changed.join("\n") + "\n")

    const repository = new GitRepository(dir, DEFAULT_CONFIG.branches)
    const snapshot = await repository.snapshot(DEFAULT_CONFIG.checkpoint)
    expect(snapshot.units).toHaveLength(2)

    const plan = validateCommitPlan(
      {
        commits: [{ message: "feat(test): commit first hunk", units: [snapshot.units[0]!.id] }],
        pending: [snapshot.units[1]!.id],
      },
      snapshot.units,
      DEFAULT_CONFIG.checkpoint,
    )

    const result = await repository.executePlan(snapshot, plan, DEFAULT_CONFIG.checkpoint)
    expect(result.commits).toHaveLength(1)
    expect((await git(dir, ["log", "-1", "--pretty=%s"])).trim()).toBe("feat(test): commit first hunk")

    const remaining = await git(dir, ["diff", "HEAD", "--", "sample.txt"])
    expect(remaining).not.toContain("changed-near-start")
    expect(remaining).toContain("changed-near-end")
    expect(await readFile(file, "utf8")).toContain("changed-near-start")
  })
})
