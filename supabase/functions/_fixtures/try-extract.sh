#!/usr/bin/env bash
# Hand test for extract-text against the live project.
#
#   bash supabase/functions/_fixtures/try-extract.sh <file> <content-type> [exam-id] [is-syllabus]
#
# Needs these in the environment (never commit them):
#   CRAMRADE_EMAIL, CRAMRADE_PASSWORD   a test account that signs in with a password
#   SUPABASE_PUBLISHABLE_KEY            the sb_publishable_... key (apps/app/.env)
#   UPLOAD_ID (optional)                reuse an upload id, to check that a repeat does no new work
#
# Steps: sign in, send the file to extract-text as multipart/form-data with a
# new upload id (it becomes the note id), then show the note row and how many
# chunks it has. Nothing is uploaded to Storage.
set -euo pipefail

SB="https://ialkxvoytoqfuxxnzlaa.supabase.co"
FILE="$1"
TYPE="$2"
EXAM_ID="${3:-}"
IS_SYLLABUS="${4:-false}"
: "${CRAMRADE_EMAIL:?set CRAMRADE_EMAIL}" "${CRAMRADE_PASSWORD:?set CRAMRADE_PASSWORD}" "${SUPABASE_PUBLISHABLE_KEY:?set SUPABASE_PUBLISHABLE_KEY}"
KEY="$SUPABASE_PUBLISHABLE_KEY"
UPLOAD_ID="${UPLOAD_ID:-$(node -e "console.log(crypto.randomUUID())")}"

field() { node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));const v=$1;if(v===undefined){console.error(JSON.stringify(d));process.exit(1)}console.log(v)"; }

SESSION="$(curl -s "$SB/auth/v1/token?grant_type=password" -H "apikey: $KEY" -H "Content-Type: application/json" \
  -d "{\"email\":\"$CRAMRADE_EMAIL\",\"password\":\"$CRAMRADE_PASSWORD\"}")"
TOKEN="$(echo "$SESSION" | field 'd.access_token')"
USER_ID="$(echo "$SESSION" | field 'd.user.id')"
echo "user $USER_ID  upload id (note id) $UPLOAD_ID"

EXTRA=()
if [ -n "$EXAM_ID" ]; then EXTRA+=(-F "examId=$EXAM_ID"); fi

echo "--- extract-text"
curl -s -X POST "$SB/functions/v1/extract-text" -H "Authorization: Bearer $TOKEN" -H "apikey: $KEY" \
  -F "file=@$FILE;type=$TYPE" -F "uploadId=$UPLOAD_ID" -F "isSyllabus=$IS_SYLLABUS" "${EXTRA[@]}"
echo

echo "--- note row"
curl -s "$SB/rest/v1/notes?id=eq.$UPLOAD_ID&select=status,failure_reason,exam_id,is_syllabus" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN"
echo

echo "--- chunk count"
curl -s -I "$SB/rest/v1/chunks?note_id=eq.$UPLOAD_ID&select=id" -H "apikey: $KEY" -H "Authorization: Bearer $TOKEN" \
  -H "Prefer: count=exact" | grep -i '^content-range' || echo "(no content-range header)"
