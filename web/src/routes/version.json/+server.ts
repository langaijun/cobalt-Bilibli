import { json } from "@sveltejs/kit";
import { getCommit, getBranch, getRemote, getVersion } from "@imput/version-info";

const fallback = (p: Promise<string | undefined>) =>
    p.catch(() => "");

export async function GET() {
    return json({
        commit: await fallback(getCommit()),
        branch: await fallback(getBranch()),
        remote: await fallback(getRemote()),
        version: await fallback(getVersion())
    });
}

export const prerender = true;
