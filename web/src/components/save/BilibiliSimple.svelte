<script lang="ts">
    import { tick } from "svelte";
    import { link } from "$lib/state/omnibox";
    import { downloadButtonState } from "$lib/state/omnibox";
    import { updateSetting } from "$lib/state/settings";
    import { savingHandler } from "$lib/api/saving-handler";
    import { pasteLinkFromClipboard } from "$lib/clipboard";
    import { hapticSwitch } from "$lib/haptics";
    import settings from "$lib/state/settings";
    import { turnstileEnabled, turnstileSolved } from "$lib/state/turnstile";
    import dialogs from "$lib/state/dialogs";
    import { saveView } from "$lib/state/save-view";
    import { currentApiURL } from "$lib/api/api-url";

    import type { Optional } from "$lib/types/generic";

    let linkInput: Optional<HTMLInputElement>;
    let pasteError = $state("");
    /** 批量：多行链接（每行一个） */
    let batchLinks = $state("");
    let batchInProgress = $state(false);
    let batchCurrent = $state(0);
    let batchTotal = $state(0);
    /** 收藏夹链接（space.bilibili.com/xxx/favlist?fid=xxx） */
    let favlistUrl = $state("");
    let favlistLoading = $state(false);
    let favlistError = $state("");
    /** 解析收藏夹时是否用 view 接口校验，只保留可播放视频 */
    let favlistValidate = $state(false);
    /** 解析页：view 校验过滤掉的无效条数 */
    let parseFilteredCount = $state(0);
    /** 解析结果（仅展示在本页，不写入批量下载框） */
    let parsedFavlistText = $state("");
    let batchAreaEl: HTMLElement | null = null;

    const validLink = (url: string) => {
        try {
            return /^https?\:/i.test(new URL(url).protocol);
        } catch {}
    };

    let isBotCheckOngoing = $derived($turnstileEnabled && !$turnstileSolved);
    let isLoading = $derived(
        $downloadButtonState === "think" || $downloadButtonState === "check"
    );
    let isDisabled = $derived(isLoading || isBotCheckOngoing);

    type Format = "video" | "audio";
    const videoQualities = ["1080", "720", "480"] as const;
    const audioBitrates = ["320", "128", "64"] as const;

    let format = $derived(
        $settings.save.downloadMode === "audio" ? "audio" : "video"
    );
    let videoQuality = $derived($settings.save.videoQuality);
    let audioBitrate = $derived($settings.save.audioBitrate);

    function setFormat(f: Format) {
        hapticSwitch();
        updateSetting({
            save: {
                downloadMode: f === "video" ? "auto" : "audio",
            },
        });
    }

    function setVideoQuality(q: string) {
        hapticSwitch();
        updateSetting({ save: { videoQuality: q } });
    }

    function setAudioBitrate(b: string) {
        hapticSwitch();
        updateSetting({ save: { audioBitrate: b } });
    }

    async function doDownload() {
        if ($dialogs.length > 0 || isDisabled || isLoading || !validLink($link))
            return;
        hapticSwitch();
        await savingHandler({ url: $link });
    }

    async function pasteClipboard() {
        if ($dialogs.length > 0 || isDisabled || isLoading) return;
        hapticSwitch();
        pasteError = "";
        const pastedData = await pasteLinkFromClipboard();
        if (!pastedData) {
            pasteError = "无法读取剪贴板，请直接在输入框按 Ctrl+V 粘贴。";
            return;
        }
        const linkMatch = pastedData.match(/https?\:\/\/[^\s]+/g);
        if (linkMatch) {
            $link = linkMatch[0].split("，")[0];
            await tick();
            savingHandler({ url: $link });
        }
    }

    const BATCH_MAX = 100;
    const BATCH_PAGE_SIZE = 25;
    /**
     * 两次「解析/入队」请求之间的间隔。
     * 自建 API 默认约每 IP 每 60 秒 20 次 POST（RATELIMIT_MAX），400ms 会迅速触发「请求过于频繁」。
     * 3.3s ≈ 每分钟约 18 次，留一点余量；若仍 429 可调大或提高 RATELIMIT_MAX。
     */
    const BATCH_SAVE_DELAY_MS = 3300;

    /** 从多行文本里解析出有效链接（每行一个，支持从收藏夹复制的一整段） */
    function parseBatchUrls(text: string): string[] {
        const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        const urls: string[] = [];
        for (const line of lines) {
            const match = line.match(/https?\:\/\/[^\s]+/g);
            if (match) match.forEach((u) => urls.push(u.split("，")[0]));
        }
        return [...new Set(urls)].filter(validLink);
    }

    /** 解析后的全部链接 */
    let batchUrlList = $derived(parseBatchUrls(batchLinks));
    /** 仅取前 100 条，用于展示与下载 */
    let batchUrlListCapped = $derived(batchUrlList.slice(0, BATCH_MAX));
    /** 分页：当前页（1-based） */
    let batchCurrentPage = $state(1);
    /** 总页数（每页 25 条） */
    let batchPageCount = $derived(Math.max(1, Math.ceil(batchUrlListCapped.length / BATCH_PAGE_SIZE)));
    /** 当前页的链接 */
    let batchPageUrls = $derived(
        batchUrlListCapped.slice(
            (batchCurrentPage - 1) * BATCH_PAGE_SIZE,
            batchCurrentPage * BATCH_PAGE_SIZE
        )
    );

    $effect(() => {
        if (batchCurrentPage > batchPageCount) batchCurrentPage = Math.max(1, batchPageCount);
    });

    async function doBatchDownload() {
        const urls = batchUrlListCapped;
        if (urls.length === 0 || batchInProgress || $dialogs.length > 0) return;
        hapticSwitch();
        batchInProgress = true;
        batchTotal = urls.length;
        batchCurrent = 0;
        for (let i = 0; i < urls.length; i++) {
            batchCurrent = i + 1;
            await savingHandler({ url: urls[i] });
            if (i < urls.length - 1) await new Promise((r) => setTimeout(r, BATCH_SAVE_DELAY_MS));
        }
        batchInProgress = false;
        batchCurrent = 0;
        batchTotal = 0;
    }

    async function parseFavlist() {
        const u = favlistUrl.trim();
        if (!u || favlistLoading) return;
        hapticSwitch();
        favlistError = "";
        parseFilteredCount = 0;
        parsedFavlistText = "";
        favlistLoading = true;
        try {
            const apiBase = typeof window !== "undefined" ? currentApiURL() : "";
            const params = new URLSearchParams({ url: u });
            if (favlistValidate) params.set("validate", "1");
            const res = await fetch(`${apiBase}/api/bilibili-favlist?${params}`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                favlistError = data.error || "解析失败";
                return;
            }
            if (data.urls?.length) {
                const urls = data.urls.slice(0, BATCH_MAX);
                parsedFavlistText = urls.join("\n");
                parseFilteredCount = data.invalidCount ?? 0;
            } else {
                parseFilteredCount = 0;
                favlistError = data.message || "未获取到视频链接";
            }
        } catch {
            favlistError = "网络请求失败";
        } finally {
            favlistLoading = false;
        }
    }

    async function copyParsedUrls() {
        if (!parsedFavlistText.trim()) return;
        hapticSwitch();
        try {
            await navigator.clipboard.writeText(parsedFavlistText);
        } catch {
            /* 忽略 */
        }
    }

    let isBatchDisabled = $derived(
        batchInProgress || isDisabled || batchUrlListCapped.length === 0
    );

    const statusText = $derived.by(() => {
        if (batchInProgress && batchTotal > 0)
            return `批量添加中 ${batchCurrent}/${batchTotal}…`;
        const s = $downloadButtonState;
        if (s === "idle") return "就绪";
        if (s === "think" || s === "check") return "处理中…";
        if (s === "done") return "下载完成";
        if (s === "error") return "出错";
        return "就绪";
    });
</script>

<div class="bilibili-simple">
    <h1 class="title">B站下载器</h1>

    {#if $saveView === "single"}
        <!-- 单链接下载：输入行 + 下载按钮 -->
        <div class="input-row">
            <input
                bind:this={linkInput}
                bind:value={$link}
                type="text"
                class="main-input"
                placeholder="粘贴B站视频链接"
                maxlength="512"
                autocomplete="off"
                disabled={isDisabled}
                onkeydown={(e) => {
                    if (e.key === "Enter") doDownload();
                }}
                aria-label="B站视频链接"
            />
            <button
                type="button"
                class="download-btn"
                disabled={!validLink($link) || isDisabled || isLoading || isBotCheckOngoing}
                onclick={doDownload}
                aria-label="下载"
            >
                下载
            </button>
        </div>
        <p class="paste-hint">
            <button type="button" class="paste-link" onclick={pasteClipboard} title="从剪贴板读取链接并填入输入框">粘贴链接</button>
            <span class="paste-desc">（从剪贴板粘贴，部分浏览器需点击后授权）</span>
        </p>
        {#if pasteError}
            <p class="paste-error" role="alert">{pasteError}</p>
        {/if}
        <div class="download-block">
            <div class="options">
                <div class="option-row">
                    <button type="button" class="option-label-btn" class:active={format === "video"} onclick={() => { setFormat("video"); setVideoQuality("720"); }}>视频 MP4：</button>
                    <div class="segmented">
                        {#each videoQualities as q}
                            <button type="button" class="segmented-btn small" class:active={format === "video" && videoQuality === q} onclick={() => { setFormat("video"); setVideoQuality(q); }}>{q === "1080" ? "1080P" : q === "720" ? "720P" : "480P"}</button>
                        {/each}
                    </div>
                </div>
                <div class="option-row">
                    <button type="button" class="option-label-btn" class:active={format === "audio"} onclick={() => { setFormat("audio"); setAudioBitrate("128"); }}>音频 MP3：</button>
                    <div class="segmented">
                        {#each audioBitrates as b}
                            <button type="button" class="segmented-btn small" class:active={format === "audio" && audioBitrate === b} onclick={() => { setFormat("audio"); setAudioBitrate(b); }}>{b}kbps</button>
                        {/each}
                    </div>
                </div>
            </div>
        </div>
    {:else if $saveView === "favlist"}
        <!-- 仅解析出视频地址，本页展示 / 复制 -->
        <div class="download-block">
            <p class="favlist-intro">
                粘贴收藏夹或列表页链接，在本页<strong>解析出视频地址</strong>。可复制后到「批量下载」粘贴；本页不会自动填入批量框。
            </p>
            <label for="favlist-url" class="batch-label">列表 / 收藏夹链接</label>
            <div class="favlist-input-row">
                <input
                    id="favlist-url"
                    type="text"
                    class="favlist-input"
                    bind:value={favlistUrl}
                    placeholder="https://space.bilibili.com/xxx/favlist?fid=xxx"
                    disabled={favlistLoading}
                    aria-label="列表或收藏夹页面链接"
                />
                <button type="button" class="favlist-btn" disabled={!favlistUrl.trim() || favlistLoading} onclick={parseFavlist} aria-label="解析地址">
                    {favlistLoading ? "解析中…" : "解析地址"}
                </button>
            </div>
            <label class="favlist-validate-toggle">
                <input type="checkbox" bind:checked={favlistValidate} aria-label="校验有效视频" />
                <span>校验有效视频（仅保留可播放，用 view 接口过滤下架/无效）</span>
            </label>
            {#if favlistError}
                <p class="paste-error" role="alert">{favlistError}</p>
            {/if}
            {#if parsedFavlistText}
                <div class="parsed-favlist-block">
                    <label for="parsed-favlist-out" class="batch-label">解析结果（每行一个链接）</label>
                    {#if parseFilteredCount > 0}
                        <p class="parse-filter-hint" role="status">已过滤 {parseFilteredCount} 个无效/下架</p>
                    {/if}
                    <textarea
                        id="parsed-favlist-out"
                        class="batch-textarea parsed-favlist-textarea"
                        readonly
                        rows="8"
                        bind:value={parsedFavlistText}
                        aria-label="解析出的视频链接"
                    ></textarea>
                    <button type="button" class="favlist-btn copy-parsed-btn" onclick={copyParsedUrls}>
                        复制全部链接
                    </button>
                </div>
            {/if}
        </div>
    {:else if $saveView === "batch"}
        <!-- 批量下载：最多 100 条，分页每页 25 条 -->
        <div class="download-block" bind:this={batchAreaEl}>
            <label for="batch-links" class="batch-label">多链接（收藏夹等）：每行一个链接，最多处理 100 条</label>
            <textarea
                id="batch-links"
                bind:value={batchLinks}
                class="batch-textarea"
                placeholder="https://www.bilibili.com/video/BVxxx&#10;https://www.bilibili.com/video/BVyyy"
                rows="4"
                disabled={batchInProgress || isDisabled}
                aria-label="多链接输入，每行一个"
            />
            {#if batchUrlList.length > BATCH_MAX}
                <p class="batch-hint" role="status">已取前 {BATCH_MAX} 条，共 {batchUrlList.length} 条，仅处理前 {BATCH_MAX} 条</p>
            {/if}
            {#if batchUrlListCapped.length > 0}
                <div class="batch-list-section">
                    <p class="batch-list-title">
                        链接列表（共 {batchUrlListCapped.length} 条，每页 {BATCH_PAGE_SIZE} 条）
                    </p>
                    <ul class="batch-list" aria-label="当前页链接">
                        {#each batchPageUrls as url, i}
                            <li class="batch-list-item">{(batchCurrentPage - 1) * BATCH_PAGE_SIZE + i + 1}. {url}</li>
                        {/each}
                    </ul>
                    <div class="batch-pagination">
                        <button
                            type="button"
                            class="batch-page-btn"
                            disabled={batchCurrentPage <= 1}
                            onclick={() => { hapticSwitch(); batchCurrentPage -= 1; }}
                            aria-label="上一页"
                        >
                            上一页
                        </button>
                        <span class="batch-page-nums">
                            {#each Array.from({ length: batchPageCount }, (_, i) => i + 1) as p}
                                <button
                                    type="button"
                                    class="batch-page-num"
                                    class:active={p === batchCurrentPage}
                                    onclick={() => { hapticSwitch(); batchCurrentPage = p; }}
                                    aria-label="第 {p} 页"
                                    aria-current={p === batchCurrentPage ? "page" : undefined}
                                >
                                    {p}
                                </button>
                            {/each}
                        </span>
                        <button
                            type="button"
                            class="batch-page-btn"
                            disabled={batchCurrentPage >= batchPageCount}
                            onclick={() => { hapticSwitch(); batchCurrentPage += 1; }}
                            aria-label="下一页"
                        >
                            下一页
                        </button>
                    </div>
                </div>
            {/if}
            <button
                type="button"
                class="batch-btn"
                disabled={isBatchDisabled}
                onclick={doBatchDownload}
                aria-label="批量下载"
            >
                批量下载（{batchUrlListCapped.length} 个）
            </button>
            <p class="batch-rate-hint" role="note">
                每条间隔约 3.3 秒，避免 API 限流（默认约每分钟 20 次解析）；超大列表可分批或提高服务端 RATELIMIT_MAX。
            </p>
            <div class="options">
                <div class="option-row">
                    <button type="button" class="option-label-btn" class:active={format === "video"} onclick={() => { setFormat("video"); setVideoQuality("720"); }}>视频 MP4：</button>
                    <div class="segmented">
                        {#each videoQualities as q}
                            <button type="button" class="segmented-btn small" class:active={format === "video" && videoQuality === q} onclick={() => { setFormat("video"); setVideoQuality(q); }}>{q === "1080" ? "1080P" : q === "720" ? "720P" : "480P"}</button>
                        {/each}
                    </div>
                </div>
                <div class="option-row">
                    <button type="button" class="option-label-btn" class:active={format === "audio"} onclick={() => { setFormat("audio"); setAudioBitrate("128"); }}>音频 MP3：</button>
                    <div class="segmented">
                        {#each audioBitrates as b}
                            <button type="button" class="segmented-btn small" class:active={format === "audio" && audioBitrate === b} onclick={() => { setFormat("audio"); setAudioBitrate(b); }}>{b}kbps</button>
                        {/each}
                    </div>
                </div>
            </div>
        </div>
    {/if}

    <div class="status" aria-live="polite">
        {statusText}
    </div>
</div>

<style>
    /* B站品牌蓝（图标色） */
    .bilibili-simple {
        --bilibili-blue: #00A1D6;
        --bilibili-blue-dark: #0090c0;
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
        max-width: 560px;
        margin: 0 auto;
        gap: 1rem;
    }

    .title {
        font-size: 1.5rem;
        font-weight: 600;
        color: var(--bilibili-blue);
        margin: 0 0 0.5rem 0;
    }

    .input-row {
        width: 100%;
        display: flex;
        gap: 0;
        border-radius: var(--border-radius);
        overflow: hidden;
        box-shadow: 0 0 0 1.5px var(--input-border);
    }

    .input-row:focus-within {
        box-shadow: 0 0 0 2px var(--bilibili-blue);
    }

    .main-input {
        flex: 1;
        padding: 14px 16px;
        font-size: 16px;
        border: none;
        outline: none;
        background: var(--primary);
        color: var(--bilibili-blue);
    }

    .main-input::placeholder {
        color: var(--gray);
    }

    .download-btn {
        padding: 14px 24px;
        font-size: 16px;
        font-weight: 600;
        background: var(--bilibili-blue);
        color: #fff;
        border: none;
        cursor: pointer;
        white-space: nowrap;
    }

    .download-btn:hover:not(:disabled) {
        background: var(--bilibili-blue-dark);
    }

    .download-btn:disabled {
        background: var(--bilibili-blue);
        cursor: not-allowed;
        opacity: 0.5;
    }

    .paste-link {
        align-self: flex-start;
        font-size: 13px;
        color: var(--bilibili-blue);
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;
        text-decoration: underline;
    }

    .paste-link:hover {
        color: var(--bilibili-blue);
    }

    .paste-hint {
        margin: 0;
        align-self: flex-start;
        display: flex;
        align-items: baseline;
        gap: 0.35rem;
        flex-wrap: wrap;
    }

    .paste-desc {
        font-size: 12px;
        color: var(--gray);
    }

    .paste-error {
        margin: 0;
        font-size: 13px;
        color: var(--bilibili-blue);
    }

    .download-block {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }


    .favlist-intro {
        margin: 0 0 12px;
        font-size: 0.9rem;
        line-height: 1.45;
        color: var(--secondary, #666);
    }

    .favlist-row {
        display: flex;
        flex-direction: column;
        gap: 0.35rem;
    }

    .favlist-input-row {
        display: flex;
        gap: 0.5rem;
        align-items: center;
    }

    .favlist-input {
        flex: 1;
        padding: 10px 12px;
        font-size: 14px;
        border: 1.5px solid var(--input-border);
        border-radius: var(--border-radius);
        background: var(--primary);
        color: var(--bilibili-blue);
    }

    .favlist-input:focus {
        outline: none;
        border-color: var(--bilibili-blue);
    }

    .favlist-input::placeholder {
        color: var(--gray);
    }

    .favlist-btn {
        padding: 10px 14px;
        font-size: 13px;
        font-weight: 600;
        background: var(--bilibili-blue);
        color: #fff;
        border: none;
        border-radius: var(--border-radius);
        cursor: pointer;
        white-space: nowrap;
    }

    .favlist-btn:hover:not(:disabled) {
        background: var(--bilibili-blue-dark);
    }

    .favlist-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .batch-label {
        font-size: 13px;
        color: var(--bilibili-blue);
    }

    .batch-textarea {
        width: 100%;
        padding: 10px 12px;
        font-size: 14px;
        line-height: 1.4;
        border: 1.5px solid var(--input-border);
        border-radius: var(--border-radius);
        background: var(--primary);
        color: var(--bilibili-blue);
        resize: vertical;
        min-height: 80px;
    }

    .batch-textarea:focus {
        outline: none;
        border-color: var(--bilibili-blue);
    }

    .batch-textarea::placeholder {
        color: var(--gray);
    }

    .batch-btn {
        align-self: flex-start;
        padding: 10px 18px;
        font-size: 14px;
        font-weight: 600;
        background: var(--bilibili-blue);
        color: #fff;
        border: none;
        border-radius: var(--border-radius);
        cursor: pointer;
    }

    .batch-btn:hover:not(:disabled) {
        background: var(--bilibili-blue-dark);
    }

    .batch-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .batch-hint {
        margin: 0;
        font-size: 13px;
        color: var(--bilibili-blue);
    }

    .batch-list-section {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    .batch-list-title {
        margin: 0;
        font-size: 13px;
        color: var(--bilibili-blue);
    }

    .batch-list {
        margin: 0;
        padding: 8px 12px;
        max-height: 200px;
        overflow-y: auto;
        border: 1.5px solid var(--input-border);
        border-radius: var(--border-radius);
        background: var(--primary);
        list-style: none;
        font-size: 12px;
        color: var(--bilibili-blue);
        line-height: 1.5;
    }

    .batch-list-item {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .batch-pagination {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        flex-wrap: wrap;
    }

    .batch-page-btn {
        padding: 6px 12px;
        font-size: 13px;
        color: var(--bilibili-blue);
        background: var(--primary);
        border: 1.5px solid var(--input-border);
        border-radius: var(--border-radius);
        cursor: pointer;
    }

    .batch-page-btn:hover:not(:disabled) {
        border-color: var(--bilibili-blue);
        background: var(--button-hover-transparent);
    }

    .batch-page-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .batch-page-nums {
        display: flex;
        gap: 4px;
    }

    .batch-page-num {
        min-width: 28px;
        padding: 6px 8px;
        font-size: 13px;
        color: var(--bilibili-blue);
        background: var(--primary);
        border: 1.5px solid var(--input-border);
        border-radius: var(--border-radius);
        cursor: pointer;
    }

    .batch-page-num:hover {
        border-color: var(--bilibili-blue);
    }

    .batch-page-num.active {
        background: var(--bilibili-blue);
        color: #fff;
        border-color: var(--bilibili-blue);
    }

    .options {
        display: flex;
        flex-direction: column;
        width: 100%;
        gap: 0.75rem;
    }

    .option-label {
        font-size: 14px;
        color: var(--bilibili-blue);
        min-width: 2.5em;
    }

    .option-label-btn {
        font-size: 14px;
        color: var(--bilibili-blue);
        background: none;
        border: none;
        cursor: pointer;
        padding: 4px 8px 4px 0;
        margin: 0;
        border-radius: var(--border-radius);
    }

    .option-label-btn:hover {
        color: var(--bilibili-blue-dark);
    }

    .option-label-btn.active {
        font-weight: 600;
        color: var(--bilibili-blue);
    }

    .option-row {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
    }

    .segmented {
        display: flex;
        border-radius: var(--border-radius);
        overflow: hidden;
        box-shadow: 0 0 0 1.5px var(--input-border);
    }

    .segmented-btn {
        padding: 10px 18px;
        font-size: 14px;
        border: none;
        background: var(--primary);
        color: var(--bilibili-blue);
        cursor: pointer;
    }

    .segmented-btn.small {
        padding: 8px 14px;
        font-size: 13px;
    }

    .parsed-favlist-block {
        width: 100%;
        margin-top: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .parse-filter-hint {
        margin: 0;
        font-size: 0.85rem;
        color: var(--bilibili-blue);
    }

    .parsed-favlist-textarea {
        font-size: 13px;
        line-height: 1.4;
    }

    .copy-parsed-btn {
        align-self: flex-start;
    }

    .batch-rate-hint {
        margin: 0;
        width: 100%;
        font-size: 12px;
        line-height: 1.4;
        color: var(--text-muted, #888);
    }

    .favlist-validate-toggle {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        user-select: none;
        font-size: 13px;
        color: var(--text);
        margin-bottom: 8px;
    }
    .favlist-validate-toggle input[type="checkbox"] {
        width: 16px;
        height: 16px;
        accent-color: var(--accent);
    }
    .segmented-btn.active {
        background: var(--bilibili-blue);
        color: #fff;
    }

    .segmented-btn:hover:not(.active) {
        background: var(--button-hover-transparent);
    }

    .status {
        font-size: 14px;
        color: var(--bilibili-blue);
        margin-top: 0.5rem;
    }

    @media screen and (max-width: 535px) {
        .title {
            font-size: 1.25rem;
        }

        .input-row {
            flex-direction: column;
        }

        .download-btn {
            width: 100%;
        }

        .option-row {
            flex-direction: column;
            align-items: stretch;
        }

        .segmented {
            width: 100%;
        }

        .segmented-btn {
            flex: 1;
        }
    }
</style>
