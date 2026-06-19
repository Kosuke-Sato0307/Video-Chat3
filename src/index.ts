/**
 * Worker エントリポイント。
 * - `/api/room` への WebSocket アップグレードを、合言葉ごとの Durable Object に振り分ける。
 * - `/api/ice` で WebRTC 用の ICE サーバー（公開 STUN ＋ Cloudflare Realtime TURN）を返す。
 * - それ以外のリクエストは Workers Static Assets（public/）が自動で配信する。
 */

export { Room } from "./room";

export interface Env {
  ROOM: DurableObjectNamespace;
  ASSETS: Fetcher;
  // Cloudflare Realtime TURN の認証情報（任意）。未設定なら公開 STUN のみで動作する。
  TURN_TOKEN_ID?: string;
  TURN_API_TOKEN?: string;
}

// 公開 STUN（TURN 未設定時・取得失敗時のフォールバック）。
const PUBLIC_STUN = {
  urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"],
};

// TURN 認証情報の有効期間（秒）。通話1回分として十分な長さ。
const TURN_TTL_SECONDS = 86400;

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

    if (url.pathname === "/api/ice") {
      // WebRTC 用の ICE サーバー一覧を返す（公開 STUN ＋ 可能なら TURN）。
      const iceServers = await buildIceServers(env);
      return Response.json(
        { iceServers },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // 静的アセット（HTML/CSS/JS）は assets バインディングが処理する。
    return new Response("Not Found", { status: 404 });
  },
};

/**
 * ICE サーバー一覧を構築する。
 * 公開 STUN は常に含め、TURN の認証情報が設定されていれば Cloudflare Realtime API で
 * 短命の TURN 認証情報を取得して追加する。API 失敗時は STUN のみにフォールバックする
 * （TURN 認証情報をクライアントに発行する API トークンは Worker 側に隠蔽する）。
 */
async function buildIceServers(env: Env): Promise<unknown[]> {
  const servers: unknown[] = [PUBLIC_STUN];

  if (!env.TURN_TOKEN_ID || !env.TURN_API_TOKEN) {
    return servers;
  }

  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_TOKEN_ID}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.TURN_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
      },
    );
    if (!res.ok) return servers;

    // レスポンスは { iceServers: [...] } または { iceServers: {...} } の両形に対応。
    const data = (await res.json()) as { iceServers?: unknown };
    const turn = data.iceServers;
    if (Array.isArray(turn)) {
      servers.push(...turn);
    } else if (turn && typeof turn === "object") {
      servers.push(turn);
    }
  } catch {
    // 取得失敗時は STUN のみ（アプリは継続して動作する）。
  }

  return servers;
}
