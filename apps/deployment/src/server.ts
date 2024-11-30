import type { Peer } from "crossws";
import crossws from "crossws/adapters/cloudflare-durable";

import type { ClientReception } from "@sinkr/validators";

import { hooks } from "./hooks";

export const ws = crossws({
  hooks,
});

export function getPeers() {
  const firstPeer = ws.peers.values().next().value;
  if (!firstPeer) {
    return new Set<Peer>();
  }
  return firstPeer.peers;
}

export function getPeerMap() {
  const peers = getPeers();
  const map = new Map<string, Peer>();
  peers.forEach((p) => map.set(p.id, p));
  return map;
}

export function sendToPeer(peer: Peer, message: ClientReception) {
  peer.send(message);
}
