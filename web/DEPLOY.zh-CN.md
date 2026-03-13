# Cobalt 中文版 - 部署说明

## 构建

```bash
cd web
pnpm install
pnpm run build
```

构建产物在 `build/` 目录（含 `_libav/` 等静态资源）。

## 环境变量

构建前在 `web/.env` 中配置（或 CI 中设置）：

| 变量 | 必填 | 说明 |
|------|------|------|
| `WEB_DEFAULT_API` | 是 | 默认处理 API 地址，如 `https://your-api.example.com` 或官方 `https://api.cobalt.tools` |
| `WEB_HOST` | 否 | 站点域名，用于 sitemap、og:url 等 |
| `WEB_PLAUSIBLE_ENABLED` | 否 | 是否启用 Plausible 统计 |
| `WEB_PLAUSIBLE_HOST` | 否 | Plausible 脚本域名（若启用） |

## 部署到 Vercel

1. 将仓库连接 Vercel，根目录选 **web**（或 monorepo 下指定 `web` 为根）。
2. 构建命令：`pnpm run build`（或 `pnpm install && pnpm run build`）。
3. 输出目录：`build`。
4. 在 Vercel 项目 **Environment Variables** 中配置 `WEB_DEFAULT_API` 等。
5. 根目录下的 `vercel.json` 已配置 **COOP/COEP** 响应头，用于本地转码（ffmpeg Worker）所需。

部署完成后访问站点，在 **设置 → 外观 → 语言** 中可选择「简体中文」。

## 其他静态托管（Netlify / 自建）

- **Netlify**：在项目根（或 web）添加 `netlify.toml`：

```toml
[build]
  command = "pnpm run build"
  publish = "build"

[[headers]]
  for = "/*"
  [headers.values]
    Cross-Origin-Opener-Policy = "same-origin"
    Cross-Origin-Embedder-Policy = "require-corp"
```

- **Nginx**：在 `location /` 中增加：

```nginx
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
```

**注意**：未设置 COOP/COEP 时，本地处理队列（转码/重封装）可能报「couldn't start a processing worker」。

## 预览

本地预览构建结果：

```bash
pnpm run preview
```

访问输出的本地地址（如 `https://localhost:4173`），COEP 头已在 `vite.config.ts` 的 preview 中配置。
