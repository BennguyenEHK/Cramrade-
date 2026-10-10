#!/usr/bin/env bash
# Hand test for extract-text against the live project.
#
#   bash supabase/functions/_fixtures/try-extract.sh <file> <content-type> [note-id]
#
# Needs these in the environment (never commit them):
#   CRAMRADE_EMAIL, CRAMRADE_PASSWORD   a test account that signs in with a password
#   SUPABASE_PUBLISHABLE_KEY            the sb_publishable_... key (apps/app/.env)
#   SKIP_CALL=1 (optional)              stop after the upload, for testing calls by hand
#
# Steps: sign in, create a note (unless a note id is given), upload the file
# to uploads/<user>/<note>/<name>, call extract-text, then list what is left
# in the upload folder (should be []) and show the note row.
set -euo pipefail

SB="https://ialkxvoytoqfuxxnzlaa.supabase.co"
FILE="$1"
TYPE="$2"
NOTE_ID="${3:-}"
NAME="$(basename "$FILE")"
: "${CRAMRADE_EMAIL:?set CRAMRADE_EMAIL}" "${CRAMRADE_PASSWORD:?set CRAMRADE_PASSWORD}" "${SUPABASE_PUBLISHABLE_KEY:?set SUPABASE_PUBLISHABLE_KEY}"
KEY="$SUPABASE_PUBLISHABLE_KEY"

field() { node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));const v=$1;if(v===undefined){console.error(JSON.stringify(d));process.exit(1)}console.log(v)"; }

SESSION="$(curl -s "$SB/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$CRAMRADE_EMAIL\",\"password\":\"$CRAMRADE_PASSWORD\"}")"
TOKEN="$(echo "$SESSION" | field 'd.access_token')"
USER_ID="$(echo "$SESSION" | field 'd.user.id')"

if [ -z "$NOTE_ID" ]; then
  NOTE_ID="$(curl -s "$SB/rest/v1/notes" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" -H "Prefer: return=representation" \
    -d "{\"title\":\"Hand test: $NAME\",\"source\":\"file\",\"original_filename\":\"$NAME\"}" | field 'd[0].id')"
fi
echo "user $USER_ID  note $NOTE_ID"

echo "--- upload"
curl -s -X POST "$SB/storage/v1/object/uploads/$USER_ID/$NOTE_ID/$NAME" -H "apikey: $KEY" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: $TYPE" --data-binary "@$FILE"
echo

if [ "${SKIP_CALL:-}" = "1" ]; then
  echo "SKIP_CALL=1: file uploaded, extract-text not called"
  exit 0
fi

echo "--- extract-text"
curl -s -X POST "$SB/functions/v1/extract-text" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d "{\"noteId\":\"$NOTE_ID\"}"
echo

echo "--- left in the upload folder (expect [])"
curl -s -X POST "$SB/storage/v1/object/list/uploads" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d "{\"prefix\":\"$USER_ID/$NOTE_ID\"}"
echo

echo "--- note row"
curl -s "$SB/rest/v1/notes?id=eq.$NOTE_ID&select=status,failure_reason" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN"
echo
