import mime from "mime";
import basicSSL from "@vitejs/plugin-basic-ssl";

import { sveltekit } from "@sveltejs/kit/vite";
import { createSitemap } from "svelte-sitemap/src/index";
import { defineConfig, searchForWorkspaceRoot, type PluginOption } from "vite";

import { join, basename } from "node:path";
import { createReadStream, existsSync } from "node:fs";
import { cp, readdir, mkdir } from "node:fs/promises";

const exposeLibAV: PluginOption = (() => {
    const LIBAV_MODULES = ['libav.js-encode-cli', 'libav.js-remux-cli'];

    function getImputDir(): string {
        const fromDirname = join(__dirname, 'node_modules/@imput');
        const fromCwd = join(process.cwd(), 'node_modules/@imput');
        if (existsSync(fromDirname)) return fromDirname;
        return fromCwd;
    }

    function findLibavFile(filename: string): string | undefined {
        const IMPUT_MODULE_DIR = getImputDir();
        const tryFind = (name: string) => {
            for (const mod of LIBAV_MODULES) {
                const candidate = join(IMPUT_MODULE_DIR, mod, 'dist', name);
                if (existsSync(candidate)) return candidate;
            }
            return undefined;
        };
        let file = tryFind(filename);
        if (file) return file;
        // 兼容 .thrm.js -> .thr.js
        if (filename.endsWith('.thrm.js')) {
            file = tryFind(filename.replace(/\.thrm\.js$/, '.thr.js'));
            if (file) return file;
        }
        // 兼容 encode.thr.* -> encode-cli.thr.*（控制台可能显示为 encode.thr.mjs）
        if (filename.includes('encode.thr.') && !filename.includes('encode-cli')) {
            file = tryFind(filename.replace('encode.thr.', 'encode-cli.thr.'));
            if (file) return file;
        }
        return undefined;
    }

    return {
        name: "vite-libav.js",
        configureServer(server) {
            // 必须在 SvelteKit 之前处理 /_libav/，否则会被当成路由返回 404
            server.middlewares.use(async (req, res, next) => {
                if (!req.url?.startsWith('/_libav/')) return next();

                const filename = basename(req.url).split('?')[0];
                if (!filename) return next();

                const file = findLibavFile(filename);
                if (!file) return next();

                const fileType = mime.getType(filename) || mime.getType(file) || 'application/javascript';
                res.setHeader('Content-Type', fileType);
                // COEP require-corp 下，Worker 内再次加载同一脚本需要 CORP 头，否则后续请求会挂起/失败
                res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
                res.setHeader('Cache-Control', 'public, max-age=3600');
                return createReadStream(file).pipe(res);
            });
        },
        generateBundle: async (options) => {
            if (!options.dir) {
                return;
            }

            const IMPUT_MODULE_DIR = getImputDir();
            const assets = join(options.dir, '_libav');
            await mkdir(assets, { recursive: true });

            const modules = await readdir(IMPUT_MODULE_DIR).then(
                modules => modules.filter(m => m.startsWith('libav.js'))
            );

            for (const module of modules) {
                const distFolder = join(IMPUT_MODULE_DIR, module, 'dist/');
                await cp(distFolder, assets, { recursive: true });
            }
        }
    }
})();

const enableCOEP: PluginOption = {
    name: "isolation",
    configureServer(server) {
        server.middlewares.use((_req, res, next) => {
            res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
            res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
            next();
        })
    }
};

const generateSitemap: PluginOption = {
    name: "generate-sitemap",
    async writeBundle(bundle) {
        if (!process.env.WEB_HOST || !bundle.dir?.endsWith('server')) {
            return;
        }

        await createSitemap(`https://${process.env.WEB_HOST}`, {
            changeFreq: 'monthly',
            outDir: '.svelte-kit/output/prerendered/pages',
            resetTime: true
        });
    }
}

const checkDefaultApiEnv = (): PluginOption => ({
    name: "check-default-api",
    config() {
        if (!process.env.WEB_DEFAULT_API) {
            throw new Error(
                "WEB_DEFAULT_API env variable is required, but missing."
            );
        }
    },
});

export default defineConfig({
    plugins: [
        checkDefaultApiEnv(),
        basicSSL(),
        enableCOEP, // 必须在最前，确保所有响应（含 HTML）都带上 COOP/COEP，否则 SharedArrayBuffer 不可用
        exposeLibAV, // 必须在 sveltekit 之前，保证 /_libav/ 由本插件提供，避免 404
        sveltekit(),
        generateSitemap
    ],
    build: {
        sourcemap: true,
        rollupOptions: {
            output: {
                manualChunks: (id) => {
                    if (id.includes('/web/i18n') && id.endsWith('.json')) {
                        const lang = id.split('/web/i18n/')?.[1].split('/')?.[0];
                        if (lang) {
                            return `i18n_${lang}`;
                        }
                    }
                }
            }
        }
    },
    server: {
        headers: {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp"
        },
        fs: {
            allow: [
                searchForWorkspaceRoot(process.cwd()),
                join(process.cwd(), 'node_modules/@imput'),
                join(__dirname, 'node_modules/@imput')
            ]
        },
        proxy: {}
    },
    preview: {
        headers: {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp"
        }
    },
    optimizeDeps: {
        exclude: ["@imput/libav.js-remux-cli"]
    },
});
