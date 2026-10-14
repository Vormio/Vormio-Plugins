import type { PluginInput } from '@vormio/plugin-sdk'
import { describeProblem, explainFailures } from '../../../shared/companions.ts'

/** A loading failure whose message is meant for the user. */
export class ModelError extends Error {
  override name = 'ModelError'
  /** Addresses that failed while loading, for explaining the error. */
  readonly failed: readonly string[]

  constructor(message: string, failed: readonly string[] = []) {
    super(message)
    this.failed = failed
  }
}

/**
 * What to tell the user when a model cannot be shown. When files it refers to could not be read,
 * names them with the reason instead of the loader's message. The host shows at most 500
 * characters.
 */
export async function failureMessage(input: PluginInput, error: unknown): Promise<string> {
  let message = error instanceof Error ? error.message : String(error)
  if (error instanceof ModelError && error.failed.length) {
    const problems = await explainFailures(input, error.failed)
    message = `模型无法加载：${problems.map(describeProblem).join('；')}`
  }
  return message.length > 400 ? `${message.slice(0, 399)}…` : message
}
