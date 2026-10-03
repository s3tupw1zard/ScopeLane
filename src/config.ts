export interface BranchPrefixConfig {
  feature: string
  fix: string
  refactor: string
  docs: string
  chore: string
}

export type BranchKind = keyof BranchPrefixConfig

export interface BranchConfig {
  protected: string[]
  prefixes: BranchPrefixConfig
  featureIdPattern: string
  featurePartPattern: string
  maxPartDepth: 1
  lockNameAfterPush: boolean
}

export interface ScopeConfig {
  registryPath: string
  projectPath: string
  confidenceThreshold: number
  autoSplit: boolean
  maxParts: number
  fallbackKind: Exclude<BranchKind, "feature">
}

export interface CheckpointConfig {
  onIdle: boolean
  push: boolean
  remote: string
  maxCommits: number
  maxDiffBytes: number
  conventionalCommits: boolean
}

export interface GitHubConfig {
  enabled: boolean
  autoCreatePullRequest: boolean
  cli: string
}

export interface ScopeLaneConfig {
  branches: BranchConfig
  scope: ScopeConfig
  checkpoint: CheckpointConfig
  github: GitHubConfig
}

export const DEFAULT_CONFIG: ScopeLaneConfig = {
  branches: {
    protected: ["main", "master", "trunk"],
    prefixes: {
      feature: "feat",
      fix: "fix",
      refactor: "refactor",
      docs: "docs",
      chore: "chore",
    },
    featureIdPattern: "^F\\d{3,}$",
    featurePartPattern: "^[A-Z]$",
    maxPartDepth: 1,
    lockNameAfterPush: true,
  },
  scope: {
    registryPath: "specs/FEATURES.md",
    projectPath: "specs/PROJECT.md",
    confidenceThreshold: 0.62,
    autoSplit: true,
    maxParts: 4,
    fallbackKind: "chore",
  },
  checkpoint: {
    onIdle: true,
    push: true,
    remote: "origin",
    maxCommits: 4,
    maxDiffBytes: 200_000,
    conventionalCommits: true,
  },
  github: {
    enabled: false,
    autoCreatePullRequest: false,
    cli: "gh",
  },
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(record: UnknownRecord, key: string, fallback: string): string {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function readBoolean(record: UnknownRecord, key: string, fallback: boolean): boolean {
  const value = record[key]
  return typeof value === "boolean" ? value : fallback
}

function readNumber(
  record: UnknownRecord,
  key: string,
  fallback: number,
  range: { min: number; max: number },
): number {
  const value = record[key]
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(range.max, Math.max(range.min, value))
}

function validatePrefix(prefix: string, label: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(prefix)) {
    throw new Error(`ScopeLane: invalid ${label} branch prefix "${prefix}"`)
  }
  return prefix
}

function validatePattern(pattern: string, label: string): string {
  try {
    new RegExp(pattern)
    return pattern
  } catch {
    throw new Error(`ScopeLane: invalid ${label} regex "${pattern}"`)
  }
}

function readFallbackKind(record: UnknownRecord): ScopeConfig["fallbackKind"] {
  const value = record.fallbackKind
  return value === "fix" || value === "refactor" || value === "docs" || value === "chore"
    ? value
    : DEFAULT_CONFIG.scope.fallbackKind
}

export function resolveConfig(options: unknown): ScopeLaneConfig {
  if (!isRecord(options)) return structuredClone(DEFAULT_CONFIG)

  const rawBranches = isRecord(options.branches) ? options.branches : {}
  const rawPrefixes = isRecord(rawBranches.prefixes) ? rawBranches.prefixes : {}
  const rawScope = isRecord(options.scope) ? options.scope : {}
  const rawCheckpoint = isRecord(options.checkpoint) ? options.checkpoint : {}
  const rawGitHub = isRecord(options.github) ? options.github : {}

  const prefixes: BranchPrefixConfig = {
    feature: validatePrefix(readString(rawPrefixes, "feature", DEFAULT_CONFIG.branches.prefixes.feature), "feature"),
    fix: validatePrefix(readString(rawPrefixes, "fix", DEFAULT_CONFIG.branches.prefixes.fix), "fix"),
    refactor: validatePrefix(readString(rawPrefixes, "refactor", DEFAULT_CONFIG.branches.prefixes.refactor), "refactor"),
    docs: validatePrefix(readString(rawPrefixes, "docs", DEFAULT_CONFIG.branches.prefixes.docs), "docs"),
    chore: validatePrefix(readString(rawPrefixes, "chore", DEFAULT_CONFIG.branches.prefixes.chore), "chore"),
  }

  const protectedBranches = Array.isArray(rawBranches.protected)
    ? [...new Set(rawBranches.protected.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean))]
    : [...DEFAULT_CONFIG.branches.protected]

  return {
    branches: {
      protected: protectedBranches,
      prefixes,
      featureIdPattern: validatePattern(
        readString(rawBranches, "featureIdPattern", DEFAULT_CONFIG.branches.featureIdPattern),
        "featureIdPattern",
      ),
      featurePartPattern: validatePattern(
        readString(rawBranches, "featurePartPattern", DEFAULT_CONFIG.branches.featurePartPattern),
        "featurePartPattern",
      ),
      maxPartDepth: 1,
      lockNameAfterPush: readBoolean(
        rawBranches,
        "lockNameAfterPush",
        DEFAULT_CONFIG.branches.lockNameAfterPush,
      ),
    },
    scope: {
      registryPath: readString(rawScope, "registryPath", DEFAULTCONFIG.scope.registryPath),
      projectPath: readString(rawScope, "projectPath", DEFAULT_CONFIG.scope.projectPath),
      confidenceThreshold: readNumber(
        rawScope,
        "confidenceThreshold",
        DEFAULT_CONFIG.scope.confidenceThreshold,
        { min: 0, max: 1 },
      ),
      autoSplit: readBoolean(rawScope, "autoSplit", DEFAULT_CONFIG.scope.autoSplit),
      maxParts: Math.round(
        readNumber(rawScope, "maxParts", DEFAULT_CONFIG.scope.maxParts, { min: 2, max: 26 }),
      ),
      fallbackKind: readFallbackKind(rawScope),
    },
    checkpoint: {
      onIdle: readBoolean(rawCheckpoint, "onIdle", DEFAULT_CONFIG.checkpoint.onIdle),
      push: readBoolean(rawCheckpoint, "push", DEFAULTCONFIG.checkpoint.push),
      remote: readString(rawCheckpoint, "remote", DEFAULT_CONFIG.checkpoint.remote),
      maxCommits: Math.round(
        readNumber(rawCheckpoint, "maxCommits", DEFAULT_CONFIG.checkpoint.maxCommits, {
          min: 1,
          max: 12,
        }),
      ),
      maxDiffBytes: Math.round(
        readNumber(rawCheckpoint, "maxDiffBytes", DEFAULT_CONFIG.checkpoint.maxDiffBytes, {
          min: 16_384,
          max: 2_000_000,
        }),
      ),
      conventionalCommits: readBoolean(
        rawCheckpoint,
        "conventionalCommits",
        DEFAULT_CONFIG.checkpoint.conventionalCommits,
      ),
    },
    github: {
      enabled: readBoolean(rawGitHub, "enabled", DEFAULT_CONFIG.github.enabled),
      autoCreatePullRequest: readBoolean(
        rawGitHub,
        "autoCreatePullRequest",
        DEFAULT_CONFIG.github.autoCreatePullRequest,
      ),
      cli: readString(rawGitHub, "cli", DEFAULT_CONFIG.github.cli),
    },
  }
}
