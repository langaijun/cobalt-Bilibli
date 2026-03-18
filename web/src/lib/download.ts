import { get } from "svelte/store";

import settings from "$lib/state/settings";

import { device } from "$lib/device";
import { t } from "$lib/i18n/translations";
import { createDialog } from "$lib/state/dialogs";

import type { DialogInfo } from "$lib/types/dialog";
import type { CobaltFileUrlType } from "$lib/types/api";

type DownloadFileParams = {
    url?: string,
    file?: File,
    urlType?: CobaltFileUrlType,
}

type SavingDialogParams = {
    url?: string,
    file?: File,
    body?: string,
    urlType?: CobaltFileUrlType,
}

const openSavingDialog = ({ url, file, body, urlType }: SavingDialogParams) => {
    const dialogData: DialogInfo = {
        type: "saving",
        id: "saving",
        file,
        url,
        urlType,
    }
    if (body) dialogData.bodyText = body;

    createDialog(dialogData)
}

export const openFile = (file: File) => {
    const a = document.createElement("a");
    const url = URL.createObjectURL(file);

    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const shareFile = async (file: File) => {
    return await navigator?.share({
        files: [ file ],
    });
}

export const openURL = (url: string) => {
    if (!['http:', 'https:'].includes(new URL(url).protocol)) {
        return alert('error: invalid url!');
    }

    const open = window.open(url, "_blank", "noopener,noreferrer");

    /* if new tab got blocked by user agent, show a saving dialog */
    if (!open) {
        return openSavingDialog({
            url,
            body: get(t)("dialog.saving.blocked")
        });
    }
}

/** 从 Content-Disposition 头解析文件名 */
function filenameFromContentDisposition(header: string | null): string | undefined {
    if (!header) return undefined;
    const m = header.match(/filename\*?=(?:UTF-8'')?["']?([^"'\s;]+)["']?/i) || header.match(/filename=["']?([^"'\s;]+)["']?/i);
    return m ? decodeURIComponent(m[1].trim()) : undefined;
}

/**
 * 通过 fetch 拉取 URL 为 blob 并用 <a download> 触发下载，不依赖 window.open，批量/延迟场景下不会触发弹窗拦截。
 * 用于 tunnel 等跨域直链，避免「选择保存方式」弹窗。
 */
export function downloadUrlAsBlob(url: string, suggestedFilename?: string): Promise<void> {
    return fetch(url, { mode: "cors", credentials: "omit" })
        .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const disposition = res.headers.get("Content-Disposition");
            const name = filenameFromContentDisposition(disposition) || suggestedFilename || "download";
            return res.blob().then((blob) => ({ blob, name }));
        })
        .then(({ blob, name }) => {
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = blobUrl;
            a.download = name;
            a.click();
            setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
        });
}

export const shareURL = async (url: string) => {
    return await navigator?.share({ url });
}

export const copyURL = async (url: string) => {
    return await navigator?.clipboard?.writeText(url);
}

export const downloadFile = ({ url, file, urlType }: DownloadFileParams) => {
    if (!url && !file) throw new Error("attempted to download void");

    const pref = get(settings).save.savingMethod;

    if (pref === "ask") {
        return openSavingDialog({ url, file, urlType });
    }

    /* 所有 URL 下载都优先用 fetch+blob，不依赖 window.open，避免「新标签页被拦截」弹窗 */
    if (url && pref === "download") {
        downloadUrlAsBlob(url).catch(() => {
            openSavingDialog({
                url,
                urlType,
                body: get(t)("dialog.saving.timeout"),
            });
        });
        return;
    }

    /*
        user actions (such as invoke share, open new tab) have expiration.
        in webkit, for example, that timeout is 5 seconds.
        https://github.com/WebKit/WebKit/blob/b838f8bb/Source/WebCore/page/LocalDOMWindow.cpp#L167

        navigator.userActivation.isActive makes sure that we're still able to
        invoke an action without the user agent interrupting it.
        if not, we show a saving dialog for user to re-invoke that action.

        if browser is old or doesn't support this API, we just assume that it expired.
    */
    if (!navigator?.userActivation?.isActive) {
        return openSavingDialog({
            url,
            file,
            body: get(t)("dialog.saving.timeout"),
            urlType
        });
    }

    try {
        if (file) {
            // 256mb cuz ram limit per tab is 384mb,
            // and other stuff (such as libav) might have used some ram too
            const iosFileShareSizeLimit = 1024 * 1024 * 256;

            // this is required because we can't share big files
            // on ios due to a very low ram limit
            if (device.is.iOS) {
                if (file.size < iosFileShareSizeLimit) {
                    return shareFile(file);
                } else {
                    return openFile(file);
                }
            }

            if (pref === "share" && device.supports.share) {
                return shareFile(file);
            } else if (pref === "download") {
                return openFile(file);
            }
        }

        if (url) {
            if (pref === "share" && device.supports.share) {
                return shareURL(url);
            } else if (pref === "download" && device.supports.directDownload
                    && !(device.is.iOS && urlType === "redirect")) {
                return openURL(url);
            } else if (pref === "copy" && !file) {
                return copyURL(url);
            }
        }
    } catch { /* catch & ignore */ }

    return openSavingDialog({ url, file, urlType });
}
