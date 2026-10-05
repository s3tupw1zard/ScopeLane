export type ChangeUnit = PatchChangeUnit | UntrackedChangeUnit

export interface PatchChangeUnit {
  id: string
  kind: "patch"
  path: string
  patch: string
  summary: string
}

export interface UntrackedChangeUnit {
  id: string
  kind: "untracked"
  path: string
  summary: string
  preview?: string
}

function displayPath(section: string): string {
  const plus = section.match(/^\+\+\+\s+b\/(.+)$/m)?.[1]
  if (plus && plus !== "/dev/null") return plus.replace(/^"|"$/g, "")
  const minus = section.match(/^---\s+a\/(.+)$/m)?.[1]
  if (minus && minus !== "/dev/null") return minus.replace(/^"|"$/g, "")
  const diff = section.match(/^diff --git\s+a\/(.+?)\s+b\/(.+)$/m)?.[2]
  return (diff ?? "unknown").replace(/^"|"$/g, "")
}

function patchHeader(lines: string[], firstHunk: number): string[] {
  return lines.slice(0, firstHunk).filter((line) => !line.startsWith("index "))
}

function hunkSummary(hunk: string[], path: string): string {
  const changed = hunk.find((line) =>
    (line.startsWith("+") && !line.startsWith("+++")) ||
    (line.startsWith("-") && !line.startsWith("---")),
  )
  const text = changed?.slice(1).trim()
  return text ? path + ": " + text.slice(0, 120) : path
}

export function parseWorkingDiff(diff: string): ChangeUnit[] {
  if (!diff.trim()) return []

  const starts: number[] = []
  const lines = diff.split("\n")
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]?.startsWith("diff --git ")) starts.push(index)
  }
  if (starts.length === 0) return []

  const units: ChangeUnit[] = []
  let nextID = 1

  for (let sectionIndex = 0; sectionIndex < starts.length; sectionIndex += 1) {
    const start = starts[sectionIndex]!
    const end = starts[sectionIndex + 1] ?? lines.length
    const sectionLines = lines.slice(start, end)
    while (sectionLines.at(-1) === "") sectionLines.pop()
    const section = sectionLines.join("\n") + "\n"
    const path = displayPath(section)
    const hunks = sectionLines
      .map((line, index) => (line.startsWith("@@ ") ? index : -1))
      .filter((index) => index >= 0)

    if (hunks.length === 0) {
      units.push({
        id: "p" + nextID++,
        kind: "patch",
        path,
        patch: section,
        summary: path + " (whole-file change)",
      })
      continue
    }

    const header = patchHeader(sectionLines, hunks[0]!)
    for (let hunkIndex = 0; hunkIndex < hunks.length; hunkIndex += 1) {
      const hunkStart = hunks[hunkIndex]!
      const hunkEnd = hunks[hunkIndex + 1] ?? sectionLines.length
      const hunk = sectionLines.slice(hunkStart, hunkEnd)
      units.push({
        id: "p" + nextID++,
        kind: "patch",
        path,
        patch: [...header, ...hunk].join("\n") + "\n",
        summary: hunkSummary(hunk, path),
      })
    }
  }

  return units
}

export function appendUntrackedUnits(
  tracked: ChangeUnit[],
  untrackedPaths: readonly string[],
  previews: ReadonlyMap<string, string> = new Map(),
): ChangeUnit[] {
  const units = [...tracked]
  let next = units.length + 1
  for (const path of untrackedPaths) {
    const clean = path.trim()
    if (!clean) continue
    units.push({
      id: "u" + next++,
      kind: "untracked",
      path: clean,
      summary: clean + " (untracked file)",
      preview: previews.get(clean),
    })
  }
  return units
}
