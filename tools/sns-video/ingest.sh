#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# SNS動画(TikTok / Instagram Reels)を Claude Code が読める形に変換する
#
#   動画 --> フレーム画像(テロップ・映像) + 音声WAV(文字起こし用) + メタ情報
#
# Claude Code は動画ファイルを直接読めないため、画像とテキストに落とす。
# ---------------------------------------------------------------------------
set -euo pipefail

MAX_FRAMES=24
MODE=uniform
SCENE_THRESHOLD=0.25
FRAME_WIDTH=720

usage() {
  cat <<'USAGE'
使い方:
  tools/sns-video/ingest.sh [オプション] <動画ファイル> [出力先ディレクトリ]

オプション:
  -n, --max-frames <数>   抽出するフレームの上限 (既定: 24)
  -s, --scene             等間隔ではなくシーン変化点でフレームを抽出する
  -t, --threshold <0-1>   シーン検出の閾値 (既定: 0.25、小さいほど多く抽出)
  -w, --width <px>        フレームの横幅 (既定: 720)
  -h, --help              このヘルプ

例:
  tools/sns-video/ingest.sh videos/reel_001.mp4
  tools/sns-video/ingest.sh -s -n 40 videos/tiktok_002.mp4 analysis/tiktok_002

出力 (既定は analysis/<動画名>/):
  frames/frame_XXX.jpg   フレーム画像。Claude Code の Read で直接読める
  frames/index.md        フレームと再生位置(秒)の対応表
  contact-sheet-XX.jpg   フレームをタイル状に並べた一覧。全体の流れの把握用
  audio.wav              16kHz モノラル。transcribe.sh の入力
  meta.json              尺・解像度・fps など
  NOTES.md               分析結果を書き込むテンプレート
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--max-frames) MAX_FRAMES="$2"; shift 2 ;;
    -s|--scene)      MODE=scene; shift ;;
    -t|--threshold)  SCENE_THRESHOLD="$2"; shift 2 ;;
    -w|--width)      FRAME_WIDTH="$2"; shift 2 ;;
    -h|--help)       usage; exit 0 ;;
    -*)              echo "不明なオプション: $1" >&2; usage >&2; exit 1 ;;
    *)               break ;;
  esac
done

if [[ $# -lt 1 ]]; then usage >&2; exit 1; fi

VIDEO="$1"
[[ -f "$VIDEO" ]] || { echo "動画が見つかりません: $VIDEO" >&2; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || {
  echo "ffmpeg が必要です。 macOS: brew install ffmpeg / Ubuntu: sudo apt install ffmpeg" >&2
  exit 1
}

BASE="$(basename "${VIDEO%.*}")"
OUT="${2:-analysis/$BASE}"
FRAMES="$OUT/frames"
mkdir -p "$FRAMES"

# --- 尺の取得 (ffprobe が無い環境でも動くようフォールバックする) ------------
duration_of() {
  if command -v ffprobe >/dev/null 2>&1; then
    ffprobe -v error -show_entries format=duration -of csv=p=0 "$1" 2>/dev/null || true
  else
    # ffmpeg は出力先を指定しないと終了コード1を返すので握りつぶす
    { ffmpeg -nostdin -i "$1" 2>&1 || true; } \
      | sed -n 's/.*Duration: \([0-9][0-9]*:[0-9][0-9]:[0-9.]*\).*/\1/p' \
      | head -1 \
      | awk -F: '{printf "%.3f", ($1*3600)+($2*60)+$3}'
  fi
}

DURATION="$(duration_of "$VIDEO" || true)"
[[ -n "$DURATION" && "$DURATION" != "N/A" ]] || DURATION=0
echo "==> $VIDEO (${DURATION}秒)"

# --- フレーム抽出 -----------------------------------------------------------
INTERVAL=0
if [[ "$MODE" == "scene" ]]; then
  echo "--> シーン変化点でフレームを抽出 (閾値 $SCENE_THRESHOLD)"
  ffmpeg -nostdin -y -loglevel error -i "$VIDEO" \
    -vf "select='gt(scene,${SCENE_THRESHOLD})',scale=${FRAME_WIDTH}:-2" \
    -vsync vfr -frames:v "$MAX_FRAMES" -q:v 3 "$FRAMES/frame_%03d.jpg"
  # 静止画的な動画ではシーン検出が0枚になることがあるので等間隔にフォールバック
  if [[ -z "$(ls -A "$FRAMES" 2>/dev/null)" ]]; then
    echo "--> シーン変化を検出できず。等間隔抽出に切り替えます"
    MODE=uniform
  fi
fi

if [[ "$MODE" == "uniform" ]]; then
  INTERVAL="$(awk -v d="$DURATION" -v n="$MAX_FRAMES" \
    'BEGIN{ i = (d>0 ? d/n : 1); if (i < 0.2) i = 0.2; printf "%.3f", i }')"
  echo "--> ${INTERVAL}秒ごとにフレームを抽出 (最大 ${MAX_FRAMES}枚)"
  ffmpeg -nostdin -y -loglevel error -i "$VIDEO" \
    -vf "fps=1/${INTERVAL},scale=${FRAME_WIDTH}:-2" \
    -frames:v "$MAX_FRAMES" -q:v 3 "$FRAMES/frame_%03d.jpg"
fi

COUNT="$(find "$FRAMES" -name 'frame_*.jpg' | wc -l | tr -d ' ')"
echo "--> フレーム ${COUNT}枚"

# --- フレームと再生位置の対応表 --------------------------------------------
{
  echo "# フレーム一覧: $BASE"
  echo
  if [[ "$MODE" == "uniform" ]]; then
    echo "等間隔抽出 / 間隔 ${INTERVAL}秒 / 全体 ${DURATION}秒"
    echo
    echo "| ファイル | 再生位置(秒) |"
    echo "|---|---|"
    i=0
    for f in "$FRAMES"/frame_*.jpg; do
      [[ -e "$f" ]] || continue
      t="$(awk -v i="$i" -v s="$INTERVAL" 'BEGIN{printf "%.1f", i*s}')"
      echo "| $(basename "$f") | $t |"
      i=$((i+1))
    done
  else
    echo "シーン変化点で抽出 (閾値 ${SCENE_THRESHOLD}) / 全体 ${DURATION}秒"
    echo
    echo "フレーム番号は登場順。正確な再生位置は等間隔モード(-s なし)で取得してください。"
    echo
    for f in "$FRAMES"/frame_*.jpg; do
      [[ -e "$f" ]] || continue
      echo "- $(basename "$f")"
    done
  fi
} > "$FRAMES/index.md"

# --- コンタクトシート (全体の流れを1枚で掴む用) ------------------------------
if [[ "$COUNT" -gt 0 ]]; then
  ffmpeg -nostdin -y -loglevel error -pattern_type glob -i "$FRAMES/frame_*.jpg" \
    -vf "scale=360:-2,tile=4x3:padding=8:margin=8:color=white" \
    -q:v 3 "$OUT/contact-sheet-%02d.jpg" 2>/dev/null || true
  echo "--> コンタクトシート $(find "$OUT" -maxdepth 1 -name 'contact-sheet-*.jpg' | wc -l | tr -d ' ')枚"
fi

# --- 音声抽出 ---------------------------------------------------------------
if ffmpeg -nostdin -y -loglevel error -i "$VIDEO" -vn -ac 1 -ar 16000 \
     -c:a pcm_s16le "$OUT/audio.wav" 2>/dev/null && [[ -s "$OUT/audio.wav" ]]; then
  echo "--> 音声 audio.wav"
else
  rm -f "$OUT/audio.wav"
  echo "--> 音声トラックなし (スキップ)"
fi

# --- メタ情報 ---------------------------------------------------------------
if command -v ffprobe >/dev/null 2>&1; then
  ffprobe -v error -print_format json -show_format -show_streams "$VIDEO" > "$OUT/meta.json"
else
  printf '{"source":"%s","duration_sec":%s,"frames":%s}\n' "$VIDEO" "$DURATION" "$COUNT" > "$OUT/meta.json"
fi

# --- 分析テンプレート -------------------------------------------------------
if [[ ! -f "$OUT/NOTES.md" ]]; then
  cat > "$OUT/NOTES.md" <<NOTES
# $BASE

## 投稿メタデータ（手で埋める）
- プラットフォーム:
- 投稿日時:
- 尺: ${DURATION}秒
- 再生数 / いいね / 保存 / コメント / シェア:
- 平均視聴時間・視聴維持率:
- キャプション:
- ハッシュタグ:

## 内容（Claude が frames/ と transcript.txt を読んで埋める）
### 冒頭2秒のフック

### 構成（時間ごとの展開）

### テロップ（画面に焼き込まれた文字）

### 音声・ナレーション要約

### 被写体・画作り・編集テンポ

### CTA

## 考察
### 伸びた/伸びなかった要因の仮説

### 次の投稿への打ち手
NOTES
fi

echo "==> 完了: $OUT"
echo "    次: tools/sns-video/transcribe.sh \"$OUT/audio.wav\""
