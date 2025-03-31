import {Camera, director, renderer, RenderTexture} from 'cc';
import Kefir, {Subscription} from 'kefir'
import {PreviewFrame, ConfigChange, PreviewConfig} from "./interfaces";

export interface CameraModel {
    renderTexture: RenderTexture,
    camera: Camera,
    sceneCamera: renderer.scene.Camera | undefined,
    sub: number
}

const defaultConfig : PreviewConfig = {
    frameRate: 15,
    scale: 1,
}

const globalDispatcher = Kefir.pool<string, unknown>()
const models = new Map<string, CameraModel>()
const configs = new Map<string, PreviewConfig>()
const streams = new Map<string, Subscription>()

function rebuildStream(cameraUUID: string, frameRate: number) {
    streams.get(cameraUUID)?.unsubscribe();

    const triggerManual = globalDispatcher.filter(value => value == cameraUUID);
    const intervalStream = frameRate > 0 ?
        Kefir.interval(1000 / frameRate, undefined) :
        Kefir.never();

    const sub = Kefir.merge([intervalStream, triggerManual])
        .observe(async _ => {
            const model = models.get(cameraUUID);
            if(!model) return;

            const config = configs.get(cameraUUID) ?? defaultConfig;
            const size = await Editor.Profile.getProject('project', 'general.designResolution') as {
                width: number;
                height: number;
            };
            const scaledSize = {
                width: size.width * config.scale,
                height: size.height * config.scale
            };

            const camera = model.camera;
            const renderTexture = model.renderTexture;

            if(renderTexture.width != scaledSize.width ||
                renderTexture.height != scaledSize.height)
            {
                renderTexture.reset(scaledSize);
            }

            //TODO: We need to find some other way to link sceneCamera and camera
            if(!model.sceneCamera)
            {
                model.sceneCamera = director.root?.cameraList.find(value => value.node == camera.node);
                if(model.sceneCamera)
                {
                    models.set(cameraUUID, model);
                }
            }

            const rt = camera.targetTexture;
            try {
                camera.targetTexture = renderTexture;
                model.sceneCamera?.update(true);
                director.tick(0.0)

                const args : PreviewFrame = {
                    cameraUUID: cameraUUID,
                    size: {
                        x: scaledSize.width,
                        y: scaledSize.height
                    },
                    base64: arrayBufferToBase64Inv(renderTexture.readPixels()!, scaledSize.width, scaledSize.height),
                };

                Editor.Message.broadcast('camera-preview-panel:frameUpdated', args);
            }
            catch(err) {
                console.error(err);
            }
            finally {
                camera.targetTexture = rt;
            }
        });
    streams.set(cameraUUID, sub);
}

function bindCameraIfRequired(cameraUUID: string, incrementUsage: boolean) {
    const record = models.get(cameraUUID);
    if(!record) {
        const scene = director.getScene();
        if (!scene) return;
        const all = scene.getComponentsInChildren(Camera);
        const camera = all.find(camera => camera.uuid == cameraUUID);
        if (!camera) return;

        models.set(camera.uuid, {
            camera: camera,
            sceneCamera: director.root?.cameraList.find(value => value.node == camera.node),
            renderTexture: new RenderTexture(`preview-${cameraUUID}`),
            sub: 1,
        });
        return;
    }
    if(incrementUsage) {
        record.sub++;
        models.set(cameraUUID, record);
    }
}

function arrayBufferToBase64Inv(buffer: ArrayBuffer, width: number, height: number) : string {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.style.aspectRatio = `${width}/${height}`;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(width, height);
    const data = new Uint8ClampedArray(buffer);
    const flippedData = new Uint8ClampedArray(width * height * 4);

    // Переворачиваем строки
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const srcIdx = (y * width + x) * 4;
            const dstIdx = ((height - 1 - y) * width + x) * 4;
            flippedData[dstIdx] = data[srcIdx];     // R
            flippedData[dstIdx + 1] = data[srcIdx + 1]; // G
            flippedData[dstIdx + 2] = data[srcIdx + 2]; // B
            flippedData[dstIdx + 3] = data[srcIdx + 3]; // A
        }
    }

    imageData.data.set(flippedData);
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL().split(',')[1];
}

export function unload() {
    streams.forEach(value => value.unsubscribe());
    streams.clear();
}

export const methods = {
    async fetchConfig(cameraUUID: string) {
        return configs.get(cameraUUID) ?? defaultConfig;
    },
    async updateConfig(cameraUUID: string, change: ConfigChange) {
        bindCameraIfRequired(cameraUUID, false);

        const record = configs.get(cameraUUID) ?? defaultConfig;
        const nextRecord = {
            frameRate: change?.frameRate ?? record?.frameRate,
            scale: change?.scale ?? record?.scale,
        } as PreviewConfig

        if (record != nextRecord) {
            configs.set(cameraUUID, nextRecord);
            if((streams.get(cameraUUID)?.closed ?? true) ||
                record.frameRate != nextRecord.frameRate)
            {
                rebuildStream(cameraUUID, nextRecord.frameRate);
            }
        }
    },
    async watchCamera(cameraUUID: string) {
        bindCameraIfRequired(cameraUUID, true);
        const config = configs.get(cameraUUID) ?? defaultConfig;
        if((streams.get(cameraUUID)?.closed ?? true)) {
            rebuildStream(cameraUUID, config.frameRate);
        }
        return config;
    },
    async unwatchCamera(cameraUUID: string) {
        const record = models.get(cameraUUID);
        if(!record) return;

        record.sub = Math.max(record.sub - 1, 0);
        models.set(cameraUUID, record);
        if(record.sub == 0) streams.get(cameraUUID)?.unsubscribe();
    },
    forceRefresh(cameraUUID: string) {
      globalDispatcher.plug(Kefir.constant(cameraUUID))
    }
};