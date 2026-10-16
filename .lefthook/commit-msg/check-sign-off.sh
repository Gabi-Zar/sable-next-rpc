#!/usr/bin/env bash

set -euo pipefail

if ! git interpret-trailers --parse "$1" | grep -q '^Signed-off-by: '; then
    echo "ERROR: Missing Signed-off-by trailer!"
    echo "Every commit needs a Signed-off-by trailer matching its author, certifying the DCO."
    echo "Please review the DCO and sign off under the name you go by. You can use \"git commit -s\"."
    exit 1
fi
