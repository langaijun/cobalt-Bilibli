const allowedLinkTypes = new Set(["text/plain", "text/uri-list"]);

export const pasteLinkFromClipboard = async (): Promise<string | null> => {
    try {
        if (!navigator?.clipboard?.read) {
            return null;
        }
        const clipboard = await navigator.clipboard.read();

        if (clipboard?.length) {
            const clipboardItem = clipboard[0];
            for (const type of clipboardItem.types) {
                if (allowedLinkTypes.has(type)) {
                    const blob = await clipboardItem.getType(type);
                    const blobText = await blob.text();
                    return blobText;
                }
            }
        }
    } catch (e) {
        // NotAllowedError: 未在用户手势中调用或用户拒绝权限
        if (e instanceof Error && e.name === "NotAllowedError") {
            console.warn("剪贴板读取被拒绝，请点击「粘贴」按钮后重试或直接在输入框内 Ctrl+V 粘贴。");
        }
        // 静默失败，不打断用户
    }
    return null;
}
