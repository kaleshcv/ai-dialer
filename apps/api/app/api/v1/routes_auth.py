from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, get_current_user
from app.models import User
from app.schemas.auth import BootstrapTenantRequest, LoginRequest, TokenResponse, UserOut
from app.services.auth_service import authenticate_user, bootstrap_admin

router = APIRouter(prefix='/api/v1/auth', tags=['auth'])


@router.post('/bootstrap', response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def bootstrap(payload: BootstrapTenantRequest, db: Session = Depends(get_db)):
    if not settings.ALLOW_BOOTSTRAP:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Bootstrap is disabled')

    try:
        user = bootstrap_admin(db, payload)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    token = create_access_token({'user_id': user.id, 'tenant_id': user.tenant_id, 'role': user.role})
    return {'access_token': token, 'user': user}


@router.post('/login', response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = authenticate_user(db, payload.email, payload.password)
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid credentials')

    token = create_access_token({'user_id': user.id, 'tenant_id': user.tenant_id, 'role': user.role})
    return {'access_token': token, 'user': user}


@router.get('/me', response_model=UserOut)
def me(current_user: User = Depends(get_current_user)):
    return current_user
