from urllib.parse import urlencode


def build_redirect(mobile_redirect_uri: str, **params: str) -> str:
    """Appends status/network/account/reason to the app's deep link — matches
    app/oauth/callback.tsx's typed params exactly (no `token` field, ever)."""
    filtered = {key: value for key, value in params.items() if value}
    separator = "&" if "?" in mobile_redirect_uri else "?"
    return f"{mobile_redirect_uri}{separator}{urlencode(filtered)}"
