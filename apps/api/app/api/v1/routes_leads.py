from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.schemas.leads import LeadImportRequest, LeadOut
from app.services.lead_service import import_leads, list_leads

router = APIRouter(prefix='/api/v1/leads', tags=['leads'])


@router.get('', response_model=list[LeadOut])
def get_leads(campaign_id: int | None = None, tenant_id: int | None = None, db: Session = Depends(get_db)):
    return list_leads(db, campaign_id=campaign_id, tenant_id=tenant_id)


@router.post('/import', response_model=list[LeadOut], status_code=201)
def import_leads_route(payload: LeadImportRequest, db: Session = Depends(get_db)):
    try:
        return import_leads(db, payload)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
