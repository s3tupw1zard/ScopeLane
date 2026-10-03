import { Plugin } from "@opencode/plugin"
import { resolveConfig } from "./config"
import { isGitMutationCommand } from "./git/guard"

export default Plugin.define({
  id: "scopelane",

  async setup(ctx) {
    const config = resolveConfig(ctx.options)

    await ctx.storage.set("effective-config", config)

    await ctx.permission.hook("evaluate", (event) => {
      if (event.action !== "shell") return
      if (!event.resources.some(isGitMutationCommand)) return

      event.effect = "deny"
      event.message =
        "ScopeLane owns Git mutations for this session. Git inspection is allowed; branch, index, history, worktree, and remote mutations must go through ScopeLane."
    })

    const controller = new AbortController()

    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event.type !== "session.idle") continue
          // Checkpoint analysis is intentionally added in the next implementation slice.
          // Idle is a trigger to inspect accumulated work, never an unconditional commit.
        }
      } catch (error) {
        if (!controller.signal.aborted) throw error
      }
    })()

    return () => controller.abort()
  },
})
