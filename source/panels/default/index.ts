import { readFileSync } from 'fs-extra';
import { join } from 'path';
import { createApp, watch, App, ref } from 'vue';
import { PreviewFrame, PreviewConfig } from "../../scene/interfaces";

interface AppDispatcher {
    updateFrame (value : PreviewFrame) : void;
}

const panelDataMap = new WeakMap<any, App>();
const panelDispatcher = new WeakMap<any, AppDispatcher>();

module.exports = Editor.Panel.define({
    listeners: {
        show() {  },
        hide() {  }
    },
    template: readFileSync(join(__dirname, '../../../static/template/default/index.html'), 'utf-8'),
    style: readFileSync(join(__dirname, '../../../static/style/default/index.css'), 'utf-8'),
    $: {
        app: '#app'
    },
    methods: {
        frameUpdated(args: PreviewFrame) {
            const dispatcher = panelDispatcher.get(this);
            if(dispatcher)
            {
                dispatcher.updateFrame(args);
            }
        }
    },
    ready() {
        const appContainer = this.$.app;
        if (!appContainer) return;

        const panel = this;

        const app = createApp({
            setup() {
                const scaleFactor = ref<number>(1.0);
                const frameRate = ref<number>(0);

                const selectedCamera = ref('');
                const canvas = ref<HTMLCanvasElement | null>(null);

                const resolutionTitle = ref('');
                const imageRef = ref<HTMLImageElement>();

                const cameraChanged = (value: string) => {
                    selectedCamera.value = value
                }

                const scaleFactorChanged = (value: number) => {
                    scaleFactor.value = value
                }
                const frameRateChanged = (value: number) => {
                    frameRate.value = value
                }

                const requestRefresh = async () => {
                    await Editor.Message.request('scene', 'execute-scene-script', {
                        name: 'camera-preview-panel',
                        method: 'forceRefresh',
                        args: [selectedCamera.value],
                    })
                }

                watch(frameRate, async () => {
                    await Editor.Message.request('scene', 'execute-scene-script', {
                        name: 'camera-preview-panel',
                        method: 'updateConfig',
                        args: [selectedCamera.value, {
                            frameRate: frameRate.value
                        }],
                    })
                })

                watch(scaleFactor, async () => {
                    await Editor.Message.request('scene', 'execute-scene-script', {
                        name: 'camera-preview-panel',
                        method: 'updateConfig',
                        args: [selectedCamera.value, {
                            scale: scaleFactor.value
                        }],
                    })
                })

                watch(selectedCamera, async (cameraUUID, lastCameraUUID) => {
                    if(lastCameraUUID && lastCameraUUID != '')
                    {
                        await Editor.Message.request('scene', 'execute-scene-script', {
                            name: 'camera-preview-panel',
                            method: 'unwatchCamera',
                            args: [lastCameraUUID],
                        })
                    }
                    if(!cameraUUID || cameraUUID == '') return;

                    const response : PreviewConfig = await Editor.Message.request('scene', 'execute-scene-script', {
                        name: 'camera-preview-panel',
                        method: 'watchCamera',
                        args: [cameraUUID],
                    })

                    frameRate.value = response.frameRate;
                    scaleFactor.value = response.scale;
                })

                const updateFrame = (value : PreviewFrame) => {
                    if(value.cameraUUID != selectedCamera.value) return;

                    const canvasValue = canvas.value;
                    const ctx = canvasValue?.getContext('2d');
                    if(!canvasValue || !ctx) return;

                    const width = value.size.x;
                    const height = value.size.y;

                    const aspect = `${width} / ${height}`
                    const resChanged = canvasValue.style.aspectRatio != aspect;
                    if(resChanged)
                    {
                        canvasValue.style.aspectRatio = aspect;
                        canvasValue.width = width;
                        canvasValue.height = height;
                    }
                    resolutionTitle.value = ` (${width}x${height})`

                    if(resChanged || !imageRef.value)
                    {
                        const image = new Image(width, height);
                        image.onload = () => {
                            ctx.drawImage(image, 0, 0, width, height);
                        };
                        imageRef.value = image;
                    }
                    imageRef.value.src = `data:image/png;base64,${value.base64}`;
                }

                return {
                    canvas,
                    scaleFactor,
                    frameRate,
                    resolutionTitle,
                    selectedCamera,
                    frameRateChanged,
                    scaleFactorChanged,
                    cameraChanged,
                    requestRefresh,
                    updateFrame
                };
            },
            template: `
              <div id="top_panel">
                <div class="top_panel_line">
                  <ui-component id="selector" droppable="cc.Camera" v-model="selectedCamera" @change="cameraChanged($event.target.value)"></ui-component>
                  <ui-num-input v-model="frameRate" label="frame rate" step="1" min="0" max="30" id="frameRate" @change="frameRateChanged($event.target.value)"></ui-num-input>
                  <button @click="requestRefresh">refresh</button>
                </div>
                <div class="top_panel_line">
                  <ui-label style="padding-left:5px" value="Scaled resolution" />
                  <ui-slider style="flex-grow:1" v-model="scaleFactor" step="0.05" min="0.25" max="1.0" @change="scaleFactorChanged($event.target.value)" />
                  <ui-label style="padding-right:5px;min-width: 80px" v-model="resolutionTitle" />
                </div>
              </div>
              <canvas id="canvas" ref="canvas"></canvas>
            `
        });
        app.config.compilerOptions.isCustomElement = (tag) => tag.startsWith('ui-');

        //@ts-ignore
        const dispatcher : AppDispatcher = app.mount(appContainer) as AppDispatcher;

        panelDataMap.set(this, app);
        panelDispatcher.set(this, dispatcher);
    },
    beforeClose() { },
    close() {
        const app = panelDataMap.get(this);
        if (app) {
            app.unmount();
        }
    },
});