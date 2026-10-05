import { describe, expect, test } from "bun:test"
import { DEFAULT_CONFIG } from "../src/config"
import { parseFeatureRegistry } from "../src/scope/registry"
import { resolveScope } from "../src/scope/resolver"

const registry = `
| Gapless | Planned | Implemented | ID | Feature | Short description | Description | Depends on | Spec |
|---|---|---|---|---|---|---|---|---|
| [x] | [ ] | [ ] | F001 | Panel Authentication | Authenticate against Pelican Panel | Login and token lifecycle. | — | \`specs/001-auth/spec.md\` |
| [ ] | [ ] | [ ] | F002 | Server Console | Realtime console | View and send console commands. | F001 | \`specs/002-console/spec.md\` |
`

describe("ScopeSeed registry", () => {
  test("parses accepted features", () => {
    const features = parseFeatureRegistry(registry)
    expect(features).toHaveLength(2)
    expect(features[0]?.id).toBe("F001")
    expect(features[1]?.dependsOn).toEqual(["F001"])
  })
})

describe("scope resolver", () => {
  test("uses an explicitly named registered feature without a model", async () => {
    const decision = await resolveScope(
      "Implement F001 now",
      { enabled: true, features: parseFeatureRegistry(registry) },
      DEFAULT_CONFIG.scope,
    )

    expect(decision.kind).toBe("feature")
    expect(decision.featureId).toBe("F001")
    expect(decision.slug).toBe("panel-authentication")
  })

  test("accepts a one-level split for a registered feature", async () => {
    const decision = await resolveScope(
      "Implement panel authentication",
      { enabled: true, features: parseFeatureRegistry(registry) },
      DEFAULT_CONFIG.scope,
      {
        async text() {
          return JSON.stringify({
            kind: "feature",
            featureId: "F001",
            slug: "panel-auth",
            confidence: 0.95,
            reason: "Two independent implementation workstreams.",
            split: {
              parts: [
                { label: "A", slug: "token-lifecycle", description: "Token storage and refresh." },
                { label: "B", slug: "login-ui", description: "Login and account UI." },
              ],
            },
          })
        },
      },
    )

    expect(decision.featureId).toBe("F001")
    expect(decision.split?.parts.map((part) => part.label)).toEqual(["A", "B"])
  })

  test("never accepts invented ScopeSeed IDs", async () => {
    const decision = await resolveScope(
      "Build a new thing",
      { enabled: true, features: parseFeatureRegistry(registry) },
      DEFAULT_CONFIG.scope,
      {
        async text() {
          return JSON.stringify({
            kind: "feature",
            featureId: "F999",
            slug: "new-thing",
            confidence: 0.99,
            reason: "Invented.",
          })
        },
      },
    )

    expect(decision.featureId).toBeUndefined()
    expect(decision.slug).toBe("new-thing")
  })

  test("supports a custom ScopeSeed feature id pattern", async () => {
    const companionRegistry = registry.replaceAll("F001", "C001").replaceAll("F002", "C002")
    const features = parseFeatureRegistry(companionRegistry, "^C\\d{3,}$")
    const decision = await resolveScope(
      "Implement C001 now",
      { enabled: true, features },
      DEFAULT_CONFIG.scope,
    )

    expect(features.map((feature) => feature.id)).toEqual(["C001", "C002"])
    expect(decision.featureId).toBe("C001")
    expect(decision.slug).toBe("panel-authentication")
  })

  test("does not add a feature id when ScopeSeed is not in use", async () => {
    const decision = await resolveScope(
      "Implement companion authentication",
      { enabled: false, features: [] },
      DEFAULT_CONFIG.scope,
      {
        async text() {
          return JSON.stringify({
            kind: "feature",
            featureId: "C001",
            slug: "companion-authentication",
            confidence: 0.99,
            reason: "Feature work.",
          })
        },
      },
    )

    expect(decision.kind).toBe("feature")
    expect(decision.featureId).toBeUndefined()
    expect(decision.slug).toBe("companion-authentication")
  })

})
