<script>
    // 极简 B站下载器：仅保留输入框+下载+格式/质量+状态
    import BilibiliSimple from "$components/save/BilibiliSimple.svelte";
    // 原多平台版恢复时取消注释: Omnibox, Meowbalt, SupportedServices, $t("general.cobalt")
    // import { t } from "$lib/i18n/translations";
    // import Omnibox from "$components/save/Omnibox.svelte";
    // import Meowbalt from "$components/misc/Meowbalt.svelte";
    // import SupportedServices from "$components/save/SupportedServices.svelte";
</script>

<svelte:head>
    <title>B站下载器</title>
    <meta property="og:title" content="B站下载器" />
</svelte:head>

<div id="cobalt-save-container" class="center-column-container">
    <main
        id="cobalt-save"
        tabindex="-1"
        data-first-focus
    >
        <!-- 原多平台版恢复时用 Meowbalt + Omnibox 替换 BilibiliSimple -->
        <BilibiliSimple />
    </main>
    <!-- 原条款与支持平台，以后可恢复:
    <div id="terms-note">... + SupportedServices </div>
    -->
</div>

<style>
    #cobalt-save-container {
        padding: var(--padding);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        min-height: 100%;
    }

    #cobalt-save {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        flex: 1;
        gap: 15px;
    }

    @media screen and (max-width: 535px) {
        #cobalt-save-container {
            padding-top: calc(var(--padding) / 2);
        }
    }
</style>
