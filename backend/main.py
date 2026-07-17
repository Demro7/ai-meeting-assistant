"""
main.py — AI Meeting Assistant API Server
================================================
FastAPI application that receives audio files from the Chrome Extension,
processes them through the Groq AI pipeline, and returns structured JSON.

Endpoints:
  POST /api/v1/analyze   — Upload audio file → Get meeting analysis
  GET  /health           — Health check for monitoring

Security:
  - File size validation (max 25MB for Groq compatibility)
  - File extension whitelist
  - Temporary file cleanup after processing
  - CORS restricted to Chrome Extension origin

Usage:
  uvicorn main:app --host 0.0.0.0 --port 8000 --reload
"""

import os
import uuid
import logging
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from schemas import MeetingAnalysis, HealthResponse
from groq_service import process_meeting_audio

# ─── Logging Setup ────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s │ %(levelname)-7s │ %(name)s │ %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("meeting-assistant-api")

# ─── Allowed Audio Formats ────────────────────────────────────────
ALLOWED_EXTENSIONS = {".webm", ".mp3", ".wav", ".m4a", ".ogg", ".flac"}

# ─── Upload Directory Setup ───────────────────────────────────────
UPLOAD_DIR = Path(settings.upload_dir)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown lifecycle."""
    # Startup: ensure upload directory exists
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    logger.info(f"🚀 AI Meeting Assistant API started on {settings.host}:{settings.port}")
    logger.info(f"📁 Upload directory: {UPLOAD_DIR.resolve()}")
    logger.info(f"🤖 Whisper model: {settings.whisper_model}")
    logger.info(f"🧠 Llama model: {settings.llama_model}")
    yield
    # Shutdown: cleanup
    logger.info("👋 API shutting down")


# ─── FastAPI App ──────────────────────────────────────────────────
app = FastAPI(
    title="AI Meeting Assistant API",
    description="Arabic meeting transcription and campaign insight extraction",
    version="1.0.0",
    lifespan=lifespan
)

# ─── CORS Configuration ──────────────────────────────────────────
# Allow requests from Chrome Extension context
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://*",     # Chrome Extension origin
        "http://localhost:3000",     # Local development
        "http://localhost:5678",     # n8n webhook
    ],
    allow_credentials=True,
    allow_methods=["POST", "GET"],
    allow_headers=["*"],
)


# ─── Health Check Endpoint ────────────────────────────────────────
@app.get("/health", response_model=HealthResponse, tags=["System"])
async def health_check():
    """Health check endpoint for monitoring and uptime verification."""
    return HealthResponse()


# ─── Main Analysis Endpoint ──────────────────────────────────────
@app.post(
    "/api/v1/analyze",
    response_model=MeetingAnalysis,
    tags=["Analysis"],
    summary="Analyze meeting audio",
    description="Upload a meeting audio file (.webm) for Arabic transcription and campaign insight extraction."
)
async def analyze_meeting(
    audio: UploadFile = File(..., description="Audio file from Google Meet recording")
):
    """
    Main endpoint: Receives audio → Transcribes → Analyzes → Returns structured JSON.

    Pipeline:
      1. Validate file type and size
      2. Save to temp file
      3. Transcribe with Whisper-large-v3 (Arabic)
      4. Extract insights with Llama-3
      5. Return MeetingAnalysis JSON
      6. Cleanup temp file
    """
    # ── Step 1: Validate file extension ───────────────────────
    file_ext = Path(audio.filename).suffix.lower()
    if file_ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format: {file_ext}. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # ── Step 2: Save uploaded file temporarily ────────────────
    # Use UUID to prevent filename collisions
    temp_filename = f"{uuid.uuid4().hex}{file_ext}"
    temp_path = UPLOAD_DIR / temp_filename

    try:
        # Read file content with size validation
        content = await audio.read()
        file_size_mb = len(content) / (1024 * 1024)

        if file_size_mb > settings.max_file_size_mb:
            raise HTTPException(
                status_code=413,
                detail=f"File too large: {file_size_mb:.1f}MB. Maximum: {settings.max_file_size_mb}MB"
            )

        logger.info(f"📥 Received: {audio.filename} ({file_size_mb:.2f} MB)")

        # Write to disk
        with open(temp_path, "wb") as f:
            f.write(content)

        # ── Step 3 & 4: Process through AI pipeline ───────────
        result = await process_meeting_audio(temp_path)

        logger.info(f"✅ Analysis complete for {audio.filename}")
        return result

    except HTTPException:
        raise  # Re-raise HTTP exceptions as-is

    except Exception as e:
        logger.error(f"❌ Processing failed for {audio.filename}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Processing failed: {str(e)}"
        )

    finally:
        # ── Step 6: Cleanup temp file ─────────────────────────
        if temp_path.exists():
            temp_path.unlink()
            logger.debug(f"🗑️ Cleaned up temp file: {temp_filename}")


# ─── Entry Point ──────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host=settings.host,
        port=settings.port,
        reload=True,
        log_level="info"
    )
