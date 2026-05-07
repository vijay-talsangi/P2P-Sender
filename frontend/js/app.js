/**
 * app.js — Main application controller
 * Orchestrates signaling, WebRTC, and file transfer modules.
 * Manages UI state machine and DOM interactions.
 */

(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════
  // DOM REFERENCES
  // ═══════════════════════════════════════════════════════

  const $ = (id) => document.getElementById(id);

  const views = {
    landing: $('view-landing'),
    room: $('view-room'),
    transfer: $('view-transfer'),
  };

  const dom = {
    // Landing
    btnCreate: $('btn-create'),
    btnJoin: $('btn-join'),
    inputRoomCode: $('input-room-code'),
    errorLanding: $('error-landing'),
    errorLandingText: $('error-landing-text'),

    // Room
    statusBadge: $('status-badge'),
    statusText: $('status-text'),
    roomCodeSection: $('room-code-section'),
    roomCodeBox: $('room-code-box'),
    roomCodeValue: $('room-code-value'),
    copyTooltip: $('copy-tooltip'),
    fileDropSection: $('file-drop-section'),
    fileDropZone: $('file-drop-zone'),
    fileInput: $('file-input'),
    selectedFile: $('selected-file'),
    fileName: $('file-name'),
    fileSize: $('file-size'),
    btnRemoveFile: $('btn-remove-file'),
    btnSend: $('btn-send'),
    waitingForFile: $('waiting-for-file'),

    // Transfer
    transferIcon: $('transfer-icon'),
    transferTitle: $('transfer-title'),
    transferStatusBadge: $('transfer-status-badge'),
    transferStatusText: $('transfer-status-text'),
    transferFileName: $('transfer-file-name'),
    transferFileSize: $('transfer-file-size'),
    progressLabel: $('progress-label'),
    progressPercent: $('progress-percent'),
    progressFill: $('progress-fill'),
    statSpeed: $('stat-speed'),
    statTransferred: $('stat-transferred'),
    statEta: $('stat-eta'),
    transferComplete: $('transfer-complete'),
    completeMessage: $('complete-message'),
    btnDownload: $('btn-download'),
    btnNewTransfer: $('btn-new-transfer'),
  };

  // ═══════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════

  let state = {
    currentView: 'landing',
    role: null,           // 'host' or 'guest'
    roomId: null,
    selectedFile: null,
    isConnected: false,
    isTransferring: false,
    receivedBlob: null,
    receivedFileName: null,
  };

  // ═══════════════════════════════════════════════════════
  // MODULE INSTANCES
  // ═══════════════════════════════════════════════════════

  const signaling = new window.SignalingClient();
  const webrtc = new window.WebRTCManager();
  const transfer = new window.FileTransfer();

  // ═══════════════════════════════════════════════════════
  // VIEW MANAGEMENT
  // ═══════════════════════════════════════════════════════

  function showView(viewName) {
    Object.values(views).forEach((v) => v.classList.remove('active'));
    views[viewName].classList.add('active');
    state.currentView = viewName;
  }

  function showError(message) {
    dom.errorLandingText.textContent = message;
    dom.errorLanding.style.display = 'flex';
    setTimeout(() => {
      dom.errorLanding.style.display = 'none';
    }, 5000);
  }

  function setStatus(statusClass, text) {
    dom.statusBadge.className = `status-badge ${statusClass}`;
    dom.statusText.textContent = text;
  }

  function setTransferStatus(statusClass, text) {
    dom.transferStatusBadge.className = `status-badge ${statusClass}`;
    dom.transferStatusText.textContent = text;
  }

  // ═══════════════════════════════════════════════════════
  // SIGNALING CALLBACKS
  // ═══════════════════════════════════════════════════════

  signaling.onRoomCreated = (roomId) => {
    state.roomId = roomId;
    state.role = 'host';

    dom.roomCodeValue.textContent = roomId;
    dom.roomCodeSection.style.display = '';
    dom.fileDropSection.style.display = 'none';
    dom.waitingForFile.style.display = 'none';

    setStatus('status-waiting', 'Waiting for peer…');
    showView('room');
  };

  signaling.onRoomJoined = async (roomId, isInitiator) => {
    state.roomId = roomId;
    state.role = 'guest';

    dom.roomCodeSection.style.display = 'none';
    dom.fileDropSection.style.display = 'none';
    dom.waitingForFile.style.display = 'none';

    setStatus('status-waiting', 'Connecting to peer…');
    showView('room');

    // Guest creates the connection and waits for offer
    await webrtc.createConnection(false);
  };

  signaling.onPeerJoined = async () => {
    setStatus('status-waiting', 'Peer found, connecting…');

    // Host creates the connection and initiates
    await webrtc.createConnection(true);
    webrtc.createOffer();
  };

  signaling.onPeerLeft = () => {
    state.isConnected = false;
    webrtc.close();

    if (state.currentView === 'transfer' && state.isTransferring) {
      setTransferStatus('status-disconnected', 'Peer disconnected');
    } else if (state.currentView === 'room') {
      setStatus('status-disconnected', 'Peer disconnected');
      dom.fileDropSection.style.display = 'none';
      dom.waitingForFile.style.display = 'none';

      if (state.role === 'host') {
        dom.roomCodeSection.style.display = '';
        setStatus('status-waiting', 'Waiting for peer…');
      }
    }
  };

  signaling.onOffer = (sdp) => {
    webrtc.handleOffer(sdp);
  };

  signaling.onAnswer = (sdp) => {
    webrtc.handleAnswer(sdp);
  };

  signaling.onIceCandidate = (candidate) => {
    webrtc.addIceCandidate(candidate);
  };

  signaling.onError = (message) => {
    if (state.currentView === 'landing') {
      showError(message);
      dom.btnCreate.disabled = false;
      dom.btnJoin.disabled = false;
    }
  };

  // ═══════════════════════════════════════════════════════
  // WEBRTC CALLBACKS
  // ═══════════════════════════════════════════════════════

  webrtc.onIceCandidate = (candidate) => {
    signaling.sendIceCandidate(candidate);
  };

  webrtc.onOffer = (sdp) => {
    signaling.sendOffer(sdp);
  };

  webrtc.onAnswer = (sdp) => {
    signaling.sendAnswer(sdp);
  };

  webrtc.onDataChannelOpen = () => {
    state.isConnected = true;
    setStatus('status-connected', 'Connected');

    if (state.role === 'host') {
      // Host is the sender — show file picker
      dom.roomCodeSection.style.display = 'none';
      dom.fileDropSection.style.display = '';
      dom.waitingForFile.style.display = 'none';
    } else {
      // Guest is the receiver — wait for file
      dom.waitingForFile.style.display = '';
      dom.fileDropSection.style.display = 'none';
    }
  };

  webrtc.onDataChannelMessage = (event) => {
    transfer.handleMessage(event);
  };

  webrtc.onDataChannelClose = () => {
    if (state.isTransferring) {
      setTransferStatus('status-disconnected', 'Connection lost');
    }
  };

  webrtc.onConnectionStateChange = (iceState) => {
    if (iceState === 'failed-permanent') {
      if (state.currentView === 'room') {
        setStatus('status-disconnected', 'Connection failed');
      }
    }
  };

  // ═══════════════════════════════════════════════════════
  // TRANSFER CALLBACKS
  // ═══════════════════════════════════════════════════════

  transfer.onProgress = (percent, speed, transferred, eta) => {
    dom.progressPercent.textContent = `${percent}%`;
    dom.progressFill.style.width = `${percent}%`;
    dom.statSpeed.textContent = speed;
    dom.statTransferred.textContent = transferred;
    dom.statEta.textContent = eta;
  };

  transfer.onSendComplete = () => {
    state.isTransferring = false;

    dom.transferIcon.textContent = '✅';
    dom.transferTitle.textContent = 'Sent!';
    setTransferStatus('status-complete', 'Transfer complete');
    dom.progressLabel.textContent = 'Complete';
    dom.transferComplete.style.display = '';
    dom.btnDownload.style.display = 'none';
    dom.completeMessage.textContent = 'File sent successfully!';
  };

  transfer.onFileMetaReceived = (meta) => {
    state.isTransferring = true;

    // Switch to transfer view
    dom.transferIcon.textContent = '📡';
    dom.transferTitle.textContent = 'Receiving…';
    dom.transferFileName.textContent = meta.name;
    dom.transferFileSize.textContent = formatBytes(meta.size);
    dom.progressFill.style.width = '0%';
    dom.progressPercent.textContent = '0%';
    dom.progressLabel.textContent = 'Receiving…';
    dom.statSpeed.textContent = '—';
    dom.statTransferred.textContent = '—';
    dom.statEta.textContent = '—';
    dom.transferComplete.style.display = 'none';
    setTransferStatus('status-transferring', 'Receiving…');

    showView('transfer');
  };

  transfer.onReceiveComplete = (blob, fileName, fileSize) => {
    state.isTransferring = false;
    state.receivedBlob = blob;
    state.receivedFileName = fileName;

    dom.transferIcon.textContent = '✅';
    dom.transferTitle.textContent = 'Received!';
    setTransferStatus('status-complete', 'Transfer complete');
    dom.progressLabel.textContent = 'Complete';
    dom.transferComplete.style.display = '';
    dom.btnDownload.style.display = '';
    dom.completeMessage.textContent = `${fileName} (${formatBytes(fileSize)}) received successfully!`;
  };

  // ═══════════════════════════════════════════════════════
  // DOM EVENT LISTENERS
  // ═══════════════════════════════════════════════════════

  // ─── Create Room ──────────────────────────────────────
  dom.btnCreate.addEventListener('click', async () => {
    dom.btnCreate.disabled = true;
    dom.errorLanding.style.display = 'none';

    try {
      await connectSignaling();
      signaling.createRoom();
    } catch {
      showError('Could not connect to server');
      dom.btnCreate.disabled = false;
    }
  });

  // ─── Join Room ────────────────────────────────────────
  dom.btnJoin.addEventListener('click', async () => {
    const code = dom.inputRoomCode.value.trim().toUpperCase();
    if (code.length < 4) {
      showError('Please enter a valid room code');
      return;
    }

    dom.btnJoin.disabled = true;
    dom.errorLanding.style.display = 'none';

    try {
      await connectSignaling();
      signaling.joinRoom(code);
    } catch {
      showError('Could not connect to server');
      dom.btnJoin.disabled = false;
    }
  });

  // ─── Room Code Input ─────────────────────────────────
  dom.inputRoomCode.addEventListener('input', () => {
    const val = dom.inputRoomCode.value.trim();
    dom.btnJoin.disabled = val.length < 4;
  });

  dom.inputRoomCode.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !dom.btnJoin.disabled) {
      dom.btnJoin.click();
    }
  });

  // ─── Copy Room Code ───────────────────────────────────
  dom.roomCodeBox.addEventListener('click', async () => {
    const code = dom.roomCodeValue.textContent;
    try {
      await navigator.clipboard.writeText(code);
      dom.copyTooltip.classList.add('visible');
      setTimeout(() => dom.copyTooltip.classList.remove('visible'), 1500);
    } catch {
      // Fallback: select text
      const range = document.createRange();
      range.selectNodeContents(dom.roomCodeValue);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(range);
    }
  });

  // ─── File Selection ───────────────────────────────────
  dom.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) selectFile(file);
  });

  // ─── Drag and Drop ────────────────────────────────────
  dom.fileDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dom.fileDropZone.classList.add('drag-over');
  });

  dom.fileDropZone.addEventListener('dragleave', () => {
    dom.fileDropZone.classList.remove('drag-over');
  });

  dom.fileDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dom.fileDropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) selectFile(file);
  });

  // ─── Remove File ──────────────────────────────────────
  dom.btnRemoveFile.addEventListener('click', () => {
    state.selectedFile = null;
    dom.selectedFile.style.display = 'none';
    dom.fileDropZone.style.display = '';
    dom.btnSend.disabled = true;
    dom.fileInput.value = '';
  });

  // ─── Send File ────────────────────────────────────────
  dom.btnSend.addEventListener('click', () => {
    if (!state.selectedFile || !webrtc.dataChannel) return;

    state.isTransferring = true;
    dom.btnSend.disabled = true;

    // Switch to transfer view
    dom.transferIcon.textContent = '📡';
    dom.transferTitle.textContent = 'Sending…';
    dom.transferFileName.textContent = state.selectedFile.name;
    dom.transferFileSize.textContent = formatBytes(state.selectedFile.size);
    dom.progressFill.style.width = '0%';
    dom.progressPercent.textContent = '0%';
    dom.progressLabel.textContent = 'Sending…';
    dom.statSpeed.textContent = '—';
    dom.statTransferred.textContent = '—';
    dom.statEta.textContent = '—';
    dom.transferComplete.style.display = 'none';
    setTransferStatus('status-transferring', 'Sending…');

    showView('transfer');

    // Start sending
    transfer.sendFile(webrtc.dataChannel, state.selectedFile);
  });

  // ─── Download ─────────────────────────────────────────
  dom.btnDownload.addEventListener('click', () => {
    if (!state.receivedBlob || !state.receivedFileName) return;

    const url = URL.createObjectURL(state.receivedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.receivedFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up after a delay
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });

  // ─── New Transfer ─────────────────────────────────────
  dom.btnNewTransfer.addEventListener('click', () => {
    state.selectedFile = null;
    state.isTransferring = false;
    state.receivedBlob = null;
    state.receivedFileName = null;
    transfer.reset();

    // Reset file input
    dom.fileInput.value = '';
    dom.selectedFile.style.display = 'none';
    dom.fileDropZone.style.display = '';
    dom.btnSend.disabled = true;

    if (state.isConnected) {
      if (state.role === 'host') {
        dom.fileDropSection.style.display = '';
        dom.waitingForFile.style.display = 'none';
      } else {
        dom.fileDropSection.style.display = 'none';
        dom.waitingForFile.style.display = '';
      }
      setStatus('status-connected', 'Connected');
      showView('room');
    } else {
      showView('landing');
      dom.btnCreate.disabled = false;
      dom.btnJoin.disabled = true;
      dom.inputRoomCode.value = '';
    }
  });

  // ═══════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════

  function selectFile(file) {
    state.selectedFile = file;
    dom.fileName.textContent = file.name;
    dom.fileSize.textContent = formatBytes(file.size);
    dom.selectedFile.style.display = 'flex';
    dom.fileDropZone.style.display = 'none';
    dom.btnSend.disabled = false;
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  }

  async function connectSignaling() {
    if (signaling.ws && signaling.ws.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    await signaling.connect(wsUrl);
  }

  // ═══════════════════════════════════════════════════════
  // INIT
  // ═══════════════════════════════════════════════════════

  console.log('[P2P Sender] App initialized');
})();
