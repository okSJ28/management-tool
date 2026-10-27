"""Login, logout and the signed-in user's own account."""

from __future__ import annotations

import time

from core import auth

from ..http import Request, Response, error, json_response
from ..router import PUBLIC, Router

router = Router()


def _with_session(response: Response, token: str, max_age: int) -> Response:
    response.headers["Set-Cookie"] = (f"{auth.COOKIE}={token}; Path=/; Max-Age={max_age}; "
                                      "HttpOnly; SameSite=Strict")
    return response


@router.post("/api/auth/login", auth=PUBLIC)
def login(req: Request) -> Response:
    payload = req.json()
    user = auth.authenticate(str(payload.get("id") or ""), str(payload.get("password") or ""))
    if user is None:
        time.sleep(0.6)  # slow down password guessing
        return error("login-failed", 401)
    return _with_session(json_response({"user": user}),
                         auth.issue_token(user["id"]), auth.session_seconds())


@router.post("/api/auth/logout", auth=PUBLIC)
def logout(_req: Request) -> Response:
    return _with_session(json_response({"ok": True}), "", 0)


@router.get("/api/auth/me")
def me(req: Request) -> Response:
    return json_response({"user": req.account})


@router.put("/api/auth/password")
def change_password(req: Request) -> Response:
    payload = req.json()
    user_id = req.account["id"]
    try:
        auth.change_password(user_id, str(payload.get("current") or ""),
                             str(payload.get("password") or ""))
    except auth.AccountError as exc:
        return error(exc.code, exc.status)
    # The old cookie was signed with the old password hash, so issue a new one.
    return _with_session(json_response({"ok": True}),
                         auth.issue_token(user_id), auth.session_seconds())
