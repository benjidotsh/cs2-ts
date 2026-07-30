export type SolverErrorCode =
  | 'OVERLAP'
  | 'INSUFFICIENT_FACE_OVERLAP'
  | 'SLOPE_WITHOUT_RUN'
  | 'RISE_CONFLICT'
  | 'UNROUTABLE_CONNECTION'
  | 'CORRIDOR_TOO_SHORT'
  | 'OUT_OF_BOUNDS'
  | 'INSUFFICIENT_CLEARANCE'

export type AuthoringErrorCode =
  | 'DUPLICATE_ANCHOR'
  | 'DUPLICATE_ROOM_NAME'
  | 'DIAGONAL_CONNECTION'
  | 'SPAWN_GRID_TOO_LARGE'
  | 'NEGATIVE_HEIGHT'
  | 'INVALID_ROOM_SIZE'

export class Cs2tsError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class SolverError extends Cs2tsError {
  declare readonly code: SolverErrorCode
  constructor(code: SolverErrorCode, message: string, detail?: Record<string, unknown>) {
    super(code, message, detail)
  }
}

export class AuthoringError extends Cs2tsError {
  declare readonly code: AuthoringErrorCode
  constructor(code: AuthoringErrorCode, message: string, detail?: Record<string, unknown>) {
    super(code, message, detail)
  }
}
