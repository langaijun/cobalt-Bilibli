/**
 * B 站公开收藏夹解析：从收藏夹页面 URL 拉取视频链接列表。
 * 供前端「从收藏夹下载」使用，GET /api/bilibili-favlist?url=...
 */

const BILI_FAV_LIST = "https://api.bilibili.com/x/v3/fav/resource/list";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REFERER = "https://www.bilibili.com/";
const ORIGIN = "https://www.bilibili.com";
import { env } from "../config.js";

function parseFavlistUrl(pageUrl) {
    try {
        const u = new URL(pageUrl);
        if (!u.hostname.includes("bilibili")) return null;
        const pathSegs = u.pathname.split("/").filter(Boolean);
        const pathMid = pathSegs.find((s) => /^\d+$/.test(s));
        const mid = pathMid || u.searchParams.get("mid") || "";
        const fid = u.searchParams.get("fid") || "";
        if (mid && fid) return { mid, fid };
        return null;
    } catch {
        return null;
    }
}

function toMediaId(fid, mid) {
    return String(fid) + String(mid).slice(-2);
}

export async function handleBilibiliFavlist(req, res) {
    const raw = (req.query && req.query.url) ? req.query.url.trim() : "";
    if (!raw) {
        res.status(400).json({ error: "缺少参数 url" });
        return;
    }

    const parsed = parseFavlistUrl(raw);
    if (!parsed) {
        res.status(400).json({
            error: "无法解析收藏夹链接，请使用 space.bilibili.com/xxx/favlist?fid=xxx 格式",
        });
        return;
    }

    const { mid, fid } = parsed;
    const mediaId = toMediaId(fid, mid);
    const urls = [];
    let pn = 1;
    const ps = 20;

    const headers = {
        "User-Agent": UA,
        Referer: REFERER,
        Origin: ORIGIN,
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        Accept: "application/json",
    };
    if (env.biliSessdata) {
        headers.Cookie = `SESSDATA=${env.biliSessdata}`;
    }

    try {
        for (;;) {
            const apiUrl = `${BILI_FAV_LIST}?media_id=${mediaId}&pn=${pn}&ps=${ps}&order=mtime&type=0&platform=web`;
            const apiRes = await fetch(apiUrl, { headers });
            const data = await apiRes.json().catch(() => ({}));

            if (data.code !== 0) {
                if (pn === 1) {
                    res.status(400).json({
                        error: data.message || "收藏夹拉取失败（可能为私密或需要登录）",
                    });
                    return;
                }
                break;
            }

            const list = data.data?.medias ?? data.data?.resources ?? [];
            for (const m of list) {
                const bvid = m.bvid ?? m.bv_id ?? m.id?.bvid;
                if (bvid) urls.push(`https://www.bilibili.com/video/${bvid}`);
            }

            const hasMore = data.data?.has_more ?? (list.length >= ps);
            if (!hasMore) break;
            pn += 1;
        }
    } catch (e) {
        res.status(502).json({ error: "请求 B 站接口失败" });
        return;
    }

    const count = urls.length;
    const body = { urls, count };
    if (count === 0) {
        body.message = "该收藏夹为空或仅登录后可查看（公开收藏夹无需登录）";
    }
    res.json(body);
}
