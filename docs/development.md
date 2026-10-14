# 开发说明

本文是 Vormio-Plugins 的工程说明：目录、构建、测试与依赖。插件的使用说明见各插件的 README。

## 目录结构

```text
Vormio-Plugins/
├─ package.json           构建、测试与素材工具；packageManager 锁定 pnpm 版本
├─ pnpm-workspace.yaml    plugins/* 各是一个包；唯一的锁文件 pnpm-lock.yaml
├─ docs/                  工程文档：插件规划与设计计划
├─ vendor/                Core 发布的 plugin-sdk 打包产物（固定版本，附来源记录）
├─ plugins/
│  ├─ gltf/               每个插件一个目录：manifest、build.json、源码、README、测试、许可证文本
│  └─ spine/              包含 Spine Runtimes，许可条件见它的 README
├─ shared/                多个插件共用的代码，由插件按相对路径导入、打进各自的包
│  ├─ report.ts           组成报告：宿主上限、名称清理、地址、超限时裁剪
│  ├─ uri.ts              文件里写的文件名转成宿主能还原的相对地址
│  ├─ testing/            测试用的替身宿主与页面桥接
│  └─ tests/              shared 自己的 Node 测试
├─ fixtures/              测试素材，每种格式一个目录（每份都记录来源与许可证）
├─ scripts/               构建、打包与素材生成脚本；fixtures/ 中每种格式一个素材脚本
├─ dist/                  构建输出（不入库），每个插件一个可作开发目录的文件夹
└─ artifacts/             打包输出的 .vormioplugin（不入库）
```

每个插件目录中的 `build.json` 列出要打包的入口脚本（esbuild 打成 ES 模块，共用部分拆到 `chunks/`）和要原样复制的静态文件；`manifest.json` 的版本必须与插件 `package.json` 一致。插件 `package.json` 的 `dependencies` 是会进入插件包的代码，`devDependencies` 只用于开发。

## 环境与命令

需要 Node 24.21（见 `.node-version`）和 pnpm 12.6（`packageManager`，通过 Corepack）。第一次运行渲染测试前，安装 Playwright 的 Chromium：

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm exec playwright install chromium-headless-shell
```

| 命令                        | 作用                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run build [插件…]`    | 构建到 `dist/<插件>/`，只写入有变化的文件并删除多余文件                                                                                      |
| `pnpm run dev [插件…]`      | 同上，并在插件目录变化时重新构建                                                                                                             |
| `pnpm run package [插件…]`  | 构建后用 `vormio-plugin pack` 生成 `artifacts/<插件 ID>-<版本>.vormioplugin`（不是 `pnpm pack`：那是 pnpm 自带的命令，会把整个仓库打成 tgz） |
| `pnpm run lint`             | Prettier 格式检查                                                                                                                            |
| `pnpm run typecheck`        | TypeScript 类型检查（插件源码、测试与脚本）                                                                                                  |
| `pnpm test`                 | 构建，运行 Node 测试（`plugins/*/tests/*.test.ts` 与 `shared/tests/*.test.ts`），再在 Chromium 中运行页面测试（`*.spec.ts`）                 |
| `pnpm run fixtures [格式…]` | 用 `scripts/fixtures/<格式>.ts` 重新生成 `fixtures/<格式>/`（`gltf`、`spine`；不写时全部），每次结果相同                                     |

每次改动都运行 `lint`、`typecheck` 与 `test`。

**在 Vormio 中联调**：先 `pnpm run dev gltf`，再在 Vormio 的“插件”页选择“添加开发目录…”，指向 `dist/gltf`，并在资源库中启用。Vormio 监听这个目录，每次构建后重新校验并重载插件。本项目的测试不需要 Core 源码。

## 与 Core 的协作

- 只使用 `vendor/` 中固定版本的 SDK 打包产物，不导入 Core 源码。来源记录见 [vendor/README.md](vendor/README.md)。
- 插件需要宿主没有的能力时，向 Core 提出需求，写清使用场景；由 Core 以通用方式补齐，不为单个格式开特例。
- 插件在 Core 的开发目录模式下联调；本项目的测试不要求 Core 源码存在。

## 开发工具与许可证

插件包中包含的第三方代码与许可证，见各插件的 README（glTF：three.js MIT，Draco 与 Basis Universal 解码器 Apache-2.0，meshoptimizer 解码器 MIT；Spine：Spine Runtimes，按 Spine Runtimes 许可协议，每个使用者都需要自己的 Spine Editor 许可证）。Spine Runtimes 只进入 `plugins/spine/`，其他插件不依赖它。只在开发、测试与生成素材时使用、不进入插件包的工具：

| 工具                                        | 版本             | 许可证     | 用途                        |
| ------------------------------------------- | ---------------- | ---------- | --------------------------- |
| esbuild                                     | 0.28.2           | MIT        | 打包插件脚本                |
| TypeScript                                  | 6.0.3            | Apache-2.0 | 类型检查                    |
| Prettier                                    | 3.9.10           | MIT        | 格式检查                    |
| @playwright/test                            | 1.63.0           | Apache-2.0 | 在 Chromium 中运行渲染测试  |
| @types/node、@types/three                   | 24.19.2、0.186.0 | MIT        | 类型定义                    |
| @gltf-transform/core、extensions、functions | 4.5.1            | MIT        | 生成测试素材                |
| draco3dgltf                                 | 1.5.7            | Apache-2.0 | 生成素材时的 Draco 编码器   |
| meshoptimizer                               | 1.3.0            | MIT        | 生成素材时的 meshopt 编码器 |

`scripts/fixtures/spine-binary.ts` 按 Spine Runtimes 的二进制读取器写出 `.skel` 素材，是 Spine Runtimes 的派生代码，与仓库其他部分不同，受 Spine Runtimes 许可协议约束；它只在生成素材时运行，不进入插件包。
