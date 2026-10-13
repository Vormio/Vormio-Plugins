/** A failure whose message is meant for the user; the host shows it as the reason. */
export class SpineError extends Error {
  override name = 'SpineError'
}

/**
 * The file is not a Spine skeleton at all, as opposed to a broken or unsupported one. JSON is a
 * general format, so once the host lets an analyzer decline a file this becomes that answer; until
 * then it fails like any other error.
 */
export class NotSpineError extends SpineError {
  override name = 'NotSpineError'
}
