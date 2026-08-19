#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# ingest.sh が出力した audio.wav を文字起こしする。
# 利用できるバックエンドを自動判定して、最初に見つかったものを使う。
#
#   1. whisper.cpp   (whisper-cli) … ローカル完結・高速。要 WHISPER_CPP_MODEL
#   2. openai-whisper (whisper)    … ローカル完結。pip install openai-whisper
#   3. OpenAI API                  … 要 OPENAI_API_KEY。音声が外部に送信される
#
# 出力: 同じディレクトリに transcript.txt (本文) と transcript.srt (時刻付き)
# ---------------------------------------------------------------------------
set -euo pipefail

LANG_CODE="${WHISPER_LANG:-ja}"

usage() {
  cat <<'USAGE'
使い方:
  tools/sns-video/transcribe.sh <audio.wav|動画ファイル> [バックエンド]

バックエンド: auto (既定) | whisper-cpp | whisper | openai-api

環境変数:
  WHISPER_LANG        言語コード (既定: ja)
  WHISPER_CPP_MODEL   whisper.cpp のモデルファイル (.bin) のパス
  WHISPER_CPP_BIN     whisper.cpp の実行ファイル (既定: whisper-cli)
  OPENAI_API_KEY      OpenAI API を使う場合のキー
USAGE
}

[[ $# -ge 1 ]] || { usage >&2; exit 1; }
[[ "$1" == "-h" || "$1" == "--help" ]] && { usage; exit 0; }

AUDIO="$1"
BACKEND="${2:-auto}"
[[ -f "$AUDIO" ]] || { echo "ファイルが見つかりません: $AUDIO" >&2; exit 1; }

OUTDIR="$(cd "$(dirname "$AUDIO")" && pwd)"
STEM="$OUTDIR/transcript"

# 動画を直接渡された場合は wav に変換する
case "$AUDIO" in
  *.wav) ;;
  *)
    command -v ffmpeg >/dev/null 2>&1 || { echo "wav 変換に ffmpeg が必要です" >&2; exit 1; }
    echo "--> 音声を wav に変換"
    ffmpeg -nostdin -y -loglevel error -i "$AUDIO" -vn -ac 1 -ar 16000 \
      -c:a pcm_s16le "$OUTDIR/audio.wav"
    AUDIO="$OUTDIR/audio.wav"
    ;;
esac

WHISPER_CPP_BIN="${WHISPER_CPP_BIN:-whisper-cli}"

if [[ "$BACKEND" == "auto" ]]; then
  if command -v "$WHISPER_CPP_BIN" >/dev/null 2>&1 && [[ -n "${WHISPER_CPP_MODEL:-}" ]]; then
    BACKEND=whisper-cpp
  elif command -v whisper >/dev/null 2>&1; then
    BACKEND=whisper
  elif [[ -n "${OPENAI_API_KEY:-}" ]]; then
    BACKEND=openai-api
  else
    cat >&2 <<'NOBACKEND'
文字起こしバックエンドが見つかりません。いずれかを用意してください:

  # A. whisper.cpp (ローカル完結・推奨)
  brew install whisper-cpp        # または github.com/ggml-org/whisper.cpp をビルド
  export WHISPER_CPP_MODEL=/path/to/ggml-large-v3-turbo.bin

  # B. openai-whisper (ローカル完結・導入が簡単)
  pip install -U openai-whisper

  # C. OpenAI API (音声が外部送信される。社外秘の素材では使わないこと)
  export OPENAI_API_KEY=sk-...
NOBACKEND
    exit 1
  fi
fi

echo "==> バックエンド: $BACKEND"

case "$BACKEND" in
  whisper-cpp)
    [[ -n "${WHISPER_CPP_MODEL:-}" ]] || { echo "WHISPER_CPP_MODEL が未設定です" >&2; exit 1; }
    "$WHISPER_CPP_BIN" -m "$WHISPER_CPP_MODEL" -f "$AUDIO" -l "$LANG_CODE" \
      -otxt -osrt -of "$STEM"
    ;;
  whisper)
    whisper "$AUDIO" --language "$LANG_CODE" --model medium \
      --output_format all --output_dir "$OUTDIR"
    # openai-whisper は入力ファイル名で出力するのでリネームする
    for ext in txt srt vtt json tsv; do
      src="$OUTDIR/$(basename "${AUDIO%.*}").$ext"
      [[ -f "$src" && "$src" != "$STEM.$ext" ]] && mv "$src" "$STEM.$ext"
    done
    ;;
  openai-api)
    [[ -n "${OPENAI_API_KEY:-}" ]] || { echo "OPENAI_API_KEY が未設定です" >&2; exit 1; }
    echo "--> 音声を OpenAI に送信します (社外秘の素材では中断してください)"
    curl -sS https://api.openai.com/v1/audio/transcriptions \
      -H "Authorization: Bearer $OPENAI_API_KEY" \
      -F file="@$AUDIO" -F model=whisper-1 -F language="$LANG_CODE" \
      -F response_format=srt > "$STEM.srt"
    sed -E '/^[0-9]+$/d; /-->/d; /^$/d' "$STEM.srt" > "$STEM.txt"
    ;;
  *)
    echo "不明なバックエンド: $BACKEND" >&2; exit 1 ;;
esac

echo "==> 完了:"
for ext in txt srt; do
  [[ -f "$STEM.$ext" ]] && echo "    $STEM.$ext"
done
