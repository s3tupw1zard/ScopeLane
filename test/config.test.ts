import { describe, expect, test } from "bun:test"
import { DEFAULT_CONFIG, resolveConfig } from "../src/config"

describe("configuration", () => {
  test("uses delayed idle checkpoints by default", () => {
    expect(DEFAULT_CONFIG.checkpoint.idleDelaySeconds).toBe(90)
    expect(DEFAULT_CONFIG.checkpoint.minIntervalSeconds).toBe(180)
  })

  test("accepts custom checkpoint timing and feature prefix", () => {
    const config = resolveConfig({
      branches: { prefixes: { feature: "feature" } },
      checkpoint: { idleDelaySeconds: 30, minIntervalSeconds: 600 },
    })

    expect(config.branches.prefixes.feature).toBe("feature")
    expect(config.checkpoint.idleDelaySeconds).toBe(30)
    expect(config.checkpoint.minIntervalSeconds).toBe(600)
  })

  test("clamps unsafe timing values", () => {
    const config = resolveConfig({
      checkpoint: { idleDelaySeconds: -50, minIntervalSeconds: 999999 },
    })

    expect(config.checkpoint.idleDelaySeconds).toBe(0)
    expect(config.checkpoint.minIntervalSeconds).toBe(86400)
  })
})
