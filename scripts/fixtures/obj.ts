// Generates the OBJ test fixtures in fixtures/obj/; run through scripts/make-fixtures.ts. Geometry,
// material libraries and textures (PNG, TGA, BMP) are all written here, so the fixtures contain no
// third-party content. The files that only look like OBJ files (compiled object files) are a few
// bytes of a COFF or ELF header and filler.

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { png, type Rgba } from './png.ts'

const output = join(import.meta.dirname, '..', '..', 'fixtures', 'obj')

async function write(path: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(join(output, path)), { recursive: true })
  await writeFile(join(output, path), data)
}
/** Text with LF line ends, as most exporters write it. */
const lines = (...each: string[]) => `${each.join('\n')}\n`

const red: Rgba = [220, 38, 38, 255]
const green: Rgba = [22, 163, 74, 255]
const blue: Rgba = [37, 99, 235, 255]
const yellow: Rgba = [234, 179, 8, 255]
const orange: Rgba = [234, 88, 12, 255]

/** Wood grain in two browns. */
const wood = png(32, 32, (x, y) =>
  Math.floor((x + (Math.floor(y / 8) % 2) * 4) / 4) % 2 ? [158, 104, 58, 255] : [190, 132, 78, 255],
)
const stripes = png(32, 32, (x) => (Math.floor(x / 8) % 2 ? blue : yellow))

/** An uncompressed 24-bit TGA, stored bottom-up as the format's default origin. */
function tga(width: number, height: number, pixel: (x: number, y: number) => Rgba): Uint8Array {
  const header = Buffer.alloc(18)
  header[2] = 2 // uncompressed true colour
  header.writeUInt16LE(width, 12)
  header.writeUInt16LE(height, 14)
  header[16] = 24
  const body = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, height - 1 - y)
      body.set([b, g, r], (y * width + x) * 3)
    }
  return Buffer.concat([header, body])
}

/** A 24-bit BMP (BI_RGB), rows bottom-up and padded to four bytes. */
function bmp(width: number, height: number, pixel: (x: number, y: number) => Rgba): Uint8Array {
  const row = Math.ceil((width * 3) / 4) * 4
  const header = Buffer.alloc(54)
  header.write('BM', 0, 'latin1')
  header.writeUInt32LE(54 + row * height, 2)
  header.writeUInt32LE(54, 10)
  header.writeUInt32LE(40, 14)
  header.writeInt32LE(width, 18)
  header.writeInt32LE(height, 22)
  header.writeUInt16LE(1, 26)
  header.writeUInt16LE(24, 28)
  header.writeUInt32LE(row * height, 34)
  const body = Buffer.alloc(row * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, height - 1 - y)
      body.set([b, g, r], y * row + x * 3)
    }
  return Buffer.concat([header, body])
}

/**
 * Writes OBJ geometry: boxes with texture coordinates and normals, numbered across the whole file
 * as the format requires.
 */
class ObjWriter {
  private readonly out: string[] = []
  private vertices = 0

  line(text: string): this {
    this.out.push(text)
    return this
  }

  /** A box of size [w, h, d] centred at `at`; each face shows the whole texture. */
  box([w, h, d]: [number, number, number], at: [number, number, number], normals = true): this {
    const corner = (sx: number, sy: number, sz: number) =>
      `v ${at[0] + (sx * w) / 2} ${at[1] + (sy * h) / 2} ${at[2] + (sz * d) / 2}`
    const base = this.vertices
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) for (const sz of [-1, 1]) this.out.push(corner(sx, sy, sz))
    this.vertices += 8
    if (normals) this.out.push('vt 0 0', 'vt 1 0', 'vt 1 1', 'vt 0 1')
    // Corners are numbered x * 4 + y * 2 + z (0 = negative side), counter-clockwise from outside.
    const faces: [number, number, number, number, number][] = [
      [1, 5, 7, 3, 1], // +z
      [4, 0, 2, 6, 2], // -z
      [5, 4, 6, 7, 3], // +x
      [0, 1, 3, 2, 4], // -x
      [3, 7, 6, 2, 5], // +y
      [0, 4, 5, 1, 6], // -y
    ]
    if (normals)
      this.out.push('vn 0 0 1', 'vn 0 0 -1', 'vn 1 0 0', 'vn -1 0 0', 'vn 0 1 0', 'vn 0 -1 0')
    for (const [a, b, c, e, n] of faces) {
      const v = (corner: number, uv: number) =>
        normals ? `${base + corner + 1}/${-4 + uv}/${-7 + n}` : `${base + corner + 1}`
      this.out.push(`f ${v(a, 0)} ${v(b, 1)} ${v(c, 2)} ${v(e, 3)}`)
    }
    return this
  }

  toString(): string {
    return `${this.out.join('\n')}\n`
  }
}

await mkdir(output, { recursive: true })
for (const name of await readdir(output))
  if (name !== 'README.md') await rm(join(output, name), { recursive: true, force: true })

// --- basic: two objects, three groups, two materials; a texture in a subfolder with a space -----

await write(
  'basic/table.obj',
  new ObjWriter()
    .line('# Vormio-Plugins test fixture: a table')
    .line('mtllib table.mtl')
    .line('o Top')
    .line('g top')
    .line('usemtl Wood')
    .box([1.2, 0.08, 0.7], [0, 0.74, 0])
    .line('o Legs')
    .line('g legs-front')
    .line('usemtl Metal')
    .box([0.06, 0.7, 0.06], [-0.54, 0.35, 0.29])
    .box([0.06, 0.7, 0.06], [0.54, 0.35, 0.29])
    .line('g legs-back')
    .box([0.06, 0.7, 0.06], [-0.54, 0.35, -0.29])
    .box([0.06, 0.7, 0.06], [0.54, 0.35, -0.29])
    .toString(),
)
await write(
  'basic/table.mtl',
  lines(
    '# Vormio-Plugins test fixture',
    'newmtl Wood',
    'Kd 1 1 1',
    'map_Kd textures/wood grain.png',
    '',
    'newmtl Metal',
    'Ka 0 0 0',
    'Kd 0.62 0.63 0.66',
    'Ks 0.5 0.5 0.5',
    'Ns 80',
  ),
)
await write('basic/textures/wood grain.png', wood)

// --- layout: two libraries, the second in ../materials/ redefining a material; texture options ----
// and a Windows path

await write(
  'layout/model/crate.obj',
  new ObjWriter()
    .line('mtllib base.mtl')
    .line('mtllib ../materials/paint.mtl')
    .line('o Crate')
    .line('usemtl Body')
    .box([1, 1, 1], [0, 0.5, 0])
    .line('usemtl Label')
    .box([0.4, 0.4, 0.02], [0, 0.5, 0.51])
    .toString(),
)
await write(
  'layout/model/base.mtl',
  lines('newmtl Body', 'Kd 0.8 0.1 0.1', '', 'newmtl Label', 'Kd 1 1 1'),
)
await write(
  'layout/materials/paint.mtl',
  lines(
    '# Body is defined again here; the later library wins.',
    'newmtl Body',
    'Kd 0.1 0.6 0.2',
    '',
    'newmtl Label',
    'Kd 1 1 1',
    'map_Kd -clamp on -s 1 1 1 -o 0 0 ..\\textures\\stripes #2.png',
    'bump -bm 0.5 ..\\textures\\stripes #2.png',
  ),
)
await write('layout/textures/stripes #2.png', stripes)

// --- no-material: geometry only, with vertex colours and without normals -------------------------

await write(
  'no-material/marker.obj',
  lines(
    'o Marker',
    'v -0.5 0 0 1 0 0',
    'v 0.5 0 0 0 1 0',
    'v 0 0.8 0 0 0 1',
    'v 0 0.3 0.5 1 1 0',
    'f 1 2 3',
    'f 1 4 2',
    'f 2 4 3',
    'f 3 4 1',
  ),
)
await write(
  'no-material/plain.obj',
  new ObjWriter().line('o Box').box([1, 1, 1], [0, 0, 0], false).toString(),
)

// --- formats: textures in TGA and BMP ------------------------------------------------------------

await write(
  'formats/blocks.obj',
  new ObjWriter()
    .line('mtllib blocks.mtl')
    .line('o Left')
    .line('usemtl Targa')
    .box([0.8, 0.8, 0.8], [-0.5, 0, 0])
    .line('o Right')
    .line('usemtl Bitmap')
    .box([0.8, 0.8, 0.8], [0.5, 0, 0])
    .toString(),
)
await write(
  'formats/blocks.mtl',
  lines(
    'newmtl Targa',
    'Kd 1 1 1',
    'map_Kd orange.tga',
    '',
    'newmtl Bitmap',
    'Kd 1 1 1',
    'map_Kd green.bmp',
  ),
)
await write(
  'formats/orange.tga',
  tga(8, 8, () => orange),
)
await write(
  'formats/green.bmp',
  bmp(6, 6, () => green),
)

// --- problems ------------------------------------------------------------------------------------

const cube = (library?: string, material?: string) => {
  const writer = new ObjWriter()
  if (library) writer.line(`mtllib ${library}`)
  writer.line('o Cube')
  if (material) writer.line(`usemtl ${material}`)
  return writer.box([1, 1, 1], [0, 0, 0]).toString()
}
await write('problems/missing-library.obj', cube('absent.mtl', 'Paint'))
await write('problems/missing-texture.obj', cube('missing-texture.mtl', 'Painted'))
await write(
  'problems/missing-texture.mtl',
  lines('newmtl Painted', 'Kd 0.9 0.2 0.2', 'map_Kd absent.png'),
)
await write('problems/unknown-material.obj', cube('unknown-material.mtl', 'Ghost'))
await write('problems/unknown-material.mtl', lines('newmtl Real', 'Kd 0.2 0.2 0.9'))
await write(
  'problems/bad-index.obj',
  lines(
    'o Broken',
    'v 0 0 0',
    'v 1 0 0',
    'v 0 1 0',
    'f 1 2 3',
    'f 1 2 9',
    'f 0 2 3',
    'curv 0 1 1 2',
    'zz unknown',
  ),
)
await write('problems/truncated.obj', cube().slice(0, 40))
await write(
  'problems/library-issues.mtl',
  lines(
    'map_Kd orphan.png',
    'newmtl Twice',
    'Kd 1 0 0',
    'newmtl Twice',
    'Kd 0 1 0',
    'map_Ks',
    'refl -type cube_top sky top.png',
    'refl -type cube_bottom sky bottom.png',
    'map_Pr rough.png',
    'map_Xyz custom.png',
    'zz unknown',
  ),
)

// --- not-obj: files with the extension that are not models ------------------------------------------

/** A COFF object file as MSVC writes it for x64: machine 0x8664, then sections and symbols. */
const coff = Buffer.alloc(256)
coff.writeUInt16LE(0x8664, 0)
coff.writeUInt16LE(3, 2)
coff.write('.text$mn', 20, 'latin1')
await write('not-obj/compiled-msvc.obj', coff)
/** An ELF relocatable object as GCC writes it. */
const elf = Buffer.alloc(256)
elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0)
elf.writeUInt16LE(1, 16)
await write('not-obj/compiled-gcc.obj', elf)
await write(
  'not-obj/notes.obj',
  lines('These notes happen to end in .obj.', 'They are not a model.'),
)
