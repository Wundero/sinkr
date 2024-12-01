"use client";

import React, { useMemo } from "react";

import type { Channel, EventMap, PresenceChannel, Sinker } from "@sinkr/core";
import { sink } from "@sinkr/core";

interface SinkrContext {
  sink: Sinker;
}

const SinkrContext = React.createContext<SinkrContext | null>(null);

export interface SinkrProviderProps {
  url: string;
  appId?: string;
  children: React.ReactNode;
}

/**
 * Create a SinkrProvider to provide the sink instance to the children.
 *
 * All children of this provider can call `useSinkr` or `useSinkrChannel` to get an event listener for the sink.
 */
export function SinkrProvider({ url, appId, children }: SinkrProviderProps) {
  const memoizedSink = useMemo(() => {
    return sink({
      url,
      appId,
    });
  }, [url, appId]);

  return (
    <SinkrContext.Provider value={{ sink: memoizedSink }}>
      {children}
    </SinkrContext.Provider>
  );
}

/**
 * Get an event listener for all events.
 */
export function useSinkr() {
  const context = React.useContext(SinkrContext);
  if (!context) {
    return null;
  }
  return context.sink;
}

/**
 * Run a callback whenever the specified event is fired.
 * @param event The event to listen to.
 * @param callback A callback to run when the event is fired.
 */
export function useSinkrEvent<
  TEvent extends keyof EventMap,
  TData extends EventMap[TEvent] = EventMap[TEvent],
>(event: TEvent, callback: (data: TData) => void) {
  const sinkr = useSinkr();
  React.useEffect(() => {
    if (!sinkr) {
      return;
    }
    const unsubFn = sinkr.on(event, (data) => {
      callback(data.message as TData);
    });
    return () => {
      unsubFn();
    };
  }, [sinkr, event, callback]);
}

/**
 * Get an event listener for a specific channel.
 * @param channel The channel name.
 */
export function useSinkrChannel(channel: string): Channel | null;
export function useSinkrChannel(
  channel: `presence-${string}`,
): PresenceChannel | null;
export function useSinkrChannel(
  channel: string,
): Channel | PresenceChannel | null {
  const sinkr = useSinkr();
  return sinkr?.channel(channel) ?? null;
}

/**
 * Run a callback whenever the specified event is fired on the specified channel.
 * @param channel The channel name.
 * @param event The event to listen to.
 * @param callback A callback to run when the event is fired.
 */
export function useSinkrChannelEvent<
  TEvent extends keyof EventMap,
  TData extends EventMap[TEvent] = EventMap[TEvent],
>(channel: string, event: TEvent, callback: (data: TData) => void) {
  const ch = useSinkrChannel(channel);
  React.useEffect(() => {
    if (!ch) {
      return;
    }
    const unsubFn = ch.on(event, (data) => {
      callback(data as TData);
    });
    return () => {
      unsubFn();
    };
  }, [ch, event, callback]);
}
