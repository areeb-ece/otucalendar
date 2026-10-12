#!/usr/bin/env bash
# One-command setup and export; everything installs in this folder / user cache.
set -euo pipefail
exporter_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$exporter_dir"

if ! command -v python3 >/dev/null 2>&1; then
  echo 'Install Python 3.10 or newer, then run this script again.' >&2
  exit 1
fi
if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))'; then
  echo 'Python 3.10 or newer is required.' >&2
  exit 1
fi
if [[ ! -x .venv/bin/python ]]; then
  if ! python3 -m venv .venv; then
    echo 'Could not create a Python environment. On Ubuntu/Mint: sudo apt install python3-venv' >&2
    exit 1
  fi
fi
if [[ ! -f .venv/requirements-installed.txt ]] || ! cmp -s requirements.txt .venv/requirements-installed.txt; then
  echo 'Installing the exporter dependencies (first run)...'
  .venv/bin/python -m pip install --disable-pip-version-check -r requirements.txt
  cp requirements.txt .venv/requirements-installed.txt
fi

exporter_mode=auto
exporter_offline=false
exporter_setup=false
exporter_next_browser=false
for exporter_arg in "$@"; do
  if "$exporter_next_browser"; then
    exporter_mode="$exporter_arg"
    exporter_next_browser=false
  elif [[ "$exporter_arg" == --browser ]]; then
    exporter_next_browser=true
  elif [[ "$exporter_arg" == --browser=* ]]; then
    exporter_mode="${exporter_arg#--browser=}"
  elif [[ "$exporter_arg" == --gui || "$exporter_arg" == --input || "$exporter_arg" == --input=* || "$exporter_arg" == --help || "$exporter_arg" == -h ]]; then
    exporter_offline=true
  elif [[ "$exporter_arg" == --setup ]]; then
    exporter_setup=true
  fi
done
if "$exporter_setup"; then
  # --setup is intentionally a standalone action.
  .venv/bin/python -m playwright install --no-shell chromium
  echo 'Setup complete. Run: bash run.sh'
  exit 0
fi
if ! "$exporter_offline"; then
  if [[ "$exporter_mode" == firefox ]]; then
    .venv/bin/python -m playwright install firefox
  elif [[ "$exporter_mode" == chromium ]] || { [[ "$exporter_mode" == auto ]] && ! .venv/bin/python -c 'from browser_capture import installed_chromium; import sys; sys.exit(installed_chromium() is None)'; }; then
    .venv/bin/python -m playwright install --no-shell chromium
  fi
fi
exec .venv/bin/python export_courses.py "$@"
