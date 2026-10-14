# vendor

Vormio-Core 发布的插件 SDK 打包产物。本仓库只通过这里的固定版本使用 SDK，不导入 Core 源码，也不依赖同级检出。

| 文件                                  | 版本  | 来源                                                                                                                  | SHA-256                                                            |
| ------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `vormio-plugin-sdk-0.0.6-02188f0.tgz` | 0.0.6 | Vormio-Core `02188f00d6aefe8cafb4cb705a8efe8e3de9f658`（`worktree-r1-not-applicable-plan` 分支），`pnpm run sdk:pack` | `471ab5a7342f424cdf88a82654a19d88b46809b2ad8b3f2e81fca2ef3eefdc92` |

- 由 Core 提交 `02188f0` 在干净的工作区中构建，2026-10-14 复制到这里并校验了 SHA-256；锁文件中的 integrity 与这份 tarball 一致。文件名中的提交号是 `sdk:pack` 加上的；工作区有未提交改动时它还会加 `-dirty`，这样的 tarball 不能放进这里。0.0.6 还没有发布到 npm，发布后 npm 上的包应当与这份 tarball 的内容相同（0.0.5 只差在 README 的语言）。
- 它替换了 0.0.5（Core `6cf994f` 构建，SHA-256 `d53a560d3682bca9c4dbcf000a8604e8cc2a83414c738c579900d8687d2b6f6f`）。0.0.6 新增“不适用”：`notApplicable()` 与 `isNotApplicable`，分析器、缩略图与查看器的处理函数都可以返回它，语义见 SDK README 的 “Files that are not your format”。插件契约随之升到 `apiVersion: 2`，所有插件的 manifest 都要改，SDK 的 `parseManifest` 与 `vormio-plugin pack` 只接受 2。
- 宿主只加载与自己相同 `apiVersion` 的插件：Core 0.0.6 只加载 `apiVersion: 2`，Core 0.0.5 及更早只加载 `apiVersion: 1`。
- 再往前是 0.0.3（Core `9d56146` 构建，SHA-256 `61b94764f7b85b823b8a23ffad6bed2a8c33c6e17e3fd67d2141f5af35d300e2`）。0.0.5 新增签名的插件目录（`@vormio/plugin-sdk/node` 的 `verifyCatalog`、`signCatalog`、`writeCatalog` 等，命令 `vormio-plugin keygen` 与 `vormio-plugin catalog`），以及 `.vormioplugin` 文件的上限 96 MiB。SDK 以 MIT 许可证发布，包内带 `LICENSE`。

更新时：

1. 在 Core 运行 `pnpm run sdk:pack`，把新的 tarball 复制到这里，校验 SHA-256，更新上表（Core 提交号、SHA-256）。
2. 更新根目录与各插件 `package.json` 中的 `file:` 路径，运行 `pnpm install`，确认锁文件中的 integrity 已经更新，删除不再使用的旧 tarball。
3. 保留 `sdk:pack` 给的文件名：它带着构建提交，同一版本内重新交付也会换文件名，锁文件随之更新。替换同名的 tarball 时（0.0.3 曾经这样），`pnpm install` 会认为锁文件没有变化而跳过解析，要运行 `pnpm update -r @vormio/plugin-sdk`。
4. 换了 SDK 之后重新构建的插件，分块文件名会变：分块名的哈希包含 SDK 在 `node_modules` 中的路径，而这个路径带着 tarball 的文件名。

校验：

```bash
sha256sum vendor/vormio-plugin-sdk-0.0.6-02188f0.tgz
```
