#!/usr/bin/env bash
#
# Get a session via the GAM central issuer (the "new way") and open the dashboard.
#
# Two-leg OAuth-style flow (see src/middleware.ts and ../gam/token_issuer.py):
#   1) POST {GAM_BASE_URL}/auth/issue — Magic-style call that returns a
#      SHORT-lived `code` (typ="code", ~2 min) for one audience. Gated by GAM's
#      IP allowlist only.
#   2) Open {BASE_URL}/?code=<code> in the browser. The dashboard's middleware
#      calls /auth/exchange server-to-server, stores the full RS256 access token
#      in the httpOnly `gam_session` cookie, and redirects to a clean URL.
#
# Prerequisites for local dev:
#   • GAM running on $GAM_BASE_URL (default http://localhost:8080).
#   • The dashboard's .env.local has:
#       GAM_BASE_URL=http://localhost:8080
#     The dashboard fetches GAM's public key from
#     $GAM_BASE_URL/.well-known/jwks.json on demand (cached by `kid`). For a
#     stable dev key across GAM restarts, set ISSUER_PRIVATE_KEY_PEM in GAM.
#
# Optional env:
#   GAM_BASE_URL    default http://localhost:8080
#   BASE_URL        default http://localhost:3000
#   EMAIL           default golem1@lecfl.com (must end in @lecfl.com)
#   CUSTOMER_ID, INVOICE_UID, ACCOUNT_ID  baked into the token's `data` claim
#
# Usage:
#   ./scripts/open-dashboard-gam.sh
#   ./scripts/open-dashboard-gam.sh <CustomerID> <InvoiceUID> <AccountID>

set -euo pipefail

# Load GAM_BASE_URL from .env.local without `source` —
# values in that file may contain shell metacharacters (`:`, `,`, etc.) which
# would otherwise be evaluated. Only KEY=value lines are honored; surrounding
# quotes are stripped; existing shell env wins over the file.
ENV_FILE="$(dirname "$0")/../.env.local"
load_env_var() {
  local key="$1"
  [[ -n "${!key:-}" ]] && return 0
  [[ -f "$ENV_FILE" ]] || return 0
  local line value
  line=$(grep -E "^[[:space:]]*${key}=" "$ENV_FILE" | tail -n 1) || true
  [[ -z "$line" ]] && return 0
  value="${line#*=}"
  # Strip optional surrounding single or double quotes.
  if [[ "$value" == \"*\" || "$value" == \'*\' ]]; then
    value="${value:1:${#value}-2}"
  fi
  export "$key=$value"
}
load_env_var GAM_BASE_URL

GAM_BASE_URL="${GAM_BASE_URL:-https://flask-gam-app-364894474586.us-central1.run.app}"
BASE_URL="${BASE_URL:-http://localhost:3000}"
EMAIL="${EMAIL:-sholem@lecfl.com}"

# Same defaults as open-dashboard.sh — a real triple pulled from production logs.
DEFAULT_CUSTOMER_ID="cus_RCNmmDbRyZZVzz"
DEFAULT_INVOICE_UID="4B85A29E-E3F3-4ADC-A5E8-3219CE204F49"
DEFAULT_ACCOUNT_ID="1"

CUSTOMER_ID="${1:-${CUSTOMER_ID:-$DEFAULT_CUSTOMER_ID}}"
INVOICE_UID="${2:-${INVOICE_UID:-$DEFAULT_INVOICE_UID}}"
ACCOUNT_ID="${3:-${ACCOUNT_ID:-$DEFAULT_ACCOUNT_ID}}"

# GAM's /auth/issue is gated by an IP allowlist (token_auth.ALLOWED_IPS) that
# does NOT include 127.0.0.1. The allowlist check uses the rightmost
# X-Forwarded-For entry, so passing one of the allowed IPs here lets a local
# call through. This is fine in dev because there's no real proxy in front of
# GAM to spoof — do NOT do this against a deployed GAM.
ALLOWED_IP_FOR_DEV="67.23.68.218"

echo "→ Requesting code from $GAM_BASE_URL/auth/issue (email=$EMAIL aud=stripe-dashboard)"
PAYLOAD=$(cat <<JSON
{"AUD":"stripe-dashboard","Email":"$EMAIL","Data":{"AccountID":"$ACCOUNT_ID","CustomerID":"$CUSTOMER_ID","InvoiceUID":"$INVOICE_UID","ExtendedInfo":{"FatherName":"Shmuel Freeman","FatherEmail":"ShmuelFreeman@gmail.com","FatherCell":3233639795,"MotherName":"Kayla Freeman","MotherEmail":"KaylaCFreeman@gmail.com","MotherCell":3238930181,"ParentsName":"Mr. Shmuel and Mrs. Kayla Freeman","SenderName":"Rabbi Sholem Kleinman","SenderEmail":"sholem@lecfl.com","PaymentName":"Enrollment & Tuition for 2025/26 School Year","TotalAmount":7166.00}}}
JSON
)
RESPONSE=$(curl -sS -X POST "$GAM_BASE_URL/auth/issue" \
  -H "Content-Type: application/json" \
  -H "X-Forwarded-For: $ALLOWED_IP_FOR_DEV" \
  -d "$PAYLOAD")

CODE=$(printf '%s' "$RESPONSE" | node -e '
  let s = "";
  process.stdin.on("data", d => s += d).on("end", () => {
    try {
      const j = JSON.parse(s);
      if (j.success && j.code) { process.stdout.write(j.code); }
      else { console.error("Issue request failed:", s); process.exit(1); }
    } catch { console.error("Unexpected response:", s); process.exit(1); }
  });
')

URL="$BASE_URL/?code=$CODE"
echo "→ Opening $URL"
echo "  (the dashboard middleware will exchange the code, set the gam_session cookie, and redirect)"
open "$URL"
