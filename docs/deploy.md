# ローカル確認とデプロイ手順

## 前提

- Node.js 18 以上（開発は Node 22 で確認）。
- Cloudflare アカウント（**無料プランで可**）。
- GitHub と Cloudflare Workers は **連携済み**。

## ローカルで動かす

```bash
npm install
npm run dev        # → http://localhost:8787
```

`wrangler dev` はローカルに Durable Object をエミュレートして起動します。
`Unable to fetch the Request.cf object` という警告は、ネットワーク制限環境で出る
非致命的なものなので無視して構いません（`Ready on http://localhost:8787` が出れば起動成功）。

### 動作確認

1. ブラウザの**複数タブ／ウィンドウ**で `http://localhost:8787` を開く。
2. それぞれで**同じ合言葉**を入力して「参加する」。
3. 互いの映像・音声が表示されることを確認（同一PC内の複数タブでも可）。
4. 1→2→3→4人と増やし、スクロールせずに画面に収まるレイアウトを確認。
5. 1人退出するとレイアウトが再計算されることを確認。
6. マイク／カメラのトグル、退出ボタンを確認。

> `getUserMedia` は `localhost` か `https` でのみ動作します。スマホ実機で試す場合は
> デプロイ後の `https` URL を使ってください（LAN 内の `http://192.168.x.x` では
> カメラ／マイクにアクセスできません）。

### 型チェック

```bash
npx tsc --noEmit
```

## デプロイ

### 自動デプロイ（推奨）

GitHub 連携済みのため、designated ブランチへ push すると Cloudflare 側で
自動的にビルド・デプロイされます。Cloudflare ダッシュボードの Workers プロジェクトで
デプロイ状況とアクセス URL（`*.workers.dev`）を確認できます。

### 手動デプロイ（必要な場合のみ）

```bash
npx wrangler login   # 初回のみ
npm run deploy       # wrangler deploy
```

## TURN（Cloudflare Realtime）の設定

公開 STUN だけでは、対称型 NAT や社内ネットワーク（同じ Wi-Fi/LAN を含む）で P2P 接続が
確立できず、相手の映像が真っ暗のまま消えたり音声が届かないことがある。これを解消するため
**Cloudflare Realtime TURN**（無料）を利用する。Worker が `/api/ice` で短命の TURN 認証情報を
発行し、API トークンはクライアントに渡さず Worker 側に隠蔽する。

### 1. TURN Token を作成

Cloudflare ダッシュボード → **Realtime → TURN** で TURN アプリ(キー)を作成し、
`TURN Token ID` と `API Token`（キー）を控える。

### 2. Worker に認証情報を設定

- **自動デプロイ（GitHub 連携）**: Workers プロジェクト → **Settings → Variables and Secrets**
  に以下を Secret として登録する。
  - `TURN_TOKEN_ID`
  - `TURN_API_TOKEN`
- **手動デプロイ**: 次のコマンドで登録する。

  ```bash
  npx wrangler secret put TURN_TOKEN_ID
  npx wrangler secret put TURN_API_TOKEN
  ```

- **ローカル開発（`wrangler dev`）**: プロジェクト直下に `.dev.vars` を作成（**コミット禁止**）。

  ```
  TURN_TOKEN_ID=xxxxxxxx
  TURN_API_TOKEN=xxxxxxxx
  ```

> 未設定でもアプリは動く（公開 STUN のみにフォールバック）。その場合、社内ネットワーク等では
> 接続できないことがある。`/api/ice` を開くと、実際に返る ICE サーバー一覧を確認できる。

## 無料プランの制約（重要）

- **Durable Objects は SQLite バックエンドのみ**利用可能。本リポジトリの
  `wrangler.jsonc` は `migrations` で `new_sqlite_classes: ["Room"]` を指定済み
  （`new_classes`（KV バックエンド）は無料プランでは使えないので変更しないこと）。
- WebSocket メッセージは最大 32 MiB（本アプリのシグナリングでは十分）。
- 無料プランには1日あたりのリクエスト数・実行時間の上限があります。少人数の
  ビデオチャット用途であれば通常は上限内に収まります。

## トラブルシューティング

| 症状 | 対処 |
| --- | --- |
| カメラ／マイクが使えない | `https` か `localhost` でアクセスしているか確認。ブラウザの権限を許可 |
| 相手の映像が出ない／真っ暗で消える | 公開 STUN だけでは繋がらない NAT 環境の可能性。上記「TURN（Cloudflare Realtime）の設定」で `TURN_TOKEN_ID` / `TURN_API_TOKEN` を設定する。`/api/ice` に `turn:`/`turns:` が含まれるか確認 |
| `room-full` になる | ルームは4人まで。別の合言葉を使う |
| デプロイで DO エラー | `wrangler.jsonc` の migration が `new_sqlite_classes` になっているか確認 |
