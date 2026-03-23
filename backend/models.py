from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field


class ImageRequest(BaseModel):
    food: str = Field(..., description="Food name to generate an image for", examples=["scrambled eggs on toast"])


class FoodItem(BaseModel):
    food: str = Field(..., description="Food description", examples=["scrambled eggs"])
    calories: int = Field(..., description="Estimated calories (kcal)", examples=[250])
    protein: float = Field(..., description="Protein in grams", examples=[14.0])
    carbs: float = Field(..., description="Carbohydrates in grams", examples=[20.0])
    fat: float = Field(..., description="Fat in grams", examples=[10.0])
    fibre: float = Field(..., description="Dietary fibre in grams", examples=[2.0])
    time_hint: Optional[str] = Field(None, description="Time of consumption (HH:MM 24h) if mentioned", examples=["08:30"])


class NutritionUpdates(BaseModel):
    food: Optional[str] = Field(None, description="Updated food description")
    calories: Optional[int] = Field(None, description="Updated calories (kcal)")
    protein: Optional[float] = Field(None, description="Updated protein (g)")
    carbs: Optional[float] = Field(None, description="Updated carbohydrates (g)")
    fat: Optional[float] = Field(None, description="Updated fat (g)")
    fibre: Optional[float] = Field(None, description="Updated fibre (g)")


class AddResponse(BaseModel):
    intent: Literal["add"]
    items: list[FoodItem]
    transcript: str = Field(..., description="Whisper transcript of the user's audio")


class EditResponse(BaseModel):
    intent: Literal["edit"]
    entry_id: int = Field(..., description="ID of the log entry to update")
    updates: NutritionUpdates
    transcript: str


class DeleteResponse(BaseModel):
    intent: Literal["delete"]
    entry_id: int = Field(..., description="ID of the log entry to remove")
    transcript: str


class MultiAddAction(BaseModel):
    intent: Literal["add"]
    items: list[FoodItem]


class MultiEditAction(BaseModel):
    intent: Literal["edit"]
    entry_id: int
    updates: NutritionUpdates


class MultiDeleteAction(BaseModel):
    intent: Literal["delete"]
    entry_id: int


MultiAction = Annotated[
    Union[MultiAddAction, MultiEditAction, MultiDeleteAction],
    Field(discriminator="intent"),
]


class MultiResponse(BaseModel):
    intent: Literal["multi"]
    actions: list[MultiAction] = Field(..., description="Ordered list of add/edit/delete sub-actions")
    transcript: str


TrackResponse = Union[AddResponse, EditResponse, DeleteResponse, MultiResponse]


class ImageResponse(BaseModel):
    data_url: str = Field(..., description="Base64-encoded PNG as a data URL (data:image/png;base64,...)")


class TextTrackRequest(BaseModel):
    text: str = Field(..., description="Plain-text food log entry (typed by user, skips Whisper)", examples=["had a chicken sandwich and a diet coke"])
    entries: str = Field(default="[]", description="JSON array of today's log entries for edit/delete context")


class PhotoLogRequest(BaseModel):
    image_b64: str = Field(..., description="Base64-encoded JPEG image (resize to ≤512 px before sending)")


class HealthResponse(BaseModel):
    status: Literal["ok"]
