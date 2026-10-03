const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  "status",
  "diff",
  "log",
  "show",
  "blame",
  "grep",
  "rev-parse",
  "rev-list",
  "ls-files",
  "ls-tree",
  "cat-file",
  "describe",
  "name-rev",
  "merge-base",
])

function tokenize(command: string): string[] {
  return command.match(/(?:[^\s"'\\]+|"(?:\\.|[^"])*"|'[^']*')+/g) ?? []
}

function unquote(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1)
  }
  return token
}

function gitExecutable(token: string): boolean {
  const clean = unquote(token)
  return clean === "git" || clean.endsWith("/git")
}

function readGitSubcommand(tokens: string[], gitIndex: number): { subcommand?: string; index: number } {
  let index = gitIndex + 1

  while (index < tokens.length) {
    const token = unquote(tokens[index]!)

    if (token === "-C" || token === "-c" || token === "--git-dir" || token === "--work-tree") {
      index += 2
      continue
    }

    if (
      token.startsWith("--git-dir=") ||
      token.startsWith("--work-tree=") ||
      token.startsWith("--namespace=") ||
      token === "--no-pager" ||
      token === "--bare"
    ) {
      index += 1
      continue
    }

    if (token.startsWith("-")) return { index }
    return { subcommand: token.toLowerCase(), index }
  }

  return { index }
}

function isSafeBranchInspection(tokens: string[], subcommandIndex: number): boolean {
  const rest = tokens.slice(subcommandIndex + 1).map(unquote)
  return (
    rest.every(
      (token) =>
        token === "--show-current" ||
        token === "--list" ||
        token === "-l" ||
        token === "--contains" ||
        token === "--merged" ||
        token === "--no-merged" ||
        token.startsWith("--format=") ||
        (!token.startsWith("-") && !token.includes("=")),
    ) && rest.some((token) => token === "--show-current" || token === "--list" || token === "-l")
  )
}

function isSafeRemoteInspection(tokens: string[], subcommandIndex: number): boolean {
  const first = unquote(tokens[subcommandIndex + 1] ?? "")
  return first === "-v" || first === "show" || first === "get-url"
}

export function isGitMutationCommand(command: string): boolean {
  const tokens = tokenize(command)

  for (let index = 0; index < tokens.length; index += 1) {
    if (!gitExecutable(tokens[index]!)) continue

    const parsed = readGitSubcommand(tokens, index)
    if (!parsed.subcommand) return true

    if (READ_ONLY_GIT_SUBCOMMANDS.has(parsed.subcommand)) {
      index = parsed.index
      continue
    }

    if (parsed.subcommand === "branch" && isSafeBranchInspection(tokens, parsed.index)) {
      index = parsed.index
      continue
    }

    if (parsed.subcommand === "remote" && isSafeRemoteInspection(tokens, parsed.index)) {
      index = parsed.index
      continue
    }

    return true
  }

  return false
}
