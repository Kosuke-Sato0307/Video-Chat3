# アーキテクチャ詳細

## 全体像

```
            ┌─────────────────────────────────────────────┐
            │            Cloudflare Workers               │
            │                                             │
  ブラウザ ──┼─ GET / , /style.css , /app.js              │
   (client) │      └→ Workers Static Assets (public/)     │
            │                                             │
            ┼─ WS /api/room?room=合言葉                    │
            │      └→ Worker (src/index.ts)               │
            │            └→ env.ROOM.idFromName(合言葉)    │
            │                 └→ Durable Object: Room      │
            └─────────────────────────────────────────────┘
                            ▲  シグナリングのみ
                            │ (welcome/join/leave/offer/answer/ice)
  ブラウザA ════════ WebRTC P2P（映像・音声）════════ ブラウザB
        ╲                                          ╱
         ╲════════ ブラウザC, D とも相互接続 ═══════╱   ← フルメッシュ
```

## なぜこの構成か

- **無料版 Workers のみ**という制約から、メディアサーバー（SFU/MCU）は使わない。
- 4人程度なら **WebRTC フルメッシュ**（各ピアが他の全ピアと直接接続）で十分。
  接続数は N×(N−1)/2。4人なら最大6本のため、クライアント負荷も許容範囲。
- ルームの状態（誰が参加しているか）を一貫して管理するため、合言葉ごとに1つの
  **Durable Object** を割り当てる（`idFromName(合言葉)` で同じ合言葉＝同じインスタンス）。
- **Durable Objects は無料プランで SQLite バックエンドのみ利用可能**。本アプリは
  ストレージを使わず WebSocket 接続管理のみのため、SQLite バックエンドで問題ない
  （`wrangler.jsonc` の migration は `new_sqlite_classes` を使用）。

## Durable Object（Room）

`src/room.ts`。WebSocket Hibernation API を使用：

- `state.acceptWebSocket(server)` で接続を受け入れ（アイドル時はメモリから退避＝低コスト）。
- `server.serializeAttachment({ id })` で各接続に peerId を保持（Hibernation 復帰後も復元）。
- `state.getWebSockets()` で現在の全接続を取得し、一覧作成・ブロードキャストに使う。
- ハンドラ：
  - `fetch()` … 接続確立・peerId 採番・満員(4人)チェック・welcome/peer-join 送信。
  - `webSocketMessage()` … offer/answer/ice を `to` 指定の相手のみへ中継。
  - `webSocketClose()` / `webSocketError()` … peer-leave をブロードキャスト。

DO はメディア（映像・音声）を一切扱わない。あくまで「誰がいるか」と
「シグナルの受け渡し」だけを担当する。

## クライアント（WebRTC メッシュ）

`public/app.js`。

1. `getUserMedia({ video, audio })` でローカルストリーム取得。
2. `/api/room?room=合言葉` へ WebSocket 接続。
3. `welcome` 受信 → 既存メンバー全員へ **自分から** offer を送る（グレア回避ルール）。
4. ピアごとに `RTCPeerConnection`（公開 STUN）を生成し、トラック送出・ICE 交換。
5. `track` イベントで相手の映像タイルを追加。`peer-leave` でタイル除去。

### グレア（衝突）回避

両者が同時に offer を作ると衝突する。これを防ぐため
**「後から入った人（newcomer）が、既にいる全員へ offer を出す」**ルールに統一：

- 新規参加者は `welcome.peers` をループして各既存メンバーへ offer。
- 既存メンバーは `peer-join` を受け取っても何もせず、offer の到着を待つ。

### ICE 候補のバッファリング

`remoteDescription` がまだ設定されていない時に届いた ICE 候補は
`pendingCandidates` に貯め、`setRemoteDescription` 後に `flushCandidates()` で適用する。

## レイアウト（スクロール不要・人数別グリッド）

`public/style.css`。

- ルートを `height: 100dvh; overflow: hidden` にしてスクロールを禁止。
- `.grid[data-count="N"]` で人数別に `grid-template-*` を切り替え：
  - 1人=全画面 / 2人=2分割 / 3人=上2＋下中央1 / 4人=2×2。
- 縦長画面（スマホ）は `@media (orientation: portrait)` で行方向に積む。
- 各 `video` は `object-fit: cover` で枠にちょうど収める。
- 人数の更新は `app.js` の `updateCount()` が `grid.dataset.count` を書き換えて行う。

## 制約・既知の限界

- **公開 STUN のみ**のため、対称型 NAT や一部の企業ネットワークでは P2P 接続が
  確立できないことがある（TURN を導入すれば改善するが本アプリでは未採用）。
- フルメッシュのため、人数が増えるほどクライアントの送出負荷が増える（4人想定で許容）。
- `getUserMedia` は `https` または `localhost` でのみ動作する。
