import type { EventMap } from "./types";

type DefaultMap = Record<string, unknown>;

type EventKey = keyof EventMap;

export type RealEventMap = EventKey extends never ? DefaultMap : EventMap;
