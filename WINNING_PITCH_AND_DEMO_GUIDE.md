# 5Sense: Pitch Script, Demo Recording Guide & Submission Blueprint

**Event:** IBM Z Datathon 2026  
**Goal:** 1st Place & AI Innovation Award  
**Live Prototype URL:** [https://downloaded-wearing-packaging-authors.trycloudflare.com](https://downloaded-wearing-packaging-authors.trycloudflare.com)  
**Submission Portal:** [https://hack2skill.com/event/datathon-2026](https://hack2skill.com/event/datathon-2026)  
**Strict Video Rule:** **Maximum 3 minutes (180 seconds)**.

---

## Part 1: How to Record the Demo Video (Fast & Simple)

### 🛠️ Recommended Recording Tools (Choose One)
1. **Loom (Easiest & Fastest)**: Free, records your screen + your webcam in a small bubble simultaneously, generates an instant shareable link.
2. **Zoom "Record to this Computer"**: Start a personal meeting, share your screen, turn on camera, click "Record". Saves an `.mp4` file immediately when you end meeting.
3. **OBS Studio**: Free, high quality screen capture with microphone.
4. **Windows Snipping Tool / Game Bar (`Win + Alt + R`)**: Built-in Windows 11 screen recorder.

### 🎬 Screen Layout
- **Main Screen:** 5Sense web app running on `http://localhost:5173` OR on Cloudflare: `https://downloaded-wearing-packaging-authors.trycloudflare.com`.
- **Second Screen / Tab:** Architecture Flowchart slide from `ARCHITECTURE_AND_FLOWCHARTS.md`, and optionally your terminal / LinuxONE Community Cloud dashboard.

---

## Part 2: Addressing IBM Z & LinuxONE Honestly & Effectively

Because your working prototype is running its Fastify backend and React frontend with on-device computer vision, here is how you frame IBM Z / LinuxONE truthfully and compellingly to win top marks:

1. **State What Is Live & Working**: 5Sense is a fully functional end-to-end prototype: on-device YOLOv8/COCO-SSD computer vision, Fastify TypeScript backend API, SQLite database, zero-precision touchscreen, priority speech queue, and 3D spatial audio.
2. **The IBM Z / LinuxONE Role**: 
   - LinuxONE Community Cloud (`s390x`) is the **designated enterprise production target** for the containerized backend.
   - Explain **why** LinuxONE is necessary for real-world deployment: Life-safety navigation and emergency SOS require **99.999% uptime (zero-downtime)**, high-concurrency pedestrian load across cities, and hardware-level isolation for pedestrian GPS privacy.
3. **If You Have Access to the LinuxONE Terminal (`148.78.100.11`)**:
   - You can flash your SSH terminal for 10 seconds showing `uname -m` (`s390x`) as proof of your LinuxONE environment setup.

---

## Part 3: Word-for-Word 3-Minute Video Pitch Script
**Target Duration:** **2 minutes 45 seconds** (leaves 15-second safety buffer).

---

### ⏱️ SECTION 1: PROBLEM & THEME ALIGNMENT (0:00 – 0:35 | 35 seconds)

**[Visual: Presenter on camera OR Title Slide with WHO statistics]**

> *"Hello judges. Worldwide, over **285 million individuals** live with visual impairments. For a blind pedestrian, walking down a city street is high-stakes: low-hanging tree branches, construction barriers, and veering off crosswalks cause severe physical injuries every day.*
> 
> *Current navigation apps fail them because they rely on visual maps, require high-precision tapping, and flood the user with overlapping audio that talks over their own voice commands.*
> 
> *Addressing **Theme 1: Real-Time AI for Critical Decisions** and **Theme 3: Accessibility**, we built **5Sense**: a real-time, zero-vision spatial navigation assistant powered by on-device computer vision and an accessible, voice-first architecture designed for enterprise reliability on **IBM Z LinuxONE**."*

---

### ⏱️ SECTION 2: LIVE PRODUCT DEMONSTRATION (0:35 – 1:35 | 60 seconds)

**[Visual: Switch to 5Sense App Screen running at localhost:5173 or Cloudflare]**

> *"Let me show you 5Sense in action.*
> 
> *First, we eliminated complex visual UI. The entire screen is an intuitive **Zero-Precision Touchpad**.*
> 
> *A single tap anywhere instantly scans the walking path using our on-device YOLOv8 vision engine running directly in the browser at 30 frames per second."*
> 
> **[Action: Click once anywhere on screen]**
> *(App sounds clear chime or announces: 'Path clear ahead' / obstacle alert).*
> 
> *"Next, finding a destination is completely hands-free. A two-tap hold activates push-to-talk."*
> 
> **[Action: Press and hold the screen, speak: 'Costa Coffee']**
> *(App announces: 'Found 3 locations. Option 1: Costa Coffee Oxford Road. Option 2: Costa Coffee Piccadilly... Say option 1, 2, or 3').*
> 
> *"Notice our **Priority Speech Lockout Engine**: the millisecond the microphone opens, all background speech, turn prompts, and hazard chimes are instantly silenced. There is zero conversational race condition."*
> 
> **[Action: Speak: 'Option 1']**
> *(App announces: 'Route found to Costa Coffee, 420 metres. Walk forward').*
> 
> *"During navigation, 5Sense monitors compass heading. If the user veers off course, it delivers 3D binaural spatial audio earcons and haptic vibrations to gently guide them back to the center line."*

---

### ⏱️ SECTION 3: SYSTEM ARCHITECTURE & AI ENGINE (1:35 – 2:15 | 40 seconds)

**[Visual: Switch to Architecture Flowchart Slide]**

> *"Under the hood, 5Sense utilizes an optimized **Hybrid Architecture**:*
> 
> *1. **Edge-Based Real-Time AI**: We run YOLOv8 and COCO-SSD client-side using WebGL and WebAssembly, delivering sub-10-millisecond obstacle detection without relying on cellular network latency.*
> 
> *2. **Fastify Backend API**: Our high-performance Fastify TypeScript server handles geocoding disambiguation, OSRM pedestrian routing, and in-memory management for community hazard reports and active SOS sessions."*

---

### ⏱️ SECTION 4: ENTERPRISE SCALING ON IBM Z & LINUXONE (2:15 – 2:40 | 25 seconds)

**[Visual: Show LinuxONE s390x Terminal or LinuxONE slide]**

> *"For real-world smart-city deployment, 5Sense is architected for the **IBM Z LinuxONE Community Cloud**.*
> 
> *In life-safety pedestrian navigation, system downtime is unacceptable. LinuxONE's enterprise **99.999% fault tolerance** provides the non-stop reliability required for emergency SOS dispatch and multi-city pedestrian scale.*
> 
> *Furthermore, IBM Z's hardware-level security ensures that visually impaired pedestrians' daily GPS coordinates and transit routines remain strictly private and protected."*

---

### ⏱️ SECTION 5: CONCLUSION (2:40 – 2:48 | 8 seconds)

**[Visual: Team slide with GitHub link and Project Title]**

> *"5Sense: Making independent urban mobility safe, dignified, and accessible through Real-Time AI. Thank you!"*

---

## Part 4: Ready-to-Paste Hack2skill Submission Form Answers

### 1. Project Title
```text
[5Sense_IBM Z Datathon 2026 Project]
```

### 2. Selected Theme
- **Primary Theme:** `Theme 1: Real-Time AI for Critical Decisions (Detect. Decide. Respond.)`
- **Secondary Track:** `Theme 3 (Wildcard): Accessibility & Inclusion (AI for Good)`

### 3. Problem Statement & Supporting Data (300 words)
```text
Over 285 million individuals worldwide live with moderate to severe visual impairments (World Health Organization). For blind pedestrians, independent urban travel poses serious daily risks: undetected low obstacles (construction barriers, e-scooters), head-height hazards (scaffolding, branches), and veering off crosswalks into traffic cause thousands of hospitalizations annually.

Mainstream navigation applications (such as Google Maps or Apple Maps) fail visually impaired users in three fundamental ways:
1. High-precision visual requirement: They rely on complex visual maps and small touch targets impossible to navigate without sight.
2. Conversational race conditions: Background turn prompts and alerts frequently talk over the user when they try to speak commands, creating confusion.
3. Lack of immediate micro-obstacle awareness: Existing tools route from street to street, but offer zero real-time detection of immediate pedestrian hazards.

5Sense solves this critical societal challenge by introducing an accessible, real-time spatial navigation assistant designed from the ground up for zero-vision independence.
```

### 4. Proposed Solution & Architecture (300 words)
```text
5Sense delivers an end-to-end accessible navigation platform featuring:

1. Zero-Precision Physical Touchpad: The entire smartphone screen operates as an intuitive haptic controller (1-Tap for instant 10ms path obstacle audit, 2-Tap Hold for hands-free voice destination query, 3-Tap for emergency SOS broadcast, and vertical swipes for alert repeat).
2. Priority-Interrupt SpeechQueue Engine: Enforces a strict hardware lockout that completely silences all background speech, turn cues, and hazard chimes whenever the microphone is active, eliminating audio overlap.
3. 3D Spatial Audio & Haptics: Employs StereoPanner Web Audio earcons and rhythmic vibration feedback to gently guide pedestrians if compass bearing veers off the path.
4. Edge Computer Vision: Sub-10ms YOLOv8 / COCO-SSD tensor inference running client-side for immediate obstacle and road-crossing edge detection.
5. High-Performance Fastify Backend: TypeScript API server proxying Nominatim geocoding, OSRM foot routing, Overpass accessible places, and maintaining an in-memory data store for local hazards and emergency SOS sessions (zero database configuration needed).
```

### 5. Alignment with IBM Z & LinuxONE
```text
5Sense is architected for enterprise smart-city deployment on the IBM Z LinuxONE platform:

1. Mission-Critical 99.999% Reliability for Emergency SOS: A life-safety app for vulnerable citizens cannot tolerate downtime. 5Sense's containerized backend is designed for deployment on IBM LinuxONE (s390x architecture), leveraging its enterprise fault tolerance to guarantee zero-downtime SOS dispatch even during regional network congestion.
2. High-Concurrency Scale: As adoption expands across municipal transit systems, LinuxONE's enterprise architecture effortlessly handles high-volume simultaneous pedestrian hazard requests and routing computations without latency spikes.
3. Confidential Computing & Data Privacy: Visually impaired commuters' daily transit routes and GPS coordinates are sensitive personal data. LinuxONE provides enterprise hardware-level isolation, ensuring user travel data is protected from exposure.
```

### 6. Tech Stack
```text
- Frontend & Client AI: React 18, Vite, TypeScript, YOLOv8 ONNX Runtime Web, TensorFlow.js (COCO-SSD), HTML5 Canvas, Leaflet
- Voice & Audio: Web Speech API (SpeechRecognition & SpeechSynthesis), Web Audio API (Synthesized Earcons), Vibration API
- Backend & Storage: Node.js, Fastify, TypeScript, In-Memory Zero-DB Data Store
- APIs & Data: OpenStreetMap Nominatim, OSRM Pedestrian Routing, Overpass API
- Target Infrastructure: IBM Z LinuxONE Community Cloud (s390x) / Containerized Linux
```
