FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

FROM base AS build
WORKDIR /app
COPY . /app
#  COPY .git /app/.git  # 强制复制 .git 目录

RUN corepack enable
RUN apk add --no-cache python3 alpine-sdk

# 安装所有依赖（包括开发依赖）
RUN pnpm install

# 安装生产依赖（如果 lockfile 变了，重新生成）
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod

# 部署 api 服务到 /prod/api
#  RUN pnpm deploy --filter=“@imput/cobalt-api” --prod /prod/api
RUN pnpm deploy --filter="./api" --prod /prod/api
RUN ls -la /app/ && ls -la /app/.git || echo ".git not found in build"
FROM base AS api
WORKDIR /app

RUN ls -la /app/.git || echo ".git not found before copy"
COPY --from=build --chown=1000:1000 /app/.git /app/.git
RUN ls -la /app/.git || echo ".git not found after copy"
# 复制部署好的 api 代码
COPY --from=build --chown=1000:1000 /prod/api /app

# 可选：复制 .git 信息（用于版本展示）
# COPY --from=build --chown=1000:1000 /app/.git /app/.git
# 添加这行：复制 .git 目录
COPY --from=build --chown=1000:1000 /app/.git /app/.git

# 使用非 root 用户运行（node 镜像默认 uid 1000）
USER 1000

EXPOSE 9000
CMD [ "node", "src/cobalt.js" ]  # 确认入口文件是 cobalt.js 还是 cobalt

