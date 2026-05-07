import { Hono } from 'hono';
import { createBunWebSocket } from 'hono/bun';
import { serveStatic } from 'hono/bun';
import { cors } from 'hono/cors';
import { registerConnection, handleMessage, handleClose, handleError } from './signaling';
import * as crypto from 'crypto';

const app = new Hono();
const { upgradeWebSocket, websocket } = createBunWebSocket();

// ─── Middleware ────────────────────────────────────────────────────────

app.use('/api/*', cors());

// ─── Health Check ─────────────────────────────────────────────────────

app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: Date.now() }));

// ─── TURN Credentials ──────────────────────────────────────────────────

app.get('/api/turn-credentials', (c) => {
  const secret = process.env.TURN_SECRET!;
  const ttl = 600; // 10 minutes
  const username = String(Math.floor(Date.now() / 1000) + ttl);
  const credential = crypto.createHmac('sha1', secret).update(username).digest('base64');

  return c.json({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: process.env.TURN_URL,
        username,
        credential
      }
    ]
  });
});

// ─── WebSocket Signaling ──────────────────────────────────────────────

app.get(
  '/ws',
  upgradeWebSocket(() => {
    // This closure is created once per connection upgrade.
    // We use it to store the stable connection ID.
    let connId: string = '';

    return {
      onOpen: (_event, ws) => {
        connId = registerConnection(ws);
      },
      onMessage: (event, ws) => {
        handleMessage(connId, ws, event.data as string);
      },
      onClose: (_event, _ws) => {
        console.log(`[WS] ${connId} closed`);
        handleClose(connId);
      },
      onError: (event, _ws) => {
        handleError(connId, event);
      },
    };
  })
);

// ─── Static Files (Frontend) ──────────────────────────────────────────

app.use('/*', serveStatic({ root: '../frontend' }));
app.get('*', serveStatic({ path: '../frontend/index.html' }));

// ─── Server Export ────────────────────────────────────────────────────

const port = parseInt(process.env.PORT || '3000', 10);

console.log(`
╔══════════════════════════════════════════╗
║   🚀 P2P File Sender — Server Ready     ║
║   → http://localhost:${port}                ║
║   → WebSocket: ws://localhost:${port}/ws    ║
╚══════════════════════════════════════════╝
`);

export default {
  fetch: app.fetch,
  websocket,
  port,
};
