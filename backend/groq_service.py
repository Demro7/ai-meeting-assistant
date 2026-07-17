"""
groq_service.py — Groq API Integration Service
=================================================
Handles all communication with the Groq API:
  1. Whisper-large-v3 for Arabic speech-to-text transcription
  2. Llama-3 for structured meeting analysis and extraction

Design Decisions:
  - Synchronous Groq SDK calls wrapped in asyncio.to_thread() for non-blocking I/O
  - Structured JSON output enforced via system prompts with explicit schema
  - Arabic-first prompting to improve extraction quality for RTL content
"""

import json
import asyncio
import logging
from pathlib import Path

from groq import Groq

from config import settings
from schemas import MeetingAnalysis, ActionItem, CampaignBudget

logger = logging.getLogger(__name__)

# ─── Initialize Groq Client ──────────────────────────────────────
client = Groq(api_key=settings.groq_api_key)

# ─── System Prompt for Meeting Analysis ──────────────────────────
ANALYSIS_SYSTEM_PROMPT = """أنت مساعد ذكاء اصطناعي متخصص في تحليل اجتماعات وكالات التسويق الرقمي.
ستتلقى نص اجتماع (transcript) باللغة العربية. مهمتك هي استخراج المعلومات التالية بدقة عالية:

أجب بصيغة JSON فقط بالهيكل التالي:
{
  "summary": "ملخص موجز للاجتماع في 3-5 جمل",
  "action_items": [
    {
      "task": "وصف المهمة",
      "assignee": "اسم الشخص المسؤول أو null",
      "deadline": "الموعد النهائي أو null",
      "priority": "high أو medium أو low"
    }
  ],
  "campaign_budgets": [
    {
      "campaign_name": "اسم الحملة",
      "budget": "المبلغ والعملة أو null",
      "platform": "المنصة المستهدفة أو null",
      "notes": "ملاحظات إضافية أو null"
    }
  ],
  "key_decisions": ["القرار الأول", "القرار الثاني"]
}

تعليمات مهمة:
- اكتب الملخص والمهام باللغة العربية
- استخرج جميع المبالغ المالية والميزانيات المذكورة
- حدد أسماء الأشخاص المسؤولين عن كل مهمة إن وُجدت
- إذا لم تجد معلومات لحقل معين، استخدم null
- أجب بـ JSON فقط بدون أي نص إضافي"""


async def transcribe_audio(file_path: Path) -> dict:
    """
    Transcribe an audio file using Groq's Whisper-large-v3.

    Args:
        file_path: Path to the audio file (.webm, .mp3, .wav, etc.)

    Returns:
        dict with 'text' (transcript) and 'language' (detected language)

    Notes:
        - Whisper-large-v3 has excellent Arabic support
        - Groq's implementation is ~10x faster than OpenAI's
        - Max file size: 25MB
    """
    logger.info(f"Transcribing audio: {file_path.name} ({file_path.stat().st_size / 1024:.1f} KB)")

    def _transcribe():
        with open(file_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                model=settings.whisper_model,
                file=audio_file,
                language="ar",          # Hint for Arabic (improves accuracy)
                response_format="verbose_json",  # Includes language detection + segments
                temperature=0.0         # Deterministic output for consistency
            )
        return transcription

    result = await asyncio.to_thread(_transcribe)

    transcript_text = result.text
    detected_lang = getattr(result, 'language', 'ar')

    logger.info(f"Transcription complete. Length: {len(transcript_text)} chars, Language: {detected_lang}")
    return {
        "text": transcript_text,
        "language": detected_lang,
        "duration": getattr(result, 'duration', None)
    }


async def analyze_transcript(transcript: str) -> dict:
    """
    Analyze a meeting transcript using Groq's Llama-3 to extract
    summary, action items, campaign budgets, and key decisions.

    Args:
        transcript: Full Arabic text transcript from Whisper

    Returns:
        dict matching the MeetingAnalysis schema (minus transcript/duration/language)
    """
    logger.info(f"Analyzing transcript ({len(transcript)} chars) with {settings.llama_model}")

    def _analyze():
        completion = client.chat.completions.create(
            model=settings.llama_model,
            messages=[
                {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
                {"role": "user", "content": f"نص الاجتماع:\n\n{transcript}"}
            ],
            temperature=0.1,        # Low temp for structured extraction
            max_tokens=4096,
            response_format={"type": "json_object"}  # Enforce JSON output
        )
        return completion.choices[0].message.content

    raw_json = await asyncio.to_thread(_analyze)

    try:
        analysis = json.loads(raw_json)
    except json.JSONDecodeError as e:
        logger.error(f"Llama returned invalid JSON: {e}\nRaw output: {raw_json[:500]}")
        # Return a safe fallback
        analysis = {
            "summary": "تعذر تحليل الاجتماع. الرجاء المحاولة مرة أخرى.",
            "action_items": [],
            "campaign_budgets": [],
            "key_decisions": []
        }

    logger.info(f"Analysis complete. Actions: {len(analysis.get('action_items', []))}, "
                f"Campaigns: {len(analysis.get('campaign_budgets', []))}")
    return analysis


async def process_meeting_audio(file_path: Path) -> MeetingAnalysis:
    """
    End-to-end pipeline: Transcribe audio → Analyze transcript → Structured output.

    This is the main entry point called by the API endpoint.

    Args:
        file_path: Path to the uploaded audio file

    Returns:
        MeetingAnalysis: Fully structured meeting analysis
    """
    # Step 1: Transcribe Arabic audio
    transcription = await transcribe_audio(file_path)

    # Step 2: Analyze the transcript with Llama
    analysis = await analyze_transcript(transcription["text"])

    # Step 3: Assemble the final structured response
    return MeetingAnalysis(
        transcript=transcription["text"],
        summary=analysis.get("summary", ""),
        action_items=[
            ActionItem(**item) for item in analysis.get("action_items", [])
        ],
        campaign_budgets=[
            CampaignBudget(**camp) for camp in analysis.get("campaign_budgets", [])
        ],
        key_decisions=analysis.get("key_decisions", []),
        duration_seconds=transcription.get("duration"),
        language_detected=transcription.get("language")
    )
