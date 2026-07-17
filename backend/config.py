"""
config.py — Centralized Configuration
=======================================
Loads environment variables and provides typed settings.
Uses Pydantic's BaseSettings for validation and type coercion.
"""

import os
from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    """Application settings loaded from environment variables / .env file."""

    # ── Groq API ──────────────────────────────────────────────────
    groq_api_key: str = Field(
        ...,
        description="Groq API key for Whisper STT and Llama inference"
    )

    # ── Model Configuration ───────────────────────────────────────
    whisper_model: str = Field(
        default="whisper-large-v3",
        description="Groq Whisper model ID for Arabic speech-to-text"
    )
    llama_model: str = Field(
        default="llama-3.3-70b-versatile",
        description="Groq Llama model ID for text analysis and extraction"
    )

    # ── Server ────────────────────────────────────────────────────
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000)

    # ── File Handling ─────────────────────────────────────────────
    max_file_size_mb: int = Field(
        default=25,
        description="Maximum upload file size in MB (Groq limit is 25MB)"
    )
    upload_dir: str = Field(
        default="./uploads",
        description="Temporary directory for uploaded audio files"
    )

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": False
    }


# Singleton instance
settings = Settings()
