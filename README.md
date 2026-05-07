# P2P Sender

> **Share files instantly, peer-to-peer. No uploads. No size limits. Fully encrypted.**

A modern, lightweight web application for direct peer-to-peer file transfers using WebRTC. Transfer files of any size between devices with zero intermediary servers, end-to-end encryption, and real-time progress tracking.

![Status](https://img.shields.io/badge/status-active-brightgreen)
![Node.js](https://img.shields.io/badge/runtime-Node.js%20%7C%20Bun-black)
![TypeScript](https://img.shields.io/badge/language-TypeScript-blue)

---

## ✨ Features

- **True P2P Transfers** — Files are transferred directly between peers using WebRTC data channels. No files ever touch the server.
- **No Size Limits** — Transfer files as large as your disk storage. The server only facilitates initial connection (signaling), not data transfer.
- **Encrypted** — All data is encrypted during transfer. The connection is established directly peer-to-peer.
- **Room-Based Sharing** — Create or join a room using a simple 6-character code. Perfect for sharing with a single peer or inviting others.
- **Real-Time Progress** — Live transfer speed, bytes transferred, and ETA calculation.
- **Drag & Drop** — Intuitive file selection via drag-and-drop or file picker.
- **Cross-Platform** — Works on any modern browser with WebRTC support (Chrome, Firefox, Safari, Edge).
- **Responsive Design** — Beautiful glass-morphism UI that works on desktop, tablet, and mobile.

---

## 🏗️ Architecture

### Overview

P2P Sender uses a **signaling-only server pattern**:

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (Sender)                     │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Frontend (HTML/CSS/JS)                         │   │
│  │  ├─ Signaling Client                            │   │
│  │  ├─ WebRTC Manager                              │   │
│  │  └─ File Transfer Engine                        │   │
│  └─────────────────────────────────────────────────┘   │
│                    ↕ WebSocket (signaling only)         │
├─────────────────────────────────────────────────────────┤
│            Backend (Node.js/Bun + Hono)                 │
│  ├─ WebSocket Server (signaling)                        │
│  ├─ TURN/STUN Configuration                             │
│  └─ Static Frontend Serving                             │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  ═══════════════════════════════════════════════════    │
│              Direct P2P Connection (WebRTC)             │
│             (File transfer - no server)                 │
│  ═══════════════════════════════════════════════════    │
│                                                          │
└─────────────────────────────────────────────────────────┘
                        ↕ WebRTC Data Channel
                  (Encrypted file transfer)
         ↙                                    ↘
    ┌──────────────────────┐      ┌──────────────────────┐
    │ Browser (Receiver)   │      │ Browser (Receiver 2) │
    │ - Receives files     │      │ - Can join room      │
    │ - Download with      │      │ - Waiting for file   │
    │   single click       │      │ - Download ready     │
    └──────────────────────┘      └──────────────────────┘
```

### Key Components

**Backend:**
- **Hono Web Framework** — Lightweight, fast HTTP framework built on Web Standards
- **WebSocket Server** — Handles signaling messages for peer discovery and SDP/ICE exchange
- **Room Manager** — Manages temporary rooms with 30-minute auto-expiry
- **TURN/STUN Configuration** — Provides NAT traversal for peers behind firewalls

**Frontend:**
- **SignalingClient** — Manages WebSocket connection and negotiation messages
- **WebRTCManager** — Handles ICE candidate gathering, SDP offer/answer, and data channel setup
- **FileTransfer** — Breaks files into chunks, sends over data channel, tracks progress
- **UI State Machine** — Three main views: Landing → Room → Transfer

---

## 🛠️ Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Runtime** | Node.js / Bun | 18+ / latest |
| **Backend** | Hono | ^4.7.0 |
| **Frontend** | Vanilla JavaScript | ES2020+ |
| **Real-Time** | WebRTC | Native API |
| **Styling** | CSS3 | Modern (Grid, Flexbox, Animations) |
| **Language** | TypeScript | ^5.7.0 |
| **Package Manager** | Bun (recommended) | latest |

---

## 📋 Prerequisites

- **Node.js 18+** or **Bun** (recommended for better performance)
- **Modern Browser** with WebRTC support (Chrome, Firefox, Safari, Edge)
- **TURN Server Credentials** (optional, but recommended for NAT traversal behind corporate firewalls)

### Optional: TURN Server

For reliable connections behind restrictive firewalls, configure a TURN server:

- **Google's STUN servers** — Already configured as fallback (free, public)
- **Custom TURN server** — See [Environment Variables](#environment-variables)

---

## 🚀 Installation

### Clone the Repository

```bash
git clone https://github.com/yourusername/p2p-sender.git
cd p2p-sender
```

### Option 1: Using Bun (Recommended)

```bash
# Install Bun if not already installed
curl -fsSL https://bun.sh/install | bash

# Install backend dependencies
cd backend
bun install

# Start development server
bun run dev

# In another terminal, start the frontend (or just serve via backend)
# Frontend is already served from backend at http://localhost:3000
```

### Option 2: Using npm/Node.js

```bash
# Install dependencies
cd backend
npm install

# Start server
npm run dev
```

---

## 💻 Usage

### Getting Started

1. **Open the Application** — Navigate to `http://localhost:3000` in your browser
2. **Create a Room** — Click "Create Room" to generate a 6-character room code
3. **Share the Code** — Send the code to the peer you want to transfer files with
4. **Join the Room** — Peer enters the code and clicks "Join Room"
5. **Select & Send** — Once connected, the sender drags/selects a file and sends it
6. **Download** — Receiver gets a download button when the file arrives

### Workflow Examples

#### Scenario 1: Transfer a File from Desktop to Laptop

```
Desktop                          Laptop
  │                                │
  ├─ Open localhost:3000           │
  ├─ Click "Create Room"           │
  ├─ Get code: ABC123    ◄────────┐│
  │                                ││
  │                           ┌────┘│
  │                           │     │
  │                      Enter ABC123
  │                      Click "Join"
  │                                │
  ├─ Connected! ◄────────────────┤ Connected!
  │ (Sender UI active)             │ (Receiver mode)
  │                                │
  ├─ Select large_file.zip         │
  ├─ Click "Send"                  │
  │ (Sending... 45 MB/s)           │
  │                           Receiving...
  │                           (Progress bar)
  │                                │
  └─ Transfer Complete! ◄──────────┤
                                    │
                               Click Download
                               File saved ✓
```

#### Scenario 2: Transfer Multiple Files

After the first transfer completes:
- Sender: Click "New Transfer" to reset the UI
- Select the next file
- Repeat

---

## 📂 Project Structure

```
P2P-Sender/
├── backend/                          # Node.js/Bun server
│   ├── src/
│   │   ├── index.ts                 # Server entry point, HTTP & WebSocket setup
│   │   ├── signaling.ts             # Room manager, peer coordination logic
│   │   └── types.ts                 # TypeScript type definitions
│   ├── package.json                 # Backend dependencies (Hono, etc.)
│   ├── tsconfig.json                # TypeScript configuration
│   └── bunfig.toml                  # Bun configuration (if using Bun)
│
├── frontend/                         # Web UI
│   ├── index.html                   # Main HTML (three views: landing, room, transfer)
│   ├── css/
│   │   └── styles.css               # Modern glass-morphism design
│   └── js/
│       ├── app.js                   # Main controller, event handlers, state management
│       ├── signaling.js             # WebSocket client for signaling
│       ├── webrtc.js                # WebRTC connection setup & management
│       └── transfer.js              # File chunking, transmission, progress tracking
│
├── README.md                         # This file
└── .gitignore                        # Git ignore rules
```

### Backend File Descriptions

- **index.ts** — Hono server setup, routes, WebSocket upgrade, TURN credentials endpoint
- **signaling.ts** — Room creation/joining logic, peer coordination, message routing
- **types.ts** — Shared TypeScript interfaces for type safety

### Frontend File Descriptions

- **app.js** — Main orchestrator; manages UI state, connects modules, handles user interactions
- **signaling.js** — WebSocket client for signaling (SDP, ICE candidates, room messages)
- **webrtc.js** — WebRTC peer connection setup, offer/answer negotiation, data channel events
- **transfer.js** — File transmission engine; chunking, progress calculation, error handling

---

## ⚙️ Environment Variables

Create a `.env` file in the `backend/` directory (or set these in your deployment):

```bash
# Server Configuration
PORT=3000                           # Server port (default: 3000)

# TURN Server (Optional but recommended for NAT traversal)
TURN_URL=turn:turnserver.example.com:3478
TURN_SECRET=your_secret
```

### Notes

- If `TURN_*` variables are not set, the server falls back to Google's public STUN servers
- TURN servers are essential for users behind restrictive firewalls or corporate proxies
- Popular TURN server providers: Twilio, Xirsys, Coturn (self-hosted)

---

## 🏗️ Building & Deployment

### Development

```bash
cd backend
bun run dev
# Server starts at http://localhost:3000 with hot reload
```

### Production Build

```bash
cd backend
# Using Bun
bun run start

# Using npm
npm run start
```

### Docker Deployment (Example Dockerfile)

```dockerfile
FROM oven/bun:latest

WORKDIR /app

COPY backend/package.json backend/bun.lock* ./
RUN bun install

COPY backend/src ./src
COPY frontend ../frontend

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
```

### Deployment to Cloud

**Vercel (Bun):**
```bash
vercel deploy
```

**Docker Compose:**
```yaml
version: '3.8'
services:
  p2p-sender:
    build: .
    ports:
      - "3000:3000"
    environment:
      PORT: 3000
      TURN_URL: ${TURN_URL}
      TURN_USERNAME: ${TURN_USERNAME}
      TURN_PASSWORD: ${TURN_PASSWORD}
```

---

## 🔍 How It Works

### Connection Flow

1. **Signaling** — Peers connect to the server via WebSocket and exchange SDP (Session Description Protocol) offers/answers
2. **ICE Gathering** — Each peer gathers ICE candidates (potential connection routes)
3. **Peer Connection** — Peers establish a direct P2P connection using the best available candidate
4. **Data Channel** — Once connected, a data channel opens for file transfer
5. **File Transfer** — File is chunked and sent over the encrypted data channel

### File Transfer Protocol

- Files are split into 16KB chunks
- Each chunk is sent as a binary message over the WebRTC data channel
- Receiver reassembles chunks and creates a Blob
- Progress is calculated and updated in real-time
- ETA is computed based on current transfer speed

### Security

- **End-to-End Encryption** — WebRTC automatically encrypts data in transit (DTLS-SRTP)
- **No Server-Side Storage** — Files never touch the backend server storage
- **Temporary Rooms** — Rooms expire after 30 minutes of inactivity
- **Direct Connection** — No routing through centralized servers after peer discovery

---

## 🐛 Troubleshooting

### Connection Issues

**Problem:** Two peers can't connect

**Solutions:**
1. Verify both peers are in the same room (same code)
2. Check browser console for errors (`F12` → Console tab)
3. Ensure firewall allows WebRTC connections
4. Configure TURN server if behind corporate firewall
5. Try a different browser or network

### Transfer is Slow

**Causes & Fixes:**
- **Network Congestion** — Try during off-peak hours or use a wired connection
- **WiFi Issues** — Use Ethernet cable if available
- **Distance Between Peers** — Geographic distance affects connection quality
- **TURN Relay** — If using TURN server, direct connection is faster than relay

### File Appears to Hang

**Solutions:**
1. Check browser console for JavaScript errors
2. Verify the receiving peer is still connected
3. Check network connectivity (no WiFi drops)
4. Try a smaller file first to test
5. Refresh and retry

### "Failed to connect" Error

**Steps to Debug:**
1. Verify backend server is running: `curl http://localhost:3000/api/health`
2. Check WebSocket is accessible: `ws://localhost:3000/ws`
3. Look at server logs for errors
4. Ensure CORS is configured correctly (should be auto-configured)

### Mobile or Behind VPN/Proxy?

- WebRTC has limitations on mobile networks
- VPNs may block WebRTC or limit connection options
- Configure a TURN server for better reliability
- Try disabling VPN temporarily to test

---

## 📊 Performance Characteristics

| Metric | Typical Value | Notes |
|--------|---------------|-------|
| **Connection Time** | 2-5 seconds | Depends on network, ICE gathering |
| **Transfer Speed** | 50-500 MB/s | Direct P2P connection on LAN |
| **Max File Size** | Limited by RAM | Typically 8GB+ on modern systems |
| **Room Expiry** | 30 minutes | Auto-cleanup of inactive rooms |
| **Chunk Size** | 16 KB | Optimized for reliability |

---

## 🚀 Future Enhancements

Potential features and improvements:

- [ ] Multi-file batch transfers
- [ ] Directory/folder upload support
- [ ] Resume interrupted transfers
- [ ] Compression on-the-fly
- [ ] File encryption with password protection
- [ ] Chat during transfer
- [ ] Transfer history/statistics
- [ ] QR code for room sharing
- [ ] Mobile app (React Native/Flutter)
- [ ] S3/Cloud storage integration

---

## 📝 Contributing

Contributions are welcome! To get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Commit with clear messages (`git commit -m 'Add amazing feature'`)
5. Push to your fork (`git push origin feature/amazing-feature`)
6. Open a Pull Request

### Code Style

- Use TypeScript for type safety
- Follow existing code patterns
- Keep functions small and focused
- Document complex logic with comments

---

## 📞 Support & Issues

- **GitHub Issues** — Report bugs or request features
- **Email** — vijaytalsangi4705@gmail.com

---

## 🎯 Project Status

- ✅ Core P2P file transfer working
- ✅ WebRTC signaling and connection
- ✅ UI/UX with multiple views
- ✅ Progress tracking and transfer stats
- 🔄 In active development

---

## 🙏 Acknowledgments

- **WebRTC** — Modern peer-to-peer communication
- **Hono** — Fast, lightweight web framework
- **Bun** — Fast JavaScript runtime
- **Community** — Thanks to all contributors and testers

---

**Made with ❤️ for seamless peer-to-peer file sharing**
