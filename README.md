# 🎙️ AI Meeting Assistant (Smart Meeting Analyzer)

An automated end-to-end solution for capturing meeting sessions (tab audio + microphone), transcribing Arabic conversations with high accuracy, and extracting structured meeting insights (such as summaries, action items with assignees/deadlines, and campaign budgets).

---

> [!IMPORTANT]
> **Production Disclaimer**: This system was originally engineered and successfully deployed in production during my tenure at a digital marketing agency to automate operational workflows, transcribe Arabic conversations, and extract structured marketing insights.

---

## 🏗️ Technical Architecture & Data Flow

The project is designed as a decoupled system featuring a **Manifest V3 Chrome Extension** (collector) and a **FastAPI Python Backend** (AI analyzer).

### System Data Flow
```mermaid
sequenceDiagram
    participant User as User (Popup UI)
    participant Pop as Popup Context (popup.js)
    participant BG as Background Context (background.js)
    participant Off as Offscreen Document (offscreen.js)
    participant API as FastAPI Backend (main.py)
    participant Groq as Groq AI Cloud Services

    User->>Pop: Click "Start Capture"
    Pop->>Pop: Request tabCapture Stream ID (User Gesture)
    Pop->>BG: Send Stream ID + Mic Permission State
    BG->>Off: Instantiate Offscreen Doc & Forward Parameters
    Off->>Off: Mix Tab Audio + Microphone inputs (AudioContext)
    Off->>Off: MediaRecorder starts recording mixed stream
    Note over Off: Recording meeting session...
    User->>Pop: Click "Stop & Download"
    Pop->>BG: Send Stop Capture command
    BG->>Off: Forward Stop Capture command
    Off->>Off: Finalize audio Blob & encode to base64 Data URL
    Off->>BG: Return Data URL
    BG->>User: Download .webm recording via Downloads API
    User->>API: Upload .webm to /api/v1/analyze
    API->>Groq: Transcribe Arabic audio (Whisper-large-v3)
    Groq-->>API: Return Transcript text
    API->>Groq: Analyze transcript text in JSON Mode (Llama-3.3-70b)
    Groq-->>API: Return structured JSON (Summary, Actions, Budgets)
    API-->>User: Return clean structured JSON response
```

---

## 🛠️ Key Technical Features

1.  **Manifest V3 Offscreen Document Pattern**: Bypass MV3 service worker limitations (lack of DOM APIs like `AudioContext` and `MediaRecorder`) by orchestrating a hidden offscreen document for heavy media manipulation.
2.  **Echo-Free Audio Mixing Pipeline**: Mixes tab audio (other meeting participants) and user microphone input concurrently, while isolating the microphone channel from local speaker output to prevent acoustic feedback loops.
3.  **Graceful Permission Gatekeeping**: Since hidden offscreen documents cannot trigger browser dialogs, the Extension Popup initiates the permission request first, storing authorization for offscreen usage.
4.  **Arabic-Optimized AI Chain**: 
    *   **Whisper-large-v3**: Configured with explicit language forcing (`ar`) and zero-temperature decoding to maximize transcription accuracy for regional dialects.
    *   **Llama-3.3-70b-versatile**: Prompts are written in Arabic to preserve linguistic nuances and extract entities (mismatches in RTL formatting are avoided via strict JSON schemas and Pydantic validation).

---

## 📂 Folder Structure

```
AI_Meeting_Assistant/
├── extension/             # Manifest V3 Extension files
│   ├── manifest.json      # Extension metadata & permission requests
│   ├── popup.html         # User Interface panel
│   ├── popup.js           # popup UI triggers & permissions gateway
│   ├── background.js      # Service worker controller & offscreen creator
│   ├── offscreen.html     # DOM environment carrier
│   └── offscreen.js       # Audio engine (AudioContext, mixer, recorder)
├── backend/               # FastAPI API Service
│   ├── .env.example       # Environment configuration template
│   ├── requirements.txt   # Server dependencies
│   ├── config.py          # Pydantic Settings management
│   ├── schemas.py         # Pydantic structured output models
│   ├── groq_service.py    # Whisper & Llama API client handlers
│   └── main.py            # FastAPI main application & CORS routes
├── docs/                  # Architectural deep-dives
│   ├── meeting_assistant_walkthrough.md
│   └── audio_mixing_walkthrough.md
└── .gitignore             # Git exclusion rules
```

---

## 🚀 Local Setup & Installation

### Prerequisite: Get a Groq API Key
1.  Sign up at [Groq Console](https://console.groq.com/).
2.  Generate a new API key (e.g. `gsk_...`).

### 1. Running the Backend Server

Ensure you have Python 3.10+ installed.

```bash
# Navigate to backend directory
cd backend

# Create and activate virtual environment
python -m venv venv
source venv/Scripts/activate  # On Windows PowerShell: .\venv\Scripts\Activate.ps1

# Install required packages
pip install -r requirements.txt

# Create your local environment file
cp .env.example .env

# Edit .env and insert your GROQ_API_KEY
# GROQ_API_KEY=gsk_your_actual_key_here

# Run the FastAPI server
python main.py
```
The server will start on **`http://localhost:8000`**. You can verify it is running by visiting the Swagger docs at `http://localhost:8000/docs` or checking `http://localhost:8000/health`.

### 2. Installing the Chrome Extension

1.  Open Google Chrome and navigate to `chrome://extensions/`.
2.  Enable **Developer Mode** by toggling the switch in the top-right corner.
3.  Click the **Load unpacked** button in the top-left.
4.  Select the **`extension/`** folder of this repository.
5.  Pin the extension icon to your toolbar.

---

## 🎙️ How to Use

1.  Click the extension icon. You'll see the **Microphone Access Required** banner.
2.  Click **Grant** and allow browser microphone permissions.
3.  Navigate to a tab containing audio (e.g. Google Meet, YouTube).
4.  Open the popup and click **▶ Start Capture (Tab + Mic)**.
5.  When done, click **⏹ Stop & Download**. A `.webm` audio recording will download to your local Downloads folder.
6.  Send a POST request to analyze the audio:
    ```bash
    curl -X POST http://localhost:8000/api/v1/analyze \
      -F "audio=@/path/to/Meeting_2026-xx-xx.webm"
    ```
7.  The response returns a structured meeting analysis:
    ```json
    {
      "transcript": "Full transcript text...",
      "summary": "Meeting summary...",
      "action_items": [
        {
          "task": "Task description",
          "assignee": "Responsible person",
          "deadline": "Timeframe",
          "priority": "high"
        }
      ],
      "campaign_budgets": [],
      "key_decisions": [],
      "duration_seconds": 120.5,
      "language_detected": "ar"
    }
    ```

---

## ✉️ Author / Contact

*   **Email**: ahmedeldemery68@gmail.com
*   **Phone**: +201094670920
