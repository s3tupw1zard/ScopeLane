import { describe, expect, test } from "bun:test"
import { isGitMutationCommand } from "../src/git/guard"

describe("Git mutation guard", () => {
  test("allows read-only Git inspection", () => {
    expect(isGitMutationCommand("git status --short")).toBe(false)
    expect(isGitMutationCommand("git diff --stat && git log -5 --oneline")).toBe(false)
    expect(isGitMutationCommand("git branch --show-current")).toBe(false)
    expect(isGitMutationCommand("git remote -v")).toBe(false)
    expect(isGitMutationCommand("git -C /tmp/repo status")).toBe(false)
  })

  test("blocks repository mutations", () => {
    expect(isGitMutationCommand("git add .")).toBe(true)
    expect(isGitMutationCommand("git commit -m 'change'")).toBe(true)
    expect(isGitMutationCommand("git push origin HEAD")).toBe(true)
    expect(isGitMutationCommand("git switch -c feat/F001-test")).toBe(true)
    expect(isGitMutationCommand("git worktree add ../foo feat/F001-test")).toBe(true)
    expect(isGitMutationCommand("git branch -D old-branch")).toBe(true)
  })

  test("blocks mutation hidden in a compound or nested shell command", () => {
    expect(isGitMutationCommand("git status && git push origin HEAD")).toBe(true)
    expect(isGitMutationCommand('bash -lc "git push origin HEAD"')).toBe(true)
    expect(isGitMutationCommand("sh -c 'git commit -m change'")).toBe(true)
    expect(isGitMutationCommand('bash -lc "git status --short"')).toBe(false)
  })
})
