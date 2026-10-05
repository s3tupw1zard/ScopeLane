import { resolveConfig } from "./config"
import { planCheckpoint } from "./checkpoint/planner"
import { findFeatureId, findFeaturePart, parseFeatureBranch } from "./git/branch"
import { GitClient } from "./git/client"
import { isGitMutationCommand, isReadOnlyGitInspectionCommand } from "./git/guard"
import { GitRepository } from "./git/repository"
import { ensureLane } from "./lane/orchestrator"
import { planLanes, type LanePlan, type PlannedLane } from "./lane/plan"
import { GitHubCliProvider } from "./provider/github"
import { loadScopeSeedContext } from "./scope/registry"
import { resolveScope, type ScopeDecision } from "./scope/resolver"
import type { FeatureState, SessionLaneState } from "./state"
import type { OpenCodeSession, ScopeLanePlugin } from "./opencode-types"

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
  return (
    typeof candidate.sessionId === "string" &&
    typeof candidate.branch === "string" &&
    typeof candidate.baseBranch === "string" &&
    typeof candidate.worktree === "string"
      ? (candidate as SessionLaneState)
      : undefined
  )
}

function asFeatureState(value: unknown): FeatureState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const candidate = value as Partial<FeatureState>
  return (
    typeof candidate.featureId === "string" &&
    typeof candidate.parentBranch === "string" &&
    Array.isArray(candidate.parts)
      ? (candidate as FeatureState)
      : undefined
  )
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

  return scored[0]?.score ? scored[0].part : undefined
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

const plugin: ScopeLanePlugin = {
  id: "scopelane",

  async setup(ctx) {
    const config = resolveConfig(ctx.options)
    await ctx.storage.set("effective-config", toJson(config))

    const laneLocks = new Map<string, Promise<void>>()
    const checkpointing = new Set<string>()
    const idleTimers = new Map<string, ReturnType<typeof setTimeout>>()
    const protectedReadOnly = new Map<string, { branch: string; directory: string }>()

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

    const cancelIdleCheckpoint = (sessionID: string) => {
      const timer = idleTimers.get(sessionID)
      if (timer) clearTimeout(timer)
      idleTimers.delete(sessionID)
    }

    const loadFeatureState = async (featureID: string) =>
      asFeatureState(await ctx.storage.get(featureKey(featureID)))

    const saveFeatureState = async (state: FeatureState) => {
      await ctx.storage.set(featureKey(state.featureId), toJson(state))
    }

    const generatedText = async (session: OpenCodeSession, prompt: string) => {
      if (session.model) {
        const output = await ctx.generate.text({ model: session.model, prompt })
        if (typeof output === "string") return output
        const maybe = output as unknown as { text?: string }
        if (typeof maybe.text === "string") return maybe.text
      }
      const output = await ctx.session.generate({ sessionID: session.id, prompt })
      return output.text
    }

    const resolveExistingPart = async (
      session: OpenCodeSession,
      prompt: string,
      feature: FeatureState,
    ) => {
      const deterministic = chooseExistingPart(prompt, {
        kind: "feature",
        slug: feature.featureId.toLowerCase(),
        confidence: 1,
        reason: "existing split feature",
        featureId: feature.featureId,
      }, feature)
      if (deterministic) return deterministic

      const inventory = feature.parts
        .map(
          (part) =>
            part.part +
            ": " +
            (part.slug ?? part.branch) +
            (part.description ? " — " + part.description : ""),
        )
        .join("\n")

      const output = await generatedText(
        session,
        [
          "You are selecting the existing ScopeLane part for " + feature.featureId + ".",
          "Choose only from the listed labels. Do not invent another part.",
          "If the task is too ambiguous to choose safely, return null.",
          "Return JSON only: {\"part\":\"A\"} or {\"part\":null}.",
          "",
          "PARTS:",
          inventory,
          "",
          "TASK:",
          prompt.slice(0, 8_000),
        ].join("\n"),
      )

      try {
        const json = output.match(/\{[\s\S]*\}/)?.[0]
        const parsed = json ? (JSON.parse(json) as { part?: unknown }) : undefined
        const label = typeof parsed?.part === "string" ? parsed.part.toUpperCase() : undefined
        return label ? feature.parts.find((part) => part.part === label) : undefined
      } catch {
        return undefined
      }
    }

    const resolveLanePlan = async (
      session: OpenCodeSession,
      prompt: string,
      repository: GitRepository,
    ) => {
      const defaultBranch = await repository.defaultBranch()
      const scopeContext = await loadScopeSeedContext(session.location.directory, config.scope, config.branches)
      const decision = await resolveScope(prompt, scopeContext, config.scope, {
        text: (input) => generatedText(session, input),
      })

      if (decision.featureId) {
        const existing = await loadFeatureState(decision.featureId)
        if (existing && (existing.mode === "split" || existing.mode === "integration-only")) {
          const chosen =
            chooseExistingPart(prompt, decision, existing) ??
            (await resolveExistingPart(session, prompt, existing))
          if (!chosen) {
            throw new Error(
              "ScopeLane: " +
                existing.featureId +
                " is split, but the task does not identify a part clearly enough. " +
                "Mention the target explicitly (for example " +
                existing.featureId +
                "-A).",
            )
          }
          decision.activePart = chosen.part
          const persisted = planFromExistingFeature(decision, existing, defaultBranch)
          if (persisted) return { decision, plan: persisted, defaultBranch, existing }
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
          baseBranch: plan.parent.baseBranch,
          mode: "integration-only",
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
        baseBranch: plan.active.baseBranch,
        mode: "single",
        parts: [],
      })
    }

    const adoptCurrentLane = async (
      session: OpenCodeSession,
      branch: string,
      repository: GitRepository,
      prompt: string,
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
        taskSummary: prompt.slice(0, 2_000),
      }
      await saveSessionState(state)
      return state
    }

    const ensureSessionLane = async (sessionID: string, prompt: string) => {
      if (await loadSessionState(sessionID)) return
      const session = await ctx.session.get({ sessionID })
      if (session.parentID) return

      protectedReadOnly.delete(sessionID)

      const repository = new GitRepository(session.location.directory, config.branches)
      const currentBranch = await repository.currentBranch()
      let preResolved:
        | Awaited<ReturnType<typeof resolveLanePlan>>
        | undefined

      if (
        currentBranch &&
        config.branches.protected.includes(currentBranch) &&
        (await repository.isDirty())
      ) {
        protectedReadOnly.set(sessionID, {
          branch: currentBranch,
          directory: session.location.directory,
        })
        return
      }

      if (currentBranch && !config.branches.protected.includes(currentBranch)) {
        const parsed = parseFeatureBranch(currentBranch, config.branches)
        const feature =
          parsed?.kind === "feature" ? await loadFeatureState(parsed.featureId) : undefined
        const isFeatureParent =
          Boolean(feature) && feature!.parentBranch === currentBranch && parsed?.kind === "feature"

        if (isFeatureParent) {
          preResolved = await resolveLanePlan(session, prompt, repository)
          const wantsSplit =
            feature?.mode === "single" &&
            preResolved.plan.parent?.branch === currentBranch
          const integrationOnly =
            feature?.mode === "split" || feature?.mode === "integration-only"

          if (!wantsSplit && !integrationOnly) {
            await adoptCurrentLane(session, currentBranch, repository, prompt)
            return
          }

          if (await repository.isDirty()) {
            throw new Error(
              "ScopeLane: " +
                currentBranch +
                (integrationOnly
                  ? " is an integration-only feature parent"
                  : " must be clean before it can be promoted to an integration parent") +
                ". Run /scopelane checkpoint and finish pending work first.",
            )
          }
        } else {
          await adoptCurrentLane(session, currentBranch, repository, prompt)
          return
        }
      }

      if (await repository.isDirty()) {
        throw new Error(
          "ScopeLane: the source checkout has uncommitted changes. Clean or move them before starting a new lane.",
        )
      }

      const { decision, plan } = preResolved ?? (await resolveLanePlan(session, prompt, repository))
      const git = new GitClient(session.location.directory, config.branches)

      if (plan.parent) {
        await git.ensureBranch(plan.parent.branch, plan.parent.baseBranch)
        for (const sibling of plan.siblings) {
          await git.ensureBranch(sibling.branch, sibling.baseBranch)
        }
      }

      const worktreeClient = {
        refresh: (input: { projectID: string }) => ctx.worktree.refresh(input),
        list: (input: { projectID: string }) => ctx.worktree.list(input),
        create: (input: {
          projectID: string
          name: string
          branch: string
          from?: string
        }) => ctx.worktree.create(input),
        branchAt: async (directory: string) => {
          try {
            return await new GitRepository(directory, config.branches).currentBranch()
          } catch {
            return undefined
          }
        },
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
        worktreeClient,
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
        taskSummary: prompt.slice(0, 2_000),
      }
      await saveSessionState(state)

      await ctx.session.move({ sessionID, directory: lane.directory })
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

    const ensureFeaturePullRequest = async (
      state: SessionLaneState,
      direction: "forward" | "sync",
    ) => {
      if (!state.featureId) {
        throw new Error("ScopeLane: the current lane is not associated with a ScopeSeed feature")
      }

      const feature = await loadFeatureState(state.featureId)
      if (!feature) throw new Error("ScopeLane: feature state is not available for " + state.featureId)

      const repository = new GitRepository(state.worktree, config.branches)
      const defaultBranch = feature.baseBranch ?? (await repository.defaultBranch())
      const provider = new GitHubCliProvider(state.worktree, config.github)
      const head = direction === "forward" ? feature.parentBranch : defaultBranch
      const base = direction === "forward" ? defaultBranch : feature.parentBranch

      return provider.ensure({
        head,
        base,
        title:
          direction === "forward"
            ? "Merge " + feature.parentBranch + " into " + defaultBranch
            : "Sync " + defaultBranch + " into " + feature.parentBranch,
        body:
          "Created by ScopeLane for feature " +
          feature.featureId +
          ". Integration remains an explicit GitHub pull request action.",
      })
    }

    const checkpoint = async (
      sessionID: string,
      announce: boolean,
      options: { force?: boolean } = {},
    ) => {
      if (checkpointing.has(sessionID)) return "Checkpoint already running."
      checkpointing.add(sessionID)
      try {
        const state = await loadSessionState(sessionID)
        if (!state) return "No ScopeLane lane is associated with this session."
        const session = await ctx.session.get({ sessionID })
        if (session.parentID) return "Subagent sessions use their parent lane."

        const repository = new GitRepository(state.worktree, config.branches)
        if (state.featureId) {
          const feature = await loadFeatureState(state.featureId)
          if (
            feature &&
            feature.parentBranch === state.branch &&
            (feature.mode === "split" || feature.mode === "integration-only")
          ) {
            return (
              "No commit created: " +
              feature.parentBranch +
              " is integration-only; merge feature parts through pull requests."
            )
          }
        }

        const snapshot = await repository.snapshot(config.checkpoint)
        if (snapshot.units.length === 0) return "Working tree is clean."

        if (!options.force && state.lastPlannedFingerprint === snapshot.fingerprint) {
          return "No commit created: " + (state.lastPlanReason || "unchanged work is still incomplete")
        }

        const recentCommits = await repository.recentCommitSubjects()
        const plan = await planCheckpoint(
          snapshot.units,
          config.checkpoint,
          {
            text: (prompt) => generatedText(session, prompt),
          },
          {
            branch: state.branch,
            baseBranch: state.baseBranch,
            featureId: state.featureId,
            part: state.part,
            taskSummary: state.taskSummary,
            recentCommits,
          },
        )
        if (plan.commits.length === 0) {
          state.lastPlannedFingerprint = snapshot.fingerprint
          state.lastPlanReason = plan.reason || "changes are still incomplete"
          await saveSessionState(state)
          return "No commit created: " + state.lastPlanReason
        }

        const result = await repository.executePlan(snapshot, plan, config.checkpoint)
        let pushed = false
        if (result.commits.length && config.checkpoint.push) {
          await repository.push(state.branch, config.checkpoint)
          pushed = true
        }

        state.lastCheckpointHead = result.head
        state.lastCheckpointAt = Date.now()
        state.lastPlannedFingerprint = undefined
        state.lastPlanReason = undefined
        if (pushed && config.branches.lockNameAfterPush) state.branchNameLocked = true
        await saveSessionState(state)

        let pr = ""
        if (
          pushed &&
          config.github.enabled &&
          config.github.autoCreatePullRequest &&
          (!state.featureId || Boolean(state.part))
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
      const readOnly = protectedReadOnly.get(event.sessionID)

      if (readOnly && event.action === "edit") {
        event.effect = "deny"
        event.message =
          'ScopeLane protected read-only mode: "' +
          readOnly.branch +
          '" has uncommitted changes. File edits are blocked until you create or switch to a work branch.'
        return
      }

      if (readOnly && event.action === "shell") {
        if (event.resources.every(isReadOnlyGitInspectionCommand)) return
        event.effect = "deny"
        event.message =
          'ScopeLane protected read-only mode: only read-only Git inspection is allowed on "' +
          readOnly.branch +
          '". Create or switch to a work branch before running shell mutations.'
        return
      }

      if (event.action !== "shell") return
      if (!event.resources.some(isGitMutationCommand)) return
      event.effect = "deny"
      event.message =
        "ScopeLane owns Git mutations for this session. Git inspection is allowed; branch, index, history, worktree, and remote mutations must go through ScopeLane."
    })

    await ctx.session.hook("prompt", async (event) => {
      cancelIdleCheckpoint(event.sessionID)

      const existing = await loadSessionState(event.sessionID)
      if (existing) {
        const explicitFeature = findFeatureId(event.prompt.text, config.branches)
        const explicitPart = existing.featureId
          ? findFeaturePart(event.prompt.text, existing.featureId, config.branches)
          : undefined

        if (
          explicitFeature &&
          existing.featureId &&
          explicitFeature.toLowerCase() !== existing.featureId.toLowerCase()
        ) {
          throw new Error(
            "ScopeLane: this session is already assigned to " +
              existing.branch +
              ". The new prompt explicitly targets " +
              explicitFeature +
              "; start a separate OpenCode session for that feature.",
          )
        }

        if (explicitPart && existing.part && explicitPart !== existing.part) {
          throw new Error(
            "ScopeLane: this session is assigned to feature part " +
              existing.featureId +
              "-" +
              existing.part +
              ". Start a separate session for part " +
              explicitPart +
              ".",
          )
        }
      }

      await withLaneLock(event.sessionID, () => ensureSessionLane(event.sessionID, event.prompt.text))
    })

    await ctx.session.hook("context", async (event) => {
      const readOnly = protectedReadOnly.get(event.sessionID)
      if (readOnly) {
        event.system.push({
          type: "text",
          text:
            'ScopeLane: the current branch "' +
            readOnly.branch +
            '" is protected and has uncommitted changes. This session is in protected read-only mode. You may read/search files and inspect Git state/diffs, and you may propose branch names or commit messages. Do not edit files or run mutations. Ask the user to create or switch to a work branch before implementation.',
        })
        return
      }

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
        description: "Show status, checkpoint or split work, and create lane/feature integration pull requests.",
        execute: async ({ sessionID, prompt }) => {
          const args = prompt.text.trim().replace(/^\/?scopelane(?:\s+|$)/i, "").trim()
          const action = args.split(/\s+/)[0]?.toLowerCase() || "status"
          const state = await loadSessionState(sessionID)

          if (action === "checkpoint") {
            const result = await checkpoint(sessionID, false, { force: true })
            await ctx.session.synthetic({ sessionID, text: result })
            return
          }

          if (action === "split") {
            if (!state?.featureId || state.part) {
              await ctx.session.synthetic({
                sessionID,
                text: "ScopeLane: split is available only from a top-level feature lane.",
              })
              return
            }

            const feature = await loadFeatureState(state.featureId)
            if (feature && feature.mode !== "single") {
              await ctx.session.synthetic({
                sessionID,
                text: "ScopeLane: feature " + state.featureId + " is already split/integration-only.",
              })
              return
            }

            const repository = new GitRepository(state.worktree, config.branches)
            if (await repository.isDirty()) {
              await checkpoint(sessionID, false, { force: true })
            }
            if (await repository.isDirty()) {
              await ctx.session.synthetic({
                sessionID,
                text:
                  "ScopeLane: the feature still has pending/uncommitted work. " +
                  "Finish that logical unit before splitting the feature.",
              })
              return
            }

            const detail = args.replace(/^split(?:\s+|$)/i, "").trim()
            await ctx.storage.remove(sessionKey(sessionID))
            await withLaneLock(sessionID, () =>
              ensureSessionLane(
                sessionID,
                "Split " +
                  state.featureId +
                  " into parallel implementation parts only if it remains one coherent feature. " +
                  detail,
              ),
            )

            const moved = await loadSessionState(sessionID)
            await ctx.session.synthetic({
              sessionID,
              text:
                moved && moved.part
                  ? "ScopeLane: promoted " +
                    state.featureId +
                    " to an integration parent and moved this session to " +
                    moved.branch +
                    "."
                  : "ScopeLane: no useful one-level split was identified; the feature remains on " +
                    state.branch +
                    ".",
            })
            return
          }

          if (action === "feature-pr" || action === "feature-sync") {
            if (!state) {
              await ctx.session.synthetic({ sessionID, text: "ScopeLane: no lane is associated with this session." })
              return
            }
            const result = await ensureFeaturePullRequest(
              state,
              action === "feature-pr" ? "forward" : "sync",
            )
            await ctx.session.synthetic({
              sessionID,
              text: "ScopeLane feature PR: " + result.url + (result.created ? " (created)" : " (already open)"),
            })
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
            const readOnly = protectedReadOnly.get(sessionID)
            await ctx.session.synthetic({
              sessionID,
              text: readOnly
                ? 'ScopeLane protected read-only: ' +
                  readOnly.branch +
                  " has uncommitted changes. Read/search and read-only Git inspection are available; create or switch to a work branch before mutations."
                : "ScopeLane: no lane is associated with this session yet.",
            })
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

    const scheduleIdleCheckpoint = async (sessionID: string) => {
      cancelIdleCheckpoint(sessionID)
      const state = await loadSessionState(sessionID)
      if (!state) return

      const now = Date.now()
      const idleDelay = config.checkpoint.idleDelaySeconds * 1_000
      const cooldown =
        state.lastCheckpointAt === undefined
          ? 0
          : Math.max(
              0,
              config.checkpoint.minIntervalSeconds * 1_000 - (now - state.lastCheckpointAt),
            )
      const delay = Math.max(idleDelay, cooldown)

      const timer = setTimeout(() => {
        idleTimers.delete(sessionID)
        void checkpoint(sessionID, true).catch(async (error) => {
          const message = error instanceof Error ? error.message : String(error)
          await ctx.session.synthetic({
            sessionID,
            text: "ScopeLane checkpoint skipped: " + message,
          }).catch(() => undefined)
        })
      }, delay)
      idleTimers.set(sessionID, timer)
    }

    const controller = new AbortController()
    void (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (event.type !== "session.idle" || !config.checkpoint.onIdle) continue
          const sessionID = event.data.sessionID
          void scheduleIdleCheckpoint(sessionID).catch(console.error)
        }
      } catch (error) {
        if (!controller.signal.aborted) console.error("ScopeLane event loop failed", error)
      }
    })()

    return () => {
      controller.abort()
      for (const timer of idleTimers.values()) clearTimeout(timer)
      idleTimers.clear()
    }
  },
}

export default plugin
