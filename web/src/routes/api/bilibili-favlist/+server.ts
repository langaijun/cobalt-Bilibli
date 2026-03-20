import { json } from "@sveltejs/kit";

const BILI_FAV_LIST = "https://api.bilibili.com/x/v3/fav/resource/list";
const BILI_FOLDER_CREATED = "https://api.bilibili.com/x/v3/fav/folder/created/list";
const BILI_FOLDER_COLLECTED = "https://api.bilibili.com/x/v3/fav/folder/collected/list";
const BILI_VIEW_API = "https://api.bilibili.com/x/web-interface/view";
const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const REFERER = "https://www.bilibili.com/";
const ORIGIN = "https://www.bilibili.com";
const VIEW_CONCURRENCY = 4;
const VIEW_SLEEP_MS = 300;
const MAX_RESOURCE_PAGES = 500;
const MAX_FOLDER_PAGES = 50;

function parseFavlistUrl(pageUrl: string): { mid: string; fid: string } | null {
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

function toMediaIdLegacy(fid: string, mid: string): string {
	return String(fid) + String(mid).slice(-2);
}

async function resolveMediaId(
	mid: string,
	fidTarget: string,
	headers: Record<string, string>
): Promise<string> {
	const target = String(fidTarget);

	async function scanFolders(listUrl: string): Promise<string | null> {
		let pn = 1;
		const ps = 100;
		for (let page = 0; page < MAX_FOLDER_PAGES; page++) {
			const u = new URL(listUrl);
			u.searchParams.set("up_mid", mid);
			u.searchParams.set("pn", String(pn));
			u.searchParams.set("ps", String(ps));
			u.searchParams.set("platform", "web");
			const data = await fetch(u, { headers }).then((r) => r.json()).catch(() => ({}));
			if (data.code !== 0) return null;
			const folders: { id?: number; fid?: number }[] = data.data?.list || [];
			for (const f of folders) {
				if (String(f.fid) === target) return String(f.id);
				if (String(f.id) === target) return String(f.id);
			}
			if (!data.data?.has_more) break;
			pn += 1;
		}
		return null;
	}

	let mediaId = await scanFolders(BILI_FOLDER_CREATED);
	if (mediaId) return mediaId;
	mediaId = await scanFolders(BILI_FOLDER_COLLECTED);
	if (mediaId) return mediaId;
	return toMediaIdLegacy(fidTarget, mid);
}

async function fetchAllFavResources(
	mediaId: string,
	headers: Record<string, string>,
	order: string
): Promise<{ urls: string[]; error?: string }> {
	const urls: string[] = [];
	let pn = 1;
	/** 与 B 站网页收藏夹列表每页条数对齐 */
	const ps = 40;

	for (let page = 0; page < MAX_RESOURCE_PAGES; page++) {
		const apiUrl = new URL(BILI_FAV_LIST);
		apiUrl.searchParams.set("media_id", mediaId);
		apiUrl.searchParams.set("pn", String(pn));
		apiUrl.searchParams.set("ps", String(ps));
		apiUrl.searchParams.set("order", order);
		apiUrl.searchParams.set("type", "0");
		apiUrl.searchParams.set("platform", "web");

		const data = await fetch(apiUrl, { headers }).then((r) => r.json()).catch(() => ({}));

		if (data.code !== 0) {
			if (pn === 1) {
				return { urls: [], error: data.message || "收藏夹拉取失败" };
			}
			break;
		}

		const list = data.data?.medias ?? data.data?.resources ?? [];
		if (list.length === 0) break;

		for (const m of list) {
			const bvid = m.bvid ?? m.bv_id ?? m.id?.bvid;
			if (bvid) urls.push(`https://www.bilibili.com/video/${bvid}`);
		}

		if (list.length < ps) {
			if (data.data?.has_more) {
				pn += 1;
				continue;
			}
			break;
		}
		pn += 1;
	}

	return { urls };
}

export async function GET({ url: reqUrl }) {
	const raw = reqUrl.searchParams.get("url")?.trim();
	if (!raw) {
		return json({ error: "缺少参数 url" }, { status: 400 });
	}

	const parsed = parseFavlistUrl(raw);
	if (!parsed) {
		return json(
			{ error: "无法解析收藏夹链接，请使用 space.bilibili.com/xxx/favlist?fid=xxx 格式" },
			{ status: 400 }
		);
	}

	const { mid, fid } = parsed;
	const orderParam = reqUrl.searchParams.get("order") || "";
	const order = ["manual", "mtime", "view"].includes(orderParam) ? orderParam : "manual";
	const validate =
		reqUrl.searchParams.get("validate") === "1" || reqUrl.searchParams.get("validate") === "true";

	const headers: Record<string, string> = {
		"User-Agent": UA,
		Referer: REFERER,
		Origin: ORIGIN,
		"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
		Accept: "application/json",
	};

	const sess = typeof process !== "undefined" ? process.env.BILI_SESSDATA : undefined;
	if (sess) {
		headers.Cookie = `SESSDATA=${sess}`;
	}

	try {
		const mediaId = await resolveMediaId(mid, fid, headers);
		let { urls, error } = await fetchAllFavResources(mediaId, headers, order);
		if (error && order === "manual") {
			({ urls, error } = await fetchAllFavResources(mediaId, headers, "mtime"));
		}
		if (error) {
			return json({ error }, { status: 400 });
		}

		if (urls.length === 0) {
			const legacyId = toMediaIdLegacy(fid, mid);
			if (legacyId !== mediaId) {
				const second = await fetchAllFavResources(legacyId, headers, "mtime");
				if (!second.error && second.urls.length > 0) urls = second.urls;
			}
		}

		let finalUrls = urls;
		let invalidCount = 0;

		if (urls.length > 0 && validate) {
			const bvids = [
				...new Set(
					urls
						.map((u) => (u.match(/\/video\/(BV[0-9A-Za-z]{10})/) || [])[1])
						.filter(Boolean) as string[]
				),
			];
			const valid: string[] = [];
			let i = 0;
			async function viewWorker() {
				while (i < bvids.length) {
					const bv = bvids[i++];
					try {
						const viewRes = await fetch(`${BILI_VIEW_API}?bvid=${bv}`, {
							headers: { ...headers, Accept: "application/json" },
						});
						const viewData = await viewRes.json().catch(() => ({}));
						if (viewData && viewData.code === 0) {
							valid.push(`https://www.bilibili.com/video/${bv}`);
						}
					} catch {
						/* ignore */
					}
					await new Promise((r) => setTimeout(r, VIEW_SLEEP_MS));
				}
			}
			await Promise.all(Array.from({ length: VIEW_CONCURRENCY }, viewWorker));
			finalUrls = valid;
			invalidCount = bvids.length - valid.length;
		}

		const count = finalUrls.length;
		const body: Record<string, unknown> = { urls: finalUrls, count };
		if (invalidCount > 0) body.invalidCount = invalidCount;
		if (count === 0) {
			body.message = "该收藏夹为空或仅登录后可查看（公开收藏夹无需登录）";
			if (invalidCount > 0) {
				body.message = `经 view 校验后无有效视频（共 ${invalidCount} 个无效/下架）`;
			}
		}
		return json(body);
	} catch {
		return json({ error: "请求 B 站接口失败" }, { status: 502 });
	}
}
