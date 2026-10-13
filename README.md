# Vormio-Plugins

Vormio 的官方插件：为宿主提供格式识别、专业预览、组成与引用解析以及诊断。插件只读取宿主授予的文件，不修改用户文件。

## 插件

| 插件                                | ID                    | 版本  | 能力                                   |
| ----------------------------------- | --------------------- | ----- | -------------------------------------- |
| [glTF 模型](plugins/gltf/README.md) | `vormio-plugins.gltf` | 0.2.0 | 缩略图、三维查看器、组成与引用关系分析 |

各插件的 README 写明支持的格式与版本、能力、不支持的情况以及第三方依赖的许可证。

## 链接

- 开发说明（目录、构建、测试、依赖）：[docs/development.md](docs/development.md)
- 插件规划：[docs/roadmap.md](docs/roadmap.md)
- 插件 SDK 来源记录：[vendor/README.md](vendor/README.md)

## 约定

- 插件 ID 形如 `vormio-plugins.<名称>`；每个插件位于 `plugins/<名称>/`。
- 版本号遵循 semver，`manifest.json` 与插件 `package.json` 的版本保持一致。
- 只使用 `vendor/` 中固定版本的 plugin-sdk 打包产物，不依赖 Vormio-Core 源码。
- 插件不访问网络、任意路径或本地进程；解码器等二进制随插件包分发。
- 测试素材放在 `fixtures/`，每份都记录来源与许可证。

## 开发

需要 Node 24.21 与 pnpm 12.6（通过 Corepack）。

```bash
pnpm install --frozen-lockfile
```

```bash
pnpm run dev gltf
```

在 Vormio 的“插件”页选择“添加开发目录…”，指向 `dist/gltf` 并在资源库中启用；每次构建后插件会自动重载。提交前运行 `pnpm run lint`、`pnpm run typecheck` 与 `pnpm test`。打包用 `pnpm run package <插件>`，产物在 `artifacts/`。

## 许可证

[MIT](LICENSE)。插件包中包含的第三方代码保留各自的许可证，见各插件的 README。
