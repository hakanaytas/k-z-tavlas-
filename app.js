// app.js — Kız Tavlası
// Tüm oyun mantığı burada. Framework yok, sade ve doğrudan DOM.

import {
  auth, db, signInAnonymously, onAuthStateChanged,
  doc, getDoc, setDoc, updateDoc, onSnapshot,
  collection, addDoc, query, orderBy, limit,
  serverTimestamp, runTransaction, increment,
} from "./firebase.js";

/* ---------------------------------------------------------------- */
/* Sabitler                                                          */
/* ---------------------------------------------------------------- */
const TOWERS_PER_PLAYER = 3;
const STONES_PER_TOWER = 5;
const TOTAL_STONES = TOWERS_PER_PLAYER * STONES_PER_TOWER; // 15
const PRESENCE_INTERVAL_MS = 10000;
const PRESENCE_TIMEOUT_MS = 22000;
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // ambiguous karakterler çıkarıldı

/* ---------------------------------------------------------------- */
/* Durum                                                             */
/* ---------------------------------------------------------------- */
const state = {
  uid: null,
  name: "",
  roomCode: null,
  room: null,          // en son alınan Firestore oda verisi
  unsubRoom: null,
  unsubChat: null,
  presenceTimer: null,
  presenceCheckTimer: null,
  soundOn: true,
  fromScreen: "waiting", // create-room-screen | join-room-screen (hazırlık ekranı takip)
};

/* ---------------------------------------------------------------- */
/* DOM yardımcıları                                                  */
/* ---------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  const target = $(id);
  if (target) target.classList.add("active");
}

let toastTimer = null;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

function playSound(id) {
  if (!state.soundOn) return;
  const el = $(id);
  if (!el) return;
  try {
    el.currentTime = 0;
    el.play().catch(() => {});
  } catch (e) { /* sessiz geç */ }
}

/* ---------------------------------------------------------------- */
/* Yerel ayarlar                                                     */
/* ---------------------------------------------------------------- */
function loadLocalSettings() {
  state.soundOn = localStorage.getItem("kt_sound") !== "off";
  $("sound-toggle").checked = state.soundOn;
  const savedName = localStorage.getItem("kt_name") || "";
  if (savedName) $("name-input").value = savedName;
}

/* ---------------------------------------------------------------- */
/* Kimlik doğrulama                                                  */
/* ---------------------------------------------------------------- */
function initAuth() {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      state.uid = user.uid;
      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);
      if (snap.exists() && snap.data().name) {
        state.name = snap.data().name;
        $("menu-name").textContent = state.name;
        $("settings-name-input").value = state.name;
        playSound("snd-open");
        showScreen("menu-screen");
        refreshStats();
      } else {
        showScreen("login-screen");
      }
    } else {
      signInAnonymously(auth).catch((err) => {
        console.error(err);
        toast("Bağlantı kurulamadı, tekrar deneyin.");
      });
    }
  });
}

async function completeLogin(name) {
  state.name = name;
  localStorage.setItem("kt_name", name);
  const userRef = doc(db, "users", state.uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) {
    await setDoc(userRef, { name, wins: 0, totalGames: 0, createdAt: serverTimestamp() });
  } else {
    await updateDoc(userRef, { name });
  }
  $("menu-name").textContent = name;
  $("settings-name-input").value = name;
  playSound("snd-open");
  showScreen("menu-screen");
  refreshStats();
}

/* ---------------------------------------------------------------- */
/* Oda kodu üretimi                                                  */
/* ---------------------------------------------------------------- */
function randomCode(len = 5) {
  let code = "";
  for (let i = 0; i < len; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function freshPlayer(name) {
  return {
    name,
    ready: false,
    startRoll: null,
    towers: [STONES_PER_TOWER, STONES_PER_TOWER, STONES_PER_TOWER],
    readyArea: 0,
    exit: 0,
    lastSeen: serverTimestamp(),
  };
}

/* ---------------------------------------------------------------- */
/* Oda oluştur                                                       */
/* ---------------------------------------------------------------- */
async function createRoom() {
  let code, ref, exists = true, tries = 0;
  do {
    code = randomCode();
    ref = doc(db, "rooms", code);
    const snap = await getDoc(ref);
    exists = snap.exists();
    tries++;
  } while (exists && tries < 8);

  const roomData = {
    code,
    players: { [state.uid]: freshPlayer(state.name) },
    playerOrder: [state.uid],
    status: "waiting",
    turn: null,
    dice: [],
    movesLeft: 0,
    lastAction: null,
    winner: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, roomData);
  state.roomCode = code;
  state.fromScreen = "create-room-screen";
  $("room-code-display").textContent = code;
  showScreen("create-room-screen");
  subscribeRoom(code);
  startPresence();
}

/* ---------------------------------------------------------------- */
/* Odaya katıl                                                       */
/* ---------------------------------------------------------------- */
async function joinRoom(codeRaw) {
  const code = codeRaw.trim().toUpperCase();
  $("join-error").textContent = "";
  if (!code) return;
  const ref = doc(db, "rooms", code);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    $("join-error").textContent = "Böyle bir oda bulunamadı.";
    return;
  }
  const data = snap.data();
  const uids = Object.keys(data.players || {});
  if (uids.includes(state.uid)) {
    // zaten bu odadayız (yeniden bağlanma)
  } else if (uids.length >= 2) {
    $("join-error").textContent = "Oda dolu.";
    return;
  } else {
    await updateDoc(ref, {
      [`players.${state.uid}`]: freshPlayer(state.name),
      playerOrder: [...(data.playerOrder || []), state.uid],
      updatedAt: serverTimestamp(),
    });
  }
  state.roomCode = code;
  state.fromScreen = "join-room-screen";
  showScreen("join-room-screen");
  subscribeRoom(code);
  startPresence();
}

/* ---------------------------------------------------------------- */
/* Oda dinleyicisi                                                   */
/* ---------------------------------------------------------------- */
function subscribeRoom(code) {
  if (state.unsubRoom) state.unsubRoom();
  const ref = doc(db, "rooms", code);
  state.unsubRoom = onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      toast("Oda kapatıldı.");
      leaveRoomLocal();
      showScreen("menu-screen");
      return;
    }
    const prevAction = state.room && state.room.lastAction ? state.room.lastAction.ts : null;
    state.room = snap.data();
    routeRoomState();
    const newAction = state.room.lastAction ? state.room.lastAction.ts : null;
    if (newAction && newAction !== prevAction) {
      animateLastAction(state.room.lastAction);
    }
  }, (err) => {
    console.error(err);
  });

  const msgsRef = query(collection(db, "rooms", code, "messages"), orderBy("ts", "asc"), limit(80));
  if (state.unsubChat) state.unsubChat();
  let firstChatLoad = true;
  state.unsubChat = onSnapshot(msgsRef, (snap) => {
    renderChat(snap.docs.map((d) => d.data()));
    if (!firstChatLoad) {
      const last = snap.docs[snap.docs.length - 1];
      if (last && last.data().uid !== state.uid) playSound("snd-message");
    }
    firstChatLoad = false;
  });
}

function otherUid() {
  if (!state.room) return null;
  return (state.room.playerOrder || []).find((u) => u !== state.uid) || null;
}

/* ---------------------------------------------------------------- */
/* Oda durumuna göre ekran yönlendirme                               */
/* ---------------------------------------------------------------- */
function routeRoomState() {
  const room = state.room;
  if (!room) return;
  const me = room.players[state.uid];
  if (!me) return;

  if (room.status === "waiting") {
    renderWaitingPlayers();
    showScreen(state.fromScreen);
  } else if (room.status === "starting") {
    showScreen("starting-screen");
    renderStarting();
  } else if (room.status === "playing") {
    showScreen("game-screen");
    renderBoard();
  } else if (room.status === "finished") {
    showScreen("end-screen");
    renderEnd();
  }
  updatePresenceBanner();
}

function renderWaitingPlayers() {
  const room = state.room;
  const uids = room.playerOrder || [];
  const rowsHtml = uids.map((u) => {
    const p = room.players[u];
    return `<div class="room-player-row">
      <span>${escapeHtml(p.name)}${u === state.uid ? " (sen)" : ""}</span>
      <span class="player-ready-dot ${p.ready ? "on" : ""}"></span>
    </div>`;
  }).join("");

  $("create-room-players").innerHTML = rowsHtml;
  $("join-room-players").innerHTML = rowsHtml;

  const me = room.players[state.uid];
  const full = uids.length === 2;
  const readyBtnHost = $("ready-btn-host");
  const readyBtnGuest = $("ready-btn-guest");

  if (state.fromScreen === "create-room-screen") {
    readyBtnHost.disabled = !full;
    readyBtnHost.textContent = me.ready ? "Bekleniyor…" : "Hazırım";
    readyBtnHost.classList.toggle("btn-ghost", me.ready);
  } else {
    readyBtnGuest.classList.remove("hidden");
    readyBtnGuest.disabled = !full;
    readyBtnGuest.textContent = me.ready ? "Bekleniyor…" : "Hazırım";
  }

  if (full && uids.every((u) => room.players[u].ready) && room.status === "waiting") {
    // yalnız oda sahibi geçişi tetiklesin (çifte tetiklemeyi önlemek için)
    if (uids[0] === state.uid) startGameFlow();
  }
}

async function toggleReady() {
  if (!state.room) return;
  const me = state.room.players[state.uid];
  await updateDoc(doc(db, "rooms", state.roomCode), {
    [`players.${state.uid}.ready`]: !me.ready,
    updatedAt: serverTimestamp(),
  });
}

async function startGameFlow() {
  await updateDoc(doc(db, "rooms", state.roomCode), {
    status: "starting",
    updatedAt: serverTimestamp(),
  });
}

/* ---------------------------------------------------------------- */
/* Başlangıç zarı                                                    */
/* ---------------------------------------------------------------- */
function renderStarting() {
  const room = state.room;
  const me = room.players[state.uid];
  const opp = room.players[otherUid()] || { name: "Rakip", startRoll: null };
  $("my-start-name").textContent = "Sen";
  $("opp-start-name").textContent = opp.name;
  $("my-start-die").textContent = me.startRoll ?? "?";
  $("opp-start-die").textContent = opp.startRoll ?? "?";
  const btn = $("starting-roll-btn");
  btn.disabled = me.startRoll != null;
  btn.textContent = me.startRoll != null ? "Bekleniyor…" : "Zar At";
  $("starting-hint").textContent = "Sırayla zar atın, büyük gelen başlasın";
}

async function rollStartingDie() {
  const roomRef = doc(db, "rooms", state.roomCode);
  const val = 1 + Math.floor(Math.random() * 6);
  playSound("snd-dice");
  $("my-start-die").classList.add("die");
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    const room = snap.data();
    if (!room || room.status !== "starting") return;
    const players = room.players;
    players[state.uid].startRoll = val;
    const uids = room.playerOrder;
    const other = uids.find((u) => u !== state.uid);
    const otherVal = players[other] ? players[other].startRoll : null;

    if (otherVal != null) {
      if (otherVal === val) {
        // berabere -> sıfırla
        players[state.uid].startRoll = null;
        players[other].startRoll = null;
        tx.update(roomRef, { players, updatedAt: serverTimestamp() });
      } else {
        const winner = val > otherVal ? state.uid : other;
        tx.update(roomRef, {
          players,
          status: "playing",
          turn: winner,
          dice: [],
          movesLeft: 0,
          updatedAt: serverTimestamp(),
        });
      }
    } else {
      tx.update(roomRef, { players, updatedAt: serverTimestamp() });
    }
  });
}

/* ---------------------------------------------------------------- */
/* Oyun tahtası — render                                             */
/* ---------------------------------------------------------------- */
function towerHtml(count, colorSeed, selectable) {
  let stonesHtml = "";
  for (let i = 0; i < count; i++) {
    const c = (i + colorSeed) % 3;
    stonesHtml += `<div class="stone c${c}"></div>`;
  }
  return `<div class="tower ${selectable ? "selectable" : ""}">${stonesHtml}<div class="tower-count">${count}</div></div>`;
}

function renderBoard() {
  const room = state.room;
  const me = room.players[state.uid];
  const oppId = otherUid();
  const opp = oppId ? room.players[oppId] : null;

  $("me-tag").textContent = "Sen";
  $("opp-tag").textContent = opp ? opp.name : "Rakip bekleniyor…";

  const myTurn = room.turn === state.uid && room.status === "playing";
  const myTowersEmpty = me.towers.every((t) => t === 0);
  const phase = myTowersEmpty ? 2 : 1;
  const canPickTower = myTurn && room.movesLeft > 0 && phase === 1;
  const canExit = myTurn && room.movesLeft > 0 && phase === 2;

  $("me-towers").innerHTML = me.towers.map((count, i) =>
    `<div class="tower ${canPickTower && count > 0 ? "selectable" : ""}" data-tower="${i}">
      ${Array.from({ length: count }).map((_, s) => `<div class="stone c${(s + i) % 3}"></div>`).join("")}
      <div class="tower-count">${count}</div>
    </div>`
  ).join("");

  $("me-towers").querySelectorAll(".tower.selectable").forEach((el) => {
    el.onclick = () => makeMove("tower", parseInt(el.dataset.tower, 10));
  });

  if (opp) {
    $("opp-towers").innerHTML = opp.towers.map((count, i) =>
      `<div class="tower" data-tower="${i}">
        <div class="tower-count">${count}</div>
        ${Array.from({ length: count }).map((_, s) => `<div class="stone c${(s + i) % 3}"></div>`).join("")}
      </div>`
    ).join("");
  } else {
    $("opp-towers").innerHTML = "";
  }

  $("me-ready").querySelector(".zone-count").textContent = me.readyArea;
  $("me-exit").querySelector(".zone-count").textContent = me.exit;
  $("opp-ready").querySelector(".zone-count").textContent = opp ? opp.readyArea : 0;
  $("opp-exit").querySelector(".zone-count").textContent = opp ? opp.exit : 0;

  const meExitZone = $("me-exit");
  meExitZone.classList.toggle("targetable", canExit);
  meExitZone.onclick = canExit ? () => makeMove("exit") : null;

  // zarlar
  const dice = room.dice || [];
  $("die-1").textContent = dice[0] ?? "-";
  $("die-2").textContent = dice[1] ?? "-";

  const rollBtn = $("roll-btn");
  const canRoll = myTurn && dice.length === 0;
  rollBtn.classList.toggle("hidden", room.movesLeft > 0 || !myTurn);
  rollBtn.disabled = !canRoll;
  rollBtn.onclick = canRoll ? rollDice : null;

  const movesHint = $("moves-hint");
  if (myTurn && room.movesLeft > 0) {
    movesHint.textContent = phase === 1
      ? `${room.movesLeft} taş indirmeni bekliyorum — bir kule seç`
      : `${room.movesLeft} taş çıkışa hazır — çıkış alanına dokun`;
  } else if (!myTurn && room.status === "playing") {
    movesHint.textContent = "";
  } else {
    movesHint.textContent = "";
  }

  const turnIndicator = $("turn-indicator");
  if (room.status === "playing") {
    turnIndicator.textContent = myTurn ? "Sıra sende! 🎲" : `${opp ? opp.name : "Rakip"} oynuyor…`;
    turnIndicator.classList.toggle("my-turn", myTurn);
  }
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

/* ---------------------------------------------------------------- */
/* Zar at                                                             */
/* ---------------------------------------------------------------- */
async function rollDice() {
  const roomRef = doc(db, "rooms", state.roomCode);
  $("die-1").classList.add("rolling");
  $("die-2").classList.add("rolling");
  playSound("snd-dice");
  const d1 = 1 + Math.floor(Math.random() * 6);
  const d2 = 1 + Math.floor(Math.random() * 6);
  const isDouble = d1 === d2;
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef);
      const room = snap.data();
      if (!room || room.status !== "playing" || room.turn !== state.uid || (room.dice && room.dice.length > 0)) return;
      tx.update(roomRef, {
        dice: [d1, d2],
        movesLeft: isDouble ? 4 : 2,
        lastAction: { type: "roll", uid: state.uid, ts: Date.now() },
        updatedAt: serverTimestamp(),
      });
    });
  } finally {
    setTimeout(() => {
      $("die-1").classList.remove("rolling");
      $("die-2").classList.remove("rolling");
    }, 600);
  }
}

/* ---------------------------------------------------------------- */
/* Hamle yap (kule indir / çıkışa gönder)                            */
/* ---------------------------------------------------------------- */
async function makeMove(kind, towerIndex) {
  const roomRef = doc(db, "rooms", state.roomCode);
  playSound("snd-stone");
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(roomRef);
      const room = snap.data();
      if (!room || room.status !== "playing" || room.turn !== state.uid || room.movesLeft <= 0) return;
      const players = room.players;
      const me = players[state.uid];

      if (kind === "tower") {
        if (me.towers[towerIndex] <= 0) return;
        me.towers[towerIndex] -= 1;
        me.readyArea += 1;
      } else if (kind === "exit") {
        const towersEmpty = me.towers.every((t) => t === 0);
        if (!towersEmpty || me.readyArea <= 0) return;
        me.readyArea -= 1;
        me.exit += 1;
      } else {
        return;
      }

      const movesLeft = room.movesLeft - 1;
      const update = {
        players,
        movesLeft,
        lastAction: { type: kind, uid: state.uid, tower: towerIndex ?? null, ts: Date.now() },
        updatedAt: serverTimestamp(),
      };

      if (me.exit === TOTAL_STONES) {
        update.status = "finished";
        update.winner = state.uid;
        update.turn = null;
        update.dice = [];
        update.movesLeft = 0;
        const winnerRef = doc(db, "users", state.uid);
        const loserUid = room.playerOrder.find((u) => u !== state.uid);
        tx.update(winnerRef, { wins: increment(1), totalGames: increment(1) });
        if (loserUid) {
          const loserRef = doc(db, "users", loserUid);
          tx.update(loserRef, { totalGames: increment(1) });
        }
      } else if (movesLeft === 0) {
        const nextTurn = room.playerOrder.find((u) => u !== state.uid);
        update.turn = nextTurn;
        update.dice = [];
      }

      tx.update(roomRef, update);
    });
  } catch (e) {
    console.error(e);
  }
}

/* ---------------------------------------------------------------- */
/* Rakip hamlelerini canlandır                                       */
/* ---------------------------------------------------------------- */
function animateLastAction(action) {
  if (!action || action.uid === state.uid) return; // kendi hamlemizi zaten anlık gösteriyoruz
  if (action.type === "roll") {
    $("die-1").classList.add("rolling");
    $("die-2").classList.add("rolling");
    playSound("snd-dice");
    setTimeout(() => {
      $("die-1").classList.remove("rolling");
      $("die-2").classList.remove("rolling");
    }, 600);
  } else if (action.type === "tower" || action.type === "exit") {
    playSound("snd-stone");
    const zone = action.type === "exit" ? $("opp-exit") : $("opp-ready");
    if (zone) {
      zone.classList.add("zone-flash");
      setTimeout(() => zone.classList.remove("zone-flash"), 500);
    }
  }
}

/* ---------------------------------------------------------------- */
/* Oyun sonu                                                         */
/* ---------------------------------------------------------------- */
async function renderEnd() {
  const room = state.room;
  const iWon = room.winner === state.uid;
  $("end-title").textContent = iWon ? "Kazandın! 🎉" : "Kaybettin";
  $("end-subtitle").textContent = iWon ? "Harika oynadın!" : "Bir dahaki sefere!";
  $("trophy-pop").textContent = iWon ? "🏆" : "🎲";

  const me = room.players[state.uid];
  const oppId = otherUid();
  const opp = oppId ? room.players[oppId] : null;
  $("end-me-name").textContent = "Sen";
  $("end-opp-name").textContent = opp ? opp.name : "Rakip";

  const myStats = await getDoc(doc(db, "users", state.uid));
  if (myStats.exists()) {
    const d = myStats.data();
    $("end-me-record").textContent = `${d.wins || 0}G ${(d.totalGames || 0) - (d.wins || 0)}M`;
  }
  if (oppId) {
    const oppStats = await getDoc(doc(db, "users", oppId));
    if (oppStats.exists()) {
      const d = oppStats.data();
      $("end-opp-record").textContent = `${d.wins || 0}G ${(d.totalGames || 0) - (d.wins || 0)}M`;
    }
  }

  if (iWon) {
    playSound("snd-win");
    launchConfetti();
  }
  refreshStats();
}

function launchConfetti() {
  const layer = $("confetti-layer");
  layer.innerHTML = "";
  const colors = ["#e8608a", "#f2a154", "#f6c9d0", "#bfe0e6", "#f7e2a4", "#cdb7e6"];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    const size = 6 + Math.random() * 6;
    piece.style.width = size + "px";
    piece.style.height = size * 0.6 + "px";
    piece.style.left = Math.random() * 100 + "vw";
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = 2.2 + Math.random() * 1.8 + "s";
    piece.style.animationDelay = Math.random() * 0.6 + "s";
    layer.appendChild(piece);
  }
  setTimeout(() => { layer.innerHTML = ""; }, 4500);
}

async function rematch() {
  const roomRef = doc(db, "rooms", state.roomCode);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    const room = snap.data();
    if (!room) return;
    const players = room.players;
    Object.keys(players).forEach((u) => {
      players[u].towers = [STONES_PER_TOWER, STONES_PER_TOWER, STONES_PER_TOWER];
      players[u].readyArea = 0;
      players[u].exit = 0;
      players[u].startRoll = null;
      players[u].ready = true;
    });
    tx.update(roomRef, {
      players,
      status: "starting",
      turn: null,
      dice: [],
      movesLeft: 0,
      winner: null,
      updatedAt: serverTimestamp(),
    });
  });
}

/* ---------------------------------------------------------------- */
/* Sohbet                                                             */
/* ---------------------------------------------------------------- */
function renderChat(messages) {
  const box = $("chat-messages");
  box.innerHTML = messages.map((m) => `
    <div class="chat-bubble ${m.uid === state.uid ? "mine" : ""}">
      <span class="sender">${escapeHtml(m.name || "")}</span>${escapeHtml(m.text || "")}
    </div>
  `).join("");
  box.scrollTop = box.scrollHeight;
}

async function sendChat(text) {
  const clean = text.trim();
  if (!clean || !state.roomCode) return;
  await addDoc(collection(db, "rooms", state.roomCode, "messages"), {
    uid: state.uid,
    name: state.name,
    text: clean.slice(0, 200),
    ts: serverTimestamp(),
  });
}

/* ---------------------------------------------------------------- */
/* İstatistikler                                                     */
/* ---------------------------------------------------------------- */
async function refreshStats() {
  if (!state.uid) return;
  const snap = await getDoc(doc(db, "users", state.uid));
  if (!snap.exists()) return;
  const d = snap.data();
  const games = d.totalGames || 0;
  const wins = d.wins || 0;
  const rate = games > 0 ? Math.round((wins / games) * 100) : 0;
  $("stat-games").textContent = games;
  $("stat-wins").textContent = wins;
  $("stat-rate").textContent = `%${rate}`;
}

/* ---------------------------------------------------------------- */
/* Bağlantı (presence)                                                */
/* ---------------------------------------------------------------- */
function startPresence() {
  stopPresence();
  const tick = async () => {
    if (!state.roomCode || !state.uid) return;
    try {
      await updateDoc(doc(db, "rooms", state.roomCode), {
        [`players.${state.uid}.lastSeen`]: serverTimestamp(),
      });
    } catch (e) { /* sessiz geç */ }
  };
  tick();
  state.presenceTimer = setInterval(tick, PRESENCE_INTERVAL_MS);
  state.presenceCheckTimer = setInterval(updatePresenceBanner, 5000);
}

function stopPresence() {
  if (state.presenceTimer) clearInterval(state.presenceTimer);
  if (state.presenceCheckTimer) clearInterval(state.presenceCheckTimer);
  state.presenceTimer = null;
  state.presenceCheckTimer = null;
}

function updatePresenceBanner() {
  const room = state.room;
  const banner = $("opponent-banner");
  if (!room || room.status !== "playing") { banner.classList.add("hidden"); return; }
  const oppId = otherUid();
  if (!oppId) { banner.classList.add("hidden"); return; }
  const opp = room.players[oppId];
  const lastSeen = opp && opp.lastSeen && opp.lastSeen.toMillis ? opp.lastSeen.toMillis() : null;
  const stale = lastSeen ? (Date.now() - lastSeen > PRESENCE_TIMEOUT_MS) : false;
  banner.classList.toggle("hidden", !stale);
}

/* ---------------------------------------------------------------- */
/* Odadan ayrıl                                                      */
/* ---------------------------------------------------------------- */
function leaveRoomLocal() {
  if (state.unsubRoom) state.unsubRoom();
  if (state.unsubChat) state.unsubChat();
  stopPresence();
  state.unsubRoom = null;
  state.unsubChat = null;
  state.roomCode = null;
  state.room = null;
  $("chat-panel").classList.remove("open");
}

/* ---------------------------------------------------------------- */
/* Olay dinleyicileri                                                 */
/* ---------------------------------------------------------------- */
function bindEvents() {
  $("name-input").addEventListener("input", (e) => {
    $("start-btn").disabled = e.target.value.trim().length === 0;
  });
  $("name-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !$("start-btn").disabled) $("start-btn").click();
  });
  $("start-btn").addEventListener("click", () => {
    const name = $("name-input").value.trim();
    if (name) completeLogin(name);
  });

  document.querySelectorAll("[data-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.nav;
      if (target === "menu-screen") {
        leaveRoomLocal();
      }
      showScreen(target);
    });
  });

  $("create-room-btn").addEventListener("click", createRoom);

  $("copy-code-btn").addEventListener("click", () => {
    navigator.clipboard?.writeText($("room-code-display").textContent).then(() => toast("Kod kopyalandı!"));
  });

  $("join-btn").addEventListener("click", () => joinRoom($("join-code-input").value));
  $("join-code-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") joinRoom($("join-code-input").value);
  });

  $("ready-btn-host").addEventListener("click", toggleReady);
  $("ready-btn-guest").addEventListener("click", toggleReady);

  $("starting-roll-btn").addEventListener("click", rollStartingDie);

  $("leave-game-btn").addEventListener("click", () => {
    leaveRoomLocal();
    showScreen("menu-screen");
  });

  $("chat-toggle-btn").addEventListener("click", () => $("chat-panel").classList.toggle("open"));
  $("chat-close-btn").addEventListener("click", () => $("chat-panel").classList.remove("open"));
  $("chat-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = $("chat-input");
    sendChat(input.value);
    input.value = "";
  });
  $("chat-quick").querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => sendChat(b.dataset.emoji));
  });

  $("stats-nav-btn").addEventListener("click", () => { refreshStats(); showScreen("stats-screen"); });

  $("sound-toggle").addEventListener("change", (e) => {
    state.soundOn = e.target.checked;
    localStorage.setItem("kt_sound", state.soundOn ? "on" : "off");
  });
  $("save-settings-btn").addEventListener("click", async () => {
    const newName = $("settings-name-input").value.trim();
    if (newName) {
      state.name = newName;
      localStorage.setItem("kt_name", newName);
      await updateDoc(doc(db, "users", state.uid), { name: newName });
      $("menu-name").textContent = newName;
    }
    $("settings-saved").classList.remove("hidden");
    setTimeout(() => $("settings-saved").classList.add("hidden"), 1500);
  });

  $("rematch-btn").addEventListener("click", rematch);
  $("end-menu-btn").addEventListener("click", () => {
    leaveRoomLocal();
    showScreen("menu-screen");
  });
}

/* ---------------------------------------------------------------- */
/* Başlat                                                             */
/* ---------------------------------------------------------------- */
function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js").catch(() => {});
    });
  }
}

function init() {
  loadLocalSettings();
  bindEvents();
  initAuth();
  registerServiceWorker();
}

init();
