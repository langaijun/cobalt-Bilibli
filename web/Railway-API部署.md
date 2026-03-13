# 把 Cobalt API 部署到 Railway

[Railway](https://railway.com/) 可以跑 Docker 或 Node，适合部署 Cobalt API。部署后你会得到一个公网 API 地址（如 `https://xxx.railway.app`），前端里的 **WEB_DEFAULT_API** 填这个地址即可。

---

## 一、前置准备

1. 代码在 **GitHub** 上（Railway 用 GitHub 连仓库）。
2. 本地已把项目推到 GitHub，例如：
   ```bash
   cd d:\1\cobalt
   git add .
   git commit -m "B站下载器"
   git remote add origin https://github.com/你的用户名/cobalt.git
   git push -u origin main
   ```

---

## 二、在 Railway 创建项目并部署 API

1. **打开 Railway**  
   访问 [railway.com](https://railway.com/)，用 GitHub 登录。

2. **New Project → Deploy from GitHub repo**  
   选中你的 **cobalt** 仓库（整仓，不要只选 `api` 目录）。

3. **用 Dockerfile 部署（推荐）**  
   - 仓库根目录已有 `Dockerfile`，Railway 一般会自动识别并用 Docker 构建。  
   - 若没有自动识别：在项目 **Settings** 里把 **Builder** 设为 **Dockerfile**，Dockerfile 路径留空（用根目录的 `Dockerfile`）。

4. **端口**  
   - Dockerfile 里已 `EXPOSE 9000`，Railway 会暴露该端口。  
   - 若需要手动设：在 Service 的 **Settings → Networking** 里把 **Public Networking** 打开，端口填 **9000**。

5. **环境变量**  
   在 Service 的 **Variables** 里添加：

   | 变量名   | 值 |
   |----------|----|
   | `API_URL` | 先填 `https://你的服务名.railway.app`（见下） |

   **API_URL 怎么填：**  
   - 第一次部署后，Railway 会给你一个公网地址，例如 `https://cobalt-api-production-xxxx.up.railway.app`。  
   - 把 **API_URL** 设成这个地址，末尾加 `/`，例如：  
     `https://cobalt-api-production-xxxx.up.railway.app/`  
   - 保存后触发一次重新部署（Redeploy），否则隧道/下载链接可能不对。

6. **部署**  
   保存设置后 Railway 会自动构建并部署。  
   在 **Deployments** 里看日志，没有报错即表示 API 已跑在 9000 端口。

---

## 三、拿到 API 地址并给前端用

1. 在 Railway 该 Service 的 **Settings → Networking → Public Domain** 里可以看到公网域名，例如：  
   `https://xxx.up.railway.app`

2. **API 自用**  
   - 把 **API_URL** 设为这个地址（末尾加 `/`），保存并 Redeploy 一次。  
   - 之后前端请求的「当前 API」就是这个 Railway 地址。

3. **前端接上 Railway API**  
   - **本地**：在 `web/.env` 里写：  
     `WEB_DEFAULT_API=https://xxx.up.railway.app/`  
   - **Vercel**：在项目 **Environment Variables** 里加：  
     `WEB_DEFAULT_API` = `https://xxx.up.railway.app/`  
   然后重新部署前端。

这样，前端用的就是你在 Railway 上部署的 API。

---

## 四、可选：限制用量与访问

- **用量**：Railway 按使用量计费，可在 Dashboard 里设 **Spending Limit**，防止超支。  
- **仅自己的前端可调 API**：在 API 环境变量里配置 **CORS_URL** 为你的前端域名（如 `https://你的站点.vercel.app`），并视需要配合 [保护实例](https://github.com/imputnet/cobalt/blob/main/docs/protect-an-instance.md)（Turnstile / API Key 等）。

---

## 五、小结

| 步骤 | 说明 |
|------|------|
| 1 | GitHub 上有 cobalt 仓库 |
| 2 | Railway 从该仓库 Deploy，用根目录 Dockerfile |
| 3 | 端口 9000，Public Network 打开 |
| 4 | 环境变量 **API_URL** = 部署后的公网地址（末尾 `/`） |
| 5 | 前端 **WEB_DEFAULT_API** 填同一地址 |

这样 API 就配置在 [Railway](https://railway.com/) 上，前端（Vercel 或本地）指向这个地址即可使用。
