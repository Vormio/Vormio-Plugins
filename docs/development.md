# 开发说明

本文是 Vormio-Plugins 的工程说明：目录、构建、测试与依赖。插件的使用说明见各插件的 README。

## 目录结构

```text
Vormio-Plugins/
├─ package.json           构建、测试与素材工具；packageManager 锁定 pnpm 版本
├─ pnpm-workspace.yaml    plugins/* 各是一个包；唯一的锁文件 pnpm-lock.yaml
├─ release.json           官方目录收录的插件（发布配置，见“发布官方目录”）
├─ docs/                  工程文档：插件规划与设计计划
├─ vendor/                固定版本的外部产物，附来源记录：Core 发布的 plugin-sdk 打包产物、Spine 3.8 运行时
├─ plugins/
│  ├─ gltf/               每个插件一个目录：manifest、build.json、源码、README、测试、许可证文本
│  └─ spine/              包含 Spine Runtimes，许可条件见它的 README
├─ shared/                多个插件共用的代码，由插件按相对路径导入、打进各自的包
│  ├─ report.ts           组成报告：宿主上限、名称清理、地址、超限时裁剪
│  ├─ uri.ts              文件里写的文件名转成宿主能还原的相对地址
│  ├─ testing/            测试用的替身宿主与页面桥接
│  └─ tests/              shared 自己的 Node 测试
├─ fixtures/              测试素材，每种格式一个目录（每份都记录来源与许可证）
├─ scripts/               构建、打包、目录发布与素材生成脚本；fixtures/ 中每种格式一个素材脚本
├─ dist/                  构建输出（不入库），每个插件一个可作开发目录的文件夹
└─ artifacts/             打包输出的 .vormioplugin 与目录发布时生成的配置（不入库）
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
| `pnpm run catalog …`        | 打包 `release.json` 列出的插件，用 `vormio-plugin catalog` 生成签名的官方目录，见[发布官方目录](#发布官方目录)                               |
| `pnpm run lint`             | Prettier 格式检查                                                                                                                            |
| `pnpm run typecheck`        | TypeScript 类型检查（插件源码、测试与脚本）                                                                                                  |
| `pnpm test`                 | 构建，运行 Node 测试（`plugins/*/tests/*.test.ts` 与 `shared/tests/*.test.ts`），再在 Chromium 中运行页面测试（`*.spec.ts`）                 |
| `pnpm run fixtures [格式…]` | 用 `scripts/fixtures/<格式>.ts` 重新生成 `fixtures/<格式>/`（`gltf`、`spine`；不写时全部），每次结果相同                                     |

每次改动都运行 `lint`、`typecheck` 与 `test`。

**替身宿主**（`shared/testing/`）：页面测试在 Chromium 中运行，插件文件带宿主的页面 CSP，配套读取按 manifest 的 `companionFormats` 限制。查看器页面像在宿主中一样，报告就绪之前是隐藏的，切换到下一个文件后再次隐藏直到就绪：这期间没有动画帧，`requestAnimationFrame` 的回调与图片的 `decode()` 都要等到显示后才完成。查看器在就绪之前依赖它们，就会在 Vormio 中“插件加载超时”。页面回答“不适用”（SDK 的 `notApplicable()`）时，替身宿主记下这个回答：缩略图与分析请求得到 `{ notApplicable: true }`，查看器调用 `notApplicable(input)` 并保持隐藏。替身宿主不模拟沙箱、分区、读取校验与拒绝记录，这些由 Vormio-Core 自己的测试覆盖。

**在 Vormio 中联调**：先 `pnpm run dev gltf`，再在 Vormio 的“插件”页选择“添加开发目录…”，指向 `dist/gltf`，并在资源库中启用。Vormio 监听这个目录，每次构建后重新校验并重载插件。本项目的测试不需要 Core 源码。

## 与 Core 的协作

- 只使用 `vendor/` 中固定版本的 SDK 打包产物，不导入 Core 源码。来源记录见 [vendor/README.md](vendor/README.md)。
- 插件需要宿主没有的能力时，向 Core 提出需求，写清使用场景；由 Core 以通用方式补齐，不为单个格式开特例。
- 插件在 Core 的开发目录模式下联调；本项目的测试不要求 Core 源码存在。

## 发布官方目录

官方目录是一份签名的 `catalog.json` 加上它列出的插件包，放在静态托管上，Vormio 的插件窗口从这里安装与更新插件。格式见 SDK README 的“插件目录”一节。仓库里只有发布配置与命令；目录地址、托管配置、上传凭据与签名私钥都不进仓库，上传是发布者的运营步骤。

- `release.json` 的 `plugins` 列出目录收录的插件（`plugins/` 下的目录名）。新目录收录每个插件在当前提交上的版本；没有列出的插件不进目录。从目录撤下一个插件，就是把它从这里删掉再发布一次；已经装上的插件不会被远程删除。
- 宿主只安装与自己 `apiVersion` 相同的发布。现在的插件是 `apiVersion: 2`（Core 0.0.6 起），线上目录里是给 Core 0.0.5 的 `apiVersion: 1`。按现在的命令发布，新目录只有当前提交上的版本，0.0.5 的宿主就再也看不到可安装的插件；要让目录同时列出两组发布，命令需要保留上一份目录中其他 `apiVersion` 的发布。这一项还没有做，发布 `apiVersion: 2` 之前完成。
- 只在每个列出的版本都已在 Core 上手工验收（[插件规划](roadmap.md)的状态列）的提交上发布，发布前照常运行 `lint`、`typecheck` 与 `test`。
- 命令，路径相对于运行命令的文件夹：

  ```bash
  pnpm run catalog --previous <线上的 catalog.json> --key <私钥.pem> --out <新目录>
  ```

  - 工作区必须干净：目录要能追溯到一个提交，命令最后打印这个提交，供发布记录使用。
  - 逐个构建并打包列出的插件（同 `pnpm run package`），把 SDK 的发布配置写到 `artifacts/catalog-release.json`，再运行 `vormio-plugin catalog`：用宿主安装时相同的检查校验每个包，按内容命名复制到 `<新目录>/packages/`，签名 `catalog.json` 并用公钥复验。任何一项检查失败时都不写出文件。
  - `--previous` 是当前线上的目录，旁边是它的 `packages/`。新目录的序号是它的序号加 1，它必须由同一把私钥签名。它已经收录的版本沿用已发布的包，不用重新打的包：同一版本只有一个包。重新构建可能只有分块文件名不同（例如换了 `vendor/` 中的 SDK 之后），代码相同；要发布改动，先提高插件版本。
  - 没有上一份目录时（首次发布、换了密钥、本地演练）改用 `--initial-sequence <序号>`。
  - 私钥不能放在本仓库里；输出目录必须是新目录或空目录。

- 上传时先上传 `packages/`，最后上传 `catalog.json`。`catalog.json` 不要缓存；包的文件名随内容变化，可以长期缓存。

**本地演练**：用 `pnpm exec vormio-plugin keygen <仓库外的路径前缀>` 生成一把临时密钥，用它发布到临时目录，在 127.0.0.1 上静态托管。未打包的 Core 构建通过环境变量 `VORMIO_CATALOG_URL`（例如 `http://127.0.0.1:8787/catalog.json`）与 `VORMIO_CATALOG_PUBLIC_KEY`（`.public.txt` 中的公钥）改用这个目录；打包后的 Vormio 只用内置的官方目录。

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
