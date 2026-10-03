export interface SessionMoveRequest {
  sessionID: string
  directory: string
  moveChanges?: boolean
}

export interface SessionMover {
  move(request: SessionMoveRequest): Promise<void>
}

/**
 * ScopeLane deliberately depends on this small interface instead of the current
 * experimental OpenCode control-plane API. The concrete adapter can be replaced
 * when session movement becomes a stable plugin-context operation.
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
