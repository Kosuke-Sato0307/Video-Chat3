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
| 相手の映像が出ない | 公開 STUN だけでは繋がらない NAT 環境の可能性。`app.js` の `ICE_SERVERS` に TURN を追加 |
| `room-full` になる | ルームは4人まで。別の合言葉を使う |
| デプロイで DO エラー | `wrangler.jsonc` の migration が `new_sqlite_classes` になっているか確認 |
