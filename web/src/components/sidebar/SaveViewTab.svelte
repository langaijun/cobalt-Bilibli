<script lang="ts">
    import { saveView, type SaveView } from "$lib/state/save-view";

    export let view: SaveView;
    export let label: string;
    export let icon: ConstructorOfATypedSvelteComponent;

    $: isActive = $saveView === view;

    function select() {
        saveView.set(view);
    }
</script>

<button
    type="button"
    class="sidebar-tab save-view-tab"
    class:active={isActive}
    class:save-tab={view === "single"}
    role="tab"
    aria-selected={isActive}
    onclick={select}
>
    <svelte:component this={icon} />
    <span class="tab-title">{label}</span>
</button>

<style>
    .save-view-tab {
        display: flex;
        flex-direction: column;
        align-items: center;
        text-align: center;
        gap: 3px;
        padding: var(--sidebar-tab-padding) 3px;
        color: var(--sidebar-highlight);
        font-size: var(--sidebar-font-size);
        opacity: 0.75;
        height: fit-content;
        border-radius: var(--border-radius);
        transition: transform 0.2s;
        border: none;
        background: transparent;
        cursor: pointer;
        font-family: inherit;
        position: relative;
    }

    .save-view-tab :global(svg) {
        stroke-width: 1.2px;
        height: 22px;
        width: 22px;
    }

    .save-view-tab.active {
        color: var(--sidebar-bg);
        background: var(--sidebar-highlight);
        opacity: 1;
        cursor: default;
    }

    .save-view-tab.active.save-tab {
        background: var(--gray);
        color: #fff;
    }

    .save-view-tab:not(.active):active {
        transform: scale(0.95);
    }

    .tab-title {
        white-space: nowrap;
    }

    @media (hover: hover) {
        .save-view-tab:hover:not(.active) {
            background-color: var(--button-hover-transparent);
            opacity: 1;
        }
    }

    @media screen and (max-width: 535px) {
        .save-view-tab {
            padding: 5px var(--padding);
            min-width: calc(var(--sidebar-width) / 2);
        }
    }
</style>
