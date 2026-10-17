#!/usr/bin/env bash
# Finds an Xcode + iPhone simulator pair that can run the Unhook tests on a GitHub macOS runner.
# Runner images don't always ship simulator runtimes for their default Xcode, so this tries each
# installed Xcode (newest first), creating a simulator when a runtime exists but no device does.
#
# Outputs (GITHUB_OUTPUT): id=<simulator udid>, default_developer_dir=<runner default Xcode>
# Env (GITHUB_ENV):        DEVELOPER_DIR=<Xcode that owns the simulator>
set -uo pipefail

APPS_DIR=${APPS_DIR:-/Applications}
PROJECT=Unhook.xcodeproj
SCHEME=Unhook

DEFAULT_DEVELOPER_DIR=$(xcode-select -p)
echo "default_developer_dir=$DEFAULT_DEVELOPER_DIR" >> "$GITHUB_OUTPUT"

echo "::group::Installed Xcode versions"
ls -d "$APPS_DIR"/Xcode*.app
echo "::endgroup::"

find_simulator() {
  xcodebuild -showdestinations -project "$PROJECT" -scheme "$SCHEME" 2>/dev/null \
    | grep "platform:iOS Simulator" \
    | grep "name:iPhone" \
    | grep -v "error:" \
    | head -1 \
    | sed -E 's/.*id:([^,]+),.*/\1/'
}

create_simulator() {
  # Pick the newest available iOS runtime and an iPhone model it supports.
  local pair
  pair=$(xcrun simctl list runtimes available -j | python3 -c '
import json, sys
runtimes = [r for r in json.load(sys.stdin).get("runtimes", [])
            if r.get("platform") == "iOS" and r.get("isAvailable")]
runtimes.sort(key=lambda r: [int(p) for p in r["version"].split(".")])
for runtime in reversed(runtimes):
    phones = [d for d in runtime.get("supportedDeviceTypes", []) if d.get("productFamily") == "iPhone"]
    if phones:
        print(phones[-1]["identifier"], runtime["identifier"])
        break
')
  [ -n "$pair" ] || return 1
  # shellcheck disable=SC2086
  set -- $pair
  echo "Creating simulator $1 on $2"
  xcrun simctl create "CI iPhone" "$1" "$2"
}

XCODES=$(printf "%s\n" "$APPS_DIR"/Xcode_*.app | grep -vi beta | python3 -c '
import re, sys
apps = [line.strip() for line in sys.stdin if line.strip()]
def version(path):
    match = re.search(r"Xcode_([0-9.]+)\.app", path)
    return [int(p) for p in match.group(1).strip(".").split(".")] if match else [0]
print("\n".join(sorted(apps, key=version, reverse=True)))
')

use_if_found() {
  local id
  id=$(find_simulator)
  if [ -z "$id" ] && create_simulator; then
    id=$(find_simulator)
  fi
  [ -n "$id" ] || return 1
  echo "Using simulator $id with $DEVELOPER_DIR"
  echo "DEVELOPER_DIR=$DEVELOPER_DIR" >> "$GITHUB_ENV"
  echo "id=$id" >> "$GITHUB_OUTPUT"
}

for app in $XCODES; do
  export DEVELOPER_DIR="$app/Contents/Developer"
  echo "Trying $(xcodebuild -version | head -1) at $app"
  use_if_found && exit 0
done

# Last resort: download the iOS simulator platform for the runner's default Xcode.
export DEVELOPER_DIR="$DEFAULT_DEVELOPER_DIR"
echo "No simulator found. Downloading the iOS platform for $DEVELOPER_DIR (this can take a while)..."
if xcodebuild -downloadPlatform iOS; then
  use_if_found && exit 0
fi

echo "::group::Simulator runtimes and devices"
xcrun simctl list runtimes
xcrun simctl list devices available
echo "::endgroup::"
echo "No installed Xcode has a usable iPhone simulator on this runner." >&2
exit 1
