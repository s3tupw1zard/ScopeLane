import { describe, expect, test } from "bun:test"
import { DEFAULT_CONFIG } from "../src/config"
import { planLanes } from "../src/lane/plan"

describe("lane planning", () => {
  test("plans a registered feature directly from main", () => {
    const plan = planLanes(
      {
        kind: "feature",
        featureId: "F001",
        slug: "panel-auth",
        confidence: 1,
        reason: "registered feature",
      },
      "main",
      DEFAULT_CONFIG.branches,
    )

    expect(plan.active.branch).toBe("feat/F001-panel-auth")
    expect(plan.active.baseBranch).toBe("main")
    expect(plan.active.role).toBe("work")
  })

  test("plans one-level feature parts through an integration parent", () => {
    const plan = planLanes(
      {
        kind: "feature",
        featureId: "F001",
        slug: "panel-auth",
        confidence: 0.95,
        reason: "parallel work",
        activePart: "B",
        split: {
          parts: [
            { label: "A", slug: "token-lifecycle", description: "Tokens" },
            { label: "B", slug: "login-ui", description: "UI" },
          ],
        },
      },
      "main",
      DEFAULT_CONFIG.branches,
    )

    expect(plan.parent).toEqual({
      branch: "feat/F001-panel-auth",
      baseBranch: "main",
      role: "integration",
      featureId: "F001",
    })
    expect(plan.active.branch).toBe("feat/F001-B-login-ui")
    expect(plan.active.baseBranch).toBe("feat/F001-panel-auth")
    expect(plan.siblings.map((lane) => lane.branch)).toEqual(["feat/F001-A-token-lifecycle"])
  })

  test("uses configured prefixes for non-feature lanes", () => {
    const plan = planLanes(
      { kind: "fix", slug: "login-timeout", confidence: 1, reason: "bug" },
      "main",
      DEFAULT_CONFIG.branches,
    )
    expect(plan.active.branch).toBe("fix/login-timeout")
    expect(plan.active.baseBranch).toBe("main")
  })
})


describe("integration parent invariants", () => {
  test("split plans keep feature parts one level below the parent", () => {
    const plan = planLanes(
      {
        kind: "feature",
        featureId: "F042",
        slug: "large-feature",
        confidence: 1,
        reason: "parallel work",
        split: {
          parts: [
            { label: "A", slug: "backend", description: "Backend" },
            { label: "B", slug: "frontend", description: "Frontend" },
          ],
        },
      },
      "main",
      DEFAULT_CONFIG.branches,
    )

    expect(plan.parent?.branch).toBe("feat/F042-large-feature")
    expect([plan.active, ...plan.siblings].every((lane) => lane.baseBranch === plan.parent?.branch)).toBe(true)
    expect([plan.active, ...plan.siblings].every((lane) => /^feat\/F042-[A-Z]-/.test(lane.branch))).toBe(true)
  })
})


describe("single-to-split promotion", () => {
  test("keeps the existing feature branch as the integration parent", () => {
    const plan = planLanes(
      {
        kind: "feature",
        featureId: "F001",
        slug: "panel-auth",
        confidence: 1,
        reason: "feature grew into parallel workstreams",
        activePart: "A",
        split: {
          parts: [
            { label: "A", slug: "tokens", description: "Token lifecycle" },
            { label: "B", slug: "ui", description: "Authentication UI" },
          ],
        },
      },
      "main",
      DEFAULT_CONFIG.branches,
    )

    expect(plan.parent?.branch).toBe("feat/F001-panel-auth")
    expect(plan.active.baseBranch).toBe("feat/F001-panel-auth")
    expect(plan.active.branch).toBe("feat/F001-A-tokens")
  })
})
