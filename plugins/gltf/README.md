# glTF 模型

插件 ID `vormio-plugins.gltf`，版本 0.2.0。为 glTF 2.0 与 GLB 文件提供网格缩略图、只读三维查看器和组成分析。

- **宿主**：Vormio-Core 0.0.3 起（插件契约 `apiVersion: 1`）。0.2.0 声明了分析器扩展点，0.0.2 的宿主不认识这个字段，会拒绝加载；只要缩略图和查看器时用 0.1.0。SDK 使用 [`vendor/`](../../vendor/README.md) 中固定的 0.0.5 打包产物。
- **不修改任何文件**：只读取宿主绑定的模型文件，以及它引用的、扩展名在声明范围内的配套文件。
- 从 0.1.0 升级时新增了分析器扩展点，权限指纹改变，需要在资源库中重新启用。

## 支持的格式与版本

| 主文件  | 版本                                                             |
| ------- | ---------------------------------------------------------------- |
| `.gltf` | glTF 2.0 JSON（`asset.version` 为 2.x，`minVersion` 不高于 2.0） |
| `.glb`  | GLB 二进制容器版本 2（glTF 2.0）                                 |

buffer 与图像可以是外部文件（相对模型文件的路径，可以用 `../` 走到同一关联文件夹的其他目录，名称按 URI 规则百分号编码）、`data:` URI，或 GLB 中的 bufferView。

贴图格式：PNG、JPEG、WebP（`EXT_texture_webp`）、AVIF（`EXT_texture_avif`），以及 KTX2 / Basis Universal（`KHR_texture_basisu`）。

渲染由 three.js 0.186.1 的 GLTFLoader 完成。文件把下列扩展列为必需时也能显示；列为必需的其他扩展会被拒绝并说明原因（只是可选使用的扩展不影响显示，效果可能被忽略）：

| 扩展                                                                                                                                                                           | 本仓库素材验证                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| `KHR_draco_mesh_compression`（Draco 解码器在 Worker 中运行）                                                                                                                   | 有：`globe-draco.glb`                 |
| `EXT_meshopt_compression`、`KHR_meshopt_compression`、`KHR_mesh_quantization`                                                                                                  | 有：`globe-meshopt.glb`（EXT 与量化） |
| `KHR_texture_basisu`（Basis 转码器在 Worker 中运行）                                                                                                                           | 无                                    |
| `KHR_texture_transform`、`EXT_texture_webp`、`EXT_texture_avif`                                                                                                                | 无                                    |
| `KHR_materials_anisotropy`、`clearcoat`、`dispersion`、`emissive_strength`、`ior`、`iridescence`、`sheen`、`specular`、`transmission`、`unlit`、`volume`，`EXT_materials_bump` | 无                                    |
| `KHR_lights_punctual`、`EXT_mesh_gpu_instancing`                                                                                                                               | 无                                    |

“无”表示由 three.js 实现、插件按原样启用，但本仓库还没有对应素材做过验证。

## 能力

**缩略图**：在宿主的隐藏页面中用 WebGL 渲染默认场景，按模型实际顶点取景（顶点超过 100 万时按包围盒），透明背景，宿主给出的最长边（目前 320 px）。先以两倍尺寸渲染再缩小，边缘平滑。贴图读不到时，对应材质只用颜色渲染，缩略图照常生成。

**查看器**：与缩略图相同的加载、光照与取景代码。

- 拖动旋转，滚轮缩放（向光标处缩放），右键或 Shift + 拖动平移。
- “适应”（F）：保持当前方向，让整个模型回到视野中；“重置视角”（R）：回到初始视角。
- 底部显示三角形数；读不到的贴图在左上角列出路径与原因（例如“textures/a.png（文件不存在）”）。
- 连续查看时复用同一页面：换文件前释放上一个模型的几何体、材质、贴图与图像。查看区改变大小时立即重画，不闪烁。
- 无法显示时向宿主报告原因，例如缺少 buffer 文件、文件被截断、glTF 1.0、需要不支持的扩展、文件在磁盘上已变化。

**配套读取**：GLTFLoader 直接按 `input.url` 的相对地址读取 buffer 与贴图，由宿主校验后返回；查看器再用 `readCompanion()` 查明读取失败的原因（不存在、未声明的类型、已变化、超过次数上限等）。

**组成分析**：宿主在后台调用分析器，结果显示在详情栏的“组成”区与被引用文件的“被引用”区。分析只读 JSON：`.gltf` 读整个文件，GLB 用 Range 请求只读 20 字节的文件头和 JSON 数据块，二进制块与贴图都不读取。

- **子资源**（`key` 为 `集合/序号`，例如 `materials/0`；名称取文件中的 `name`，没有时用“类别 序号”）：

  | 类别                   | glTF 对象                                                      | 上级                             |
  | ---------------------- | -------------------------------------------------------------- | -------------------------------- |
  | 场景                   | `scenes`                                                       | —                                |
  | 节点                   | `nodes`                                                        | 父节点；场景的根节点以场景为上级 |
  | 网格                   | `meshes`                                                       | —                                |
  | 材质                   | `materials`                                                    | —                                |
  | 纹理                   | `textures`                                                     | —                                |
  | 图像                   | `images`                                                       | —                                |
  | 缓冲区                 | `buffers`（GLB 未命名的二进制块称“GLB 二进制块”）              | —                                |
  | 相机、光源、皮肤、动画 | `cameras`、`KHR_lights_punctual.lights`、`skins`、`animations` | —                                |

- **文件引用**：`buffers[].uri`（角色“缓冲区数据”）与 `images[].uri`（角色“图像”）按文件中写的原样报告，由宿主解码、解析并判定状态；`data:` 也原样报告，宿主归为内嵌。超过 2,048 个字符的 `data:` 地址只报告到逗号为止的头部（宿主只按 `data:` 前缀分类）；其他超长地址不报告，记一条诊断。GLB 的二进制块没有地址，不算文件引用。
- **内部引用**（`key` 加 `from`）：文件 → 默认场景；节点 → 网格、相机、皮肤、光源；网格 → 材质（含 `KHR_materials_variants` 的变体材质）与存放其几何数据的缓冲区（经 accessor、bufferView，包括 Draco 与 meshopt 的数据）；材质 → 纹理（核心五个贴图槽有中文名，材质扩展中的贴图槽写成“属性名（扩展名）”）；纹理 → 图像（含 KTX2、WebP、AVIF 来源）；图像 → 嵌入它的缓冲区；皮肤 → 骨架根节点、关节、数据缓冲区；动画 → 目标节点与数据缓冲区。同一对象之间同一角色的引用只报告一次。`evidence` 是 JSON 指针，例如 `/images/2/uri`、`/materials/0/pbrMetallicRoughness/baseColorTexture/index`。
- **诊断**：不存在的序号（引用被略去）、节点有多个父节点（按第一个显示）、层级成环（断开成环的一处）、缺少 `uri` 的 buffer 或图像、结构不是数组或对象的部分（报告标为部分完成），以及查看器不支持的必需扩展。
- **上限**：子资源超过 10,000 个、引用超过 50,000 条或报告超过 4 MiB（按 UTF-8 编码的 JSON 字节数计算，与宿主一致）时，先保留文件引用，再按节点、动画、皮肤……的顺序略去对象，报告标为部分完成并附说明。诊断最多 500 条。名称与角色去掉控制字符并按上限截断。
- **失败**：不是 glTF 2.0、GLB 文件头损坏或被截断时分析失败，宿主显示原因，例如“GLB 文件不完整：文件头声明 54000 字节，实际只有 2048 字节。”

分析器不声明 `companionFormats`，因为它从不读取配套文件；页面不加载 three.js，打包后约 17 KB。

## 声明的权限

缩略图与查看器声明 `formats: gltf, glb` 与 `companionFormats: bin, png, jpg, jpeg, webp, avif, ktx2`：`bin` 是外部 buffer，其余是 glTF 2.0 与上表扩展允许的贴图格式。分析器只声明 `formats: gltf, glb`。增减其中任何一项或增减扩展点都会改变权限指纹，用户需要重新启用。

## 不支持的情况

- glTF 1.0（包括 GLB 版本 1）。
- 必需扩展不在上表中的文件，例如 `KHR_materials_pbrSpecularGlossiness`（three.js 已移除）。查看器与缩略图拒绝显示；分析器照常分析，并记一条警告。
- 声明范围以外的贴图格式（如 `.tga`、`.bmp`、`.gif`）与非标准 buffer 扩展名：宿主拒绝读取，查看器列为“插件不读取这种类型的文件”，材质只用颜色显示。分析器仍报告这些引用，状态由宿主判定。
- 绝对路径、`http(s):` 等外部地址：插件页面不能访问网络或关联文件夹以外的文件。分析器把它们原样报告，宿主归为外部。
- 动画不播放，显示静止姿态；蒙皮按绑定姿态、变形目标按基础形状显示。
- 只显示默认场景；文件中的相机不使用；`KHR_materials_variants` 只显示默认材质。
- 分析器不列出 accessor、bufferView、采样器与图元（图元的材质与几何数据记在所属网格上），也不分析 `extras`。
- 很大的模型可能超出宿主时限（缩略图与分析 30 秒，查看器 15 秒内就绪），此时网格显示类型图标、查看器显示超时、分析记为失败。插件没有自己的文件大小或三角形上限。

## 第三方依赖

打进插件包的代码：

| 组件                                                                               | 版本    | 许可证     | 位置                                            |
| ---------------------------------------------------------------------------------- | ------- | ---------- | ----------------------------------------------- |
| three.js（含 GLTFLoader、DRACOLoader、KTX2Loader、OrbitControls、RoomEnvironment） | 0.186.1 | MIT        | 打包进 `viewer.js`、`thumbnail.js` 与 `chunks/` |
| meshoptimizer 解码器（随 three.js 发布）                                           | 1.1     | MIT        | 打包进 `chunks/`                                |
| Draco glTF 解码器（随 three.js 发布）                                              | —       | Apache-2.0 | `decoders/draco/`，原样复制                     |
| Basis Universal 转码器（随 three.js 发布）                                         | —       | Apache-2.0 | `decoders/basis/`，原样复制                     |
| `@vormio/plugin-sdk` 运行时                                                        | 0.0.5   | MIT        | 打包进 `chunks/`                                |

许可证全文与说明随包放在 `licenses/`（`THREE.txt`、`MESHOPTIMIZER.txt`、`APACHE-2.0.txt`、`NOTICE.txt`）。只在开发与测试中使用的工具见仓库 [README](../../README.md#依赖与许可证)。

## 构建、开发与测试

在仓库根目录运行（准备工作见仓库 README）：

```bash
pnpm run build gltf
```

输出到 `dist/gltf/`。在 Vormio 的“插件”页选择“添加开发目录…”，指向这个目录即可；`pnpm run dev gltf` 会在源码变化时更新它，Vormio 随之重载插件。

```bash
pnpm run package gltf
```

生成 `artifacts/vormio-plugins.gltf-0.2.0.vormioplugin`（内部调用 `vormio-plugin pack`）。

测试（`pnpm test` 会先构建）：

| 文件                       | 内容                                                                                                                                                                                                                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/gltf-file.test.ts`  | 文件头、版本与必需扩展检查；支持的扩展清单与打包的 GLTFLoader 一致                                                                                                                                                                                                                  |
| `tests/analysis.test.ts`   | 组成报告：各素材的子资源、层级与引用；地址原样报告与超长 `data:`；扩展中的贴图槽与图像来源；皮肤、动画、相机与光源；错误序号、多父节点与成环变为诊断；超出上限时部分报告；深层级只遍历一次。每份报告都用 SDK 的 `parseReport` 校验，上限与 SDK 的 `reportLimits` 一致               |
| `tests/framing.test.ts`    | 取景：随机包围盒与方向下，所有角点都在视野内且留出边距                                                                                                                                                                                                                              |
| `tests/companions.test.ts` | 配套文件路径的显示（`../`、百分号编码、中文名）                                                                                                                                                                                                                                     |
| `tests/package.test.ts`    | 构建产物通过 SDK 的包校验；三个扩展点的权限；页面引用的文件都在包内；页面不含 SDK 的 schema，分析器页面不含 three.js；`vormio-plugin pack` 生成的包与目录摘要一致                                                                                                                   |
| `tests/render.spec.ts`     | 在 Chromium 中运行构建好的页面（宿主的 CSP、跨源配套读取、模拟的 `window.vormio`）：缩略图颜色与读取的配套文件、Draco/meshopt 与未压缩结果一致、重叠任务不串图；查看器就绪、拖动旋转、滚轮缩放、适应与重置、改变大小时不出现空帧、换文件、缺失贴图警告与失败原因；全程没有 CSP 拦截 |
| `tests/analyzer.spec.ts`   | 在 Chromium 中运行分析器页面：报告与 Node 中的分析一致并通过 `parseReport`；`.gltf` 只读主文件，GLB 只用 Range 读文件头与 JSON 块；重叠的分析不串；无法解析的文件给出原因；全程没有 CSP 拦截                                                                                        |

渲染与分析测试不覆盖宿主自己的沙箱、内存分区、读取校验与引用状态判定（由 Vormio-Core 的测试覆盖），也不覆盖 KTX2 与上表中标为“无”的扩展。

## 验收记录

在 Vormio-Core 的开发构建中验收：以未打包方式启动，用临时用户数据目录，对话框按 Core e2e 的方式在主进程中应答，关联的是 `fixtures/gltf` 的副本。

**Core 0.0.2（`a24364d`，插件 0.1.0），2026-10-13**

1. “插件”页“添加开发目录…”指向 `dist/gltf`。确认框列出两个扩展点的格式与配套格式，勾选“同时在当前资源库启用”；插件卡片显示“开发目录”“已在此资源库启用”。
2. 网格：`globe.glb`、`globe-draco.glb`、`globe-meshopt.glb`、`cube.gltf`、`crate/scene/crate.gltf`（经 `../` 读取贴图）、`problems/missing-texture.gltf` 都显示 320 px 的模型缩略图。无法显示的文件显示类型图标，详情栏给出原因，例如“缩略图生成失败：模型无法加载：absent.bin（文件不存在）”。
3. 查看模式：`cube.gltf` 显示四色贴图；拖动后画面 39% 的像素改变（旋转），滚轮一个方向放大、另一个方向缩小，“重置视角”回到与初始逐像素相同的画面。`crate.gltf` 与 `globe-draco.glb` 显示贴图；`missing-texture.gltf` 显示模型并列出缺失的贴图；`missing-buffer.gltf` 由宿主显示失败原因。

**Core 0.0.3（`780e04b`，插件 0.2.0），2026-10-13**，路线图 0.0.3 的验收旅程：

1. 关联含 glTF 的文件夹（20 个文件），添加开发目录并启用。确认框多出“组成分析：gltf、glb”。
2. 选中 `props/table.gltf`，组成区显示“由‘glTF 模型’分析于 …”、子资源 14 个（场景 1、节点 6 并按层级缩进、网格 2、材质 2、纹理 1、图像 1、缓冲区 1）、引用 14 条，其中 `table.bin` 与 `wood.png` 为“已解析”。
3. 点击引用中的 `wood.png`，跳转到 `props/textures` 并选中它，被引用区显示“被 2 个文件引用”：`stool.gltf` 与 `table.gltf`，角色“图像”。
4. 在磁盘上删除 `wood.png` 并重新扫描：`table.gltf` 的组成区显示“1 个缺失”，`wood.png` 为“缺失”，网格中两个模型带“缺失引用”标记；“筛选 → 有缺失引用”后只剩 `stool.gltf` 与 `table.gltf`。宿主同时按新的配套版本重新生成了两者的缩略图（木纹消失）。
5. 写回 `wood.png` 并重新扫描：筛选结果为空（“没有符合筛选条件的文件。”），清除筛选后 `wood.png` 恢复“已解析”。
6. 同一构建上缩略图与查看器照常工作；全程原文件的内容与修改时间都没有被改动（写回的贴图内容与原来相同）。

查看器截图取自插件视图自身的 `capturePage()`。主窗口的 `capturePage()` 不包含叠加的 WebContentsView，因此没有整窗截图。
