#!/bin/bash
# Rebuilds the guide PDFs in resources/docs from their HTML versions.
# Needs Google Chrome. Run it after editing user-guide.html or code-guide.html:
#   ./make-docs.sh
cd "$(dirname "$0")/resources/docs" || exit 1

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ ! -x "$CHROME" ]; then
  CHROME="$(command -v google-chrome || command -v chromium || command -v chrome)"
fi
if [ -z "$CHROME" ]; then
  echo "Couldn't find Google Chrome. Install it, or print the HTML guides to PDF from your browser."
  exit 1
fi

for guide in user-guide code-guide; do
  "$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --run-all-compositor-stages-before-draw \
    --print-to-pdf="$PWD/$guide.pdf" "file://$PWD/$guide.html" 2>/dev/null
  echo "Made resources/docs/$guide.pdf"
done
