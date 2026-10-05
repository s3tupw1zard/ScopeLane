import { describe, expect, test } from "bun:test"
import type { PullRequestProvider } from "../src/provider/github"

describe("pull request provider contract", () => {
  test("supports idempotent ensure semantics", async () => {
    const provider: PullRequestProvider = {
      async ensure(request) {
        return { url: "https://example.invalid/" + request.head, created: false }
      },
    }
    const result = await provider.ensure({
      head: "feat/F001-A-auth",
      base: "feat/F001-panel-auth",
      title: "Auth part A",
      body: "ScopeLane",
    })
    expect(result.created).toBe(false)
    expect(result.url).toContain("F001-A")
  })
})
