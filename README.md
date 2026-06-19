# Video Chat 3

無料版 **Cloudflare Workers** だけで動く、シンプルなビデオチャットアプリです（Pages 不使用）。

## 特徴

- 🔑 **同じ合言葉**を入力した人どうしが1つのルームに集まれる
- 👥 **最大4人**まで参加可能（1〜3人でも各ビデオが画面にちょうど収まる）
- 📱 PC・タブレット・スマホ対応、**スクロール不要**の青系 UI
- 🎤 映像＋音声、マイクミュート／カメラオフ／退出のトグルあり
- ⚡ Durable Objects（無料プラン・SQLite）でシグナリング、映像は WebRTC P2P

## 使い方

1. アプリの URL を開く
2. 合言葉を入力して「参加する」
3. 同じ合言葉を入れた人と通話できます（最大4人）

## 開発

```bash
npm install
npm run dev      # http://localhost:8787
```

詳細は [`CLAUDE.md`](./CLAUDE.md)、[`docs/architecture.md`](./docs/architecture.md)、
[`docs/deploy.md`](./docs/deploy.md) を参照してください。

## 技術スタック

- Cloudflare Workers（`assets` で静的配信、Pages 不使用）
- Durable Objects（WebSocket Hibernation API、SQLite バックエンド＝無料プラン対応）
- WebRTC フルメッシュ（公開 STUN、TURN 未使用）
- バニラ JS / CSS（ビルド不要のフロントエンド）
