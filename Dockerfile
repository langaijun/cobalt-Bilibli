FROM node:24-alpine

WORKDIR /app

# 复制所有项目代码
COPY . .

# 安装系统依赖（解决编译问题）
RUN apk add --no-cache python3 alpine-sdk

# 直接用 NPM 安装（彻底抛弃 pnpm，永不报错）
RUN npm install --production

# 启动命令（你修复好的入口文件）
CMD ["node", "src/cobalt.js"]
