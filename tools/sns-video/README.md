# SNS動画を Claude Code に理解させるツール

TikTok / Instagram Reels の動画を、Claude Code が読める形（フレーム画像＋文字起こしテキスト）に変換します。

Claude Code は **動画ファイルを直接読めません**。画像とテキストに落とすことで、
映像・テロップ・ナレーションの内容まで踏み込んだ分析ができるようになります。

```
動画.mp4
  ├─ ingest.sh      → frames/*.jpg   映像・テロップ (Read でそのまま読める)
  │                  → contact-sheet-*.jpg  全体の流れを1枚で
  │                  → audio.wav     文字起こし用
  │                  → meta.json     尺・解像度・fps
  │                  → NOTES.md      分析を書き込むテンプレート
  └─ transcribe.sh  → transcript.txt / transcript.srt  ナレーション
```

## 準備

### 1. ffmpeg（必須）

```bash
brew install ffmpeg            # macOS
sudo apt install ffmpeg        # Ubuntu / Debian
```

### 2. 文字起こしバックエンド（音声を扱う場合のみ）

いずれか一つ。ローカル完結のものを推奨します。

```bash
# A. whisper.cpp — 速くてローカル完結
brew install whisper-cpp
# モデルを取得して環境変数に設定
export WHISPER_CPP_MODEL=/path/to/ggml-large-v3-turbo.bin

# B. openai-whisper — 導入が簡単
pip install -U openai-whisper

# C. OpenAI API — 音声が外部に送信される。社外秘・未公開素材では使わないこと
export OPENAI_API_KEY=sk-...
```

## 動画をどう手に入れるか

| 手段 | 対象 | 備考 |
|---|---|---|
| TikTok: 設定 → アカウント → データのダウンロード | 自分の投稿 | JSON＋動画。規約上もっとも安全 |
| Instagram: アカウントセンター → 情報をダウンロード | 自分の投稿 | JSON形式を選ぶ |
| アプリの「保存」／画面録画 | 自分の投稿 | 手軽。透かしが入る場合あり |
| 公式API（Display API / Graph API） | 自分の投稿 | 自動化するならこれ |

**他人の投稿の一括ダウンロードは両プラットフォームの規約違反です。**
競合分析をしたい場合は、公開画面の画面録画を自分の手で行う範囲に留め、
分析結果（学び）だけを残してリポジトリに動画を溜め込まないでください。

## 使い方

```bash
# 1. 動画を素材に分解する
tools/sns-video/ingest.sh videos/reel_001.mp4
#   → analysis/reel_001/ に出力される

# カットが多い動画はシーン変化点で抜くほうが情報密度が高い
tools/sns-video/ingest.sh -s -n 40 videos/reel_001.mp4

# 2. 音声を文字起こしする
tools/sns-video/transcribe.sh analysis/reel_001/audio.wav

# 3. Claude Code に読ませる
```

### Claude Code への渡し方（プロンプト例）

```
analysis/reel_001/ を読んで、この動画の内容を分析して。
フレーム画像・transcript.txt・meta.json を全部見て、NOTES.md を埋めて。
特に冒頭2秒のフックと、テロップの出し方を詳しく。
```

`.claude/skills/sns-video-analysis/` にスキルを置いてあるので、
「この動画を分析して」と言うだけで Claude Code がこの手順を自分で回します。

## フレーム抽出のモードの使い分け

| モード | コマンド | 向いている動画 |
|---|---|---|
| 等間隔（既定） | `ingest.sh v.mp4` | 話し手が固定のトーク動画、時系列で追いたいとき |
| シーン変化 | `ingest.sh -s v.mp4` | カット割りの多い編集動画、テロップが切り替わる動画 |

テロップが細かい動画は `-n 40 -w 1080` のようにフレーム数と解像度を上げてください。
そのぶん Claude が読むトークンは増えます（フレーム1枚あたりおおよそ1,000〜1,600トークン）。

## トークンの目安

- フレーム24枚 ≒ 30,000トークン前後
- コンタクトシートだけ読ませる ≒ 3,000トークン前後（流れの把握用。細かいテロップは読めない）

まずコンタクトシートで全体を掴み、気になる区間の個別フレームだけ読ませるのが効率的です。

## 出力物をコミットしない

`analysis/` と `videos/` は `.gitignore` に入れてあります。
動画そのものや素材フレームはリポジトリに入れず、**分析結果の Markdown だけ**を残してください。
