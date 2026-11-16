"""Wire DTOs of the UI flow render (pre-check, job, result): read and written by youtrack/api_flow.py."""

from typing import Literal

from pydantic import BaseModel, Field


class FlowRetryRequest(BaseModel):
    note: str = Field("", max_length=2000)
    mode: Literal["screens", "flow"] = "flow"  # a job saved before modes (it had "deep"): an AI render
    split: bool = False
    skip: list[str] = Field([], max_length=255)  # Zeplin URLs the dialog left out: their screens are not drawn


class FlowLineDTO(BaseModel):  # a source line the code could not turn into a link, and why
    no: int = 0  # the "#n" the dialog shows and a question to the AI cites
    line: str
    why: str  # format | unknown | duplicate | label | web | mobile
    name: str = ""
    hint: str = ""  # unknown: the closest screen title; web: the design size
    urls: list[str] = Field(default_factory=list)  # Zeplin links of the screen(s) the line names


class FlowRiskDTO(BaseModel):
    code: str  # tokens | screens | ambiguous
    text: str
    lines: list[FlowLineDTO] = Field(default_factory=list)  # ambiguous: the lines themselves (first 50)


class FlowCheckDTO(BaseModel):
    """A render's input counted by code before the run: estimated tokens by source, size, what may go wrong."""

    tokens: int
    parts: dict[str, int]
    screens: int
    links: int
    risks: list[FlowRiskDTO]
    warnings: list[str] = Field(default_factory=list)
    model: str = ""  # the model the render would run on (the heavy YouTrack pick)
    cost_usd: float | None = None  # estimated from past runs on that model; None: no history (not Claude)
    cost_runs: int = 0  # how many past runs the estimate rests on
    chunks: int = 1  # parts a split render would run ("Chia phần"): 12 screens each
    split_tokens: int = 0  # input of that split render, every part counted (each repeats the ticket); 0: one part


class FlowOmittedDTO(BaseModel):
    source: str
    kind: str
    count: int


class FlowManifestDTO(BaseModel):
    measurement: Literal["estimated"] = "estimated"
    estimated_input_tokens: int
    estimated_payload_tokens: int = 0
    parts: dict[str, int] = Field(default_factory=dict)
    risks: list[FlowRiskDTO] = Field(default_factory=list)
    mode: Literal["screens", "flow"] = "flow"
    reused: int = 0  # links carried from the flow on screen ("Chỉ vẽ phần mới")
    sources: list[str]
    omitted: list[FlowOmittedDTO]
    warnings: list[str] = Field(default_factory=list)
    ambiguous_lines: int = 0
    kept: dict[str, int] = Field(default_factory=dict)  # a re-render: what the person's edits it carried over


class FlowResultDTO(BaseModel):
    flow: dict
    manifest: FlowManifestDTO | None = None
    warnings: list[str] = Field(default_factory=list)


class FlowJobDTO(BaseModel):
    id: str
    issue: str
    status: Literal["queued", "running", "succeeded", "failed", "cancel_requested", "cancelled", "interrupted"]
    stage: str
    base: str | None
    request: FlowRetryRequest | None
    result: FlowResultDTO | None
    error: dict | None
    processed: bool
    cursor: int
    created_at: float
    updated_at: float
    needs_ai_retry: bool


class FlowScopeDTO(BaseModel):
    scope: str
