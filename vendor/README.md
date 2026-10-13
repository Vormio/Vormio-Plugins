# vendor

Vormio-Core 发布的插件 SDK 打包产物。本仓库只通过这里的固定版本使用 SDK，不导入 Core 源码，也不依赖同级检出。

| 文件                          | 版本  | 来源                                                                        | SHA-256                                                            |
| ----------------------------- | ----- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `vormio-plugin-sdk-0.0.3.tgz` | 0.0.3 | Vormio-Core `780e04b5f8aa39648c704167285bf498a2a4ab32`，`pnpm run sdk:pack` | `62e6d4697eca3d5f952476c978c676ce1fa4fd0e3944b25de9ebb1c2df6deb92` |

- 0.0.3 由 Core 提交 `780e04b`（Add 0.0.3 composition and relationships (host side)，分支 `feat/0.0.3-composition`）在干净的工作区中构建，2026-10-13 由 Core 会话交付，复制到这里并校验了 SHA-256。替换了 0.0.2（Core `a24364d`）。
- 插件契约仍是 `apiVersion: 1`。0.0.3 新增可选的分析器扩展点（`contributions.analyzers`、`analyzer()`、组成报告的 schema 与 `parseReport`），并声明 `"sideEffects": false`。
- 宿主只加载与自己相同 `apiVersion` 的插件。
- 更新时：在 Core 运行 `pnpm run sdk:pack`，把新的 tarball 复制到这里，更新上表（Core 提交号、SHA-256）、各 `package.json` 中的 `file:` 路径与锁文件，删除不再使用的旧 tarball。

校验：

```bash
sha256sum vendor/vormio-plugin-sdk-0.0.3.tgz
```
