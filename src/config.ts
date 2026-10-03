export interface BranchPrefixConfig {
  feature: string
  fix: string
  refactor: string
  docs: string
  chore: string
}

export interface BranchConfig {
  protected: string[]
  prefixes: BranchPrefixConfig
  featureIdPattern: string
  featurePartPattern: string
  maxPartDepth: 1
  lockNameAfterPush: boolean
}

export interface ScopeLaneConfig {
  branches: BranchConfig
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
}

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readString(record: UnknownRecord, key: string, fallback: string): string {
  const value = record[key]
  return typeof value === "string" && value.trim() ? value.trim() : fallback
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

export function resolveConfig(options: unknown): ScopeLaneConfig {
  if (!isRecord(options)) return structuredClone(DEFAULT_CONFIG)

  const rawBranches = isRecord(options.branches) ? options.branches : {}
  const rawPrefixes = isRecord(rawBranches.prefixes) ? rawBranches.prefixes : {}

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
      lockNameAfterPush:
        typeof rawBranches.lockNameAfterPush === "boolean"
          ? rawBranches.lockNameAfterPush
          : DEFAULT_CONFIG.branches.lockNameAfterPush,
    },
  }
}
