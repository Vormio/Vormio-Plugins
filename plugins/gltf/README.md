# glTF 模型

插件 ID `vormio-plugins.gltf`，版本 0.1.0。为 glTF 2.0 与 GLB 文件提供网格缩略图和只读三维查看器。

- **宿主**：Vormio-Core 0.0.2 起（插件契约 `apiVersion: 1`）。SDK 使用 [`vendor/`](../../vendor/README.md) 中固定的 0.0.2 打包产物。
- **不修改任何文件**：只读取宿主绑定的模型文件，以及它引用的、扩展名在声明范围内的配套文件。

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
- 连续查看时复用同一页面：换文件前释放上一个模型的几何体、材质、贴图与图像。
- 无法显示时向宿主报告原因，例如缺少 buffer 文件、文件被截断、glTF 1.0、需要不支持的扩展、文件在磁盘上已变化。

**配套读取**：GLTFLoader 直接按 `input.url` 的相对地址读取 buffer 与贴图，由宿主校验后返回；查看器再用 `readCompanion()` 查明读取失败的原因（不存在、未声明的类型、已变化、超过次数上限等）。

## 声明的权限

两个扩展点都声明 `formats: gltf, glb` 与 `companionFormats: bin, png, jpg, jpeg, webp, avif, ktx2`：`bin` 是外部 buffer，其余是 glTF 2.0 与上表扩展允许的贴图格式。增减其中任何一项都会改变权限指纹，用户需要重新启用。

## 不支持的情况

- glTF 1.0（包括 GLB 版本 1）。
- 必需扩展不在上表中的文件，例如 `KHR_materials_pbrSpecularGlossiness`（three.js 已移除）。
- 声明范围以外的贴图格式（如 `.tga`、`.bmp`、`.gif`）与非标准 buffer 扩展名：宿主拒绝读取，查看器列为“插件不读取这种类型的文件”，材质只用颜色显示。
- 绝对路径、`http(s):` 等外部地址：插件页面不能访问网络或关联文件夹以外的文件。
- 动画不播放，显示静止姿态；蒙皮按绑定姿态、变形目标按基础形状显示。
- 只显示默认场景；文件中的相机不使用；`KHR_materials_variants` 只显示默认材质。
- 很大的模型可能超出宿主时限（缩略图 30 秒，查看器 15 秒内就绪），此时网格显示类型图标、查看器显示超时。插件没有自己的文件大小或三角形上限。
- 不列出模型的组成与引用（网格、材质、贴图的清单与引用状态属于 Core 0.0.3 的分析器）。

## 第三方依赖

打进插件包的代码：

| 组件                                                                               | 版本    | 许可证                     | 位置                                            |
| ---------------------------------------------------------------------------------- | ------- | -------------------------- | ----------------------------------------------- |
| three.js（含 GLTFLoader、DRACOLoader、KTX2Loader、OrbitControls、RoomEnvironment） | 0.186.1 | MIT                        | 打包进 `viewer.js`、`thumbnail.js` 与 `chunks/` |
| meshoptimizer 解码器（随 three.js 发布）                                           | 1.1     | MIT                        | 打包进 `chunks/`                                |
| Draco glTF 解码器（随 three.js 发布）                                              | —       | Apache-2.0                 | `decoders/draco/`，原样复制                     |
| Basis Universal 转码器（随 three.js 发布）                                         | —       | Apache-2.0                 | `decoders/basis/`，原样复制                     |
| `@vormio/plugin-sdk` 运行时                                                        | 0.0.2   | 随 Vormio-Core（尚未选定） | 打包进 `chunks/`                                |

许可证全文与说明随包放在 `licenses/`（`THREE.txt`、`MESHOPTIMIZER.txt`、`APACHE-2.0.txt`、`NOTICE.txt`）。只在开发与测试中使用的工具见仓库 [README](../../README.md#依赖与许可证)。

## 构建、开发与测试

在仓库根目录运行（准备工作见仓库 README）：

```bash
pnpm run build gltf
```

输出到 `dist/gltf/`。在 Vormio 的“插件”页选择“添加开发目录…”，指向这个目录即可；`pnpm run dev gltf` 会在源码变化时更新它，Vormio 随之重载插件。

```bash
pnpm run pack gltf
```

生成 `artifacts/vormio-plugins.gltf-0.1.0.vormioplugin`（内部调用 `vormio-plugin pack`）。

测试（`pnpm test` 会先构建）：

| 文件                       | 内容                                                                                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/gltf-file.test.ts`  | 文件头、版本与必需扩展检查；支持的扩展清单与打包的 GLTFLoader 一致                                                                                                                                                                                            |
| `tests/framing.test.ts`    | 取景：随机包围盒与方向下，所有角点都在视野内且留出边距                                                                                                                                                                                                        |
| `tests/companions.test.ts` | 配套文件路径的显示（`../`、百分号编码、中文名）                                                                                                                                                                                                               |
| `tests/package.test.ts`    | 构建产物通过 SDK 的包校验；页面引用的文件都在包内；`vormio-plugin pack` 生成的包与目录摘要一致                                                                                                                                                                |
| `tests/render.spec.ts`     | 在 Chromium 中运行构建好的页面（宿主的 CSP、跨源配套读取、模拟的 `window.vormio`）：缩略图颜色与读取的配套文件、Draco/meshopt 与未压缩结果一致、重叠任务不串图；查看器就绪、拖动旋转、滚轮缩放、适应与重置、换文件、缺失贴图警告与失败原因；全程没有 CSP 拦截 |

渲染测试不覆盖宿主自己的沙箱、内存分区与读取校验（由 Vormio-Core 的测试覆盖），也不覆盖 KTX2 与上表中标为“无”的扩展。

## 验收记录

2026-10-13，在 Vormio-Core `a24364d` 的开发构建中验收（`pnpm run build` 后以未打包方式启动，用临时用户数据目录；对话框按 Core e2e 的方式在主进程中应答）：

1. 新建资源库，关联 `fixtures/gltf` 的副本（15 个文件）。
2. “插件”页“添加开发目录…”指向 `dist/gltf`。确认框列出两个扩展点的格式与配套格式，勾选“同时在当前资源库启用”；插件卡片显示“开发目录”“已在此资源库启用”。
3. 网格：`globe.glb`、`globe-draco.glb`、`globe-meshopt.glb`、`cube.gltf`、`crate/scene/crate.gltf`（经 `../` 读取贴图）、`problems/missing-texture.gltf` 都显示 320 px 的模型缩略图。四个无法显示的文件显示类型图标，详情栏给出原因，例如“缩略图生成失败：模型无法加载：absent.bin（文件不存在）”。
4. 查看模式：`cube.gltf` 显示四色贴图；拖动后画面 39% 的像素改变（旋转），滚轮一个方向放大、另一个方向缩小，“重置视角”回到与初始逐像素相同的画面。`crate.gltf` 与 `globe-draco.glb` 显示贴图；`missing-texture.gltf` 显示模型并列出“textures/absent.png（文件不存在）”；`missing-buffer.gltf` 由宿主显示“‘glTF 模型’无法显示这个文件：模型无法加载：absent.bin（文件不存在）”。

查看器截图取自插件视图自身的 `capturePage()`。主窗口的 `capturePage()` 不包含叠加的 WebContentsView，因此没有整窗截图。
