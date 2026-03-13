# 用本地改过的 API 一步步部署

这里说的「本地」= 你本仓库里改过的 API（B站分片、超时、TUNNEL_LIFESPAN 等）。部署后 API 跑在 Railway，前端跑在 Vercel，但用的都是你这套代码。

---

## 第一步：把代码推到 GitHub

1. 打开终端，进入项目目录：
   ```bash
   cd d:\1\cobalt
   ```

2. 看下有没有未提交的修改：
   ```bash
   git status
   ```

3. 若有修改，全部提交并推送（若还没有远程仓库，先到 GitHub 建一个空仓库，再执行下面的 `git remote add`）：
   ```bash
   git add .
   git commit -m "B站下载器：前端极简版 + API 超时与 B站 分片"
   git remote add origin https://github.com/你的用户名/cobalt.git
   git push -u origin main
   ```
   （若已经 add 过 remote，只做 `git push` 即可。）

4. 到 GitHub 网页上确认：`api/src/stream/proxy.js`、`api/src/stream/internal.js`、`api/.env.example`（若有）和 `web` 下的修改都在。

**做完第一步后**：代码已经在 GitHub，后面两步都从「你的仓库」部署，用的就是本地这套 API。

---

## 第二步：在 Railway 部署 API（用你的仓库，不用模板）

1. 打开 **https://railway.com**，用 GitHub 登录。

2. **New Project** → **Deploy from GitHub repo**，选择你刚推送的 **cobalt** 仓库（你的 fork，不是官方 imputnet/cobalt）。

3. 部署方式选 **Dockerfile**（用仓库根目录的 `Dockerfile`），端口保持 **9000**，并打开 **Public Networking**，让 Railway 分配一个公网域名。

4. 部署完成后，在 **Settings → Networking** 里看到公网地址，例如：
   `https://cobalt-xxx.up.railway.app`

5. 在 **Variables** 里添加（或修改）环境变量：

   | 变量名 | 值 |
   |--------|-----|
   | `API_URL` | `https://上面看到的公网地址/`（末尾加 `/`） |
   | `TUNNEL_LIFESPAN` | `600`（可选，和本地一致，10 分钟） |

6. 保存后若 Railway 提示重新部署，点一次 **Redeploy**。

7. 记下当前 API 的最终地址，例如：**`https://cobalt-xxx.up.railway.app`**，后面给前端用。

**做完第二步后**：API 已经是「本地改过的版本」，跑在 Railway 上。

---

## 第三步：在 Vercel 部署前端

1. 打开 **https://vercel.com**，用 GitHub 登录。

2. **Add New… → Project**，选择同一个 **cobalt** 仓库，**Import**。

3. 配置项目：
   - **Root Directory**：点 **Edit**，填 **`web`**，回车。
   - **Build Command**：`pnpm run build`
   - **Output Directory**：`build`
   - **Install Command**：`pnpm install`（没有可留空）

4. 在 **Environment Variables** 里添加：
   - **Name**：`WEB_DEFAULT_API`
   - **Value**：第二步里记下的 API 地址，末尾加 `/`，例如：  
     `https://cobalt-xxx.up.railway.app/`

5. 点 **Deploy**，等构建完成。

6. 部署完成后会得到一个前端地址，例如：**`https://cobalt-xxx.vercel.app`**。

**做完第三步后**：前端在 Vercel，请求会发到你 Railway 上部署的「本地版」API。

---

## 第四步：自测

1. 浏览器打开第三步的前端地址（Vercel 给的链接）。
2. 输入一个 B 站视频链接，选 视频 MP4 或 音频 MP3，点下载。
3. 能正常解析并开始下载，说明：前端 → 你部署的 API（本地改过的代码）→ B 站，整条链已通。

若某一步报错，把报错页面或终端输出贴出来，再按报错排查即可。

---

## 小结

| 步骤 | 做什么 | 结果 |
|------|--------|------|
| 一 | 本地代码推到 GitHub | 仓库里是「本地改过的」API + 前端 |
| 二 | Railway 从 **你的 GitHub 仓库** 部署，用 Dockerfile | API = 本地版，跑在 Railway |
| 三 | Vercel 从同一仓库部署 **web** 目录，`WEB_DEFAULT_API` 填 Railway 的 API 地址 | 前端用你的 API |
| 四 | 浏览器打开 Vercel 链接试下 B 站链接 | 确认整条链正常 |

这样用的就是「本地的」那一套 API 逻辑，只是运行在 Railway 上，而不是你电脑上。
