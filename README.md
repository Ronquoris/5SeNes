# 5Sense: Real-Time Accessible Navigation

[![Live Prototype](https://img.shields.io/badge/Live%20Prototype-Cloudflare%20Tunnel-F38020?style=for-the-badge&logo=cloudflare)](https://downloaded-wearing-packaging-authors.trycloudflare.com)
[![IBM Z Datathon 2026](https://img.shields.io/badge/IBM%20Z%20Datathon-2026-052FAD?style=for-the-badge&logo=ibm)](https://hack2skill.com/event/datathon-2026)
[![Backend](https://img.shields.io/badge/Backend-Fastify%20%7C%20TypeScript-000000?style=for-the-badge&logo=fastify)](https://fastify.dev/)
[![Data Store](https://img.shields.io/badge/Data%20Store-In--Memory%20Zero--DB-008080?style=for-the-badge)](https://nodejs.org/)
[![AI Engine](https://img.shields.io/badge/AI%20Engine-YOLOv8%20%7C%20COCO--SSD-FF6F00?style=for-the-badge)](https://onnxruntime.ai/)
[![Frontend](https://img.shields.io/badge/Frontend-React%2018%20%7C%20Vite-61DAFB?style=for-the-badge&logo=react)](https://react.dev/)

> **Theme 1:** Real-Time AI for Critical Decisions (Detect. Decide. Respond.)  
> **Theme 3 (Wildcard):** Accessibility & Inclusion — AI for Good  
> **Target Audience:** 285+ million blind and visually impaired pedestrians worldwide.

---

## 🌍 The Problem

For visually impaired pedestrians, navigating complex urban environments is high-risk. Potholes, low-hanging tree branches, temporary construction curbs, and veering off crosswalks lead to severe injuries every day. 

Traditional navigation apps (Google Maps, Apple Maps) fail visually impaired users because they:
1. Require high-precision visual screen taps and map reading.
2. Suffer from conversational race conditions: background turn prompts and alerts talk over the user while they are trying to speak commands.
3. Lack real-time, low-latency micro-obstacle awareness for the immediate walking path.

---

## 💡 The 5Sense Solution

**5Sense** is a real-time, voice-first spatial navigation assistant designed specifically for zero-vision pedestrian independence.

### Key Features & Implementation:

1. **Zero-Precision Physical Touchpad**: The entire smartphone screen acts as an intuitive multi-touch haptic controller:
   - **1-Tap**: Instant real-time AI obstacle scan of the immediate path (<10ms local inference).
   - **2-Tap & Hold**: Voice destination search with multi-location disambiguation.
   - **3-Tap**: Instant emergency SOS broadcast with GPS coordinates and live reverse-geocoded location.
   - **Swipe Up / Down**: Repeat last auditory warning or request system status.

2. **Priority-Interrupt SpeechQueue with Mic Lockout**:
   - Web Speech API and Web Audio API earcons are strictly synchronized.
   - The millisecond the microphone opens or the screen is held, **all background voices, turn prompts, and hazard chimes are completely silenced**, eliminating audio overlap.

3. **Spatial 3D Binaural Earcons**:
   - Stereo panning and acoustic pitch changes guide users back to the walking center line if device compass indicates veering.

4. **Real-Time On-Device Computer Vision**:
   - Client-side YOLOv8 / COCO-SSD running at 30 FPS for immediate tactile obstacle identification (people, vehicles, curbs, steps).

5. **Fastify Backend API**:
   - High-performance TypeScript API proxying OpenStreetMap services (Nominatim geocoding, OSRM foot routing, Overpass nearby accessible places).
   - Lightweight in-memory data store for local community hazard reports, emergency contacts, and active SOS broadcast sessions (zero database configuration needed).

---

## 🏗️ System Architecture

```mermaid
flowchart TD
    subgraph Client["Edge Device (Client Browser / Mobile PWA)"]
        GesturePad["Zero-Precision Physical Touchpad\n(1-Tap · 2-Tap Hold · 3-Tap SOS · Swipes)"]
        VisionAI["On-Device Computer Vision\n(YOLOv8 / COCO-SSD Tensor <10ms)"]
        SpeechQueue["SpeechQueue Hardware Lockout\n(Priority FIFO · Strict Mic Silence Lock)"]
        SpatialAudio["Spatial Audio & Haptics\n(3D Binaural Earcons · Dual Pulse Vibration)"]
    end

    subgraph BackendServer["5Sense Backend Server (Fastify + TypeScript)"]
        APIGateway["Fastify REST API Gateway (:4000)"]
        RouteService["OSRM Pedestrian Routing Service"]
        GeoService["Nominatim Geocode & Overpass Places"]
        HazardService["Community Hazards & Alerts Engine"]
        SOSService["Emergency SOS Session Dispatcher"]
        DataStore[("In-Memory Data Store\n(hazards, contacts, sos_sessions)")]
    end

    GesturePad -->|Gestures & Voice Queries| SpeechQueue
    VisionAI -->|Hazard Classifications| SpeechQueue
    SpeechQueue -->|Mutes during Voice Input| SpatialAudio
    Client <==>|Encrypted REST API| APIGateway
    APIGateway --> RouteService
    APIGateway --> GeoService
    APIGateway --> HazardService
    APIGateway --> SOSService
    HazardService --> DataStore
    SOSService --> DataStore
```

---

## 🌐 IBM Z & LinuxONE Alignment

For deployment in enterprise and smart-city production environments:

- **Target Deployment Platform**: The 5Sense backend is container-ready (Node.js LTS + SQLite) designed to deploy seamlessly onto **IBM LinuxONE Community Cloud (s390x architecture)**.
- **Enterprise Mission-Critical Reliability (99.999% Uptime)**: For life-safety applications like emergency SOS dispatch and pedestrian hazard alerts, LinuxONE's enterprise architecture provides the fault tolerance needed for zero-downtime availability.
- **Data Privacy & Security**: Protecting visually impaired pedestrians' daily travel patterns and live GPS coordinates through enterprise-isolated memory execution.

---

## 🚀 Running the Project Locally

### Prerequisites
- Node.js 18+
- npm 9+

### Quick Start

```bash
# 1. Clone repository
git clone https://github.com/<your-username>/5sense.git
cd 5sense

# 2. Install workspace dependencies
npm install

# 3. Setup environment variables
cp .env.example backend/.env

# 4. Start backend (Fastify @ port 4000)
npm run dev:backend

# 5. Start frontend (Vite @ port 5173)
npm run dev:frontend
```

Open `http://localhost:5173` in your browser.

---

## 🛠️ Tech Stack

| Layer | Technologies |
|:---|:---|
| **Frontend & UI** | React 18, Vite, TypeScript, Progressive Web App (PWA), Leaflet |
| **Edge AI & Vision** | YOLOv8 ONNX Runtime Web, TensorFlow.js (COCO-SSD), HTML5 Canvas |
| **Voice & Auditory Feedback** | Web Speech API (SpeechRecognition & SpeechSynthesis), Web Audio API (Synthesized Earcons), Vibration API |
| **Backend & APIs** | Node.js, Fastify, TypeScript, SQLite (better-sqlite3) |
| **External Services** | Nominatim (Geocoding), OSRM (Foot routing), Overpass (Accessible places) |
| **Target Infrastructure** | IBM Z LinuxONE Community Cloud (s390x) / Containerized Linux |

---

## 👥 Team & Submission Information

- **Event:** IBM Z Datathon 2026 (October 17–18, 2026)
- **Submission Title:** `[YourTeamName_IBM Z Datathon 2026 Project]`
- **License:** MIT
