/**
 * Worker エントリポイント。
 * - `/api/room` への WebSocket アップグレードを、合言葉ごとの Durable Object に振り分ける。
 * - それ以外のリクエストは Workers Static Assets（public/）が自動で配信する。
 */

export { Room } from "./room";

export interface Env {
  ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/room") {
      // 合言葉（room）が WebSocket 接続のルームキー。
      const passphrase = url.searchParams.get("room");
      if (!passphrase || passphrase.trim().length === 0) {
        return new Response("合言葉が指定されていません", { status: 400 });
      }

      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("WebSocket 接続が必要です", { status: 426 });
      }

      // 同じ合言葉 → 同じ Durable Object インスタンス（= 同じルーム）。
      const id = env.ROOM.idFromName(passphrase.trim());
      const stub = env.ROOM.get(id);
      return stub.fetch(request);
    }

    // 静的アセット（HTML/CSS/JS）は assets バインディングが処理する。
    return new Response("Not Found", { status: 404 });
  },
};
