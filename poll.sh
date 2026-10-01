#!/usr/bin/env bash
set -euo pipefail

if [ -z "${NOTION_TOKEN:-}" ]; then
  echo "::error::请配置 NOTION_TOKEN secret。"
  exit 1
fi
case "${POLLING_MINUTES:-12}" in
  1|12) ;;
  *) echo "::error::Invalid polling_minutes"; exit 1 ;;
esac

deadline=$((SECONDS + ${POLLING_MINUTES:-12} * 60))
round=0
failures=0
unresolved=0
while (( SECONDS < deadline )); do
  round=$((round + 1))
  echo "Round $round"
  if timeout 120s node renumber.mjs; then
    failures=0
    unresolved=0
    sleep 1
  else
    status=$?
    # 75 is a temporary API/network failure; 124 is the round timeout.
    if (( status != 75 && status != 124 )); then
      echo "::error::Permanent or unexpected error (exit $status); stopping."
      exit "$status"
    fi
    failures=$((failures + 1))
    unresolved=$status
    if (( failures >= 5 )); then
      echo "::error::Five consecutive temporary round failures; stopping."
      exit "$status"
    fi
    delay=$((30 * 2 ** (failures - 1)))
    if (( delay > 120 )); then delay=120; fi
    remaining=$((deadline - SECONDS))
    if (( remaining <= 0 )); then break; fi
    if (( delay > remaining )); then delay=$remaining; fi
    echo "::warning::Temporary round failure (exit $status); retrying in ${delay}s."
    sleep "$delay"
  fi
done
if (( unresolved != 0 )); then
  echo "::error::Polling window ended without recovery; stopping automatic continuation."
  exit "$unresolved"
fi
echo "Polling window complete: $round rounds."
