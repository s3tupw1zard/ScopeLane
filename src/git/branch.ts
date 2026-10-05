import type { BranchConfig, BranchKind } from "../config"

export interface FeatureBranchInput {
  featureId: string
  slug: string
  part?: string
}

export type ParsedFeatureBranch =
  | {
      kind: "feature"
      featureId: string
      slug: string
      branch: string
    }
  | {
      kind: "feature-part"
      featureId: string
      part: string
      slug: string
      branch: string
    }

function stripAnchors(pattern: string): string {
  return pattern.replace(/^\^/, "").replace(/\$$/, "")
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function slugifyBranchSegment(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
}

export function isProtectedBranch(branch: string, config: BranchConfig): boolean {
  return config.protected.includes(branch)
}

export function findFeatureId(text: string, config: BranchConfig): string | undefined {
  const pattern = stripAnchors(config.featureIdPattern)
  const match = text.match(new RegExp("(?:^|[^A-Za-z0-9])((?:" + pattern + "))(?=$|[^A-Za-z0-9])", "i"))
  return match?.[1]
}

export function findFeaturePart(
  text: string,
  featureId: string,
  config: BranchConfig,
): string | undefined {
  const part = stripAnchors(config.featurePartPattern)
  const match = text.match(
    new RegExp(
      "(?:^|[^A-Za-z0-9])" +
        escapeRegExp(featureId) +
        "-((?:" +
        part +
        "))(?=$|[^A-Za-z0-9])",
      "i",
    ),
  )
  return match?.[1]?.toUpperCase()
}

export function renderSimpleBranch(
  kind: BranchKind,
  slugInput: string,
  config: BranchConfig,
): string {
  const slug = slugifyBranchSegment(slugInput)
  if (!slug) throw new Error("ScopeLane: branch slug cannot be empty")
  return `${config.prefixes[kind]}/${slug}`
}

export function renderFeatureBranch(input: FeatureBranchInput, config: BranchConfig): string {
  if (!new RegExp(config.featureIdPattern).test(input.featureId)) {
    throw new Error(`ScopeLane: feature id "${input.featureId}" does not match ${config.featureIdPattern}`)
  }

  if (input.part && !new RegExp(config.featurePartPattern).test(input.part)) {
    throw new Error(`ScopeLane: feature part "${input.part}" does not match ${config.featurePartPattern}`)
  }

  const slug = slugifyBranchSegment(input.slug)
  if (!slug) throw new Error("ScopeLane: feature branch slug cannot be empty")

  const base = `${config.prefixes.feature}/${input.featureId}`
  return input.part ? `${base}-${input.part}-${slug}` : `${base}-${slug}`
}

export function parseFeatureBranch(branch: string, config: BranchConfig): ParsedFeatureBranch | null {
  const prefix = escapeRegExp(config.prefixes.feature)
  const featureId = stripAnchors(config.featureIdPattern)
  const part = stripAnchors(config.featurePartPattern)

  const partMatch = branch.match(new RegExp(`^${prefix}/(${featureId})-(${part})-(.+)$`))
  if (partMatch) {
    return {
      kind: "feature-part",
      featureId: partMatch[1]!,
      part: partMatch[2]!,
      slug: partMatch[3]!,
      branch,
    }
  }

  const featureMatch = branch.match(new RegExp(`^${prefix}/(${featureId})-(.+)$`))
  if (!featureMatch) return null

  return {
    kind: "feature",
    featureId: featureMatch[1]!,
    slug: featureMatch[2]!,
    branch,
  }
}
