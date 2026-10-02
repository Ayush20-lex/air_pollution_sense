#!/usr/bin/env bash
# Set (or replace) one secret in /etc/airsense.env and restart the API.
#
#   sudo ./set-assistant-key.sh GEMINI_API_KEY
#   sudo ./set-assistant-key.sh GROQ_API_KEY
#   sudo ./set-assistant-key.sh WAQI_TOKEN
#   sudo ./set-assistant-key.sh CPCB_API_KEY
#   sudo ./set-assistant-key.sh NASA_FIRMS_KEY
#   sudo ./set-assistant-key.sh AQICN_TOKEN
#
# The value is read from a prompt rather than taken as an argument, so it does
# not land in the shell history or in the process list where `ps` would show it.
set -euo pipefail

VAR="${1:-GEMINI_API_KEY}"
ENVF=/etc/airsense.env

case "$VAR" in
  GEMINI_API_KEY|GROQ_API_KEY|WAQI_TOKEN|CPCB_API_KEY|NASA_FIRMS_KEY|AQICN_TOKEN) ;;
  *) echo "unknown variable: $VAR" >&2
     echo "expected one of: GEMINI_API_KEY, GROQ_API_KEY, WAQI_TOKEN," >&2
     echo "                 CPCB_API_KEY, NASA_FIRMS_KEY, AQICN_TOKEN" >&2
     exit 2 ;;
esac

if [ "$(id -u)" -ne 0 ]; then echo "run with sudo" >&2; exit 1; fi

printf "%s: " "$VAR"
read -rs VALUE
echo
[ -n "$VALUE" ] || { echo "empty, nothing changed" >&2; exit 1; }

touch "$ENVF"; chown root:root "$ENVF"; chmod 600 "$ENVF"

# Replace the line if it is there, append if it is not. Written to a temp file
# in the same directory and moved into place, so a crash midway cannot leave
# the file half-written and the service unable to start.
TMP="$(mktemp "${ENVF}.XXXXXX")"
chmod 600 "$TMP"
if grep -q "^${VAR}=" "$ENVF"; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      "${VAR}="*) printf "%s=%s\n" "$VAR" "$VALUE" ;;
      *)          printf "%s\n" "$line" ;;
    esac
  done < "$ENVF" > "$TMP"
else
  cat "$ENVF" > "$TMP"
  printf "%s=%s\n" "$VAR" "$VALUE" >> "$TMP"
fi
mv "$TMP" "$ENVF"

echo "$VAR written to $ENVF"
systemctl restart uvicorn
echo -n "waiting for the API to come back"
for i in $(seq 1 30); do
  if ss -tln | grep -q ":443"; then echo " - up"; break; fi
  echo -n "."; sleep 2
done
curl -s --max-time 10 https://127.0.0.1/api/v1/assistant/status --resolve "80.225.229.208:443:127.0.0.1" -k || true
echo
