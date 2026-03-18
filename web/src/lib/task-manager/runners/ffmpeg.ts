// 使用 media?worker 避免构建产物名为 ffmpeg-xxx.js，减少被广告拦截规则命中的概率
import MediaWorker from "$lib/task-manager/workers/media?worker";

import { killWorker } from "$lib/task-manager/run-worker";
import { updateWorkerProgress } from "$lib/state/task-manager/current-tasks";
import { pipelineTaskDone, itemError, queue } from "$lib/state/task-manager/queue";

import type { FileInfo } from "$lib/types/libav";
import type { CobaltQueue } from "$lib/types/queue";

let startAttempts = 0;

const START_CHECK_INTERVAL_MS = 500;
const START_CHECK_TICKS_BEFORE_RETRY = 24; // 12s：给 WASM 初始化与 probe 足够时间
const MAX_START_RETRIES = 12;
const DELAY_BEFORE_RETRY_MS = 1500; // 重试前等待，让上一个 Worker 释放资源

export const runFFmpegWorker = async (
    workerId: string,
    parentId: string,
    files: File[],
    args: string[],
    output: FileInfo,
    variant: 'remux' | 'encode',
    yesthreads: boolean,
    resetStartCounter = false,
) => {
    if (resetStartCounter) startAttempts = 0;

    // 重试前短暂等待，避免连续创建 Worker 导致浏览器未释放资源
    if (startAttempts > 0) {
        await new Promise((r) => setTimeout(r, DELAY_BEFORE_RETRY_MS));
    }

    let worker: InstanceType<typeof MediaWorker>;
    try {
        worker = new MediaWorker();
    } catch (e) {
        console.error("Worker 脚本加载失败（可能被拦截）:", e);
        return itemError(parentId, workerId, "queue.worker_script_load_failed");
    }

    // unsubscribe 必须在 setInterval 之前声明，否则回调里会触发 "Cannot access before initialization"
    let unsubscribe: () => void = () => {};

    let bumpAttempts = 0;
    const startCheck = setInterval(async () => {
        bumpAttempts++;

        if (bumpAttempts === START_CHECK_TICKS_BEFORE_RETRY) {
            startAttempts++;
            if (startAttempts <= MAX_START_RETRIES) {
                killWorker(worker, unsubscribe, startCheck);
                return await runFFmpegWorker(
                    workerId, parentId,
                    files, args, output,
                    variant, yesthreads
                );
            } else {
                killWorker(worker, unsubscribe, startCheck);
                return itemError(parentId, workerId, "queue.worker_didnt_start");
            }
        }
    }, START_CHECK_INTERVAL_MS);

    unsubscribe = queue.subscribe((queue: CobaltQueue) => {
        if (!queue[parentId]) {
            killWorker(worker, unsubscribe, startCheck);
        }
    });

    worker.postMessage({
        cobaltFFmpegWorker: {
            variant,
            files,
            args,
            output,
            yesthreads,
        }
    });

    worker.onerror = (e) => {
        // 注意：这里通常只能拿到通用 error 事件；更具体的错误会在 worker 内部打印/回传
        console.error("ffmpeg worker crashed:", e);
        try {
            // ErrorEvent 在部分浏览器可取到 message/filename/lineno/colno
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ee: any = e as any;
            if (ee?.message || ee?.filename) {
                console.error("ffmpeg worker error details:", {
                    message: ee?.message,
                    filename: ee?.filename,
                    lineno: ee?.lineno,
                    colno: ee?.colno,
                });
            }
        } catch {}
        killWorker(worker, unsubscribe, startCheck);

        // 用更贴近原因的错误码，便于用户判断是转码侧崩溃
        return itemError(parentId, workerId, "queue.ffmpeg.crashed");
    };

    worker.onmessageerror = (e) => {
        console.error("ffmpeg worker messageerror:", e);
        killWorker(worker, unsubscribe, startCheck);
        return itemError(parentId, workerId, "queue.ffmpeg.crashed");
    };

    let totalDuration: number | null = null;

    worker.onmessage = (event) => {
        const eventData = event.data.cobaltFFmpegWorker;
        if (!eventData) return;

        clearInterval(startCheck);

        if (eventData.progress) {
            if (eventData.progress.duration) {
                totalDuration = eventData.progress.duration;
            }

            updateWorkerProgress(workerId, {
                percentage: totalDuration ? (eventData.progress.durationProcessed / totalDuration) * 100 : 0,
                size: eventData.progress.size,
            })
        }

        if (eventData.render) {
            killWorker(worker, unsubscribe, startCheck);
            return pipelineTaskDone(
                parentId,
                workerId,
                eventData.render,
            );
        }

        if (eventData.error) {
            killWorker(worker, unsubscribe, startCheck);
            return itemError(parentId, workerId, eventData.error);
        }
    };
}
