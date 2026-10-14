// Addresses of files named inside other files. No DOM, so it runs in Node tests as well as in the
// plugin pages.

/**
 * The relative address of a file name, such as an atlas page. Spine and libGDX files hold file
 * names, not URIs, but the host decodes percent-encoding and drops anything after `?` or `#`;
 * those three characters are encoded so the name reaches the host as written.
 */
export function fileUri(name: string): string {
  return name.replace(/[%?#]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
}
