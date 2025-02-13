"use client";

import React, { useEffect, useMemo } from "react";

import type { EventMap, SinkrChannel, SinkrSink } from "@sinkr/core/client";
import { sink } from "@sinkr/core/client";

interface SinkrContext {
  sink: SinkrSink;
}

const SinkrContext = React.createContext<SinkrContext | null>(null);

/**
 * Props for the SinkrProvider component.
 * @param url The URL of the Sinkr server.
 * @param appId The app ID to use for the connection. Optional, ignored if the URL has an app ID already.
 * @param children The children to render.
 */
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
export function SinkrProvider({
  url,
  appId,
  children,
}: SinkrProviderProps): React.JSX.Element {
  const [sinkState, setSink] = React.useState<SinkrSink | null>(null);

  useEffect(() => {
    const sk = sink({ url, appId });
    setSink(sk);
    sk.connect();
    return () => {
      sk.disconnect();
    };
  }, [appId, url]);

  if (!sinkState) {
    return <>{children}</>;
  }

  return (
    <SinkrContext.Provider value={{ sink: sinkState }}>
      {children}
    </SinkrContext.Provider>
  );
}

/**
 * Get an event listener for all events.
 */
export function useSinkr(): SinkrSink | null {
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
 * @param channelId The channel ID.
 */
export function useSinkrChannel(channelId: string): SinkrChannel | null {
  const sinkr = useSinkr();

  const channel = useMemo(() => {
    return sinkr?.channel(channelId) ?? null;
  }, [channelId, sinkr]);

  return channel;
}

/**
 * Run a callback whenever the specified event is fired on the specified channel.
 * @param channelId The channel ID.
 * @param event The event to listen to.
 * @param callback A callback to run when the event is fired.
 */
export function useSinkrChannelEvent<
  TEvent extends keyof EventMap,
  TData extends EventMap[TEvent] = EventMap[TEvent],
>(channelId: string, event: TEvent, callback: (data: TData) => void) {
  const channel = useSinkrChannel(channelId);

  React.useEffect(() => {
    if (!channel) {
      return;
    }

    const unsubFn = channel.on(event, (data) => {
      callback(data as TData);
    });

    return () => {
      unsubFn();
    };
  }, [channel, event, callback]);
}
