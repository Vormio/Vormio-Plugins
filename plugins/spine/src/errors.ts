/** A failure whose message is meant for the user; the host shows it as the reason. */
export class SpineError extends Error {
  override name = 'SpineError'
}

/**
 * The file is not a Spine skeleton at all, as opposed to a broken or unsupported one. JSON is a
 * general format, so the pages answer the host with `notApplicable()` for it instead of failing.
 */
export class NotSpineError extends SpineError {
  override name = 'NotSpineError'
}

/**
 * What to tell the user when a skeleton cannot be previewed. Errors that are not SpineErrors come
 * from the Spine runtime, in English and about the data, so they follow a sentence saying what
 * failed. The host shows at most 500 characters.
 */
export function failureMessage(error: unknown): string {
  const message =
    error instanceof SpineError
      ? error.message
      : `Spine 运行时无法读取这个骨骼：${error instanceof Error ? error.message : String(error)}`
  return message.length > 400 ? `${message.slice(0, 399)}…` : message
}
