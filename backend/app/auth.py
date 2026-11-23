"""Sign-in (Elena, 2026-11-22): every /api route but /api/health needs a valid Clerk session, checked here on the
server with Clerk's official SDK (clerk-backend-api), never only in the browser.

The browser sends the session token as `Authorization: Bearer …`. CLERK_SECRET_KEY lives in the server's environment
only. CLERK_AUTHORIZED_PARTIES (comma-separated origins, e.g. https://sencity.onrender.com) limits which sites a
token may come from; empty: Clerk's own checks only (local development).
"""
import logging
import os
from dataclasses import dataclass

from fastapi import HTTPException, Request

from . import db

log = logging.getLogger("sencity.auth")


@dataclass(frozen=True)
class User:
    clerk_user_id: str
    account_id: str
    consented: bool


def _secret() -> str:
    key = os.environ.get("CLERK_SECRET_KEY", "").strip()
    if not key:
        raise HTTPException(503, "Sign-in is not set up on the server.")
    return key


def _parties() -> list[str] | None:
    raw = os.environ.get("CLERK_AUTHORIZED_PARTIES", "").strip()
    return [p.strip() for p in raw.split(",") if p.strip()] or None


def verify(request: Request) -> str:
    """The Clerk user id of the request's session; 401 without a valid one. Never logs the token."""
    from clerk_backend_api.security import authenticate_request
    from clerk_backend_api.security.types import AuthenticateRequestOptions
    try:
        state = authenticate_request(request, AuthenticateRequestOptions(secret_key=_secret(), authorized_parties=_parties()))
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 - a broken token or Clerk unreachable: not signed in
        log.warning("auth: session check failed: %s", type(e).__name__)
        raise HTTPException(401, "Please sign in again.") from None
    sub = (state.payload or {}).get("sub") if state.is_signed_in else None
    if not sub:
        raise HTTPException(401, "Please sign in again.")
    return sub


def signed_in(request: Request) -> User:
    """FastAPI dependency: the signed-in user, with our account (created on first sign-in)."""
    clerk_id = verify(request)
    account = db.ensure_account(clerk_id)
    return User(clerk_user_id=clerk_id, account_id=account["id"], consented=account["consented_at"] is not None)


def delete_clerk_user(clerk_user_id: str) -> None:
    """Remove the user from Clerk (their email and login). Raises HTTPException if Clerk refuses."""
    from clerk_backend_api import Clerk
    try:
        with Clerk(bearer_auth=_secret()) as clerk:
            clerk.users.delete(user_id=clerk_user_id)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        log.warning("auth: Clerk user not deleted: %s", type(e).__name__)
        raise HTTPException(502, "Your data is deleted, but the sign-in could not be removed. Try again.") from None
