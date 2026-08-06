import os
import secrets
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Header, HTTPException

load_dotenv(Path(__file__).parent / ".env")


def require_admin(x_admin_password: str | None = Header(default=None)) -> None:
    """Require X-Admin-Password header matching ADMIN_PASSWORD env var."""
    expected = os.getenv("ADMIN_PASSWORD")
    if not expected:
        raise HTTPException(503, "Admin password not configured on server")
    if not x_admin_password or not secrets.compare_digest(x_admin_password, expected):
        raise HTTPException(401, "Invalid or missing admin password")
