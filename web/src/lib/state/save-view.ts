import { writable } from "svelte/store";

export type SaveView = "single" | "favlist" | "batch";

export const saveView = writable<SaveView>("single");
