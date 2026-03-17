FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

FROM base AS build
WORKDIR /app
COPY . /app

RUN corepack enable
RUN apk add --no-cache python3 alpine-sdk

# 安装依赖
RUN pnpm install
RUN pnpm install --prod --frozen-lockfile || pnpm install --prod

# 部署 api 到 /prod/api（保持不变）
RUN pnpm deploy --filter="./api" --prod /prod/api

FROM base AS api
WORKDIR /app

# 复制部署好的 api 代码
COPY --from=build --chown=1000:1000 /prod/api /app

# ✅ 删除冗余的 .git 复制行（之前已确认不需要）
# RUN ls -la /app/.git || echo ".git not found before copy"
# COPY --from=build --chown=1000:1000 /app/.git /app/.git
# 重复的 COPY .git 也一并删掉

# 使用非 root 用户
USER 1000

EXPOSE 9000
# ✅ 修正入口文件路径：先确认 /prod/api 部署后的结构，通常入口是 index.js 或在根目录
# 如果 /prod/api 里的入口是 /app/cobalt.js，就用：
CMD [ "node", "cobalt.js" ]
# 如果是 /app/src/cobalt.js，才用：
# CMD [ "node", "src/cobalt.js" ]