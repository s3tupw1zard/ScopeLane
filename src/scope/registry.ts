import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { ScopeConfig } from "../config"

export interface FeatureRecord {
  id: string
  name: string
  shortDescription: string
  description: string
  dependsOn: string[]
  spec?: string
}

export interface ScopeSeedContext {
  project?: string
  features: FeatureRecord[]
}

function splitMarkdownRow(line: string): string[] {
  const result: string[] = []
  let current = ""
  let escaped = false

  for (const char of line.trim().replace(/^\|/, "").replace(/\|$/, "")) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      current += char
      continue
    }
    if (char === "|") {
      result.push(current.trim().replaceAll("\\|", "|"))
      current = ""
      continue
    }
    current += char
  }

  result.push(current.trim().replaceAll("\\|", "|"))
  return result
}

function columnIndex(headers: string[], name: string): number {
  return headers.findIndex((header) => header.trim().toLowerCase() === name.toLowerCase())
}

export function parseFeatureRegistry(markdown: string): FeatureRecord[] {
  const lines = markdown.split(/\r?\n/)
  let headers: string[] | undefined
  const features: FeatureRecord[] = []

  for (const line of lines) {
    if (!line.trim().startsWith("|")) continue
    const cells = splitMarkdownRow(line)

    if (!headers && cells.some((cell) => cell.trim().toLowerCase() === "id")) {
      headers = cells
      continue
    }

    if (!headers) continue
    if (cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))) continue

    const idIndex = columnIndex(headers, "ID")
    const nameIndex = columnIndex(headers, "Feature")
    if (idIndex < 0 || nameIndex < 0) continue

    const id = cells[idIndex]?.trim() ?? ""
    if (!/^F\d{3,}$/.test(id)) continue

    const shortIndex = columnIndex(headers, "Short description")
    const descriptionIndex = columnIndex(headers, "Description")
    const dependenciesIndex = columnIndex(headers, "Depends on")
    const specIndex = columnIndex(headers, "Spec")
    const dependencyText = dependenciesIndex >= 0 ? cells[dependenciesIndex] ?? "" : ""

    features.push({
      id,
      name: cells[nameIndex]?.trim() || id,
      shortDescription: shortIndex >= 0 ? cells[shortIndex]?.trim() ?? "" : "",
      description: descriptionIndex >= 0 ? cells[descriptionIndex]?.trim() ?? "" : "",
      dependsOn: dependencyText.match(/F\d{3,}/g) ?? [],
      spec: specIndex >= 0 ? cells[specIndex]?.replaceAll("`", "").trim() || undefined : undefined,
    })
  }

  return features
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8")
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === "ENOENT") return undefined
    throw error
  }
}

export async function loadScopeSeedContext(
  directory: string,
  config: ScopeConfig,
): Promise<ScopeSeedContext> {
  const registry = await readOptional(resolve(directory, config.registryPath))
  const project = await readOptional(resolve(directory, config.projectPath))

  return {
    project,
    features: registry ? parseFeatureRegistry(registry) : [],
  }
}
