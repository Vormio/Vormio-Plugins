// File names written in OBJ and MTL files. No DOM, so it runs in Node tests as well.

import { fileUri } from '../../../shared/uri.ts'

/**
 * The relative address of a file name in an OBJ or MTL file. They hold file paths, not URIs:
 * exporters on Windows write `\` between folders, which becomes `/`, and `%`, `?` and `#` are
 * encoded so the name reaches the host as written (see shared/uri.ts).
 */
export function fileName(name: string): string {
  return fileUri(name.replaceAll('\\', '/'))
}
