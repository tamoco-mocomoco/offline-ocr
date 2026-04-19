#!/bin/bash
#
# Merge scene videos with crossfade transitions + narration audio.
#
# Usage:
#   cd store/video
#   bash merge.sh              # Build Japanese version (default)
#   bash merge.sh en           # Build English version
#
# Output:
#   store/video/promo-video-ja.mp4  or  store/video/promo-video-en.mp4
#

set -e
cd "$(dirname "$0")"

LANG="${1:-ja}"
RECORDINGS="recordings"
VOICE="voice"
FADE_DURATION=0.8

if [ "$LANG" = "en" ]; then
  SUFFIX="-en"
  OUTPUT="promo-video-en.mp4"
else
  SUFFIX=""
  OUTPUT="promo-video-ja.mp4"
fi

echo "=== Building ${LANG} version ==="
echo ""

# Scene files in order
SCENES=(
  "scene0-title${SUFFIX}.mp4"
  "scene1-demo${SUFFIX}.mp4"
  "scene2-features${SUFFIX}.mp4"
  "scene3-privacy${SUFFIX}.mp4"
  "scene4-cleaning${SUFFIX}.mp4"
  "scene5-architecture${SUFFIX}.mp4"
)

echo "=== Step 1: Getting scene durations ==="
DURATIONS=()
for s in "${SCENES[@]}"; do
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$RECORDINGS/$s")
  DURATIONS+=("$d")
  echo "  $s: ${d}s"
done

echo ""
echo "=== Step 2: Building crossfade filter ==="

# Build the complex filter for xfade transitions
# Each xfade shortens the total by FADE_DURATION
N=${#SCENES[@]}
INPUTS=""
for i in $(seq 0 $((N-1))); do
  INPUTS="$INPUTS -i $RECORDINGS/${SCENES[$i]}"
done

# Calculate offsets: each transition happens at (cumulative_duration - fade * transition_number)
FILTER=""
CUMULATIVE=0
for i in $(seq 0 $((N-1))); do
  if [ $i -eq 0 ]; then
    CUMULATIVE=$(echo "${DURATIONS[0]}" | bc)
    continue
  fi

  OFFSET=$(echo "$CUMULATIVE - $FADE_DURATION" | bc)

  if [ $i -eq 1 ]; then
    PREV_LABEL="[0:v][1:v]"
    OUT_LABEL="[v1]"
  else
    PREV_LABEL="[v$((i-1))][$i:v]"
    OUT_LABEL="[v$i]"
  fi

  FILTER="${FILTER}${PREV_LABEL}xfade=transition=fade:duration=${FADE_DURATION}:offset=${OFFSET}${OUT_LABEL};"

  CUMULATIVE=$(echo "$CUMULATIVE + ${DURATIONS[$i]} - $FADE_DURATION" | bc)
done

# Remove trailing semicolon
FILTER="${FILTER%;}"

# The final output label
FINAL_V="[v$((N-1))]"

echo "  Total duration: ~${CUMULATIVE}s"
echo "  Filter: ${FILTER:0:100}..."

echo ""
echo "=== Step 3: Rendering video with crossfades ==="

TEMP_VIDEO="recordings/faded-video${SUFFIX}.mp4"
ffmpeg -y \
  $INPUTS \
  -filter_complex "$FILTER" \
  -map "$FINAL_V" \
  -c:v libx264 -crf 18 -preset slow -pix_fmt yuv420p \
  "$TEMP_VIDEO" 2>/dev/null

echo "  → faded-video${SUFFIX}.mp4"

echo ""
echo "=== Step 4: Merging video + narration ==="

NARRATION="$VOICE/narration-full${SUFFIX}.m4a"
if [ ! -f "$NARRATION" ]; then
  echo "  ⚠ ${NARRATION} not found. Outputting video without audio."
  cp "$TEMP_VIDEO" "$OUTPUT"
else
  ffmpeg -y \
    -i "$TEMP_VIDEO" \
    -i "$NARRATION" \
    -c:v copy -c:a aac -shortest \
    "$OUTPUT" 2>/dev/null
fi

echo "  → $OUTPUT"

echo ""
echo "=== Done! ==="
FINAL_DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUTPUT")
echo "  Final: $OUTPUT (${FINAL_DUR}s)"
