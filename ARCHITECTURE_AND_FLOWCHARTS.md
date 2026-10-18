# 5Sense: Technical Architecture & Flowcharts
**IBM Z Datathon 2026 — Official Technical Design Document**

---

## ⚡ 2 Simple Flowcharts (For 3-Minute Video & Slide Deck)

### Flow 1: Simple System Architecture
*How your phone connects to the cloud and backend services:*

```mermaid
flowchart LR
    User["📱 Mobile Device (User)\n• React PWA Interface\n• On-Device YOLOv8 AI\n• Speech & Spatial Audio"]
    CF["☁️ Cloudflare HTTPS Tunnel\n• Secure Global Public Access\n• Camera & Mic Permissions"]
    Server["⚙️ 5Sense Backend (Fastify)\n• In-Memory Data Store\n• Hazards & SOS Sessions"]
    Maps["🗺️ Mapping & Routing\n• Nominatim Geocoding\n• OSRM Pedestrian Foot Routing"]

    User <==>|HTTPS Traffic| CF
    CF <==>|Port 5173 / Proxy| Server
    Server <==>|API Queries| Maps
```

---

### Flow 2: Simple User Action & AI Flow
*How a visually impaired pedestrian interacts with the app:*

```mermaid
flowchart TD
    Pedestrian["👤 Visually Impaired Pedestrian"] --> Gesture{"Touches Screen"}

    Gesture -->|"1 Tap"| Scan["📷 AI Path Scan\nScans path ahead (<10ms)"]
    Gesture -->|"2 Tap & Hold"| Voice["🎙️ Speak Destination\nMutes all background chimes"]
    Gesture -->|"3 Tap"| SOS["🆘 Emergency SOS\nBroadcasts GPS coordinates"]

    Scan --> Guidance["🔊 Immediate Spoken Feedback & 3D Spatial Audio\n(Zero visual interaction required)"]
    Voice --> Guidance
    SOS --> Guidance
```

---

## 1. End-to-End System Architecture (Detailed)

This architecture represents the actual implementation of 5Sense: client-side on-device computer vision and zero-precision tactile input coupled with a high-performance Fastify backend service.

```mermaid
flowchart TB
    subgraph Edge["PEDESTRIAN CLIENT EDGE (Mobile Browser / PWA)"]
        Touch["Zero-Precision Screen Touchpad\n(1-Tap · 2-Tap Hold · 3-Tap SOS · Swipes)"]
        Sensors["Device Sensors\n(Compass Bearing, GPS Coords, Accelerometer)"]
        Camera["Camera Video Stream\n(HTML5 MediaStream 640x480 @ 30fps)"]
        
        EdgeVision["On-Device Computer Vision (<10ms Tensor Inference)\n• YOLOv8 ONNX Runtime Web / COCO-SSD\n• Spatial Distance Estimation & Object Classification\n• Road Crossing Edge Detector"]
        
        SpeechCtrl["SpeechQueue Priority Engine\n• Strict Microphone Silence Lockout\n• Zero Audio Overlap Guarantee\n• Priority FIFO (CRITICAL > NAV > INFO)"]
        
        Earcons["3D Spatial Audio & Haptics\n• Stereo Panner Binaural Earcons\n• Rhythmic Vibration Actuator"]
    end

    subgraph Backend["5SENSE BACKEND SERVER (Fastify + TypeScript @ :4000)"]
        APIGW["Fastify REST API Gateway"]
        
        subgraph Endpoints["Backend Services"]
            Routing["OSRM Foot Routing Service (/api/route)\n• Turn-by-Turn Waypoints & Distance"]
            GeoSearch["Nominatim Search Service (/api/geocode)\n• Multi-Location Address Disambiguation"]
            HazardSvc["Hazard Management Service (/api/hazards)\n• Community Hazard Storage & Radius Queries"]
            PlacesSvc["Overpass Places Service (/api/places)\n• Nearby Accessible POIs & Benches"]
            SOSCore["Emergency SOS Dispatcher (/api/sos)\n• Active Session Tracking & Contact Alerting"]
        end
        
        DB[("In-Memory Data Store\n(hazards, contacts, sos_sessions)")]
    end

    subgraph TargetPlatform["TARGET INFRASTRUCTURE (IBM Z LinuxONE s390x)"]
        EnterpriseDeploy["LinuxONE Community Cloud VM\n• Containerized Node.js Runtime\n• 99.999% Fault-Tolerant Uptime for Life-Safety SOS\n• Hardware-Isolated Data Privacy"]
    end

    Camera --> EdgeVision
    Touch --> SpeechCtrl
    Sensors --> SpeechCtrl
    EdgeVision -->|Obstacle Classifications| SpeechCtrl
    SpeechCtrl --> Earcons
    
    Edge <==>|Encrypted REST API| APIGW
    APIGW --> Routing
    APIGW --> GeoSearch
    APIGW --> HazardSvc
    APIGW --> PlacesSvc
    APIGW --> SOSCore
    HazardSvc --> DB
    SOSCore --> DB
    
    Backend -.->|Built for Containerized Deployment| EnterpriseDeploy
```

---

## 2. Real-Time AI Decision Pipeline

```mermaid
flowchart TD
    Start([Frame Captured / Gesture Received]) --> CheckInput{Input Source}

    %% Branch A: Edge Vision
    CheckInput -->|Video Frame 30 FPS| VisionInference["Run YOLOv8 / COCO-SSD Tensor Inference"]
    VisionInference --> ObstacleCheck{Obstacle Detected in ROI?}
    ObstacleCheck -->|No| ClearPath["Emit Silent Background Clear Status"]
    ObstacleCheck -->|Yes| CalcDistance["Compute Distance via Bounding Box Geometry"]
    CalcDistance --> ProximityCheck{Distance < 2.5m?}
    ProximityCheck -->|No| LogBuffer["Buffer in Proximity Cache"]
    ProximityCheck -->|Yes| MicCheck1{Is Microphone Active?}
    MicCheck1 -->|Yes - User Speaking| DropSpeech["Mute Audio Alert (Prevent Mic Interference)"]
    MicCheck1 -->|No| TriggerAlert["Dispatch Binaural Spatial Audio Earcon + Speak CRITICAL Alert"]

    %% Branch B: Touchpad Gesture
    CheckInput -->|Physical Screen Touch| TouchType{Gesture Classifier}
    TouchType -->|1 Tap| QuickCheck["Immediate Instant Path Scan (<10ms)"]
    QuickCheck --> AnnounceStatus["Announce: 'Path Clear' or Nearest Obstacle"]
    
    TouchType -->|2 Tap & Hold| OpenMic["Lock SpeechQueue & Open SpeechRecognition Mic"]
    OpenMic --> VoiceQuery["Process Spoken Destination"]
    VoiceQuery --> QueryBackend["Query Fastify Backend (/api/geocode/search)"]
    QueryBackend --> EvaluateCount{Locations Found}
    EvaluateCount -->|1 Found| StartNav["Calculate Walking Path & Start Guidance"]
    EvaluateCount -->|>1 Found| SpeakOptions["Speak Options Concisely & Auto-Open Choice Listener"]

    TouchType -->|3 Tap| EmergencySOS["Trigger Emergency SOS Mode"]
    EmergencySOS --> BackendSOS["Create SOS Session on Backend (/api/sos/start)"]
    BackendSOS --> SoundSiren["Activate SOS Siren & High-Intensity Vibration Pattern"]
```

---

## 3. Zero-Precision Physical Touchpad State Machine

```mermaid
stateDiagram-v2
    [*] --> IdleState: App Mounted

    state IdleState {
        description: Screen acts as full-surface tactile sensor
    }

    IdleState --> TapDetected: Finger Touch Down
    TapDetected --> SingleTapState: Released < 240ms (1 Tap)
    SingleTapState --> IdleState: Instant Path Obstacle Audit Spoken

    TapDetected --> HoldToSpeakState: Held > 240ms (2-Tap Hold)
    state HoldToSpeakState {
        entry: SpeechQueue.setMicActive(true) -> All Audio Silenced
        description: Push-To-Talk microphone open
        exit: SpeechQueue.setMicActive(false)
    }
    HoldToSpeakState --> MultiChoiceState: Spoken Query Sent to Backend
    HoldToSpeakState --> IdleState: User Releases Finger Early

    state MultiChoiceState {
        description: Multiple destinations disambiguation modal
        listening: Auto-listen for '1', '2', or '3' with zero overlap
    }
    MultiChoiceState --> NavigationActiveState: Option Selected (Voice or Tap)
    MultiChoiceState --> IdleState: User Says 'Cancel' or Taps Close

    TapDetected --> SOSConfirmedState: 3 Rapid Consecutive Taps
    state SOSConfirmedState {
        description: Urgent SOS Dispatch with GPS Coords
    }
    SOSConfirmedState --> IdleState: User Taps 'Cancel SOS'

    IdleState --> VerticalSwipeState: Touch Drag > 45px
    state VerticalSwipeState {
        swipeUp: Repeat Last Audio Alert
        swipeDown: Spoken System Status Check
    }
    VerticalSwipeState --> IdleState: Gesture Completed
```

---

## 4. Priority-Interrupt Speech & Audio Lockout Engine

```mermaid
sequenceDiagram
    autonumber
    actor Pedestrian as Blind User
    participant Pad as Touchpad / UI
    participant Queue as SpeechQueue Engine
    participant Mic as Web Speech API (Microphone)
    participant Vision as YOLOv8 Edge AI
    participant Audio as AudioContext (Earcons / Speaker)

    Note over Pedestrian,Audio: Scenario: User holds screen to speak destination
    Pedestrian->>Pad: Press and Hold Screen (>240ms)
    Pad->>Queue: setMicActive(true)
    Queue->>Audio: window.speechSynthesis.cancel() (Instant Kill)
    Queue->>Audio: Mute all Web Audio Chimes & Spatial Tones
    Pad->>Mic: recognition.start()
    Mic-->>Pedestrian: Gentle Haptic Buzz (Mic Open)

    Note over Vision,Queue: Camera spots an obstacle while user is speaking!
    Vision->>Queue: speak("Caution: Person 1 metre ahead", CRITICAL)
    Queue-->>Queue: Check isMicActive === true? -> REJECT & DROP ALERT
    Note over Queue: Zero background speech leaks into the microphone!

    Pedestrian->>Mic: "Take me to Manchester Museum"
    Pedestrian->>Pad: Release Finger
    Pad->>Mic: recognition.stop()
    Mic->>Pad: onresult("Take me to Manchester Museum")
    Pad->>Queue: setMicActive(false) (Mic Lock Released)
    Queue->>Audio: speak("Calculating route to Manchester Museum...", CRITICAL)
    Audio-->>Pedestrian: Spoken Route Confirmation
```

---

## 5. IBM LinuxONE Enterprise Mainframe Value Architecture

```mermaid
flowchart LR
    subgraph ClientLayer["Accessible Edge Clients"]
        C1["Pedestrian Mobile Web / PWA"]
        C2["Community Volunteers & Carers"]
    end

    subgraph FastifyBackend["Containerized Backend (Node.js + SQLite)"]
        API["Fastify API Gateway"]
        DataStore["Hazard & SOS Database"]
    end

    subgraph LinuxONETarget["Target Platform: IBM LinuxONE (s390x)"]
        Uptime["99.999% Enterprise Uptime\n• Zero-downtime SOS emergency response"]
        Scale["High-Concurrency Scalability\n• Multi-city pedestrian concurrent load"]
        Privacy["Hardware-Level Security\n• Protecting sensitive transit coordinates"]
    end

    ClientLayer <==>|REST API| FastifyBackend
    FastifyBackend -.->|Production Target Host| LinuxONETarget
```
