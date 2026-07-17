"""
schemas.py — Pydantic Response Models
=======================================
Defines the structured JSON output schema for the API.
These models ensure type safety and serve as the contract
between this backend and the downstream n8n workflow.
"""

from pydantic import BaseModel, Field
from typing import Optional


class ActionItem(BaseModel):
    """A single extracted action item from the meeting."""
    task: str = Field(..., description="The action item description")
    assignee: Optional[str] = Field(None, description="Person responsible (if mentioned)")
    deadline: Optional[str] = Field(None, description="Due date or timeframe (if mentioned)")
    priority: Optional[str] = Field(None, description="Priority level: high, medium, low")


class CampaignBudget(BaseModel):
    """A mentioned campaign and its associated budget."""
    campaign_name: str = Field(..., description="Name of the marketing campaign")
    budget: Optional[str] = Field(None, description="Mentioned budget amount and currency")
    platform: Optional[str] = Field(None, description="Target platform (e.g., Instagram, TikTok)")
    notes: Optional[str] = Field(None, description="Additional context about the campaign")


class MeetingAnalysis(BaseModel):
    """Complete structured output from meeting audio analysis."""
    transcript: str = Field(..., description="Full Arabic transcript from Whisper STT")
    summary: str = Field(..., description="Concise meeting summary in Arabic")
    action_items: list[ActionItem] = Field(
        default_factory=list,
        description="Extracted action items with assignees and deadlines"
    )
    campaign_budgets: list[CampaignBudget] = Field(
        default_factory=list,
        description="Mentioned marketing campaigns and budgets"
    )
    key_decisions: list[str] = Field(
        default_factory=list,
        description="Key decisions made during the meeting"
    )
    duration_seconds: Optional[float] = Field(
        None, description="Audio file duration in seconds"
    )
    language_detected: Optional[str] = Field(
        None, description="Primary language detected by Whisper"
    )


class HealthResponse(BaseModel):
    """Health check response."""
    status: str = "ok"
    service: str = "AI Meeting Assistant API"
    version: str = "1.0.0"
