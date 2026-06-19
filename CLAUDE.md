# CLAUDE.md

このリポジトリで作業する Claude（および開発者）向けのガイドです。日本語で記述します。

## プロジェクト概要

無料版 **Cloudflare Workers** だけで動く、シンプルなビデオチャットアプリです（Pages は不使用）。

- **同じ合言葉**を入力した人どうしが、1つのルームに集まれます。
- **最大4人**まで参加可能。1〜3人でも各ビデオが画面にちょうど収まります。
- PC・タブレット・スマホ対応。青系のかっこいい UI。**スクロール不要**のレイアウト。
- 映像＋音声。マイクのミュート／カメラのオン・オフ／退出のトグルあり。

## アーキテクチャ（概要）

```
ブラウザ --WebSocket(/api/room?room=合言葉)--> Worker --> Durable Object(Room)
   |                                                          |
   |  <-- シグナリング(welcome/peer-join/offer/answer/ice/peer-leave) --|
   |
   +==== WebRTC P2P フルメッシュ（映像・音声） ====+  他参加者と直接接続
```

- **Durable Objects は無料プランで利用可（SQLite バックエンド限定）**。
  ルームごとのシグナリングハブとして使用（WebSocket Hibernation API）。
- 映像・音声は **WebRTC フルメッシュ** で P2P 配信（4人＝各自最大3接続、SFU 不要）。
  Durable Object はメディアを中継しない（シグナリングのみ）。
- ICE は **公開 STUN のみ**（`stun:stun.l.google.com:19302` など）。TURN は未使用。
- フロントエンドは **Workers Static Assets**（`assets` バインディング）で配信 → Pages 不要。

詳細は `docs/architecture.md` を参照。

## ファイル構成

| パス | 役割 |
| --- | --- |
| `wrangler.jsonc` | Worker 設定。`assets`／`ROOM` DO バインディング／SQLite migration |
| `src/index.ts` | Worker エントリ。`/api/room` を DO に振り分け、他は静的アセット |
| `src/room.ts` | Durable Object `Room`。シグナリング中継（Hibernation API） |
| `public/index.html` | ロビー画面＋通話画面の UI |
| `public/style.css` | 青テーマ・スクロール不要・人数別の動的グリッド |
| `public/app.js` | クライアントの WebRTC メッシュ＋シグナリング処理 |
| `docs/architecture.md` | アーキテクチャ詳細・シグナリング仕様 |
| `docs/deploy.md` | ローカル確認とデプロイ手順 |

## シグナリング メッセージ仕様（JSON）

| type | 方向 | ペイロード | 説明 |
| --- | --- | --- | --- |
| `welcome` | サーバー→本人 | `selfId`, `peers:[id...]` | 入室直後。既存メンバー一覧 |
| `peer-join` | サーバー→既存全員 | `id` | 新規参加の通知 |
| `peer-leave` | サーバー→全員 | `id` | 退出の通知 |
| `offer`/`answer`/`ice` | 双方向(中継) | `from`, `to`, `data` | `to` の相手へ DO が中継 |
| `room-full` | サーバー→本人 | なし | 満員(4人)時。接続は閉じる |

**重要なルール**: グレア（衝突）回避のため、**新規参加者(自分)が既存メンバー全員へ offer を送る**側になります（`welcome` の `peers` をループ）。既存メンバーは offer を待つだけです。

## 開発コマンド

```bash
npm install          # 依存関係のインストール
npm run dev          # ローカル開発サーバー（http://localhost:8787）
npm run deploy       # 手動デプロイ（通常は GitHub 連携で自動）
npx tsc --noEmit     # 型チェック
```

> 注: ブラウザの `getUserMedia` は `https` か `localhost` でのみ動作します。
> 実機（スマホ等）でテストする場合はデプロイ後の `https` URL を使ってください。

## デプロイ

GitHub と Cloudflare Workers は **連携済み**。designated ブランチへ push すると自動デプロイされます。
無料プランの制約・手順の詳細は `docs/deploy.md` を参照。

## よくある変更ポイント

- **最大人数を変える**: `src/room.ts` の `MAX_PEERS` と `public/app.js` の `MAX_PEERS`、
  `public/style.css` のグリッド定義（`.grid[data-count="..."]`）を合わせて変更。
- **STUN/TURN を変える**: `public/app.js` の `ICE_SERVERS`。
- **UI テーマ**: `public/style.css` 冒頭の CSS 変数（`--accent` など）。
- **レイアウト（人数別）**: `public/style.css` の `.grid[data-count]` と portrait 用メディアクエリ。

## 注意事項

- やり取り・コミットメッセージ・ドキュメントは**日本語**で記述する。
- PR は明示的に依頼されたときだけ作成する。
- 公開 STUN のみのため、対称型 NAT 等の一部環境では接続できない場合がある（仕様上許容）。
