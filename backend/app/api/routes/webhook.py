"""
Webhook Routes
Public endpoints for triggering workflows via webhook (no authentication required)
"""
from fastapi import APIRouter, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional, Dict, Any
import logging

from app.core.database import async_session_maker
from app.core.rate_limit import limiter
from app.core.config import settings
from app.models.workflow import Workflow

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhook", tags=["webhook"])


@router.post("/{token}")
@limiter.limit("30/minute")  # Rate limit webhooks
async def trigger_webhook(
    request: Request,
    token: str,
    payload: Optional[Dict[str, Any]] = None
):
    """
    Trigger a workflow via webhook

    This is a public endpoint - no authentication required.
    The token in the URL identifies which workflow to trigger.

    The payload body is passed as variables to the workflow context,
    accessible via {{webhook.field}} syntax.

    Example:
        POST /api/webhook/abc123xyz
        Body: {"symbol": "RELIANCE", "action": "BUY", "quantity": 10}

        In workflow, use: {{webhook.symbol}}, {{webhook.action}}, {{webhook.quantity}}
    """
    return await _execute_webhook(token, payload)


@router.post("/{token}/{symbol}")
@limiter.limit("30/minute")  # Rate limit webhooks
async def trigger_webhook_with_symbol(
    request: Request,
    token: str,
    symbol: str,
    payload: Optional[Dict[str, Any]] = None
):
    """
    Trigger a workflow via webhook with symbol in URL path

    This is a public endpoint - no authentication required.
    The token in the URL identifies which workflow to trigger.
    The symbol is automatically injected into the webhook data.

    Example:
        POST /api/webhook/abc123xyz/RELIANCE
        Body: {"action": "BUY", "quantity": 10}

        In workflow, use: {{webhook.symbol}}, {{webhook.action}}, {{webhook.quantity}}
    """
    # Merge symbol from URL into payload
    webhook_data = payload or {}
    webhook_data["symbol"] = symbol

    return await _execute_webhook(token, webhook_data)


async def _execute_webhook(token: str, webhook_data: Optional[Dict[str, Any]] = None):
    """Internal function to execute webhook"""
    async with async_session_maker() as db:
        # Find workflow by webhook token
        result = await db.execute(
            select(Workflow).where(Workflow.webhook_token == token)
        )
        workflow = result.scalar_one_or_none()

        if not workflow:
            raise HTTPException(status_code=404, detail="Invalid webhook token")

        if not workflow.webhook_enabled:
            raise HTTPException(status_code=403, detail="Webhook is not enabled for this workflow")

        # Validate webhook secret from payload
        data = webhook_data or {}
        provided_secret = data.pop("secret", None)  # Remove secret from data before processing

        if workflow.webhook_secret:
            if not provided_secret:
                raise HTTPException(status_code=401, detail="Missing webhook secret in payload")
            if provided_secret != workflow.webhook_secret:
                raise HTTPException(status_code=401, detail="Invalid webhook secret")

        # Execute the workflow with webhook payload as variables
        from app.services.executor import execute_workflow

        logger.info(f"Webhook triggered for workflow {workflow.id}: {workflow.name}")

        result = await execute_workflow(workflow.id, webhook_data=data)

        return {
            "status": result.get("status", "success"),
            "message": f"Workflow '{workflow.name}' triggered",
            "execution_id": result.get("execution_id"),
            "workflow_id": workflow.id
        }


@router.get("/{token}/test")
async def test_webhook(token: str):
    """
    Test if a webhook token is valid (without triggering)
    """
    async with async_session_maker() as db:
        result = await db.execute(
            select(Workflow).where(Workflow.webhook_token == token)
        )
        workflow = result.scalar_one_or_none()

        if not workflow:
            raise HTTPException(status_code=404, detail="Invalid webhook token")

        return {
            "status": "valid",
            "workflow_name": workflow.name,
            "webhook_enabled": workflow.webhook_enabled,
            "message": "Webhook token is valid" + (" and enabled" if workflow.webhook_enabled else " but disabled")
        }
