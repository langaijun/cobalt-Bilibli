import "dotenv/config";

import express from "express";
import cluster from "node:cluster";

import path from "path";
import { fileURLToPath } from "url";

import { env, isCluster } from "./config.js";
import { Red } from "./misc/console-text.js";
import { initCluster } from "./misc/cluster.js";
import { setupEnvWatcher } from "./core/env.js";

const app = express();
const PORT = process.env.PORT || 9000;
const HOST = process.env.API_LISTEN_ADDRESS || '0.0.0.0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename).slice(0, -4);

app.disable("x-powered-by");

// 核心修复：把逻辑包进 async 函数，解决 await 报错
async function startServer() {
    if (env.apiURL) {
        // ✅ 修复：await 现在在 async 函数内，合法
        const { runAPI } = await import("./core/api.js");

        if (isCluster) {
            await initCluster();
        }

        if (env.envFile) {
            setupEnvWatcher();
        }

        runAPI(express, app, __dirname, cluster.isPrimary);

        // ✅ 修复：只保留一次 app.listen()，放在逻辑执行完后
        app.listen(PORT, HOST, () => {
            console.log(`Server running on http://${HOST}:${PORT}`);
        });
    } else {
        console.log(
            Red("API_URL env variable is missing, cobalt api can't start.")
        );
    }
}

// 启动异步函数
startServer().catch((err) => {
    console.error(Red("Server startup failed:"), err);
    process.exit(1); // 启动失败时退出进程
});