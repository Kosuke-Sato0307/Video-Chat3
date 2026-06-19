/**
 * クライアント：WebRTC フルメッシュのビデオチャット。
 *
 * - 合言葉で /api/room へ WebSocket 接続し、Durable Object 経由でシグナリング。
 * - 参加者ごとに RTCPeerConnection を張り、最大4人のメッシュを構築する。
 * - 新規参加者(自分)が既存メンバーへ offer を送る側になることでグレアを回避する。
 */

const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

const MAX_PEERS = 4;

// DOM
const lobby = document.getElementById("lobby");
const call = document.getElementById("call");
const joinForm = document.getElementById("join-form");
const passphraseInput = document.getElementById("passphrase");
const joinBtn = document.getElementById("join-btn");
const lobbyError = document.getElementById("lobby-error");
const grid = document.getElementById("grid");
const roomBadge = document.getElementById("room-badge");
const toggleMicBtn = document.getElementById("toggle-mic");
const toggleCamBtn = document.getElementById("toggle-cam");
const leaveBtn = document.getElementById("leave-btn");

// 状態
let ws = null;
let localStream = null;
let selfId = null;
const peers = new Map(); // id -> { pc, pendingCandidates: [] }

/* ============ ロビー：参加処理 ============ */
joinForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const passphrase = passphraseInput.value.trim();
  if (!passphrase) return;

  joinBtn.disabled = true;
  hideError();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user" },
      audio: true,
    });
  } catch (err) {
    showError("カメラ／マイクにアクセスできませんでした。権限を許可してください。");
    joinBtn.disabled = false;
    return;
  }

  // 自分のタイルを表示
  addTile(selfTileId(), localStream, true);

  connect(passphrase);
});

function connect(passphrase) {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${proto}//${location.host}/api/room?room=${encodeURIComponent(passphrase)}`;
  ws = new WebSocket(url);

  ws.addEventListener("open", () => {
    // ロビー → 通話画面へ
    lobby.hidden = true;
    call.hidden = false;
    roomBadge.textContent = `合言葉：${passphrase}`;
    joinBtn.disabled = false;
  });

  ws.addEventListener("message", (ev) => handleSignal(JSON.parse(ev.data)));

  ws.addEventListener("close", () => {
    // 接続切れ → ロビーに戻す（既に退出操作済みなら無視）
    if (!call.hidden) cleanup();
  });

  ws.addEventListener("error", () => {
    showError("接続に失敗しました。もう一度お試しください。");
    joinBtn.disabled = false;
  });
}

/* ============ シグナリング処理 ============ */
async function handleSignal(msg) {
  switch (msg.type) {
    case "room-full":
      showError("このルームは満員です（最大4人）。");
      teardownWs();
      revertToLobby();
      break;

    case "welcome":
      // 自分の id を受領。既存メンバー全員へ自分から offer する。
      selfId = msg.selfId;
      for (const peerId of msg.peers) {
        await createOffer(peerId);
      }
      break;

    case "peer-join":
      // 新規参加者は相手側から offer が来るので、ここでは待つだけ。
      break;

    case "peer-leave":
      removePeer(msg.id);
      break;

    case "offer":
      await handleOffer(msg.from, msg.data);
      break;

    case "answer":
      await handleAnswer(msg.from, msg.data);
      break;

    case "ice":
      await handleIce(msg.from, msg.data);
      break;
  }
}

/* ============ ピア接続 ============ */
function createPeer(peerId) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  const entry = { pc, pendingCandidates: [] };
  peers.set(peerId, entry);

  // ローカルトラックを送出
  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream);
  }

  // ICE 候補が出たら相手へ送る
  pc.addEventListener("icecandidate", (e) => {
    if (e.candidate) {
      send({ type: "ice", to: peerId, data: e.candidate });
    }
  });

  // 相手のメディアを受信したらタイル表示
  pc.addEventListener("track", (e) => {
    addTile(peerTileId(peerId), e.streams[0], false);
  });

  pc.addEventListener("connectionstatechange", () => {
    if (pc.connectionState === "failed" || pc.connectionState === "closed") {
      removePeer(peerId);
    }
  });

  return entry;
}

async function createOffer(peerId) {
  const { pc } = createPeer(peerId);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  send({ type: "offer", to: peerId, data: offer });
}

async function handleOffer(peerId, offer) {
  const entry = peers.get(peerId) || createPeer(peerId);
  await entry.pc.setRemoteDescription(new RTCSessionDescription(offer));
  await flushCandidates(peerId);
  const answer = await entry.pc.createAnswer();
  await entry.pc.setLocalDescription(answer);
  send({ type: "answer", to: peerId, data: answer });
}

async function handleAnswer(peerId, answer) {
  const entry = peers.get(peerId);
  if (!entry) return;
  await entry.pc.setRemoteDescription(new RTCSessionDescription(answer));
  await flushCandidates(peerId);
}

async function handleIce(peerId, candidate) {
  const entry = peers.get(peerId);
  if (!entry) return;
  // remoteDescription 未設定なら候補を貯めておく
  if (!entry.pc.remoteDescription || !entry.pc.remoteDescription.type) {
    entry.pendingCandidates.push(candidate);
    return;
  }
  try {
    await entry.pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch {
    // 不正な候補は無視
  }
}

async function flushCandidates(peerId) {
  const entry = peers.get(peerId);
  if (!entry) return;
  for (const c of entry.pendingCandidates) {
    try {
      await entry.pc.addIceCandidate(new RTCIceCandidate(c));
    } catch {
      // 無視
    }
  }
  entry.pendingCandidates = [];
}

function removePeer(peerId) {
  const entry = peers.get(peerId);
  if (entry) {
    try {
      entry.pc.close();
    } catch {}
    peers.delete(peerId);
  }
  removeTile(peerTileId(peerId));
}

/* ============ ビデオタイル（レイアウト） ============ */
function selfTileId() {
  return "self";
}
function peerTileId(id) {
  return `peer-${id}`;
}

function addTile(tileId, stream, isSelf) {
  let tile = document.getElementById(`tile-${tileId}`);
  if (!tile) {
    tile = document.createElement("div");
    tile.id = `tile-${tileId}`;
    tile.className = "tile" + (isSelf ? " self" : "");

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    if (isSelf) video.muted = true; // 自分の音は鳴らさない

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = isSelf ? "あなた" : "相手";

    tile.appendChild(video);
    tile.appendChild(name);
    grid.appendChild(tile);
    updateCount();
  }
  const video = tile.querySelector("video");
  if (video.srcObject !== stream) video.srcObject = stream;
}

function removeTile(tileId) {
  const tile = document.getElementById(`tile-${tileId}`);
  if (tile) {
    tile.remove();
    updateCount();
  }
}

function updateCount() {
  const count = Math.min(grid.children.length, MAX_PEERS);
  grid.dataset.count = String(Math.max(count, 1));
}

/* ============ コントロール ============ */
toggleMicBtn.addEventListener("click", () => {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  toggleMicBtn.classList.toggle("off", !track.enabled);
  toggleMicBtn.querySelector(".ico").textContent = track.enabled ? "🎤" : "🔇";
});

toggleCamBtn.addEventListener("click", () => {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  toggleCamBtn.classList.toggle("off", !track.enabled);
  toggleCamBtn.querySelector(".ico").textContent = track.enabled ? "📷" : "🚫";
  const selfTile = document.getElementById(`tile-${selfTileId()}`);
  if (selfTile) selfTile.classList.toggle("cam-off", !track.enabled);
});

leaveBtn.addEventListener("click", () => {
  cleanup();
});

/* ============ 後始末 ============ */
function teardownWs() {
  if (ws) {
    ws.onclose = null;
    try {
      ws.close();
    } catch {}
    ws = null;
  }
}

function cleanup() {
  teardownWs();
  for (const id of [...peers.keys()]) removePeer(id);
  if (localStream) {
    for (const t of localStream.getTracks()) t.stop();
    localStream = null;
  }
  grid.innerHTML = "";
  revertToLobby();
}

function revertToLobby() {
  call.hidden = true;
  lobby.hidden = false;
  selfId = null;
}

/* ============ ユーティリティ ============ */
function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function showError(text) {
  lobbyError.textContent = text;
  lobbyError.hidden = false;
}
function hideError() {
  lobbyError.hidden = true;
}
