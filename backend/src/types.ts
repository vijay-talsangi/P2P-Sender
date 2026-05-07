import type { WSContext } from 'hono/ws';

// ─── Signaling Message Types ──────────────────────────────────────────

/** Messages sent from client to server */
export type ClientMessage =
  | { type: 'create-room' }
  | { type: 'join-room'; roomId: string }
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit }
  | { type: 'ping' };

/** Messages sent from server to client */
export type ServerMessage =
  | { type: 'room-created'; roomId: string }
  | { type: 'room-joined'; roomId: string; isInitiator: boolean }
  | { type: 'peer-joined' }
  | { type: 'peer-left' }
  | { type: 'offer'; sdp: RTCSessionDescriptionInit }
  | { type: 'answer'; sdp: RTCSessionDescriptionInit }
  | { type: 'ice-candidate'; candidate: RTCIceCandidateInit }
  | { type: 'error'; message: string }
  | { type: 'pong' };

// ─── Connection & Room Types ──────────────────────────────────────────

/** A tracked WebSocket connection with a stable ID */
export interface Connection {
  id: string;
  ws: WSContext;
}

export interface Peer {
  connId: string;
  id: string;
}

export interface Room {
  id: string;
  host: Peer;
  guest: Peer | null;
  createdAt: number;
}
