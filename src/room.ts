/**
 * Room Durable Object — 合言葉ごとのシグナリングハブ。
 *
 * 役割は WebRTC のシグナリング中継のみ（映像・音声は WebRTC で P2P 配信されるため
 * この DO を経由しない）。WebSocket Hibernation API を使い、接続中の各参加者を管理する。
 *
 * メッセージ仕様（JSON）:
 *   サーバー → 本人 : { type: "welcome", selfId, peers: [id...] }
 *   サーバー → 全員 : { type: "peer-join", id } / { type: "peer-leave", id }
 *   双方向(中継)   : { type: "offer"|"answer"|"ice", from, to, data }
 *   サーバー → 本人 : { type: "room-full" }（満員時、接続は閉じる）
 */

const MAX_PEERS = 4;

interface Env {
  ROOM: DurableObjectNamespace;
}

export class Room implements DurableObject {
  private state: DurableObjectState;

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
  }

  async fetch(_request: Request): Promise<Response> {
    const existing = this.state.getWebSockets();
    if (existing.length >= MAX_PEERS) {
      // 満員。WebSocket を確立してから room-full を伝えて閉じる。
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      server.send(JSON.stringify({ type: "room-full" }));
      server.close(1013, "room full");
      return new Response(null, { status: 101, webSocket: client });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // 一意の peerId を採番し、WebSocket に紐付ける（Hibernation 後も復元される）。
    const selfId = crypto.randomUUID();
    server.serializeAttachment({ id: selfId });

    // Hibernation API で受け入れ（アイドル中はメモリから退避されコストを抑える）。
    this.state.acceptWebSocket(server);

    // 既存メンバーの peerId 一覧を作成（自分を除く）。
    const peers = existing
      .map((ws) => (ws.deserializeAttachment() as { id: string } | null)?.id)
      .filter((id): id is string => typeof id === "string");

    // 本人に自分の id と既存メンバー一覧を通知。
    server.send(JSON.stringify({ type: "welcome", selfId, peers }));

    // 既存メンバーに新規参加を通知。
    this.broadcast({ type: "peer-join", id: selfId }, server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;

    let msg: { type?: string; to?: string };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    const from = (ws.deserializeAttachment() as { id: string } | null)?.id;
    if (!from) return;

    // offer / answer / ice は宛先(to)の相手だけに中継する。
    if (msg.type === "offer" || msg.type === "answer" || msg.type === "ice") {
      const target = this.findWebSocket(msg.to);
      if (target) {
        target.send(JSON.stringify({ ...msg, from }));
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const id = (ws.deserializeAttachment() as { id: string } | null)?.id;
    try {
      ws.close();
    } catch {
      // 既に閉じている場合は無視。
    }
    if (id) {
      this.broadcast({ type: "peer-leave", id }, ws);
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /** 指定 peerId の WebSocket を探す。 */
  private findWebSocket(id: string | undefined): WebSocket | undefined {
    if (!id) return undefined;
    return this.state
      .getWebSockets()
      .find((ws) => (ws.deserializeAttachment() as { id: string } | null)?.id === id);
  }

  /** except 以外の全接続にメッセージを送信する。 */
  private broadcast(payload: unknown, except?: WebSocket): void {
    const data = JSON.stringify(payload);
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch {
        // 送信できない接続はスキップ。
      }
    }
  }
}
