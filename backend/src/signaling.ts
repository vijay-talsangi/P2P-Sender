import type { WSContext } from 'hono/ws';
import type { Room, Peer, Connection, ClientMessage, ServerMessage } from './types';

// ─── Connection & Room Manager ────────────────────────────────────────

/** All active connections, keyed by stable connection ID */
const connections = new Map<string, Connection>();

/** All active rooms, keyed by room code */
const rooms = new Map<string, Room>();

/** Maps connection ID → room ID */
const connToRoom = new Map<string, string>();

let nextConnId = 1;

const ROOM_CODE_LENGTH = 6;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I/O/0/1 to avoid confusion
const ROOM_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

// ─── Helpers ──────────────────────────────────────────────────────────

/** Generate a unique room code */
function generateRoomId(): string {
  let code: string;
  do {
    code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

/** Generate a unique peer display ID */
function generatePeerId(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** Send a typed message to a connection by ID */
function sendTo(connId: string, message: ServerMessage): void {
  const conn = connections.get(connId);
  if (!conn) return;
  try {
    conn.ws.send(JSON.stringify(message));
  } catch {
    // Connection may have closed
  }
}

/** Send directly on a WSContext (used when we have it in hand) */
function sendDirect(ws: WSContext, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // Connection may have closed
  }
}

/** Find the other peer's connId in a room */
function getOtherPeerConnId(room: Room, connId: string): string | null {
  if (room.host.connId === connId) return room.guest?.connId ?? null;
  if (room.guest?.connId === connId) return room.host.connId;
  return null;
}

// ─── Periodic Cleanup ─────────────────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.createdAt > ROOM_EXPIRY_MS) {
      sendTo(room.host.connId, { type: 'error', message: 'Room expired' });
      connToRoom.delete(room.host.connId);
      if (room.guest) {
        sendTo(room.guest.connId, { type: 'error', message: 'Room expired' });
        connToRoom.delete(room.guest.connId);
      }
      rooms.delete(id);
      console.log(`[Room ${id}] Expired and cleaned up`);
    }
  }
}, 60_000);

// ─── Connection Lifecycle ─────────────────────────────────────────────

/**
 * Register a new WebSocket connection. Returns the assigned connection ID.
 * Called from index.ts onOpen.
 */
export function registerConnection(ws: WSContext): string {
  const connId = `conn_${nextConnId++}`;
  connections.set(connId, { id: connId, ws });
  console.log(`[WS] New connection: ${connId}`);
  return connId;
}

/**
 * Update the WSContext for a connection (Hono may provide a new wrapper).
 * Called from index.ts onMessage before handling the message.
 */
export function refreshConnection(connId: string, ws: WSContext): void {
  const conn = connections.get(connId);
  if (conn) {
    conn.ws = ws;
  }
}

// ─── Message Handler ──────────────────────────────────────────────────

export function handleMessage(connId: string, ws: WSContext, raw: string | ArrayBuffer): void {
  // Always refresh the WSContext in case Hono created a new wrapper
  refreshConnection(connId, ws);

  let data: ClientMessage;
  try {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    data = JSON.parse(text);
  } catch {
    sendDirect(ws, { type: 'error', message: 'Invalid message format' });
    return;
  }

  switch (data.type) {
    case 'create-room': {
      if (connToRoom.has(connId)) {
        sendDirect(ws, { type: 'error', message: 'Already in a room' });
        return;
      }

      const roomId = generateRoomId();
      const peer: Peer = { connId, id: generatePeerId() };
      const room: Room = {
        id: roomId,
        host: peer,
        guest: null,
        createdAt: Date.now(),
      };

      rooms.set(roomId, room);
      connToRoom.set(connId, roomId);

      sendDirect(ws, { type: 'room-created', roomId });
      console.log(`[Room ${roomId}] Created by ${connId} (peer ${peer.id})`);
      break;
    }

    case 'join-room': {
      if (connToRoom.has(connId)) {
        sendDirect(ws, { type: 'error', message: 'Already in a room' });
        return;
      }

      const roomId = data.roomId.toUpperCase().trim();
      const room = rooms.get(roomId);

      if (!room) {
        sendDirect(ws, { type: 'error', message: 'Room not found' });
        return;
      }

      if (room.guest) {
        sendDirect(ws, { type: 'error', message: 'Room is full' });
        return;
      }

      const peer: Peer = { connId, id: generatePeerId() };
      room.guest = peer;
      connToRoom.set(connId, roomId);

      // Tell guest they joined (they should wait for offer)
      sendDirect(ws, { type: 'room-joined', roomId, isInitiator: false });

      // Tell host a peer joined (host will create offer)
      sendTo(room.host.connId, { type: 'peer-joined' });

      console.log(`[Room ${roomId}] ${connId} (peer ${peer.id}) joined`);
      break;
    }

    case 'offer':
    case 'answer':
    case 'ice-candidate': {
      const roomId = connToRoom.get(connId);
      if (!roomId) {
        sendDirect(ws, { type: 'error', message: 'Not in a room' });
        console.log(`[WS] ${connId} tried to send ${data.type} but is not in a room`);
        return;
      }

      const room = rooms.get(roomId);
      if (!room) {
        sendDirect(ws, { type: 'error', message: 'Room not found' });
        return;
      }

      const otherConnId = getOtherPeerConnId(room, connId);
      if (!otherConnId) {
        sendDirect(ws, { type: 'error', message: 'No peer connected' });
        return;
      }

      // Forward the message to the other peer
      sendTo(otherConnId, data as ServerMessage);
      console.log(`[Room ${roomId}] Forwarded ${data.type} from ${connId} → ${otherConnId}`);
      break;
    }

    case 'ping': {
      sendDirect(ws, { type: 'pong' });
      break;
    }

    default:
      sendDirect(ws, { type: 'error', message: 'Unknown message type' });
  }
}

// ─── Disconnect Handler ───────────────────────────────────────────────

export function handleClose(connId: string): void {
  const roomId = connToRoom.get(connId);
  connToRoom.delete(connId);
  connections.delete(connId);

  if (!roomId) {
    console.log(`[WS] ${connId} disconnected (not in a room)`);
    return;
  }

  const room = rooms.get(roomId);
  if (!room) return;

  if (room.host.connId === connId) {
    // Host left — notify guest and destroy room
    if (room.guest) {
      sendTo(room.guest.connId, { type: 'peer-left' });
      connToRoom.delete(room.guest.connId);
    }
    rooms.delete(roomId);
    console.log(`[Room ${roomId}] Host (${connId}) left, room destroyed`);
  } else if (room.guest?.connId === connId) {
    // Guest left — notify host, keep room open for new guest
    room.guest = null;
    sendTo(room.host.connId, { type: 'peer-left' });
    console.log(`[Room ${roomId}] Guest (${connId}) left, room still open`);
  }
}

export function handleError(connId: string, error: Event): void {
  console.error(`[WS Error] ${connId}:`, error);
  handleClose(connId);
}
