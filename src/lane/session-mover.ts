export interface SessionMoveRequest {
  sessionID: string
  directory: string
  moveChanges?: boolean
}

export interface SessionMover {
  move(request: SessionMoveRequest): Promise<void>
}

/**
 * ScopeLane keeps session movement behind a small interface even though OpenCode
 * V2 exposes ctx.session.move(). This keeps lane orchestration independently
 * testable and isolates OpenCode API binding from the plain-Git core.
 */
export async function moveSessionToLane(
  mover: SessionMover,
  request: SessionMoveRequest,
): Promise<void> {
  if (!request.sessionID.trim()) throw new Error("ScopeLane: session ID cannot be empty")
  if (!request.directory.trim()) throw new Error("ScopeLane: destination directory cannot be empty")

  await mover.move({
    ...request,
    moveChanges: request.moveChanges ?? false,
  })
}
