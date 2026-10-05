import { spawn } from "node:child_process"
import type { GitHubConfig } from "../config"

export interface PullRequestRequest {
  head: string
  base: string
  title: string
  body: string
}

export interface PullRequestResult {
  url: string
  created: boolean
}

export interface PullRequestProvider {
  ensure(request: PullRequestRequest): Promise<PullRequestResult>
}

export class GitHubCliProvider implements PullRequestProvider {
  constructor(
    private readonly directory: string,
    private readonly config: GitHubConfig,
  ) {}

  private run(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.cli, args, {
        cwd: this.directory,
        stdio: ["ignore", "pipe", "pipe"],
      })
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)))
      child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)))
      child.on("error", reject)
      child.on("close", (code) => {
        const out = Buffer.concat(stdout).toString("utf8").trim()
        const err = Buffer.concat(stderr).toString("utf8").trim()
        if (code === 0) resolve(out)
        else reject(new Error(this.config.cli + " " + args.join(" ") + " failed: " + err))
      })
    })
  }

  async ensure(request: PullRequestRequest): Promise<PullRequestResult> {
    if (!this.config.enabled) throw new Error("ScopeLane: GitHub provider is disabled")
    if (!request.head || !request.base || request.head === request.base) {
      throw new Error("ScopeLane: invalid pull request branch relationship")
    }

    const existing = await this.run([
      "pr",
      "list",
      "--head",
      request.head,
      "--base",
      request.base,
      "--state",
      "open",
      "--json",
      "url",
      "--jq",
      ".[0].url // \"\"",
    ])
    if (existing) return { url: existing, created: false }

    const url = await this.run([
      "pr",
      "create",
      "--head",
      request.head,
      "--base",
      request.base,
      "--title",
      request.title,
      "--body",
      request.body,
    ])
    return { url, created: true }
  }
}
