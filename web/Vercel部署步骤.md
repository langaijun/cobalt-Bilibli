# 前端部署到 Vercel（一步步做）

API 已用 Railway（`https://cobalt-bilitrans.up.railway.app`），下面只部署**前端**到 Vercel。

---

## 一、代码在 GitHub

在项目根目录执行（若还没推过）：

```bash
cd d:\1\cobalt
git add .
git commit -m "B站下载器 前端"
git push origin main
```

（若仓库在 Gitee，Vercel 也支持，在 Vercel 里选 “Import from Git” 时选 Gitee 即可。）

---

## 二、在 Vercel 里创建项目

1. 打开 **https://vercel.com**，用 GitHub（或 Gitee）登录。

2. 点击 **Add New… → Project**，从仓库列表里选你的 **cobalt** 仓库，点 **Import**。

3. **配置项目（重要）**：
   - **Root Directory**：点 **Edit**，填 **`web`**，回车确认（只部署 web 目录，不要用仓库根目录）。
   - **Framework Preset**：可留空或选 **Other**（我们用自己的 build）。
   - **Build Command**：填 **`pnpm run build`**（或 `pnpm install && pnpm run build`）。
   - **Output Directory**：填 **`build`**。
   - **Install Command**：填 **`pnpm install`**（如没有这一项可跳过，Vercel 一般会自动用 pnpm）。

4. **环境变量**：
   - 在 **Environment Variables** 里添加一条：
     - **Name**：`WEB_DEFAULT_API`
     - **Value**：`https://cobalt-bilitrans.up.railway.app/`（末尾要有 `/`）
     - 环境选 **Production**（以及 Preview 如需要）。

5. 点击 **Deploy**，等构建完成。

---

## 三、部署完成后

- Vercel 会给你一个地址，例如 **`https://cobalt-xxx.vercel.app`**。
- 用浏览器打开这个地址，在输入框里贴 B 站链接，选格式后点下载，能正常用就说明前端已接上 Railway 的 API。

---

## 四、之后改代码

每次 `git push` 到 main（或你绑定的分支），Vercel 会自动重新构建、部署；一般不用再点 Deploy。

---

## 五、可选：用 Vercel CLI 部署

若已安装 Node，可在本机装 Vercel CLI 后从 **web** 目录部署：

```bash
cd d:\1\cobalt\web
pnpm add -g vercel
vercel login
vercel env add WEB_DEFAULT_API
# 按提示输入：https://cobalt-bilitrans.up.railway.app/
vercel --prod
```

按提示选择或创建项目、Root 选当前目录即可。
