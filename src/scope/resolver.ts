import type { BranchKind, ScopeConfig } from "../config"
import { slugifyBranchSegment } from "../git/branch"
import type { FeatureRecord, ScopeSeedContext } from "./registry"

export interface SplitPart {
  label: string
  slug: string
  description: string
}

export interface ScopeDecision {
  kind: BranchKind
  slug: string
  confidence: number
  reason: string
  featureId?: string
  split?: {
    parts: SplitPart[]
  }
}

export interface ScopeTextGenerator {
  text(prompt: string): Promise<string>
}

type ModelDecision = {
  kind?: unknown
  slug?: unknown
  confidence?: unknown
  reason?: unknown
  featureId?: unknown
  split?: {
    parts?: Array<{
      label?: unknown
      slug?: unknown
      description?: unknown
    }>
  }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const source = fenced ?? text
  const start = source.indexOf("{")
  const end = source.lastIndexOf("}")
  if (start < 0 || end <= start) throw new Error("ScopeLane: scope model did not return JSON")
  return JSON.parse(source.slice(start, end + 1))
}

function featureSummary(feature: FeatureRecord): string {
  const details = [feature.shortDescription, feature.description].filter(Boolean).join(" — ")
  return `${feature.id}: ${feature.name}${details ? ` — ${details}` : ""}`
}

function explicitFeature(prompt: string, features: FeatureRecord[]): FeatureRecord | undefined {
  const requested = prompt.match(/\bF\d{3,}\b/i)?.[0]?.toUpperCase()
  return requested ? features.find((feature) => feature.id === requested) : undefined
}

function validKind(value: unknown): BranchKind | undefined {
  return value === "feature" ||
    value === "fix" ||
    value === "refactor" ||
    value === "docs" ||
    value === "chore"
    ? value
    : undefined
}

function normalizeParts(
  input: ModelDecision["split"],
  config: ScopeConfig,
): SplitPart[] | undefined {
  if (!config.autoSplit || !Array.isArray(input?.parts)) return undefined

  const parts: SplitPart[] = []
  const seen = new Set<string>()

  for (const candidate of input.parts.slice(0, config.maxParts)) {
    if (typeof candidate.label !== "string" || !/^[A-Z]$/.test(candidate.label)) continue
    if (seen.has(candidate.label)) continue
    if (typeof candidate.slug !== "string" || typeof candidate.description !== "string") continue
    const slug = slugifyBranchSegment(candidate.slug)
    if (!slug || !candidate.description.trim()) continue
    seen.add(candidate.label)
    parts.push({ label: candidate.label, slug, description: candidate.description.trim() })
  }

  return parts.length >= 2 ? parts : undefined
}

function fallbackDecision(prompt: string, config: ScopeConfig): ScopeDecision {
  const words = prompt
    .replace(/https?:\/\/\S+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
    .join(" ")

  return {
    kind: config.fallbackKind,
    slug: slugifyBranchSegment(words) || "session-work",
    confidence: 0,
    reason: "No reliable ScopeSeed feature match was available.",
  }
}

export async function resolveScope(
  prompt: string,
  context: ScopeSeedContext,
  config: ScopeConfig,
  generator?: ScopeTextGenerator,
): Promise<ScopeDecision> {
  const explicit = explicitFeature(prompt, context.features)

  if (!generator) {
    if (explicit) {
      return {
        kind: "feature",
        featureId: explicit.id,
        slug: slugifyBranchSegment(explicit.name),
        confidence: 1,
        reason: "The prompt explicitly names an accepted ScopeSeed feature.",
      }
    }
    return fallbackDecision(prompt, config)
  }

  const features = context.features.map(featureSummary).join("\n")
  const response = await generator.text(`You are ScopeLane's scope classifier.

Classify the user's coding task into a safe Git lane. ScopeSeed's accepted feature registry is authoritative when present. Do not invent a feature ID. If the task belongs to an accepted feature, use that exact ID. If it does not, choose fix, refactor, docs, or chore unless this is clearly a feature without a registered ScopeSeed ID.

A registered feature may be split only when it is still one coherent product feature but contains multiple independently implementable parallel workstreams. A split is limited to one level. Recommend 2-${config.maxParts} parts only when the split is genuinely useful; otherwise omit split.

Return JSON only:
{
  "kind": "feature|fix|refactor|docs|chore",
  "featureId": "F001 or omitted",
  "slug": "short-kebab-name",
  "confidence": 0.0,
  "reason": "short explanation",
  "split": {
    "parts": [
      {"label":"A","slug":"short-name","description":"precise scope"}
    ]
  }
}

PROJECT CONTEXT:
${context.project?.slice(0, 12_000) || "(no ScopeSeed PROJECT.md)"}

ACCEPTED FEATURES:
${features || "(no ScopeSeed FEATURES.md entries)"}

USER TASK:
${prompt.slice(0, 12_000)}`)

  const parsed = extractJson(response) as ModelDecision
  const kind = validKind(parsed.kind) ?? config.fallbackKind
  const confidence =
    typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0
  const requestedFeature =
    typeof parsed.featureId === "string"
      ? context.features.find((feature) => feature.id === parsed.featureId.toUpperCase())
      : undefined
  const feature = explicit ?? requestedFeature
  const slugSource =
    typeof parsed.slug === "string" && parsed.slug.trim()
      ? parsed.slug
      : feature?.name ?? prompt.slice(0, 80)
  const slug = slugifyBranchSegment(slugSource) || "session-work"
  const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "Scope classification."

  if (kind === "feature" && feature && confidence >= config.confidenceThreshold) {
    const parts = normalizeParts(parsed.split, config)
    return {
      kind,
      featureId: feature.id,
      slug: slugifyBranchSegment(feature.name) || slug,
      confidence,
      reason,
      ...(parts ? { split: { parts } } : {}),
    }
  }

  if (kind === "feature" && feature) {
    return {
      kind,
      featureId: feature.id,
      slug: slugifyBranchSegment(feature.name) || slug,
      confidence,
      reason,
    }
  }

  if (kind === "feature") {
    return {
      kind,
      slug,
      confidence,
      reason: `${reason} No accepted ScopeSeed feature ID matched, so this remains an unscoped feature lane.`,
    }
  }

  return { kind, slug, confidence, reason }
}
