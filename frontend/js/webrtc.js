/**
 * webrtc.js — WebRTC peer connection manager
 * Handles RTCPeerConnection lifecycle, DataChannel setup,
 * ICE candidate exchange, and automatic retry on failure.
 */

class WebRTCManager {
  constructor() {
    /** @type {RTCPeerConnection|null} */
    this.pc = null;
    /** @type {RTCDataChannel|null} */
    this.dataChannel = null;
    this.isInitiator = false;
    this.iceRetryCount = 0;
    this.maxIceRetries = 3;

    /** @type {RTCIceCandidateInit[]} */
    this.pendingCandidates = [];
    this.remoteDescriptionSet = false;

    // Initial basic ICE config. Overridden dynamically by fetchIceServers()
    this.iceConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10,
    };

    // Callbacks
    /** @type {(candidate: RTCIceCandidateInit) => void} */
    this.onIceCandidate = null;
    /** @type {(sdp: RTCSessionDescriptionInit) => void} */
    this.onOffer = null;
    /** @type {(sdp: RTCSessionDescriptionInit) => void} */
    this.onAnswer = null;
    /** @type {() => void} */
    this.onDataChannelOpen = null;
    /** @type {(event: MessageEvent) => void} */
    this.onDataChannelMessage = null;
    /** @type {() => void} */
    this.onDataChannelClose = null;
    /** @type {(state: string) => void} */
    this.onConnectionStateChange = null;
  }

  /**
   * Fetch secure ICE config from backend before connection setup.
   */
  async fetchIceServers() {
    try {
      // In advanced scenarios, you can request an ephemeral (short-lived) turn credential mapping
      const res = await fetch('/api/turn-credentials');
      if (res.ok) {
        const data = await res.json();
        if (data.iceServers) {
          this.iceConfig.iceServers = data.iceServers;
        }
      }
    } catch (err) {
      console.warn('[WebRTC] Could not fetch TURN credentials, falling back to STUN auto-defaults:', err);
    }
  }

  /**
   * Create a new peer connection.
   * @param {boolean} isInitiator — true if this peer creates the offer
   */
  async createConnection(isInitiator) {
    this.isInitiator = isInitiator;
    this.iceRetryCount = 0;
    this.pendingCandidates = [];
    this.remoteDescriptionSet = false;

    // Clean up any existing connection
    this.close();

    await this.fetchIceServers();

    try {
      this.pc = new RTCPeerConnection(this.iceConfig);
    } catch (err) {
      console.error('[WebRTC] Failed to create RTCPeerConnection:', err);
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange('failed-permanent');
      }
      return;
    }

    // ─── ICE Candidate Events ─────────────────────────
    this.pc.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidate) {
        this.onIceCandidate(event.candidate.toJSON());
      }
    };

    // ─── Connection State Monitoring ──────────────────
    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      console.log('[WebRTC] ICE connection state:', state);

      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(state);
      }

      if (state === 'failed') {
        this._handleIceFailure();
      } else if (state === 'disconnected') {
        // Wait a bit — might recover on its own
        setTimeout(() => {
          if (this.pc && this.pc.iceConnectionState === 'disconnected') {
            this._handleIceFailure();
          }
        }, 5000);
      }
    };

    this.pc.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state:', this.pc.connectionState);
    };

    if (isInitiator) {
      // Create DataChannel
      this.dataChannel = this.pc.createDataChannel('fileTransfer', {
        ordered: true,
      });
      this._setupDataChannel(this.dataChannel);
    } else {
      // Wait for DataChannel from initiator
      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this._setupDataChannel(this.dataChannel);
      };
    }
  }

  /** Set up DataChannel event handlers */
  _setupDataChannel(channel) {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      console.log('[WebRTC] DataChannel open');
      if (this.onDataChannelOpen) this.onDataChannelOpen();
    };

    channel.onmessage = (event) => {
      if (this.onDataChannelMessage) this.onDataChannelMessage(event);
    };

    channel.onclose = () => {
      console.log('[WebRTC] DataChannel closed');
      if (this.onDataChannelClose) this.onDataChannelClose();
    };

    channel.onerror = (err) => {
      console.error('[WebRTC] DataChannel error:', err);
    };
  }

  /** Handle ICE connection failure with retry */
  _handleIceFailure() {
    if (this.iceRetryCount >= this.maxIceRetries) {
      console.error('[WebRTC] Max ICE retries exceeded');
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange('failed-permanent');
      }
      return;
    }

    this.iceRetryCount++;
    console.log(`[WebRTC] ICE restart attempt ${this.iceRetryCount}/${this.maxIceRetries}`);

    if (this.pc && this.isInitiator) {
      this.pc.restartIce();
      this.createOffer(true);
    }
  }

  /**
   * Create and return an SDP offer.
   * @param {boolean} iceRestart — if true, include iceRestart in offer
   */
  async createOffer(iceRestart = false) {
    if (!this.pc) return;

    try {
      const offer = await this.pc.createOffer({
        iceRestart,
      });
      await this.pc.setLocalDescription(offer);

      if (this.onOffer) {
        this.onOffer(this.pc.localDescription.toJSON());
      }
    } catch (err) {
      console.error('[WebRTC] Error creating offer:', err);
    }
  }

  /**
   * Handle an incoming SDP offer and create an answer.
   * @param {RTCSessionDescriptionInit} sdp
   */
  async handleOffer(sdp) {
    if (!this.pc) return;

    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      this.remoteDescriptionSet = true;

      // Process any queued ICE candidates
      await this._processQueuedCandidates();

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      if (this.onAnswer) {
        this.onAnswer(this.pc.localDescription.toJSON());
      }
    } catch (err) {
      console.error('[WebRTC] Error handling offer:', err);
    }
  }

  /**
   * Handle an incoming SDP answer.
   * @param {RTCSessionDescriptionInit} sdp
   */
  async handleAnswer(sdp) {
    if (!this.pc) return;

    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
      this.remoteDescriptionSet = true;

      // Process any queued ICE candidates
      await this._processQueuedCandidates();
    } catch (err) {
      console.error('[WebRTC] Error handling answer:', err);
    }
  }

  /**
   * Add an ICE candidate (queued if remote description not yet set).
   * @param {RTCIceCandidateInit} candidate
   */
  async addIceCandidate(candidate) {
    if (!this.pc) return;

    if (!this.remoteDescriptionSet) {
      this.pendingCandidates.push(candidate);
      return;
    }

    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('[WebRTC] Error adding ICE candidate:', err);
    }
  }

  /** Process queued ICE candidates */
  async _processQueuedCandidates() {
    for (const candidate of this.pendingCandidates) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('[WebRTC] Error adding queued ICE candidate:', err);
      }
    }
    this.pendingCandidates = [];
  }

  /** Close and clean up the connection */
  close() {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.remoteDescriptionSet = false;
    this.pendingCandidates = [];
  }
}

window.WebRTCManager = WebRTCManager;
