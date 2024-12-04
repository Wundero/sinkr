import type { Peer } from "crossws";
import type { z } from "zod";
import crossws from "crossws/adapters/cloudflare-durable";

import type { ClientReceiveSchema } from "@sinkr/validators";

import { hooks } from "./hooks";

type ClientReception = z.infer<typeof ClientReceiveSchema>;

export const ws = crossws({
  hooks,
});

export function getPeers() {
  const firstPeer = ws.peers.values().next().value;
  if (!firstPeer) {
    console.log(
      "peer get: none",
      [...ws.peers].map((p) => p.id),
    );
    return new Set<Peer>();
  }
  const all = firstPeer.peers;
  console.log(
    "peer get",
    [...all].map((p) => p.id),
    [...ws.peers].map((p) => p.id),
  );
  return all;
}

export function getPeerMap() {
  const peers = getPeers();
  const map = new Map<string, Peer>();
  peers.forEach((p) => map.set(p.id, p));
  return map;
}

export function sendToPeer(peer: Peer, message: ClientReception) {
  console.log("Sending to peer", peer.id, message);
  peer.send(message);
}
