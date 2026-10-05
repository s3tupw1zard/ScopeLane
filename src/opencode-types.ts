export interface OpenCodeSession {
  id: string
  parentID?: string
  projectID: string
  model?: unknown
  location: {
    directory: string
  }
}

export interface PromptEvent {
  sessionID: string
  prompt: {
    text: string
  }
}

export interface ContextEvent {
  sessionID: string
  system: Array<{
    type: string
    text: string
  }>
}

export interface PermissionEvent {
  sessionID: string
  action: string
  resources: string[]
  effect: string
  message?: string
}

export interface CommandExecutionContext {
  sessionID: string
  prompt: {
    text: string
  }
}

export interface CommandEditor {
  add(command: {
    name: string
    description: string
    execute(context: CommandExecutionContext): Promise<void> | void
  }): void
}

export interface OpenCodeEvent {
  type: string
  data: {
    sessionID: string
  }
}

export interface OpenCodePluginContext {
  options: unknown

  storage: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<unknown>
    remove(key: string): Promise<unknown>
  }

  generate: {
    text(input: { model: unknown; prompt: string }): Promise<string | { text?: string }>
  }

  session: {
    get(input: { sessionID: string }): Promise<OpenCodeSession>
    generate(input: { sessionID: string; prompt: string }): Promise<{ text: string }>
    move(input: { sessionID: string; directory: string }): Promise<unknown>
    synthetic(input: { sessionID: string; text: string }): Promise<unknown>
    hook(
      name: "prompt",
      handler: (event: PromptEvent) => Promise<void> | void,
    ): Promise<unknown>
    hook(
      name: "context",
      handler: (event: ContextEvent) => Promise<void> | void,
    ): Promise<unknown>
  }

  worktree: {
    refresh(input: { projectID: string }): Promise<unknown>
    list(input: { projectID: string }): Promise<readonly { directory: string; strategy?: string }[]>
    create(input: {
      projectID: string
      name: string
      branch: string
      from?: string
    }): Promise<{ directory: string }>
  }

  permission: {
    hook(
      name: "evaluate",
      handler: (event: PermissionEvent) => Promise<void> | void,
    ): Promise<unknown>
  }

  command: {
    transform(handler: (editor: CommandEditor) => Promise<void> | void): Promise<unknown>
  }

  event: {
    subscribe(input: { signal: AbortSignal }): AsyncIterable<OpenCodeEvent>
  }
}

export interface ScopeLanePlugin {
  id: string
  setup(
    context: OpenCodePluginContext,
  ): Promise<void | (() => void)> | void | (() => void)
}
