import { json } from "@sveltejs/kit";

const BILI_FAV_LIST = "https://api.bilibili.com/x/v3/fav/resource/list";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFERER = "https://www.bilibili.com/";

/** 从收藏夹页面 URL 解析 mid 和 fid */
function parseFavlistUrl(pageUrl: string): { mid: string; fid: string } | null {
	try {
		const u = new URL(pageUrl);
		if (!u.hostname.includes("bilibili")) return null;
		// space.bilibili.com/3537108801161713/favlist?fid=2634483913 -> mid 为路径第一段数字
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

/** media_id = fid + mid 末 2 位（B 站收藏夹 API 约定） */
function toMediaId(fid: string, mid: string): string {
	return String(fid) + String(mid).slice(-2);
}

export async function GET({ url: reqUrl }) {
	const raw = reqUrl.searchParams.get("url")?.trim();
	if (!raw) {
		return json({ error: "缺少参数 url" }, { status: 400 });
	}

	const parsed = parseFavlistUrl(raw);
	if (!parsed) {
		return json({ error: "无法解析收藏夹链接，请使用 space.bilibili.com/xxx/favlist?fid=xxx 格式" }, { status: 400 });
	}

	const { mid, fid } = parsed;
	const mediaId = toMediaId(fid, mid);
	const urls: string[] = [];
	let pn = 1;
	const ps = 20;

	const headers: Record<string, string> = {
		"User-Agent": UA,
		Referer: REFERER,
	};

	// 公开收藏夹可无 Cookie 拉取；若需私密收藏夹，需在后续支持传入 Cookie
	try {
		for (;;) {
			const apiUrl = `${BILI_FAV_LIST}?media_id=${mediaId}&pn=${pn}&ps=${ps}&order=mtime&type=0&platform=web`;
			const res = await fetch(apiUrl, { headers });
			const data = await res.json().catch(() => ({}));

			if (data.code !== 0) {
				if (pn === 1) {
					return json(
						{ error: data.message || "收藏夹拉取失败（可能为私密或需要登录）" },
						{ status: 400 }
					);
				}
				break;
			}

			const list = data.data?.medias || [];
			for (const m of list) {
				const bvid = m.bvid || m.id?.bvid;
				if (bvid) urls.push(`https://www.bilibili.com/video/${bvid}`);
			}

			if (!data.data?.has_more) break;
			pn += 1;
		}
	} catch (e) {
		return json({ error: "请求 B 站接口失败" }, { status: 502 });
	}

	return json({ urls, count: urls.length });
}
