import { Vector2 } from "../models/Vector2";

export interface PreviewConfig {
    frameRate: number;
    scale: number;
}

export interface ConfigChange {
    frameRate?: number;
    scale?: number;
}

export interface PreviewFrame {
    cameraUUID: string,
    base64: string,
    size: Vector2
}