import { describe, expect, test } from "bun:test"
import { DEFAULT_CONFIG } from "../src/config"
import {
  findFeatureId,
  findFeaturePart,
  isProtectedBranch,
  parseFeatureBranch,
  renderFeatureBranch,
  slugifyBranchSegment,
} from "../src/git/branch"

const config = DEFAULT_CONFIG.branches

describe("branch naming", () => {
  test("renders a feature branch", () => {
    expect(
      renderFeatureBranch(
        {
          featureId: "F001",
          slug: "Panel Auth",
        },
        config,
      ),
    ).toBe("feat/F001-panel-auth")
  })

  test("renders exactly one feature-part level", () => {
    expect(
      renderFeatureBranch(
        {
          featureId: "F001",
          part: "A",
          slug: "Token Lifecycle",
        },
        config,
      ),
    ).toBe("feat/F001-A-token-lifecycle")
  })

  test("parses parent and part branches", () => {
    expect(parseFeatureBranch("feat/F001-panel-auth", config)).toEqual({
      kind: "feature",
      featureId: "F001",
      slug: "panel-auth",
      branch: "feat/F001-panel-auth",
    })

    expect(parseFeatureBranch("feat/F001-B-auth-ui", config)).toEqual({
      kind: "feature-part",
      featureId: "F001",
      part: "B",
      slug: "auth-ui",
      branch: "feat/F001-B-auth-ui",
    })
  })

  test("rejects invalid feature identifiers and parts", () => {
    expect(() => renderFeatureBranch({ featureId: "1", slug: "Auth" }, config)).toThrow()
    expect(() => renderFeatureBranch({ featureId: "F001", part: "AA", slug: "Auth" }, config)).toThrow()
  })

  test("normalizes branch slugs", () => {
    expect(slugifyBranchSegment("Panel Auth / Tokens")).toBe("panel-auth-tokens")
  })

  test("recognizes protected branches", () => {
    expect(isProtectedBranch("main", config)).toBe(true)
    expect(isProtectedBranch("feat/F001-panel-auth", config)).toBe(false)
  })

  test("finds feature ids using the configured pattern", () => {
    const companion = {
      ...config,
      featureIdPattern: "^C\\d{3,}$",
    }

    expect(findFeatureId("Work on C001 authentication", companion)).toBe("C001")
    expect(findFeatureId("Work on F001 authentication", companion)).toBeUndefined()
    expect(findFeaturePart("Continue C001-B now", "C001", companion)).toBe("B")
  })

})
