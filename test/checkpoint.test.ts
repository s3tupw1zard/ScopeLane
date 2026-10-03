import { describe, expect, test } from "bun:test"
import { DEFAULT_CONFIG } from "../src/config"
import { appendUntrackedUnits, parseWorkingDiff } from "../src/checkpoint/changes"
import { planCheckpoint, validateCommitPlan } from "../src/checkpoint/planner"

const diff = [
  "diff --git a/lib/a.ts b/lib/a.ts",
  "--- a/lib/a.ts",
  "+++ b/lib/a.ts",
  "@@ -1,2 +1,2 @@",
  "-old",
  "+new",
  " keep",
  "@@ -10,2 +10,3 @@",
  " keep2",
  "+added",
  " keep3",
  "",
].join("\n")

describe("change units", () => {
  test("splits tracked changes at hunk boundaries", () => {
    const units = parseWorkingDiff(diff)
    expect(units).toHaveLength(2)
    expect(units[0]?.path).toBe("lib/a.ts")
    expect(units[0]?.kind).toBe("patch")
    expect(units[1]?.id).toBe("p2")
  })

  test("adds untracked files as whole-file units with optional semantic previews", () => {
    const units = appendUntrackedUnits(
      parseWorkingDiff(diff),
      ["lib/new.ts"],
      new Map([["lib/new.ts", "export const value = 1\n"]]),
    )
    expect(units.at(-1)).toMatchObject({
      kind: "untracked",
      path: "lib/new.ts",
      preview: "export const value = 1\n",
    })
  })
})

describe("semantic commit planning", () => {
  const units = appendUntrackedUnits(parseWorkingDiff(diff), ["lib/new.ts"])

  test("allows pending work and adds omitted units to pending", () => {
    const plan = validateCommitPlan(
      {
        commits: [{ message: "fix(core): update first behavior", units: ["p1"] }],
        pending: ["p2"],
        reason: "new file is incomplete",
      },
      units,
      DEFAULT_CONFIG.checkpoint,
    )
    expect(plan.commits).toHaveLength(1)
    expect(plan.pending).toContain(units[2]!.id)
  })

  test("rejects duplicate unit assignment", () => {
    expect(() =>
      validateCommitPlan(
        {
          commits: [
            { message: "fix(core): first", units: ["p1"] },
            { message: "test(core): second", units: ["p1"] },
          ],
        },
        units,
        DEFAULT_CONFIG.checkpoint,
      ),
    ).toThrow("more than once")
  })

  test("planner receives actual hunk content for semantic grouping", async () => {
    let received = ""
    await planCheckpoint(units, DEFAULT_CONFIG.checkpoint, {
      async text(prompt) {
        received = prompt
        return JSON.stringify({ commits: [], pending: units.map((unit) => unit.id) })
      },
    })
    expect(received).toContain("-old")
    expect(received).toContain("+new")
  })

  test("planner may deliberately create no commits", async () => {
    const plan = await planCheckpoint(units, DEFAULT_CONFIG.checkpoint, {
      async text() {
        return JSON.stringify({ commits: [], pending: units.map((unit) => unit.id), reason: "Incomplete." })
      },
    })
    expect(plan.commits).toHaveLength(0)
    expect(plan.pending).toHaveLength(units.length)
  })
})
