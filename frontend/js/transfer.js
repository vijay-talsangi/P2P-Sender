/**
 * transfer.js — File chunking, backpressure management, and reassembly
 * Handles splitting files into 16KB chunks for sending via DataChannel,
 * and assembling received chunks into a downloadable Blob.
 */

class FileTransfer {
  constructor() {
    // ─── Constants ─────────────────────────────────────
    this.CHUNK_SIZE = 64 * 1024;                    // 64KB per chunk
    this.MAX_BUFFERED_AMOUNT = 8 * 1024 * 1024;     // 8MB pause threshold (keeps pipe full)
    this.LOW_THRESHOLD = 4 * 1024 * 1024;           // 4MB resume threshold (prevents network starvation)
    this.PROGRESS_THROTTLE_MS = 100;                // Update UI every 100ms

    // ─── Sender State ──────────────────────────────────
    this.sendingFile = null;
    this.sendOffset = 0;
    this.sendStartTime = 0;
    this.isSending = false;
    this.sendAborted = false;

    // ─── Receiver State ────────────────────────────────
    /** @type {ArrayBuffer[]} */
    this.receivedChunks = [];
    this.receivedBytes = 0;
    this.fileMeta = null;
    this.receiveStartTime = 0;

    // ─── Progress Throttle ─────────────────────────────
    this._lastProgressUpdate = 0;

    // ─── Callbacks ─────────────────────────────────────
    /** @type {(percent: number, speed: string, transferred: string, eta: string) => void} */
    this.onProgress = null;
    /** @type {(blob: Blob, fileName: string, fileSize: number) => void} */
    this.onReceiveComplete = null;
    /** @type {() => void} */
    this.onSendComplete = null;
    /** @type {(meta: {name: string, size: number, mimeType: string}) => void} */
    this.onFileMetaReceived = null;
    /** @type {(error: string) => void} */
    this.onError = null;
  }

  // ═══════════════════════════════════════════════════════
  // SENDER
  // ═══════════════════════════════════════════════════════

  /**
   * Send a file over the DataChannel with backpressure management.
   * @param {RTCDataChannel} dataChannel
   * @param {File} file
   */
  async sendFile(dataChannel, file) {
    this.sendingFile = file;
    this.sendOffset = 0;
    this.sendStartTime = performance.now();
    this.isSending = true;
    this.sendAborted = false;

    // 1. Send metadata
    const meta = {
      type: 'file-meta',
      name: file.name,
      size: file.size,
      mimeType: file.type || 'application/octet-stream',
    };
    dataChannel.send(JSON.stringify(meta));

    // 2. Configure backpressure threshold
    dataChannel.bufferedAmountLowThreshold = this.LOW_THRESHOLD;

    // 3. Send chunks
    try {
      while (this.sendOffset < file.size && !this.sendAborted) {
        // Backpressure check
        if (dataChannel.bufferedAmount > this.MAX_BUFFERED_AMOUNT) {
          await new Promise((resolve) => {
            dataChannel.addEventListener('bufferedamountlow', resolve, { once: true });
          });
        }

        // Check if channel is still open
        if (dataChannel.readyState !== 'open') {
          throw new Error('DataChannel closed during transfer');
        }

        // Read and send chunk
        const end = Math.min(this.sendOffset + this.CHUNK_SIZE, file.size);
        const chunk = file.slice(this.sendOffset, end);
        const buffer = await chunk.arrayBuffer();
        dataChannel.send(buffer);

        this.sendOffset = end;

        // Throttled progress update
        this._updateSendProgress(file.size);
      }

      if (!this.sendAborted) {
        // 4. Send end-of-file marker
        dataChannel.send(JSON.stringify({ type: 'file-complete' }));

        // Final progress update
        if (this.onProgress) {
          const elapsed = (performance.now() - this.sendStartTime) / 1000;
          const speed = this._formatSpeed(file.size / elapsed);
          this.onProgress(100, speed, this._formatBytes(file.size), '0s');
        }

        if (this.onSendComplete) this.onSendComplete();
      }
    } catch (err) {
      console.error('[Transfer] Send error:', err);
      if (this.onError) this.onError(err.message);
    } finally {
      this.isSending = false;
    }
  }

  /** Cancel an ongoing send */
  abortSend() {
    this.sendAborted = true;
  }

  /** Update send progress (throttled) */
  _updateSendProgress(totalSize) {
    const now = performance.now();
    if (now - this._lastProgressUpdate < this.PROGRESS_THROTTLE_MS) return;
    this._lastProgressUpdate = now;

    if (!this.onProgress) return;

    const elapsed = (now - this.sendStartTime) / 1000;
    const percent = Math.round((this.sendOffset / totalSize) * 100);
    const speed = elapsed > 0 ? this.sendOffset / elapsed : 0;
    const remaining = totalSize - this.sendOffset;
    const eta = speed > 0 ? remaining / speed : 0;

    this.onProgress(
      percent,
      this._formatSpeed(speed),
      this._formatBytes(this.sendOffset),
      this._formatTime(eta)
    );
  }

  // ═══════════════════════════════════════════════════════
  // RECEIVER
  // ═══════════════════════════════════════════════════════

  /**
   * Handle an incoming DataChannel message.
   * Dispatches to metadata handler or chunk accumulator.
   * @param {MessageEvent} event
   */
  handleMessage(event) {
    const data = event.data;

    // String messages are JSON control messages
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);

        if (msg.type === 'file-meta') {
          this._handleFileMeta(msg);
        } else if (msg.type === 'file-complete') {
          this._handleFileComplete();
        }
      } catch (err) {
        console.error('[Transfer] Invalid control message:', err);
      }
      return;
    }

    // Binary messages are file chunks
    if (data instanceof ArrayBuffer) {
      this._handleChunk(data);
    }
  }

  /** Handle incoming file metadata */
  _handleFileMeta(meta) {
    console.log('[Transfer] Receiving file:', meta.name, this._formatBytes(meta.size));

    this.fileMeta = {
      name: meta.name,
      size: meta.size,
      mimeType: meta.mimeType,
    };
    this.receivedChunks = [];
    this.receivedBytes = 0;
    this.receiveStartTime = performance.now();

    if (this.onFileMetaReceived) this.onFileMetaReceived(this.fileMeta);
  }

  /** Handle an incoming file chunk */
  _handleChunk(buffer) {
    this.receivedChunks.push(buffer);
    this.receivedBytes += buffer.byteLength;

    // Throttled progress update
    if (this.fileMeta) {
      this._updateReceiveProgress();
    }
  }

  /** Handle file-complete signal — assemble Blob */
  _handleFileComplete() {
    if (!this.fileMeta) return;

    console.log('[Transfer] File complete, assembling blob...');

    const blob = new Blob(this.receivedChunks, { type: this.fileMeta.mimeType });

    // Final progress
    if (this.onProgress) {
      const elapsed = (performance.now() - this.receiveStartTime) / 1000;
      const speed = this._formatSpeed(this.receivedBytes / elapsed);
      this.onProgress(100, speed, this._formatBytes(this.receivedBytes), '0s');
    }

    if (this.onReceiveComplete) {
      this.onReceiveComplete(blob, this.fileMeta.name, this.fileMeta.size);
    }

    // Clean up
    this.receivedChunks = [];
  }

  /** Update receive progress (throttled) */
  _updateReceiveProgress() {
    const now = performance.now();
    if (now - this._lastProgressUpdate < this.PROGRESS_THROTTLE_MS) return;
    this._lastProgressUpdate = now;

    if (!this.onProgress || !this.fileMeta) return;

    const elapsed = (now - this.receiveStartTime) / 1000;
    const percent = Math.round((this.receivedBytes / this.fileMeta.size) * 100);
    const speed = elapsed > 0 ? this.receivedBytes / elapsed : 0;
    const remaining = this.fileMeta.size - this.receivedBytes;
    const eta = speed > 0 ? remaining / speed : 0;

    this.onProgress(
      percent,
      this._formatSpeed(speed),
      this._formatBytes(this.receivedBytes),
      this._formatTime(eta)
    );
  }

  // ═══════════════════════════════════════════════════════
  // FORMATTERS
  // ═══════════════════════════════════════════════════════

  /**
   * Format bytes to human-readable string.
   * @param {number} bytes
   * @returns {string}
   */
  _formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const value = bytes / Math.pow(1024, i);
    return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  }

  /**
   * Format speed (bytes/sec) to human-readable string.
   * @param {number} bytesPerSec
   * @returns {string}
   */
  _formatSpeed(bytesPerSec) {
    if (bytesPerSec === 0) return '0 B/s';
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(1024));
    const value = bytesPerSec / Math.pow(1024, i);
    return `${value.toFixed(1)} ${units[Math.min(i, units.length - 1)]}`;
  }

  /**
   * Format seconds to mm:ss or a readable string.
   * @param {number} seconds
   * @returns {string}
   */
  _formatTime(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return '0s';
    if (seconds < 60) return `${Math.ceil(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.ceil(seconds % 60);
    return `${mins}m ${secs}s`;
  }

  /** Reset all state */
  reset() {
    this.sendingFile = null;
    this.sendOffset = 0;
    this.isSending = false;
    this.sendAborted = false;
    this.receivedChunks = [];
    this.receivedBytes = 0;
    this.fileMeta = null;
  }
}

window.FileTransfer = FileTransfer;
