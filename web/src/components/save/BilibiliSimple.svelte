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

    import type { Optional } from "$lib/types/generic";

    let linkInput: Optional<HTMLInputElement>;
    let pasteError = $state("");

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

    const statusText = $derived.by(() => {
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

    <div class="options">
        <!-- 第一行：点「视频 MP4」即选视频+默认720P；右侧可改画质 -->
        <div class="option-row">
            <button
                type="button"
                class="option-label-btn"
                class:active={format === "video"}
                onclick={() => { setFormat("video"); setVideoQuality("720"); }}
            >
                视频 MP4：
            </button>
            <div class="segmented">
                {#each videoQualities as q}
                    <button
                        type="button"
                        class="segmented-btn small"
                        class:active={format === "video" && videoQuality === q}
                        onclick={() => { setFormat("video"); setVideoQuality(q); }}
                    >
                        {q === "1080" ? "1080P" : q === "720" ? "720P" : "480P"}
                    </button>
                {/each}
            </div>
        </div>
        <!-- 第二行：点「音频 MP3」即选音频+默认128kbps；右侧可改码率 -->
        <div class="option-row">
            <button
                type="button"
                class="option-label-btn"
                class:active={format === "audio"}
                onclick={() => { setFormat("audio"); setAudioBitrate("128"); }}
            >
                音频 MP3：
            </button>
            <div class="segmented">
                {#each audioBitrates as b}
                    <button
                        type="button"
                        class="segmented-btn small"
                        class:active={format === "audio" && audioBitrate === b}
                        onclick={() => { setFormat("audio"); setAudioBitrate(b); }}
                    >
                        {b}kbps
                    </button>
                {/each}
            </div>
        </div>
    </div>

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
        display: flex;
        width: 100%;
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
