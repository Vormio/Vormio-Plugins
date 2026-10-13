# vendor

Vormio-Core 发布的插件 SDK 打包产物。本仓库只通过这里的固定版本使用 SDK，不导入 Core 源码，也不依赖同级检出。

| 文件                          | 版本  | 来源                                                                        | SHA-256                                                            |
| ----------------------------- | ----- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `vormio-plugin-sdk-0.0.2.tgz` | 0.0.2 | Vormio-Core `a24364de9a2edb3eaa66868b037c5bdd8046f605`，`pnpm run sdk:pack` | `85257ff64f9bcee0a5bdaba6269fb4c4af67fc4b670596c6db9d46c3b81b0156` |

- 0.0.2 由 Core 提交 `a24364d`（Add the 0.0.2 plugin container (host side)）在干净的工作区中构建，2026-10-13 复制到这里。
- 插件契约 `apiVersion: 1`；宿主只加载相同 `apiVersion` 的插件。
- 更新时：在 Core 运行 `pnpm run sdk:pack`，把新的 tarball 复制到这里，更新上表（Core 提交号、SHA-256）、各 `package.json` 中的 `file:` 路径与锁文件，删除不再使用的旧 tarball。

校验：

```bash
sha256sum vendor/vormio-plugin-sdk-0.0.2.tgz
```
