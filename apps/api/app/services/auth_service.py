from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.core.security import hash_password, verify_password
from app.models import Tenant, User
from app.schemas.auth import BootstrapTenantRequest


def bootstrap_admin(db: Session, payload: BootstrapTenantRequest) -> User:
    existing_users = db.scalar(select(func.count()).select_from(User)) or 0
    if existing_users:
        raise RuntimeError('Bootstrap has already been completed')

    tenant = Tenant(name=payload.tenant_name, timezone=payload.timezone)
    db.add(tenant)
    db.flush()

    user = User(
        tenant_id=tenant.id,
        full_name=payload.admin_full_name,
        email=payload.admin_email.lower(),
        password_hash=hash_password(payload.password),
        role='admin',
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    statement = select(User).where(User.email == email.lower())
    user = db.scalar(statement)
    if user is None or not user.is_active:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user
