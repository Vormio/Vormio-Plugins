import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseReport, reportLimits, type CompositionReport } from '@vormio/plugin-sdk'
import {
  analyzeGltf,
  limits,
  plainText,
  pointer,
  reportedUri,
  serializedSize,
} from '../src/analysis.ts'
import { readGltf, type GltfJson } from '../src/gltf-file.ts'

const fixtures = join(import.meta.dirname, '../../../fixtures/gltf')
async function analyzeFixture(path: string): Promise<CompositionReport> {
  const bytes = await readFile(join(fixtures, path))
  const { json, container } = readGltf(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  )
  return accepted(analyzeGltf(json, container))
}
/** The report, after checking that the host would accept it. */
function accepted(report: CompositionReport): CompositionReport {
  const parsed = parseReport(report)
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.problems.join('\n'))
  return report
}
const files = (report: CompositionReport) =>
  report.references.filter((each) => each.uri !== undefined)
const links = (report: CompositionReport, from?: string) =>
  report.references
    .filter((each) => each.key !== undefined && each.from === from)
    .map((each) => `${each.role} → ${each.key}`)

test('the limits match the SDK', () => {
  assert.equal(limits.subresources, reportLimits.subresources)
  assert.equal(limits.references, reportLimits.references)
  assert.equal(limits.diagnostics, reportLimits.diagnostics)
  assert.equal(limits.size, reportLimits.bytes)
})

test('a model with an external buffer and texture', async () => {
  const report = await analyzeFixture('cube/cube.gltf')
  assert.deepEqual(
    report.subresources.map((each) => [each.key, each.kind, each.name, each.parent]),
    [
      ['scenes/0', '场景', 'cube', undefined],
      ['nodes/0', '节点', 'cube', 'scenes/0'],
      ['meshes/0', '网格', 'cube', undefined],
      ['materials/0', '材质', 'cube', undefined],
      // glTF-Transform writes textures without names.
      ['textures/0', '纹理', '纹理 0', undefined],
      ['images/0', '图像', 'cube', undefined],
      ['buffers/0', '缓冲区', 'cube', undefined],
    ],
  )
  assert.deepEqual(files(report), [
    { from: 'buffers/0', uri: 'cube.bin', role: '缓冲区数据', evidence: '/buffers/0/uri' },
    { from: 'images/0', uri: 'textures/quadrants.png', role: '图像', evidence: '/images/0/uri' },
  ])
  assert.deepEqual(links(report), ['默认场景 → scenes/0'])
  assert.deepEqual(links(report, 'nodes/0'), ['网格 → meshes/0'])
  assert.deepEqual(links(report, 'meshes/0'), ['材质 → materials/0', '几何数据 → buffers/0'])
  assert.deepEqual(links(report, 'materials/0'), ['基础色贴图 → textures/0'])
  assert.deepEqual(links(report, 'textures/0'), ['图像 → images/0'])
  const baseColor = report.references.find((each) => each.role === '基础色贴图')
  assert.equal(baseColor?.evidence, '/materials/0/pbrMetallicRoughness/baseColorTexture/index')
  assert.deepEqual(report.diagnostics, [])
  assert.equal(report.partial, undefined)
})

test('addresses are reported exactly as written', async () => {
  const report = await analyzeFixture('crate/scene/crate.gltf')
  assert.deepEqual(
    files(report).map((each) => each.uri),
    ['../buffers/crate.bin', '../textures/crate%20color.png'],
  )
})

test('a node hierarchy with meshes shared by several nodes', async () => {
  const report = await analyzeFixture('props/table.gltf')
  const byKey = new Map(report.subresources.map((each) => [each.key, each]))
  const nodes = report.subresources.filter((each) => each.kind === '节点')
  assert.deepEqual(
    nodes.map((each) => [each.name, each.parent && byKey.get(each.parent)?.name]),
    [
      ['Table', 'Table'],
      ['Top', 'Table'],
      ['Leg front left', 'Table'],
      ['Leg front right', 'Table'],
      ['Leg back left', 'Table'],
      ['Leg back right', 'Table'],
    ],
  )
  assert.equal(byKey.get(nodes[0]!.parent!)?.kind, '场景')
  const leg = report.subresources.find((each) => each.kind === '网格' && each.name === 'Leg')!
  assert.equal(
    report.references.filter((each) => each.role === '网格' && each.key === leg.key).length,
    4,
  )
  const material = (mesh: string) =>
    byKey.get(report.references.find((each) => each.from === mesh && each.role === '材质')!.key!)!
      .name
  assert.equal(material(leg.key), 'Metal')
  assert.equal(
    material(report.subresources.find((each) => each.name === 'Top' && each.kind === '网格')!.key),
    'Wood',
  )
  assert.deepEqual(
    files(report).map((each) => each.uri),
    ['table.bin', 'textures/wood.png'],
  )
})

test('a GLB: the binary chunk is not a file, embedded images point into it', async () => {
  const report = await analyzeFixture('globe.glb')
  assert.deepEqual(files(report), [])
  assert.deepEqual(links(report, 'images/0'), ['嵌入数据 → buffers/0'])
  assert.deepEqual(report.diagnostics, [])
  // An unnamed binary chunk gets a name that says what it is.
  const unnamed = accepted(
    analyzeGltf({ asset: { version: '2.0' }, buffers: [{ byteLength: 8 }] }, 'glb'),
  )
  assert.equal(unnamed.subresources[0]?.name, 'GLB 二进制块')
  assert.deepEqual(unnamed.diagnostics, [])
})

test('compressed geometry points at the buffers that hold it', async () => {
  for (const path of ['globe-draco.glb', 'globe-meshopt.glb']) {
    const report = await analyzeFixture(path)
    assert.deepEqual(report.diagnostics, [], path)
    assert.ok(
      links(report, 'meshes/0').some((each) => each.startsWith('几何数据 → buffers/')),
      path,
    )
  }
})

test('data URIs are reported as written; overlong ones by their header', async () => {
  const report = await analyzeFixture('problems/missing-texture.gltf')
  const [buffer, image] = files(report)
  assert.match(buffer!.uri!, /^data:application\/octet-stream;base64,[A-Za-z0-9+/=]{1000,}$/)
  assert.equal(image!.uri, 'textures/absent.png')

  const long = `data:application/octet-stream;base64,${'A'.repeat(5000)}`
  assert.equal(reportedUri(long), 'data:application/octet-stream;base64,')
  assert.equal(reportedUri(`data:${'x'.repeat(3000)}`), 'data:')
  assert.equal(reportedUri(`textures/${'a'.repeat(3000)}.png`), undefined)
  const json: GltfJson = { asset: { version: '2.0' }, buffers: [{ uri: long, byteLength: 3750 }] }
  assert.deepEqual(
    files(accepted(analyzeGltf(json, 'gltf'))).map((each) => each.uri),
    ['data:application/octet-stream;base64,'],
  )
})

test('every fixture the plugin can read gives a report the host accepts', async () => {
  const visit = async (folder: string): Promise<string[]> =>
    (await readdir(join(fixtures, folder), { withFileTypes: true })).flatMap((entry) =>
      entry.isDirectory() ? [] : [`${folder}${entry.name}`],
    )
  const folders = ['', 'cube/', 'crate/scene/', 'props/', 'problems/']
  const models = (await Promise.all(folders.map(visit)))
    .flat()
    .filter((path) => /\.(gltf|glb)$/.test(path))
  assert.ok(models.length >= 12)
  for (const path of models) {
    const bytes = await readFile(join(fixtures, path))
    let summary
    try {
      summary = readGltf(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      )
    } catch {
      continue // truncated.glb and gltf-1.gltf fail before analysis, as they should
    }
    accepted(analyzeGltf(summary.json, summary.container))
  }
})

test('problems in the file become diagnostics, never an invalid report', () => {
  const json: GltfJson = {
    asset: { version: '2.0' },
    extensionsRequired: ['KHR_materials_pbrSpecularGlossiness'],
    scene: 3,
    scenes: [{ nodes: [0, 9] }],
    nodes: [
      { name: 'A', children: [1], mesh: 7 },
      { name: 'B', children: [2] },
      { name: 'C', children: [1] }, // B → C → B
      { name: 'D', children: [2] }, // C now has two parents
      { name: 'E', children: [5] },
      { name: 'F', children: [4] }, // E → F → E, reached from no scene
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 5 }, material: 4 }] }],
    materials: [{ normalTexture: { index: 2 } }],
    textures: [{ source: 8 }],
    images: [{ name: 'nowhere' }],
    buffers: [{ byteLength: 4 }],
    accessors: [],
  }
  const report = accepted(analyzeGltf(json, 'gltf'))
  const messages = report.diagnostics.map((each) => each.message)
  for (const expected of [
    /文件引用的场景 3 不存在（\/scene）/,
    /场景 0 的根节点 9 不存在/,
    /A 引用的网格 7 不存在/,
    /网格 0 引用的材质 4 不存在/,
    /accessor 5 不存在/,
    /材质 0 引用的纹理 2 不存在/,
    /纹理 0 引用的图像 8 不存在/,
    /nowhere 既没有 uri 也没有 bufferView/,
    /缓冲区 0 没有 uri/,
    /C 有多个父节点/,
    /节点层级有环/,
    /KHR_materials_pbrSpecularGlossiness/,
  ])
    assert.ok(
      messages.some((message) => expected.test(message)),
      `${expected}\n${messages.join('\n')}`,
    )
  // The diagnostics point at the subresource they are about.
  assert.equal(report.diagnostics.find((each) => each.message.startsWith('A '))?.key, 'nodes/0')

  const notArrays = accepted(
    analyzeGltf({ asset: { version: '2.0' }, nodes: {}, meshes: [5] }, 'gltf'),
  )
  assert.equal(notArrays.partial, true)
  assert.ok(
    notArrays.diagnostics.some((each) => each.message === 'nodes 不是数组，其中的内容没有分析。'),
  )
})

test('texture slots of material extensions and image sources of texture extensions', () => {
  const report = accepted(
    analyzeGltf(
      {
        asset: { version: '2.0' },
        materials: [
          {
            pbrMetallicRoughness: { metallicRoughnessTexture: { index: 0 } },
            occlusionTexture: { index: 0, extensions: { KHR_texture_transform: { texCoord: 1 } } },
            extensions: { KHR_materials_clearcoat: { clearcoatNormalTexture: { index: 1 } } },
            extras: { customTexture: { index: 9 } },
          },
        ],
        textures: [
          { source: 0, extensions: { EXT_texture_webp: { source: 1 } } },
          { extensions: { KHR_texture_basisu: { source: 2 } } },
        ],
        images: [{ uri: 'a.png' }, { uri: 'a.webp' }, { uri: 'a.ktx2' }],
      },
      'gltf',
    ),
  )
  assert.deepEqual(links(report, 'materials/0'), [
    '金属度/粗糙度贴图 → textures/0',
    '环境光遮蔽贴图 → textures/0',
    'clearcoatNormalTexture（KHR_materials_clearcoat） → textures/1',
  ])
  assert.deepEqual(links(report, 'textures/0'), ['图像 → images/0', '图像（WebP） → images/1'])
  assert.deepEqual(links(report, 'textures/1'), ['图像（KTX2） → images/2'])
  assert.equal(
    report.references.find((each) => each.key === 'textures/1')?.evidence,
    '/materials/0/extensions/KHR_materials_clearcoat/clearcoatNormalTexture/index',
  )
})

test('skins, animations, cameras and lights', () => {
  const report = accepted(
    analyzeGltf(
      {
        asset: { version: '2.0' },
        extensions: { KHR_lights_punctual: { lights: [{ type: 'point', name: 'Lamp' }] } },
        nodes: [
          { name: 'Root', children: [1], skin: 0, camera: 0 },
          { name: 'Bone', extensions: { KHR_lights_punctual: { light: 0 } } },
        ],
        cameras: [{ type: 'perspective' }],
        skins: [{ skeleton: 0, joints: [0, 1], inverseBindMatrices: 0 }],
        animations: [
          {
            channels: [
              { sampler: 0, target: { node: 1, path: 'rotation' } },
              { sampler: 0, target: { node: 1, path: 'translation' } },
            ],
            samplers: [{ input: 0, output: 0 }],
          },
        ],
        accessors: [{ bufferView: 0 }],
        bufferViews: [{ buffer: 0 }],
        buffers: [{ uri: 'anim.bin' }],
      },
      'gltf',
    ),
  )
  assert.deepEqual(links(report, 'nodes/0'), ['相机 → cameras/0', '皮肤 → skins/0'])
  assert.deepEqual(links(report, 'nodes/1'), ['光源 → lights/0'])
  assert.deepEqual(links(report, 'skins/0'), [
    '骨架根节点 → nodes/0',
    '关节 → nodes/0',
    '关节 → nodes/1',
    '皮肤数据 → buffers/0',
  ])
  // Two channels on one node are one reference.
  assert.deepEqual(links(report, 'animations/0'), ['动画目标 → nodes/1', '动画数据 → buffers/0'])
  assert.equal(report.subresources.find((each) => each.key === 'lights/0')?.name, 'Lamp')
})

test('names are plain text within the limits', () => {
  assert.equal(plainText('a\nb\u0007c', 200), 'a b c')
  assert.equal(plainText('x'.repeat(300), 200), `${'x'.repeat(199)}…`)
  assert.equal(plainText(`${'x'.repeat(198)}😀`, 199), `${'x'.repeat(198)}…`)
  assert.equal(pointer('extensions', 'a/b', 'c~d', 0), '/extensions/a~1b/c~0d/0')
  const report = accepted(
    analyzeGltf(
      {
        asset: { version: '2.0' },
        nodes: [{ name: '  ' }, { name: `line\nbreak${'x'.repeat(400)}` }],
      },
      'gltf',
    ),
  )
  assert.equal(report.subresources[0]!.name, '节点 0')
  assert.ok(
    report.subresources[1]!.name.startsWith('line break') &&
      report.subresources[1]!.name.length === 200,
  )
})

test('a very large file gives a partial report within the limits', () => {
  const count = 12_000
  const name = (index: number) => `${'Joint '.repeat(30)}${index}`
  const json: GltfJson = {
    asset: { version: '2.0' },
    scenes: [{ nodes: Array.from({ length: count }, (_, index) => index) }],
    nodes: Array.from({ length: count }, (_, index) => ({ name: name(index) })),
    skins: [{ joints: Array.from({ length: count }, (_, index) => index) }],
    animations: Array.from({ length: 5 }, () => ({
      channels: Array.from({ length: count }, (_, index) => ({
        sampler: 0,
        target: { node: index },
      })),
      samplers: [],
    })),
    images: [{ uri: 'kept.png' }],
  }
  const report = accepted(analyzeGltf(json, 'gltf'))
  assert.equal(report.partial, true)
  assert.ok(report.subresources.length <= reportLimits.subresources)
  assert.ok(report.references.length <= reportLimits.references)
  assert.ok(serializedSize(report) <= reportLimits.bytes)
  // The files it names survive; nodes are dropped before other objects.
  assert.equal(files(report)[0]?.uri, 'kept.png')
  assert.ok(report.subresources.some((each) => each.key === 'images/0'))
  assert.ok(
    report.diagnostics.some(
      (each) => each.severity === 'info' && /只列出一部分/.test(each.message),
    ),
  )
})

test('a deep node hierarchy is walked once', () => {
  // A chain of 12,000 nodes.
  const count = 12_000
  const json: GltfJson = {
    asset: { version: '2.0' },
    scenes: [{ nodes: [0] }],
    nodes: Array.from({ length: count }, (_, index) =>
      index + 1 < count ? { children: [index + 1] } : {},
    ),
  }
  const started = performance.now()
  const report = analyzeGltf(json, 'gltf')
  assert.ok(performance.now() - started < 3000, 'the hierarchy must not be walked once per node')
  const nodes = report.subresources.filter((each) => each.kind === '节点')
  assert.equal(nodes.length, limits.subresources - 1)
  assert.equal(nodes[0]!.parent, 'scenes/0')
  assert.ok(nodes.slice(1).every((each, index) => each.parent === `nodes/${index}`))
  // The host's check of such a report is linear too (since the SDK from Core 2664854).
  const checked = performance.now()
  accepted(report)
  assert.ok(performance.now() - checked < 3000, 'the SDK checks a deep hierarchy in linear time')
})

test('the size limit counts UTF-8 bytes, as the host does', () => {
  // 10,000 nodes with 200-character Chinese names: about 2.3 million characters, but over 6 MB in
  // UTF-8. Counting characters would let this report through untrimmed.
  const count = 10_000
  const name = (index: number) => `${'节'.repeat(190)}${String(index).padStart(10, '0')}`
  const json: GltfJson = {
    asset: { version: '2.0' },
    scenes: [{ nodes: Array.from({ length: count - 1 }, (_, index) => index) }],
    nodes: Array.from({ length: count - 1 }, (_, index) => ({ name: name(index) })),
  }
  const untrimmed: CompositionReport = {
    subresources: (json.nodes as { name: string }[]).map((node, index) => ({
      key: `nodes/${index}`,
      kind: '节点',
      name: node.name,
    })),
    references: [],
    diagnostics: [],
  }
  assert.ok(JSON.stringify(untrimmed).length < limits.size)
  assert.ok(serializedSize(untrimmed) > limits.size)
  // The vendored SDK refuses it, as the host does (an SDK that counts characters would not).
  assert.deepEqual(parseReport(untrimmed), {
    ok: false,
    problems: ['The report is larger than 4 MiB'],
  })

  const report = accepted(analyzeGltf(json, 'gltf'))
  assert.ok(serializedSize(report) <= limits.size, `${serializedSize(report)} bytes`)
  assert.equal(report.partial, true)
  assert.ok(report.diagnostics.some((each) => each.message === '报告超过 4 MiB，只列出一部分。'))
  // Only as much as needed is dropped: most of the nodes stay.
  assert.ok(report.subresources.length > count / 2, `${report.subresources.length} subresources`)
})
