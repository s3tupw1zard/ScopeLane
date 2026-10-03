import { Plugin } from "@opencode/plugin"
import { resolveConfig } from "./config"
import { planCheckpoint } from "./checkpoint/planner"
import { parseFeatureBranch } from "./git/branch"
import { GitClient } from "./git/client"
import { isGitMutationCommand } from "./git/guard"
import { GitRepository } from "./git/repository"
import { ensureLane } from "./lane/orchestrator"
import { planLanes, type LanePlan, type PlannedLane } from "./lane/plan"
import { GitHubCliProvider } from "./provider/github"
import { loadScopeSeedContext } from "./scope/registry"
import { resolveScope, type ScopeDecision } from "./scope/resolver"
import type { FeatureState, SessionLaneState } from "./state"

function toJson<T>(value: T) {
  return JSON.parse(JSON.stringify(value))
}

function sessionKey(sessionID: string): string {
  return "session/" + sessionID
}

function featureKey(featureID: string): string {
  return "feature/" + featureID
}

function asSessionState(value: unknown): SessionLaneState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const candidate = value as Partial<SessionLaneState>
  return
    typeof candidate.sessionId === "string" &&
    typeof candidate.branch === "string" &&
    typeof candidate.baseBranch === "string" &&
    typeof candidate.worktree === "string"
      ? (candidate as SessionLaneState)
      : undefined
}

function asFeatureState(value: unknown): FeatureState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const candidate = value as Partial<FeatureState>
  return
    typeof candidate.featureId === "string" &&
    typeof candidate.parentBranch === "string" &&
    Array.isArray(candidate.parts)
      ? (candidate as FeatureState)
      : undefined
}

function chooseExistingPart(
  prompt: string,
  decision: ScopeDecision,
  feature: FeatureState,
): FeatureState["parts"][number] | undefined {
  const explicit = prompt.match(new RegExp("\\b" + feature.featureId + "-([A-Z])\\b", "i"))?.[1]?.toUpperCase()
  if (explicit) {
    const match = feature.parts.find((part) => part.part === explicit)
    if (match) return match
  }

  if (decision.activePart) {
    const match = feature.parts.find((part) => part.part === decision.activePart)
    if (match) return match
  }

  const normalized = prompt.toLowerCase()
  const scored = feature.parts
    .map((part) => {
      const terms = [part.slug, part.description]
        .filter((value): value is string => Boolean(value))
        .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/))
        .filter((value) => value.length >= 3)
      return { part, score: terms.filter((term) => normalized.includes(term)).length }
    })
    .sort((a, b) => b.score - a.score)

  return scored[0]?.score ? scored[0].part : feature.parts[0]
}

function planFromExistingFeature(
  decision: ScopeDecision,
  feature: FeatureState,
  defaultBranch: string,
): LanePlan | undefined {
  if (decision.featureId !== feature.featureId) return undefined
  if (feature.mode !== "split" && feature.mode !== "integration-only") return undefined
  const selected = chooseExistingPart("", decision, feature)
  if (!selected) return undefined

  const parent: PlannedLane = {
    branch: feature.parentBranch,
    baseBranch: defaultBranch,
    role: "integration",
    featureId: feature.featureId,
  }
  const parts: PlannedLane[] = feature.parts.map((part) => ({
    branch: part.branch,
    baseBranch: feature.parentBranch,
    role: "work",
    featureId: feature.featureId,
    part: part.part,
    slug: part.slug,
    description: part.description,
  })) as PlannedLane[]
  const active = parts.find((part) => part.part === selected.part) ?? parts[0]
  if (!active) return undefined
  return { active, parent, siblings: parts.filter((part) => part.branch !== active.branch) }
}

export default Plugin.define({
  id: "scopelane",

  async setup(ctx) {
    const config = resolveConfig(ctx.options)
    await ctx.storage.set("effective-config", toJson(config))

    const laneLocks = new Map<string, Promise<void>>()
    const checkpointing = new Set<string>()

    const withLaneLock = async (sessionID: string, work: () => Promise<void>) => {
      const previous = laneLocks.get(sessionID) ?? Promise.resolve()
      const current = previous.catch(() => undefined).then(work)
      laneLocks.set(sessionID, current)
      try {
        await current
      } finally {
        if (laneLocks.get(sessionID) === current) laneLocks.delete(sessionID)
      }
    }

    const loadSessionState = async (sessionID: string) =>
      asSessionState(await ctx.storage.get(sessionKey(sessionID)))

    const saveSessionState = async (state: SessionLaneState) => {
      await ctx.storage.set(sessionKey(state.sessionId), toJson(state))
    }

    const loadFeatureState = async (featureID: string) =>
      asFeatureState(await ctx.storage.get(featureKey(featureID)))

    const saveFeatureState = async (state: FeatureState) => {
      await ctx.storage.set(featureKey(state.featureId), toJson(state))
    }

    const generatedText = async (session: Awaited<ReturnType<typeof ctx.session.get>>, prompt: string) => {
      if (session.model) {
        const output = await ctx.generate.text({ model: session.model, prompt })
        if (typeof output === "string") return output
        const maybe = output as unknown as { text?: string }
        if (typeof maybe.text === "string") return maybe.text
      }
      const output = await ctx.session.generate({ sessionID: session.id, prompt })
      return output.text
    }

    const resolveLanePlan = async (
      session: Awaited<ReturnType<typeof ctx.session.get>>,
      prompt: string,
      repository: GitRepository,
    ) => {
      const defaultBranch = await repository.defaultBranch()
      const scopeContext = await loadScopeSeedContext(session.location.directory, config.scope)
      const decision = await resolveScope(prompt, scopeContext, config.scope, {
        text: (input) => generatedText(session, input),
      })

      if (decision.featureId) {
        const existing = await loadFeatureState(decision.featureId)
        if (existing && (existing.mode === "split" || existing.mode === "integration-only")) {
          const chosen = chooseExistingPart(prompt, decision, existing)
          if (chosen) decision.activePart = chosen.part
          const persisted = planFromExistingFeature(decision, existing, defaultBranch)
          if (persisted) return { decision, plan: persisted, defaultBranch, existing }
        }
        if (existing?.mode === "single") {
          decision.split = undefined
        }
      }

      return {
        decision,
        plan: planLanes(decision, defaultBranch, config.branches),
        defaultBranch,
        existing: undefined,
      }
    }

    const persistFeaturePlan = async (decision: ScopeDecision, plan: LanePlan) => {
      if (!decision.featureId) return
      if (plan.parent) {
        await saveFeatureState({
          featureId: decision.featureId,
          parentBranch: plan.parent.branch,
          mode: "split",
          parts: [plan.active, ...plan.siblings].map((lane) => ({
            part: lane.part!,
            branch: lane.branch,
            slug: lane.slug,
            description: lane.description,
          })),
        })
        return
      }
      await saveFeatureState({
        featureId: decision.featureId,
        parentBranch: plan.active.branch,
        mode: "single",
        parts: [],
      })
    }

    const adoptCurrentLane = async (
      session: Awaited<ReturnType<typeof ctx.session.get>>,
      branch: string,
      repository: GitRepository,
    ) => {
      const defaultBranch = await repository.defaultBranch()
      const parsed = parseFeatureBranch(branch, config.branches)
      let baseBranch = defaultBranch
      let featureId: string | undefined
      let part: string | undefined

      if (parsed) {
        featureId = parsed.featureId
        part = parsed.kind === "feature-part" ? parsed.part : undefined
        const feature = await loadFeatureState(parsed.featureId)
        if (part && feature) baseBranch = feature.parentBranch
      }

      const state: SessionLaneState = {
        sessionId: session.id,
        branch,
        baseBranch,
        worktree: session.location.directory,
        featureId,
        part,
        branchNameLocked: false,
      }
      await saveSessionState(state)
      return state
    }

    const ensureSessionLane = async (sessionID: string, prompt: string) => {
      if (await loadSessionState(sessionID)) return
      const session = await ctx.session.get({ sessionID })
      if (session.parentID) return

      const repository = new GitRepository(session.location.directory, config.branches)
      const currentBranch = await repository.currentBranch()
      if (currentBranch && !config.branches.protected.includes(currentBranch)) {
        await adoptCurrentLane(session, currentBranch, repository)
        return
      }

      if (await repository.isDirty()) {
        throw new Error(
          "ScopeLane: the protected source checkout has uncommitted changes. Clean or move them before starting a new lane.",
        )
      }

      const { decision, plan } = await resolveLanePlan(session, prompt, repository)
      const git = new GitClient(session.location.directory, config.branches)

      if (plan.parent) {
        await git.ensureBranch(plan.parent.branch, plan.parent.baseBranch)
        for (const sibling of plan.siblings) {
          await git.ensureBranch(sibling.branch, sibling.baseBranch)
        }
      }

      const lane = await ensureLane(
        {
          projectID: session.projectID,
          branch: plan.active.branch,
          baseBranch: plan.active.baseBranch,
          sourceDirectory: session.location.directory,
        },
        config.branches,
        git,
        ctx.worktree,
      )

      await persistFeaturePlan(decision, plan)
      const state: SessionLaneState = {
        sessionId: session.id,
        branch: lane.branch,
        baseBranch: plan.active.baseBranch,
        worktree: lane.directory,
        featureId: plan.active.featureId,
        part: plan.active.part,
        branchNameLocked: false,
      }
      await saveSessionState(state)

      await ctx.permission.rules({
        sessionID,
        permissions: [
          { action: "edit", resource: session.location.directory + "/**", effect: "deny" },
        ],
      })
      await ctx.session.move({
        sessionID,
        destination: { directory: lane.directory },
        moveChanges: false,
      })
    }

    const ensurePullRequest = async (
      state: SessionLaneState,
      direction: "forward" | "sync",
    ) => {
      const provider = new GitHubCliProvider(state.worktree, config.github)
      const head = direction === "forward" ? state.branch : state.baseBranch
      const base = direction === "forward" ? state.baseBranch : state.branch
      return provider.ensure({
        head,
        base,
        title:
          direction === "forward"
            ? "Merge " + state.branch + " into " + state.baseBranch
            : "Sync " + state.baseBranch + " into " + state.branch,
        body: "Created by ScopeLane. Merge remains an explicit GitHub PR action.",
      })
    }

    const checkpoint = async (sessionID: string, announce: boolean) => {
      if (checkpointing.has(sessionID)) return "Checkpoint already running."
      checkpointing.add(sessionID)
      try {
        const state = await loadSessionState(sessionID)
        if (!state) return "No ScopeLane lane is associated with this session."
        const session = await ctx.session.get({ sessionID })
        if (session.parentID) return "Subagent sessions use their parent lane."

        const repository = new GitRepository(state.worktree, config.branches)
        const snapshot = await repository.snapshot(config.checkpoint)
        if (snapshot.units.length === 0) return "Working tree is clean."

        const plan = await planCheckpoint(snapshot.units, config.checkpoint, {
          text: (prompt) => generatedText(session, prompt),
        })
        if (plan.commits.length === 0) {
          return "No commit created: " + (plan.reason || "changes are still incomplete")
        }

        const result = await repository.executePlan(snapshot, plan, config.checkpoint)
        let pushed = false
        if (result.commits.length && config.checkpoint.push) {
          await repository.push(state.branch, config.checkpoint)
          pushed = true
        }

        state.lastCheckpointHead = result.head
        if (pushed && config.branches.lockNameAfterPush) state.branchNameLocked = true
        await saveSessionState(state)

        let pr = ""
        if (
          pushed &&
          config.github.enabled &&
          config.github.autoCreatePullRequest
        ) {
          const pull = await ensurePullRequest(state, "forward")
          pr = " PR: " + pull.url
        }

        const summary =
          "ScopeLane checkpoint: " +
          result.commits.length +
          " commit(s)" +
          (pushed ? ", pushed." : ".") +
          " Pending units: " +
          result.pending.length +
          "." +
          pr
        if (announce) await ctx.session.synthetic({ sessionID, text: summary })
        return summary
      } finally {
        checkpointing.delete(sessionID)
      }
    }

    await ctx.permission.hook("evaluate", (event) => {
      if (event.action !== "shell") return
      if (!event.resources.some(isGitMutationCommand)) return
      event.effect = "deny"
      event.message =
        "ScopeLane owns Git mutations for this session. Git inspection is allowed; branch, index, history, worktree, and remote mutations must go through ScopeLane."
    })

    await ctx.session.hook("prompt", async (event) => {
      await withLaneLock(event.sessionID, () => ensureSessionLane(event.sessionID, event.prompt.text))
    })

    await ctx.session.hook("context", async (event) => {
      const state = await loadSessionState(event.sessionID)
      if (!state) return
      const scope = state.featureId
        ? "Feature " + state.featureId + (state.part ? " part " + state.part : "")
        : "Repository work"
      event.system.push({
        type: "text",
        text:
          "ScopeLane: work only inside lane " +
          state.branch +
          " (" +
          scope +
          "). Do not perform Git mutations directly; ScopeLane owns commits, pushes, and branch/worktree management.",
      })
    })

    await ctx.command.transform((editor) => {
      editor.add({
        name: "scopelane",
        description: "Show ScopeLane status, create a semantic checkpoint, or create/sync a pull request.",
        execute: async ({ sessionID, prompt }) => {
          const args = prompt.text.trim().replace(/^\/?scopelane(?:\s+|$)/i, "").trim()
          const action = args.split(/\s+/)[0]?.toLowerCase() || "status"
          const state = await loadSessionState(sessionID)

          if (action === "checkpoint") {
            const result = await checkpoint(sessionID, false)
            await ctx.session.synthetic({ sessionID, text: result })
            return
          }

          if (action === "pr" || action === "sync") {
            if (!state) {
              await ctx.session.synthetic({ sessionID, text: "ScopeLane: no lane is associated with this session." })
              return
            }
            const result = await ensurePullRequest(state, action === "pr" ? "forward" : "sync")
            await ctx.session.synthetic({
              sessionID,
              text: "ScopeLane PR: " + result.url + (result.created ? " (created)" : " (already open)"),
            })
            return
          }

          if (!state) {
            await ctx.session.synthetic({ sessionID, text: "ScopeLane: no lane is associated with this session yet." })
            return
          }
          await ctx.session.synthetic({
            sessionID,
            text:
              "ScopeLane lane: " +
              state.branch +
              "\nBase: " +
              state.baseBranch +
              "\nWorktree: " +
              state.worktree +
              (state.featureId ? "\nFeature: " + state.featureId + (state.part ? "-" + state.part : "") : ""),
          })
        },
      })
    })

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event.type !== "session.idle" || !config.checkpoint.onIdle) continue
          const sessionID = event.properties.sessionID
          void checkpoint(sessionID, true).catch(async (error) => {
            const message = error instanceof Error ? error.message : String(error)
            await ctx.session.synthetic({
              sessionID,
              text: "ScopeLane checkpoint skipped: " + message,
            }).catch(() => undefined)
          })
        }
      } catch (error) {
        if (!controller.signal.aborted) console.error("ScopeLane event loop failed", error)
      }
    })()

    return () => controller.abort()
  },
})
