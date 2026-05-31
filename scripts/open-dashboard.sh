#!/usr/bin/env bash
#
# Generate a legacy (HMAC) dashboard token and open the site — the "old way".
#
# Calls POST /api/auth/generate-token (IP-authorized: localhost is allowlisted),
# then opens http://localhost:3000/?token=<token> in the browser.
#
# Usage:
#   ./scripts/open-dashboard.sh <CustomerID cus_...> <InvoiceUID> <AccountID>
#
# Or set them as env vars:
#   CUSTOMER_ID=cus_123 INVOICE_UID=INV-1 ACCOUNT_ID=1 ./scripts/open-dashboard.sh
#
# CustomerID must start with cus_. AccountID is a plain string (in this project
# it's a numeric value like "1" — not a Stripe acct_... ID).
#
# Override the host with BASE_URL (default http://localhost:3000).

set -euo pipefail

# Defaults — a real triple pulled from production logs so this script can be
# run with no arguments. Override via positional args or env vars.
DEFAULT_CUSTOMER_ID="cus_RDY5fgetvZ3bt4"
DEFAULT_INVOICE_UID="2BAD77DA-AB33-4D03-A455-55F9799495C0"
DEFAULT_ACCOUNT_ID="1"

BASE_URL="${BASE_URL:-http://localhost:3000}"
CUSTOMER_ID="${1:-${CUSTOMER_ID:-$DEFAULT_CUSTOMER_ID}}"
INVOICE_UID="${2:-${INVOICE_UID:-$DEFAULT_INVOICE_UID}}"
ACCOUNT_ID="${3:-${ACCOUNT_ID:-$DEFAULT_ACCOUNT_ID}}"

if [[ -z "$CUSTOMER_ID" || -z "$INVOICE_UID" || -z "$ACCOUNT_ID" ]]; then
  echo "Usage: $0 <CustomerID cus_...> <InvoiceUID> <AccountID acct_...>"
  echo "   or: CUSTOMER_ID=... INVOICE_UID=... ACCOUNT_ID=... $0"
  exit 1
fi

echo "→ Requesting token from $BASE_URL/api/auth/generate-token"
RESPONSE=$(curl -sS -X POST "$BASE_URL/api/auth/generate-token" \
  -H "Content-Type: application/json" \
  -d "{\"CustomerID\":\"$CUSTOMER_ID\",\"InvoiceUID\":\"$INVOICE_UID\",\"AccountID\":\"$ACCOUNT_ID\"}")

# Parse the token out of the JSON response (uses node, already available here).
TOKEN=$(printf '%s' "$RESPONSE" | node -e '
  let s = "";
  process.stdin.on("data", d => s += d).on("end", () => {
    try {
      const j = JSON.parse(s);
      if (j.success && j.token) { process.stdout.write(j.token); }
      else { console.error("Token request failed:", s); process.exit(1); }
    } catch { console.error("Unexpected response:", s); process.exit(1); }
  });
')

URL="$BASE_URL/?token=$TOKEN"
echo "→ Opening $URL"
open "$URL"
