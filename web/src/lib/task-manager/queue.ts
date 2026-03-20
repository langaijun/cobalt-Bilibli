import { get } from "svelte/store";
import { t } from "$lib/i18n/translations";
import { ffmpegMetadataArgs } from "$lib/util";
import { createDialog } from "$lib/state/dialogs";
import { addItem } from "$lib/state/task-manager/queue";
import { openQueuePopover } from "$lib/state/queue-visibility";
import { uuid } from "$lib/util";

import type { CobaltQueueItem } from "$lib/types/queue";
import type { CobaltCurrentTasks } from "$lib/types/task-manager";
import { resultFileTypes, type CobaltPipelineItem, type CobaltPipelineResultFileType } from "$lib/types/workers";
import type { CobaltLocalProcessingResponse, CobaltSaveRequestBody } from "$lib/types/api";

export const getMediaType = (type: string) => {
    const kind = type.split('/')[0] as CobaltPipelineResultFileType;

    if (resultFileTypes.includes(kind)) {
        return kind;
    }
}

export const createRemuxPipeline = (file: File) => {
    const parentId = uuid();
    const mediaType = getMediaType(file.type);

    const pipeline: CobaltPipelineItem[] = [{
        worker: "remux",
        workerId: uuid(),
        parentId,
        workerArgs: {
            files: [file],
            ffargs: [
                "-c", "copy",
                "-map", "0"
            ],
            output: {
                type: file.type,
                format: file.name.split(".").pop(),
            },
        },
    }];

    if (mediaType) {
        addItem({
            id: parentId,
            state: "waiting",
            pipeline,
            filename: file.name,
            mimeType: file.type,
            mediaType,
        });

        openQueuePopover();
    }
}

const makeRemuxArgs = (info: CobaltLocalProcessingResponse) => {
    const ffargs = ["-c:v", "copy"];

    if (["merge", "remux"].includes(info.type)) {
        ffargs.push("-c:a", "copy");
    } else if (info.type === "mute") {
        ffargs.push("-an");
    }

    if (info.output.subtitles) {
        ffargs.push(
            "-c:s",
            info.output.filename.endsWith(".mp4") ? "mov_text" : "webvtt"
        );
    }

    ffargs.push(
        ...(info.output.metadata ? ffmpegMetadataArgs(info.output.metadata) : [])
    );

    return ffargs;
}

const makeAudioArgs = (info: CobaltLocalProcessingResponse) => {
    if (!info.audio) {
        return;
    }

    const ffargs = [];

    if (info.audio.cover && info.audio.format === "mp3") {
        ffargs.push(
            "-map", "0",
            "-map", "1",
            ...(info.audio.cropCover ? [
                "-c:v", "mjpeg",
                "-vf", "scale=-1:720,crop=720:720",
            ] : [
                "-c:v", "copy",
            ]),
        );
    } else {
        ffargs.push("-vn");
    }

    ffargs.push(
        ...(info.audio.copy ? ["-c:a", "copy"] : ["-b:a", `${info.audio.bitrate}k`]),
        ...(info.output.metadata ? ffmpegMetadataArgs(info.output.metadata) : [])
    );

    if (info.audio.format === "mp3" && info.audio.bitrate === "8") {
        ffargs.push("-ar", "12000");
    }

    if (info.audio.format === "opus") {
        ffargs.push("-vbr", "off")
    }

    const outFormat = info.audio.format === "m4a" ? "ipod" : info.audio.format;

    ffargs.push('-f', outFormat);
    return ffargs;
}

const makeGifArgs = () => {
    return [
        "-vf",
        "scale=-1:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
        "-loop", "0",
        "-f", "gif"
    ];
}

const showError = (errorCode: string) => {
    return createDialog({
        id: "pipeline-error",
        type: "small",
        meowbalt: "error",
        buttons: [
            {
                text: get(t)("button.gotit"),
                main: true,
                action: () => {},
            },
        ],
        bodyText: get(t)(`error.${errorCode}`),
    });
}

const extToMime: Record<string, string> = {
    mp4: "video/mp4",
    webm: "video/webm",
    mkv: "video/x-matroska",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    opus: "audio/opus",
    ogg: "audio/ogg",
    gif: "image/gif",
};

/**
 * 服务端返回单条 tunnel 时走队列中的 fetch 步骤，便于在处理队列里显示进度；
 * 完成后自动触发下载（与原先直接 fetch+blob 的体验一致）。
 */
export const createTunnelFetchPipeline = (
    tunnelUrl: string,
    outputFilename: string,
    request: CobaltSaveRequestBody,
    oldTaskId?: string,
) => {
    const parentId = oldTaskId || uuid();
    const ext = outputFilename.includes(".")
        ? outputFilename.split(".").pop()!.toLowerCase()
        : "mp4";
    const mimeType = extToMime[ext] || "application/octet-stream";
    const mediaType = (mimeType.startsWith("video/")
        ? "video"
        : mimeType.startsWith("audio/")
          ? "audio"
          : "file") as CobaltPipelineResultFileType;

    addItem({
        id: parentId,
        state: "waiting",
        pipeline: [
            {
                worker: "fetch",
                workerId: uuid(),
                parentId,
                workerArgs: { url: tunnelUrl },
            },
        ],
        canRetry: true,
        originalRequest: request,
        filename: outputFilename,
        mimeType,
        mediaType,
        autoDownloadOnComplete: true,
    });

    openQueuePopover();
};

export const createSavePipeline = (
    info: CobaltLocalProcessingResponse,
    request: CobaltSaveRequestBody,
    oldTaskId?: string
) => {
    // this is a pre-queue part of processing,
    // so errors have to be returned via a regular dialog

    if (!info.output?.filename || !info.output?.type) {
        return showError("pipeline.missing_response_data");
    }

    const parentId = oldTaskId || uuid();
    const pipeline: CobaltPipelineItem[] = [];

    // reverse is needed for audio (second item) to be downloaded first
    const tunnels = info.tunnel.reverse();

    for (const tunnel of tunnels) {
        pipeline.push({
            worker: "fetch",
            workerId: uuid(),
            parentId,
            workerArgs: {
                url: tunnel,
            },
        });
    }

    if (info.type !== "proxy") {
        let ffargs: string[];
        let workerType: 'encode' | 'remux';

        if (["merge", "mute", "remux"].includes(info.type)) {
            workerType = "remux";
            ffargs = makeRemuxArgs(info);
        } else if (info.type === "audio") {
            const args = makeAudioArgs(info);

            if (!args) {
                return showError("pipeline.missing_response_data");
            }

            workerType = "encode";
            ffargs = args;
        } else if (info.type === "gif") {
            workerType = "encode";
            ffargs = makeGifArgs();
        } else {
            console.error("unknown work type: " + info.type);
            return showError("pipeline.missing_response_data");
        }

        pipeline.push({
            worker: workerType,
            workerId: uuid(),
            parentId,
            dependsOn: pipeline.map(w => w.workerId),
            workerArgs: {
                files: [],
                ffargs,
                output: {
                    type: info.output.type,
                    format: info.output.filename.split(".").pop(),
                },
            },
        });
    }

    addItem({
        id: parentId,
        state: "waiting",
        pipeline,
        canRetry: true,
        originalRequest: request,
        filename: info.output.filename,
        mimeType: info.output.type,
        mediaType: getMediaType(info.output.type) || "file",
    });

    openQueuePopover();
}

export const getProgress = (item: CobaltQueueItem, currentTasks: CobaltCurrentTasks): number => {
    if (item.state === 'done' || item.state === 'error') {
        return 1;
    } else if (item.state === 'waiting') {
        return 0;
    }

    let sum = 0;
    for (const worker of item.pipeline) {
        if (item.pipelineResults[worker.workerId]) {
            sum += 1;
        } else {
            const task = currentTasks[worker.workerId];
            sum += (task?.progress?.percentage || 0) / 100;
        }
    }

    return sum / item.pipeline.length;
}
