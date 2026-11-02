"""Create a YouTrack issue from a tagged message (REST API, permanent token)."""

import httpx

from .errors import ApiError

TIMEOUT = 20.0


async def whoami(url: str, token: str) -> dict:
    """Check a URL + token pair before saving it: {login, name} or ApiError."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as c:
            r = await c.get(
                f"{url}/api/users/me",
                params={"fields": "login,fullName"},
                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            )
        if r.status_code in (401, 403):
            raise ApiError(400, "youtrack_unauthorized")
        r.raise_for_status()
        u = r.json()
        return {"login": u["login"], "name": u.get("fullName") or u["login"]}
    except httpx.HTTPError:
        raise ApiError(502, "youtrack_unreachable") from None
    except (KeyError, ValueError, TypeError):
        raise ApiError(502, "youtrack_unreachable") from None  # not a YouTrack answer


async def create_issue(settings, summary: str, description: str) -> tuple[str, str]:
    """Returns (idReadable, browser URL)."""
    base = settings.youtrack_url.rstrip("/")
    headers = {"Authorization": f"Bearer {settings.youtrack_token}", "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(base_url=base, headers=headers, timeout=TIMEOUT) as c:
            r = await c.get(
                "/api/admin/projects",
                params={"fields": "id,shortName", "query": settings.youtrack_project},
            )
            r.raise_for_status()
            project = next(
                (p for p in r.json() if p["shortName"] == settings.youtrack_project), None
            )
            if project is None:
                raise ApiError(422, "youtrack_project_not_found")
            r = await c.post(
                "/api/issues",
                params={"fields": "idReadable"},
                json={"project": {"id": project["id"]}, "summary": summary,
                      "description": description},
            )  # fmt: skip
            r.raise_for_status()
            issue_id = r.json()["idReadable"]
    except httpx.HTTPStatusError as e:
        code = "youtrack_unauthorized" if e.response.status_code in (401, 403) else "youtrack_error"
        raise ApiError(502, code) from None
    except (httpx.HTTPError, KeyError, ValueError):
        raise ApiError(502, "youtrack_error") from None
    return issue_id, f"{base}/issue/{issue_id}"
