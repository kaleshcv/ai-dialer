#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SINK_NAME="${ACCENTAI_HOST_OUTPUT_NAME:-AccentAI_Output}"
SOURCE_NAME="${ACCENTAI_HOST_SOURCE_NAME:-AccentAI_Mic}"
SINK_DESCRIPTION="${ACCENTAI_HOST_OUTPUT_DESCRIPTION:-AccentAI Output}"
SOURCE_DESCRIPTION="${ACCENTAI_HOST_SOURCE_DESCRIPTION:-AccentAI Mic}"
VIRTUAL_FORMAT="${ACCENTAI_HOST_AUDIO_FORMAT:-s16le}"
VIRTUAL_RATE="${ACCENTAI_HOST_AUDIO_RATE:-48000}"
VIRTUAL_CHANNELS="${ACCENTAI_HOST_AUDIO_CHANNELS:-2}"
VIRTUAL_CHANNEL_MAP="${ACCENTAI_HOST_AUDIO_CHANNEL_MAP:-front-left,front-right}"
SINK_DESCRIPTION_ESCAPED="${SINK_DESCRIPTION// /\\x20}"
SOURCE_DESCRIPTION_ESCAPED="${SOURCE_DESCRIPTION// /\\x20}"

if ! command -v pactl >/dev/null 2>&1; then
  echo "pactl is required to set up the AccentAI virtual audio sink." >&2
  exit 1
fi

if ! command -v pacmd >/dev/null 2>&1; then
  echo "pacmd is required to label the AccentAI virtual audio devices." >&2
  exit 1
fi

find_physical_sink() {
  pactl list short sinks | awk -v accent_sink="$SINK_NAME" '
    $2 != accent_sink {
      print $2
      exit
    }
  '
}

find_physical_source() {
  pactl list short sources | awk -v accent_source="$SOURCE_NAME" '
    $2 !~ /\.monitor$/ && $2 != accent_source {
      print $2
      exit
    }
  '
}

find_preferred_sink() {
  local headset_sink

  headset_sink="$(pactl list short sinks 2>/dev/null | awk -v accent_sink="$SINK_NAME" '
    $2 != accent_sink && ($2 ~ /^bluez_sink\./ || $2 ~ /headset|headphone|earphone|earbud|handsfree|bluetooth/) {
      print $2
      exit
    }
  ')"
  if [[ -n "$headset_sink" ]]; then
    printf '%s\n' "$headset_sink"
    return
  fi

  find_physical_sink
}

find_preferred_source() {
  local headset_source

  headset_source="$(pactl list short sources 2>/dev/null | awk -v accent_source="$SOURCE_NAME" '
    $2 !~ /\.monitor$/ && $2 != accent_source && ($2 ~ /^bluez_source\./ || $2 ~ /headset|headphone|earphone|earbud|handsfree|bluetooth/) {
      print $2
      exit
    }
  ')"
  if [[ -n "$headset_source" ]]; then
    printf '%s\n' "$headset_source"
    return
  fi

  find_physical_source
}

get_default_sink() {
  pactl info 2>/dev/null | awk -F': ' '/^Default Sink:/ { print $2; exit }'
}

get_default_source() {
  pactl info 2>/dev/null | awk -F': ' '/^Default Source:/ { print $2; exit }'
}

get_sink_module_id() {
  pactl list short modules 2>/dev/null | awk -v sink_name="$SINK_NAME" '
    $2 == "module-null-sink" && $0 ~ ("sink_name=" sink_name "($| )") {
      print $1
      exit
    }
  '
}

get_source_module_id() {
  pactl list short modules 2>/dev/null | awk -v source_name="$SOURCE_NAME" '
    $2 == "module-remap-source" && $0 ~ ("source_name=" source_name "($| )") {
      print $1
      exit
    }
  '
}

get_sink_spec() {
  pactl list short sinks 2>/dev/null | awk -v sink_name="$SINK_NAME" '
    $2 == sink_name {
      print $4
      exit
    }
  '
}

get_source_spec() {
  pactl list short sources 2>/dev/null | awk -v source_name="$SOURCE_NAME" '
    $2 == source_name {
      print $4
      exit
    }
  '
}

expected_virtual_spec() {
  printf '%s %sch %sHz\n' "$VIRTUAL_FORMAT" "$VIRTUAL_CHANNELS" "$VIRTUAL_RATE"
}

recreate_virtual_modules_if_needed() {
  local expected_spec
  local sink_spec
  local source_spec
  local sink_module_id
  local source_module_id

  expected_spec="$(expected_virtual_spec)"
  sink_spec="$(get_sink_spec || true)"
  source_spec="$(get_source_spec || true)"

  if [[ "$sink_spec" == "$expected_spec" && "$source_spec" == "$expected_spec" ]]; then
    return
  fi

  source_module_id="$(get_source_module_id || true)"
  if [[ -n "$source_module_id" ]]; then
    pactl unload-module "$source_module_id" >/dev/null 2>&1 || true
  fi

  sink_module_id="$(get_sink_module_id || true)"
  if [[ -n "$sink_module_id" ]]; then
    pactl unload-module "$sink_module_id" >/dev/null 2>&1 || true
  fi
}

CURRENT_DEFAULT_SINK="$(get_default_sink || true)"
CURRENT_DEFAULT_SOURCE="$(get_default_source || true)"

recreate_virtual_modules_if_needed

if ! pactl list short sinks | awk '{print $2}' | grep -Fxq "$SINK_NAME"; then
  MODULE_ID="$(
    pactl load-module module-null-sink \
      sink_name="$SINK_NAME" \
      format="$VIRTUAL_FORMAT" \
      rate="$VIRTUAL_RATE" \
      channels="$VIRTUAL_CHANNELS" \
      channel_map="$VIRTUAL_CHANNEL_MAP" \
      sink_properties="device.description=${SINK_DESCRIPTION_ESCAPED}"
  )"

  echo "AccentAI sink created: $SINK_NAME (module $MODULE_ID)"
else
  echo "AccentAI sink already exists: $SINK_NAME"
fi

if ! pactl list short sources | awk '{print $2}' | grep -Fxq "$SOURCE_NAME"; then
  MODULE_ID="$(
    pactl load-module module-remap-source \
      master="${SINK_NAME}.monitor" \
      source_name="$SOURCE_NAME" \
      format="$VIRTUAL_FORMAT" \
      rate="$VIRTUAL_RATE" \
      channels="$VIRTUAL_CHANNELS" \
      channel_map="$VIRTUAL_CHANNEL_MAP" \
      master_channel_map="$VIRTUAL_CHANNEL_MAP" \
      remix=no \
      resample_method="${ACCENTAI_HOST_AUDIO_RESAMPLE_METHOD:-soxr-mq}" \
      source_properties="device.description=${SOURCE_DESCRIPTION_ESCAPED}"
  )"

  echo "AccentAI source created: $SOURCE_NAME (module $MODULE_ID)"
else
  echo "AccentAI source already exists: $SOURCE_NAME"
fi

printf "update-sink-proplist %s device.description='%s'\n" "$SINK_NAME" "$SINK_DESCRIPTION" | pacmd >/dev/null
printf "update-source-proplist %s device.description='%s'\n" "$SOURCE_NAME" "$SOURCE_DESCRIPTION" | pacmd >/dev/null
pactl set-sink-volume "$SINK_NAME" 100% >/dev/null

PHYSICAL_SINK="$CURRENT_DEFAULT_SINK"
PHYSICAL_SOURCE="$CURRENT_DEFAULT_SOURCE"

if [[ -z "$PHYSICAL_SINK" || "$PHYSICAL_SINK" == "$SINK_NAME" || ! "$PHYSICAL_SINK" =~ ^bluez_sink\. ]]; then
  PHYSICAL_SINK="$(find_preferred_sink || true)"
fi

if [[ -z "$PHYSICAL_SOURCE" || "$PHYSICAL_SOURCE" == "$SOURCE_NAME" || "$PHYSICAL_SOURCE" =~ \.monitor$ || ! "$PHYSICAL_SOURCE" =~ ^bluez_source\. ]]; then
  PHYSICAL_SOURCE="$(find_preferred_source || true)"
fi

if [[ -n "$PHYSICAL_SINK" ]]; then
  printf "set-default-sink %s\n" "$PHYSICAL_SINK" | pacmd >/dev/null
fi

if [[ -n "$PHYSICAL_SOURCE" ]]; then
  printf "set-default-source %s\n" "$PHYSICAL_SOURCE" | pacmd >/dev/null
fi
