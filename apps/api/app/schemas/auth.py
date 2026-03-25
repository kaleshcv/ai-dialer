from datetime import datetime
from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class BootstrapTenantRequest(BaseModel):
    tenant_name: str = Field(min_length=2, max_length=255)
    timezone: str = Field(default='Asia/Kolkata', max_length=64)
    admin_full_name: str = Field(min_length=2, max_length=255)
    admin_email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class UserOut(BaseModel):
    id: int
    tenant_id: int
    full_name: str
    email: EmailStr
    role: str
    is_active: bool
    created_at: datetime

    model_config = {'from_attributes': True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    user: UserOut
