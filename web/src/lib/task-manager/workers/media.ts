import LibAVWrapper from "$lib/libav";
import type { FileInfo } from "$lib/types/libav";

// probe（ffprobe）在部分浏览器/机器上可能非常慢，过短会导致误判失败
const PROBE_TIMEOUT_MS = 120_000;
/** 重新封装/转码阶段最大等待时间，避免无限卡住 */
const RENDER_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟

const withTimeout = async <T>(p: Promise<T>, ms: number, code: string): Promise<T> => {
    let t: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            p,
            new Promise<T>((_, reject) => {
                t = setTimeout(() => reject(new Error(code)), ms);
            })
        ]);
    } finally {
        if (t) clearTimeout(t);
    }
}

const ffmpeg = async (
    variant: string,
    files: File[],
    args: string[],
    output: FileInfo,
    yesthreads: boolean = false,
) => {
    if (!(files && output && args)) {
        self.postMessage({
            cobaltFFmpegWorker: {
                error: "queue.ffmpeg.no_args",
            }
        });
        return;
    }

    const ff = new LibAVWrapper((progress) => {
        self.postMessage({
            cobaltFFmpegWorker: {
                progress: {
                    durationProcessed: progress.out_time_sec,
                    speed: progress.speed,
                    size: progress.total_size,
                    currentFrame: progress.frame,
                    fps: progress.fps,
                }
            }
        })
    });

    ff.init({ variant, yesthreads });

    const error = (code: string) => {
        self.postMessage({
            cobaltFFmpegWorker: {
                error: code,
            }
        });
        ff.terminate();
    }

    const debug = (data: Record<string, unknown>) => {
        try {
            self.postMessage({
                cobaltFFmpegWorker: {
                    debug: data
                }
            });
        } catch {}
    };

    try {
        // probing just the first file in files array (usually audio) for duration progress
        const probeFile = files[0];
        if (!probeFile) {
            return error("queue.ffmpeg.probe_failed");
        }

        let file_info: any;

        try {
            file_info = await withTimeout(ff.probe(probeFile), PROBE_TIMEOUT_MS, "queue.ffmpeg.probe_timeout");
        } catch (e) {
            console.error("error from ffmpeg worker @ file_info:");
            if (e instanceof Error && e.message === "queue.ffmpeg.probe_timeout") {
                console.error(e);
                // 关键目标是“先能下载”。probe 超时不一定意味着后续 render 不能工作。
                // 跳过 probe：不给 duration 进度，但继续进行 remux/encode。
                debug({
                    stage: "probe_timeout_continue",
                    timeoutMs: PROBE_TIMEOUT_MS,
                    probeFileSize: probeFile.size,
                    probeFileType: probeFile.type
                });
                file_info = { format: { duration: 0 }, streams: [] };
            }
            if (e instanceof Error && e?.message?.toLowerCase().includes("out of memory")) {
                console.error(e);

                error("queue.ffmpeg.out_of_memory");
                return self.close();
            } else {
                console.error(e);
                return error("queue.ffmpeg.probe_failed");
            }
        }

        if (!file_info?.format) {
            return error("queue.ffmpeg.no_input_format");
        }

        // handle the edge case when a video doesn't have an audio track
        // but user still tries to extract it
        if (files.length === 1 && file_info.streams?.length === 1) {
            if (output.type?.startsWith("audio") && file_info.streams[0].codec_type !== "audio") {
                return error("queue.ffmpeg.no_audio_channel");
            }
        }

        self.postMessage({
            cobaltFFmpegWorker: {
                progress: {
                    duration: Number(file_info.format.duration),
                }
            }
        });

        for (const file of files) {
            if (!file.type) {
                return error("queue.ffmpeg.no_input_type");
            }
        }

        let render;

        try {
            render = await withTimeout(
                ff.render({
                    files,
                    output,
                    args,
                }),
                RENDER_TIMEOUT_MS,
                "queue.ffmpeg.render_timeout"
            );
        } catch (e) {
            console.error("error from the ffmpeg worker @ render:");
            console.error(e);
            if (e instanceof Error && e.message === "queue.ffmpeg.render_timeout") {
                error("queue.ffmpeg.render_timeout");
                return self.close();
            }
            return error("queue.ffmpeg.crashed");
        }

        if (!render) {
            return error("queue.ffmpeg.no_render");
        }

        await ff.terminate();

        self.postMessage({
            cobaltFFmpegWorker: {
                render
            }
        });
    } catch (e) {
        console.error("error from the ffmpeg worker:")
        console.error(e);
        return error("queue.ffmpeg.crashed");
    }
}

self.onmessage = async (event: MessageEvent) => {
    const ed = event.data.cobaltFFmpegWorker;
    if (ed?.variant && ed?.files && ed?.args && ed?.output) {
        // 先回一个 ready，避免主线程误判 “worker 没启动”
        self.postMessage({
            cobaltFFmpegWorker: { ready: true }
        });
        await ffmpeg(ed.variant, ed.files, ed.args, ed.output, ed.yesthreads);
    }
}

// 将 worker 内部的真实错误尽量回传给主线程（否则主线程只能拿到一个模糊的 Worker error 事件）
self.addEventListener("error", (e) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ee: any = e as any;
    try {
        self.postMessage({
            cobaltFFmpegWorker: {
                error: "queue.ffmpeg.crashed",
                debug: {
                    message: ee?.message,
                    filename: ee?.filename,
                    lineno: ee?.lineno,
                    colno: ee?.colno,
                }
            }
        });
    } catch {}
});

self.addEventListener("unhandledrejection", (e) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rr: any = e as any;
    try {
        self.postMessage({
            cobaltFFmpegWorker: {
                error: "queue.ffmpeg.crashed",
                debug: {
                    reason: String(rr?.reason ?? "unknown"),
                }
            }
        });
    } catch {}
});
