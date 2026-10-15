// File names written in OBJ and MTL files. No DOM, so it runs in Node tests as well.

import { nameKey } from '../../../shared/report.ts'
import { fileUri } from '../../../shared/uri.ts'

/**
 * The relative address of a file name in an OBJ or MTL file. They hold file paths, not URIs:
 * exporters on Windows write `\` between folders, which becomes `/`, and `%`, `?` and `#` are
 * encoded so the name reaches the host as written (see shared/uri.ts).
 */
export function fileName(name: string): string {
  return fileUri(name.replaceAll('\\', '/'))
}

/**
 * The key of the material `usemtl <name>` uses in an MTL report: the last `newmtl` of that name,
 * which MTLLoader keeps. An OBJ's references to its library's materials give it as `uriKey`, so it
 * must stay `material:<name>`. Undefined for an empty name or a key that would be too long.
 */
export const materialNameKey = (name: string) => (name ? nameKey('material', name) : undefined)
