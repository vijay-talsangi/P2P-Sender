/**
 * signaling.js — WebSocket signaling client
 * Manages connection to the signaling server and message routing.
 */

class SignalingClient {
  constructor() {
    /** @type {WebSocket|null} */
    this.ws = null;
    this.url = '';
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.reconnectDelay = 1000;
    this.intentionalClose = false;

    // Callbacks — set by the app controller
    /** @type {(roomId: string) => void} */
    this.onRoomCreated = null;
    /** @type {(roomId: string, isInitiator: boolean) => void} */
    this.onRoomJoined = null;
    /** @type {() => void} */
    this.onPeerJoined = null;
    /** @type {() => void} */
    this.onPeerLeft = null;
    /** @type {(sdp: RTCSessionDescriptionInit) => void} */
    this.onOffer = null;
    /** @type {(sdp: RTCSessionDescriptionInit) => void} */
    this.onAnswer = null;
    /** @type {(candidate: RTCIceCandidateInit) => void} */
    this.onIceCandidate = null;
    /** @type {(message: string) => void} */
    this.onError = null;
    /** @type {() => void} */
    this.onConnected = null;
    /** @type {() => void} */
    this.onDisconnected = null;
  }

  /**
   * Connect to the signaling server.
   * @param {string} url — WebSocket URL (e.g. ws://localhost:3000/ws)
   * @returns {Promise<void>}
   */
  connect(url) {
    this.url = url;
    this.intentionalClose = false;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }

      this.ws.onopen = () => {
        console.log('[Signaling] Connected');
        this.reconnectAttempts = 0;
        if (this.onConnected) this.onConnected();
        resolve();
      };

      this.ws.onmessage = (event) => {
        this._handleMessage(event.data);
      };

      this.ws.onclose = () => {
        console.log('[Signaling] Disconnected');
        if (this.onDisconnected) this.onDisconnected();

        if (!this.intentionalClose && this.reconnectAttempts < this.maxReconnectAttempts) {
          this._reconnect();
        }
      };

      this.ws.onerror = (err) => {
        console.error('[Signaling] Error', err);
        reject(err);
      };
    });
  }

  /** Close the connection intentionally */
  disconnect() {
    this.intentionalClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** Send a JSON message */
  _send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('[Signaling] Cannot send, WebSocket not open');
    }
  }

  /** Handle incoming messages */
  _handleMessage(raw) {
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      console.error('[Signaling] Invalid message:', raw);
      return;
    }

    switch (data.type) {
      case 'room-created':
        if (this.onRoomCreated) this.onRoomCreated(data.roomId);
        break;
      case 'room-joined':
        if (this.onRoomJoined) this.onRoomJoined(data.roomId, data.isInitiator);
        break;
      case 'peer-joined':
        if (this.onPeerJoined) this.onPeerJoined();
        break;
      case 'peer-left':
        if (this.onPeerLeft) this.onPeerLeft();
        break;
      case 'offer':
        if (this.onOffer) this.onOffer(data.sdp);
        break;
      case 'answer':
        if (this.onAnswer) this.onAnswer(data.sdp);
        break;
      case 'ice-candidate':
        if (this.onIceCandidate) this.onIceCandidate(data.candidate);
        break;
      case 'error':
        console.error('[Signaling] Server error:', data.message);
        if (this.onError) this.onError(data.message);
        break;
      case 'pong':
        break;
      default:
        console.warn('[Signaling] Unknown message type:', data.type);
    }
  }

  /** Reconnect with exponential backoff */
  _reconnect() {
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`[Signaling] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect(this.url).catch(() => {
        console.error('[Signaling] Reconnect failed');
      });
    }, delay);
  }

  // ─── Public API ──────────────────────────────────────────

  createRoom() {
    this._send({ type: 'create-room' });
  }

  joinRoom(roomId) {
    this._send({ type: 'join-room', roomId });
  }

  sendOffer(sdp) {
    this._send({ type: 'offer', sdp });
  }

  sendAnswer(sdp) {
    this._send({ type: 'answer', sdp });
  }

  sendIceCandidate(candidate) {
    this._send({ type: 'ice-candidate', candidate });
  }
}

// Export singleton
window.SignalingClient = SignalingClient;
