FROM node:24-alpine

WORKDIR /app

# 复制所有项目代码
COPY . .

# 安装系统依赖（解决编译问题）
RUN apk add --no-cache python3 alpine-sdk

# 启用 corepack 并用正确语法安装 pnpm（Node 24 中需用 prepare --activate 或 install -g）
RUN corepack enable
RUN corepack prepare pnpm@9.12.2 --activate

# 使用 pnpm 安装依赖（与 pnpm-lock.yaml 一致）
RUN pnpm install --frozen-lockfile --prod

# 入口在 api 子目录
WORKDIR /app/api

EXPOSE 9000

CMD ["node", "src/cobalt.js"]
