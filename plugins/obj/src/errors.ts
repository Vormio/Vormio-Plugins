/** A loading failure whose message is meant for the user. */
export class ModelError extends Error {
  override name = 'ModelError'
}

/** What to tell the user when a model cannot be shown. The host shows at most 500 characters. */
export function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 400 ? `${message.slice(0, 399)}…` : message
}
