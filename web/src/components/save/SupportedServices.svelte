<script lang="ts">
    import { onMount } from "svelte";
    import { t } from "$lib/i18n/translations";
    import cachedInfo from "$lib/state/server-info";
    import { getServerInfo } from "$lib/api/server-info";

    import Skeleton from "$components/misc/Skeleton.svelte";

    let services: string[] = [];
    let loaded = false;

    const loadInfo = async () => {
        await getServerInfo();
        if ($cachedInfo) {
            loaded = true;
            services = $cachedInfo.info.cobalt.services;
        }
    };

    onMount(() => {
        loadInfo();
    });
</script>

<div id="supported-services" class="footer-services">
    <div id="services-label" class="subtext">{$t("save.services.title")}</div>
    <div id="services-container">
        {#if loaded}
            {#each services as service}
                <div class="service-item">{service}</div>
            {/each}
        {:else}
            {#each { length: 12 } as _}
                <Skeleton
                    class="elevated"
                    width={Math.random() * 44 + 50 + "px"}
                    height="24.5px"
                />
            {/each}
        {/if}
    </div>
    <div id="services-disclaimer" class="subtext">
        {$t("save.services.disclaimer")}
    </div>
</div>

<style>
    .footer-services {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 6px;
        padding: 12px 0 8px;
        margin-top: auto;
        width: 100%;
        max-width: 500px;
    }

    #services-label {
        font-size: 12px;
        font-weight: 500;
        color: var(--gray);
    }

    #services-container {
        display: flex;
        flex-wrap: wrap;
        flex-direction: row;
        justify-content: center;
        gap: 4px 6px;
    }

    .service-item {
        display: inline-flex;
        padding: 4px 8px;
        border-radius: calc(var(--border-radius) / 2);
        background: var(--button-elevated);
        font-size: 12px;
        font-weight: 500;
    }

    #services-disclaimer {
        font-size: 11px;
        color: var(--gray);
        text-align: center;
        padding: 0 8px;
        user-select: text;
    }

    @media screen and (max-width: 535px) {
        .footer-services {
            padding: 10px 0 6px;
        }

        .service-item {
            font-size: 11px;
            padding: 3px 6px;
        }
    }
</style>
