export class AgentError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) {
    super(message);
    this.name = 'AgentError';
  }
}

/** Frozen work requires a new author/context revision; keeping its evidence is
 * valid, continuing to consume it is not. */
export class ExecutionInvalidated extends AgentError {}
