"""Keep credentials out of the log.

Three upstreams here carry their key in the request itself - data.gov.in and
WAQI in the query string, FIRMS in a path segment - and `requests` puts the
full request URL into the text of every exception it raises. So the ordinary
way of reporting a failed fetch,

    logger.warning("CPCB bulletin unavailable (%s)", exc)

writes the key to the journal in clear.

That is not hypothetical. api.data.gov.in refused connections for most of
3 October 2026 and the retry fires every two minutes, so `CPCB_API_KEY` went
into journald several hundred times over, as a complete URL anyone with read
access to the logs could replay.

`firms_fire` already avoids this, by logging `type(exc).__name__` and nothing
else. That is safe and tells you very little - not the host, not the errno.
This keeps the whole message and takes out only the secret.
"""
from __future__ import annotations

import re

#: Every shape a key takes on the way to an upstream here. The query-string
#: forms stop at whatever can end a value inside an exception's repr - `&`,
#: whitespace, a closing quote or bracket. The FIRMS key is a path segment, so
#: it stops at the next slash.
_SECRETS = (
    re.compile(r"(api-key=)[^&\s'\")]+"),
    re.compile(r"(token=)[^&\s'\")]+"),
    re.compile(r"(firms\.modaps\.eosdis\.nasa\.gov/api/\w+/csv/)[^/\s'\")]+"),
)


def safe(text: object) -> str:
    """`text` with any credential in it replaced by REDACTED.

    Takes an object rather than a `str` so it can wrap an exception directly -
    `safe(exc)` - which is the only call site that matters. Redacting at the
    log call rather than at the request keeps the key where it belongs, in the
    params dict, and leaves the message readable.
    """
    out = str(text)
    for pattern in _SECRETS:
        out = pattern.sub(r"\1REDACTED", out)
    return out
