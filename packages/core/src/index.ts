export type DefaultEventMap = Record<string, unknown>;

export interface EventMap extends DefaultEventMap {}

export interface UserInfo {}

export const initEventSymbol: unique symbol = Symbol("sinkr-init");
export const countEventSymbol: unique symbol = Symbol("sinkr-count");
export const joinEventSymbol: unique symbol = Symbol("sinkr-join");
export const leaveEventSymbol: unique symbol = Symbol("sinkr-leave");
export const memberJoinEventSymbol: unique symbol = Symbol("sinkr-member-join");
export const memberLeaveEventSymbol: unique symbol =
  Symbol("sinkr-member-leave");

export const connectSymbol: unique symbol = Symbol("sinkr-connect");
export const disconnectSymbol: unique symbol = Symbol("sinkr-disconnect");
