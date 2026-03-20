import { genericUserAgent, env } from "../../config.js";
import { resolveRedirectingURL } from "../url.js";

// TO-DO: higher quality downloads (currently requires an account)

function getBest(content) {
    return content?.filter(v => v.baseUrl || v.url)
                .map(v => (v.baseUrl = v.baseUrl || v.url, v))
                .reduce((a, b) => a?.bandwidth > b?.bandwidth ? a : b);
}

function extractBestQuality(dashData) {
    const bestVideo = getBest(dashData.video),
          bestAudio = getBest(dashData.audio);

    if (!bestVideo || !bestAudio) return [];
    return [ bestVideo, bestAudio ];
}

const bilibiliHeaders = {
    "user-agent": genericUserAgent,
    "referer": "https://www.bilibili.com/"
};

function viewMeta(viewRes) {
    const d = viewRes?.data;
    if (!d) return { title: "", author: "" };
    return {
        title: typeof d.title === "string" ? d.title : "",
        author: d.owner?.name && typeof d.owner.name === "string" ? d.owner.name : "",
    };
}

function filenameAttributesFor(id, video, meta) {
    return {
        service: "bilibili",
        id,
        title: meta.title || id,
        author: meta.author || "",
        resolution: `${video.width || 0}x${video.height || 0}`,
        extension: "mp4",
    };
}

function fileMetadataFrom(meta) {
    if (!meta.title && !meta.author) return undefined;
    return {
        title: meta.title || undefined,
        artist: meta.author || undefined,
    };
}

/** 当页面无 __playinfo__ 时，用 B 站官方 API 获取 cid + playurl（dash） */
async function com_download_via_api(id, partId) {
    const viewUrl = new URL("https://api.bilibili.com/x/web-interface/view");
    viewUrl.searchParams.set("bvid", id);

    const viewRes = await fetch(viewUrl, { headers: bilibiliHeaders }).then(r => r.json()).catch(() => ({}));
    const pages = viewRes?.data?.pages;
    if (!pages?.length) return { error: "fetch.empty" };

    const pageIndex = partId ? Math.max(0, parseInt(partId, 10) - 1) : 0;
    const cid = pages[pageIndex]?.cid;
    if (!cid) return { error: "fetch.empty" };

    const playUrl = new URL("https://api.bilibili.com/x/player/playurl");
    playUrl.searchParams.set("bvid", id);
    playUrl.searchParams.set("cid", String(cid));
    playUrl.searchParams.set("fnval", "16");  // dash
    playUrl.searchParams.set("fnver", "0");
    playUrl.searchParams.set("fourk", "0");

    const playRes = await fetch(playUrl, { headers: bilibiliHeaders }).then(r => r.json()).catch(() => ({}));
    const dash = playRes?.data?.dash;
    if (!dash?.video?.length || !dash?.audio?.length) return { error: "fetch.empty" };

    const norm = (arr) => arr.map((v) => ({ ...v, baseUrl: v.base_url || v.baseUrl, url: v.base_url || v.baseUrl }));
    const [ video, audio ] = extractBestQuality({
        video: norm(dash.video),
        audio: norm(dash.audio)
    });
    if (!video || !audio) return { error: "fetch.empty" };

    const videoUrl = video.baseUrl || video.url;
    const audioUrl = audio.baseUrl || audio.url;
    if (!videoUrl || !audioUrl) return { error: "fetch.empty" };

    const duration = (video.duration || audio.duration || 0) / 1000;
    if (duration > env.durationLimit) return { error: "content.too_long" };

    const meta = viewMeta(viewRes);
    let filenameBase = `bilibili_${id}`;
    if (partId) filenameBase += `_${partId}`;

    return {
        urls: [videoUrl, audioUrl],
        audioFilename: `${filenameBase}_audio`,
        filename: `${filenameBase}_${video.width || 0}x${video.height || 0}.mp4`,
        filenameAttributes: filenameAttributesFor(id, video, meta),
        fileMetadata: fileMetadataFrom(meta),
    };
}

async function com_download(id, partId) {
    const url = new URL(`https://bilibili.com/video/${id}`);

    if (partId) {
        url.searchParams.set('p', partId);
    }

    const html = await fetch(url, {
        headers: { "user-agent": genericUserAgent }
    })
    .then(r => r.text())
    .catch(() => {});

    if (!html) {
        return { error: "fetch.fail" }
    }

    const hasPlayinfo = html.includes('<script>window.__playinfo__=') && html.includes('"video_codecid"');
    if (!hasPlayinfo) {
        return com_download_via_api(id, partId);
    }

    const streamData = JSON.parse(
        html.split('<script>window.__playinfo__=')[1].split('</script>')[0]
    );

    if (streamData.data.timelength > env.durationLimit * 1000) {
        return { error: "content.too_long" };
    }

    const [ video, audio ] = extractBestQuality(streamData.data.dash);
    if (!video || !audio) {
        return { error: "fetch.empty" };
    }

    const viewUrl = new URL("https://api.bilibili.com/x/web-interface/view");
    viewUrl.searchParams.set("bvid", id);
    const viewResForMeta = await fetch(viewUrl, { headers: bilibiliHeaders }).then(r => r.json()).catch(() => ({}));
    const meta = viewMeta(viewResForMeta);

    let filenameBase = `bilibili_${id}`;
    if (partId) {
        filenameBase += `_${partId}`;
    }

    return {
        urls: [video.baseUrl, audio.baseUrl],
        audioFilename: `${filenameBase}_audio`,
        filename: `${filenameBase}_${video.width}x${video.height}.mp4`,
        filenameAttributes: filenameAttributesFor(id, video, meta),
        fileMetadata: fileMetadataFrom(meta),
    };
}

async function tv_download(id) {
    const url = new URL(
        'https://api.bilibili.tv/intl/gateway/web/playurl'
        + '?s_locale=en_US&platform=web&qn=64&type=0&device=wap'
        + '&tf=0&spm_id=bstar-web.ugc-video-detail.0.0&from_spm_id='
    );

    url.searchParams.set('aid', id);

    const { data } = await fetch(url).then(a => a.json());
    if (!data?.playurl?.video) {
        return { error: "fetch.empty" };
    }

    const [ video, audio ] = extractBestQuality({
        video: data.playurl.video.map(s => s.video_resource)
                                 .filter(s => s.codecs.includes('avc1')),
        audio: data.playurl.audio_resource
    });

    if (!video || !audio) {
        return { error: "fetch.empty" };
    }

    if (video.duration > env.durationLimit * 1000) {
        return { error: "content.too_long" };
    }

    return {
        urls: [video.url, audio.url],
        audioFilename: `bilibili_tv_${id}_audio`,
        filename: `bilibili_tv_${id}.mp4`
    };
}

export default async function({ comId, tvId, comShortLink, partId }) {
    if (comShortLink) {
        const patternMatch = await resolveRedirectingURL(`https://b23.tv/${comShortLink}`);
        comId = patternMatch?.comId;
    }

    if (comId) {
        return com_download(comId, partId);
    } else if (tvId) {
        return tv_download(tvId);
    }

    return { error: "fetch.fail" };
}
