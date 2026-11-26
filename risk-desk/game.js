/* Risk Desk: a small position sizing game.
   All tuning lives in CONFIG so the feel can be changed without touching the logic. */

const CONFIG = {
  startBalance: 10000,     // starting account, in dollars
  rounds: 20,              // trades per run
  maxDrawdown: 0.20,       // run ends if the account falls this far below its peak
  sizes: [0.01, 0.02, 0.05, 0.10], // share of the account risked per trade
  defaultSize: 1,          // index into sizes
  ticksPerRound: 60,       // price ticks in one round
  drift: 0.0012,           // per-tick drift in a trending market
  vol: 0.01,               // per-tick volatility
  stopDistance: 0.03,      // stop loss distance, as a share of entry price
  rewardRisk: 2,           // target distance = stopDistance * rewardRisk
  fee: 0.12,               // trading cost per trade, as a share of the amount risked
  regimePersistence: 0.65, // chance the market keeps its current behaviour next round
  tickMs: 26,              // animation speed while a trade is open
  historyShown: 180        // ticks visible on the chart
};

const $ = (id) => document.getElementById(id);
const fmt = (n) => "$" + Math.round(n).toLocaleString("en-US");
const REGIMES = [1, -1, 0]; // up trend, down trend, chop

const state = {};

function gauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function nextPrice(price, regime) {
  return price * Math.exp(regime * CONFIG.drift + CONFIG.vol * gauss());
}

function pickRegime(prev) {
  if (Math.random() < CONFIG.regimePersistence) return prev;
  return REGIMES[Math.floor(Math.random() * REGIMES.length)];
}

function loadBest() {
  try { return Number(localStorage.getItem("riskdesk.best")) || 0; } catch (e) { return 0; }
}
function saveBest(v) {
  try { localStorage.setItem("riskdesk.best", String(Math.round(v))); } catch (e) { /* storage unavailable */ }
}

function newGame() {
  Object.assign(state, {
    balance: CONFIG.startBalance,
    peak: CONFIG.startBalance,
    round: 0,
    regime: REGIMES[Math.floor(Math.random() * REGIMES.length)],
    prices: [100],
    marks: [],          // tick indexes where a round started
    phase: "ready",     // ready | playing | over
    trade: null,
    sizeIdx: CONFIG.defaultSize,
    best: loadBest(),
    wins: 0, losses: 0, passes: 0
  });
  for (let i = 0; i < CONFIG.ticksPerRound * 2; i++) {
    state.prices.push(nextPrice(state.prices[state.prices.length - 1], state.regime));
  }
  $("log").innerHTML = "";
  $("overlay").hidden = true;
  setMessage("Read the chart, pick a size, then go long, short or pass.");
  render();
}

function setMessage(text, tone) {
  const el = $("message");
  el.textContent = text;
  el.dataset.tone = tone || "";
}

function addLog(text, tone) {
  const li = document.createElement("li");
  li.textContent = text;
  if (tone) li.dataset.tone = tone;
  $("log").prepend(li);
}

function startRound(dir) {
  if (state.phase !== "ready") return;
  state.round += 1;
  state.regime = pickRegime(state.regime);
  state.marks.push(state.prices.length - 1);
  const entry = state.prices[state.prices.length - 1];
  const size = CONFIG.sizes[state.sizeIdx];
  state.trade = {
    dir, entry, size,
    risk: dir === 0 ? 0 : state.balance * size,
    stop: entry * (1 - dir * CONFIG.stopDistance),
    target: entry * (1 + dir * CONFIG.stopDistance * CONFIG.rewardRisk),
    ticksLeft: CONFIG.ticksPerRound,
    open: dir !== 0,
    r: 0,
    reason: ""
  };
  state.phase = "playing";
  setMessage(dir === 0 ? "Passing. Watching the tape." :
    (dir > 0 ? "Long" : "Short") + " risking " + fmt(state.trade.risk) + ".");
  render();
  lastTime = 0;
  acc = 0;
  requestAnimationFrame(loop);
}

function stepTick() {
  const t = state.trade;
  const price = nextPrice(state.prices[state.prices.length - 1], state.regime);
  state.prices.push(price);
  t.ticksLeft -= 1;
  if (t.open) {
    const move = t.dir * (price / t.entry - 1);
    t.r = move / CONFIG.stopDistance;
    if (t.r <= -1) { t.r = -1; t.open = false; t.reason = "stopped out"; }
    else if (t.r >= CONFIG.rewardRisk) { t.r = CONFIG.rewardRisk; t.open = false; t.reason = "target hit"; }
    else if (t.ticksLeft === 0) { t.open = false; t.reason = "closed at the bell"; }
  }
  if (t.ticksLeft === 0) finishRound();
}

function finishRound() {
  const t = state.trade;
  const pnl = t.dir === 0 ? 0 : t.risk * (t.r - CONFIG.fee);
  state.balance += pnl;
  state.peak = Math.max(state.peak, state.balance);
  const label = "Round " + state.round + ": ";
  if (t.dir === 0) {
    state.passes += 1;
    addLog(label + "passed");
    setMessage("No trade. Balance unchanged.");
  } else {
    if (pnl >= 0) state.wins += 1; else state.losses += 1;
    const side = t.dir > 0 ? "long" : "short";
    const text = label + side + " " + Math.round(t.size * 100) + "%, " + t.reason + ", " +
      (pnl >= 0 ? "+" : "-") + fmt(Math.abs(pnl));
    addLog(text, pnl >= 0 ? "good" : "bad");
    setMessage((pnl >= 0 ? "+" : "-") + fmt(Math.abs(pnl)) + " (" + t.reason + ")", pnl >= 0 ? "good" : "bad");
  }
  state.trade = null;
  const dd = 1 - state.balance / state.peak;
  if (dd >= CONFIG.maxDrawdown) endGame(true);
  else if (state.round >= CONFIG.rounds) endGame(false);
  else state.phase = "ready";
  render();
}

function grade(balance) {
  const x = balance / CONFIG.startBalance;
  if (x >= 2) return "Desk head. You doubled the account.";
  if (x >= 1.5) return "Senior trader. Strong, controlled run.";
  if (x >= 1.15) return "Solid. You made money and kept your seat.";
  if (x >= 1) return "Flat. You survived, which is the first job.";
  return "Down on the run, but you stayed inside the limit.";
}

function endGame(bust) {
  state.phase = "over";
  let newBest = false;
  if (!bust && state.balance > state.best) {
    state.best = state.balance;
    saveBest(state.best);
    newBest = true;
  }
  $("overTitle").textContent = bust ? "Risk limit hit" : "Run complete";
  $("overBody").textContent = bust
    ? "The account fell " + Math.round(CONFIG.maxDrawdown * 100) + "% below its peak in round " +
      state.round + ", so the desk shut you down at " + fmt(state.balance) + "."
    : "Final balance " + fmt(state.balance) + ". " + grade(state.balance) + (newBest ? " New best." : "");
  $("overStats").textContent = state.wins + " wins, " + state.losses + " losses, " + state.passes + " passes";
  $("overlay").hidden = false;
  $("again").focus();
}

let lastTime = 0, acc = 0;
function loop(ts) {
  if (state.phase !== "playing") return;
  if (!lastTime) lastTime = ts;
  acc += Math.min(ts - lastTime, 200);
  lastTime = ts;
  // Once the trade is closed (or on a pass) the rest of the round fast-forwards.
  const ms = state.trade && state.trade.open ? CONFIG.tickMs : CONFIG.tickMs / 5;
  while (acc >= ms && state.phase === "playing") { acc -= ms; stepTick(); }
  render();
  if (state.phase === "playing") requestAnimationFrame(loop);
}

/* ---------- drawing ---------- */

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function drawChart() {
  const canvas = $("chart");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const start = Math.max(0, state.prices.length - CONFIG.historyShown);
  const view = state.prices.slice(start);
  const t = state.trade;
  let lo = Math.min(...view), hi = Math.max(...view);
  if (t && t.dir !== 0) { lo = Math.min(lo, t.stop, t.target); hi = Math.max(hi, t.stop, t.target); }
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad; hi += pad;
  const right = 58;
  const x = (i) => (i / (CONFIG.historyShown - 1)) * (w - right);
  const y = (p) => h - ((p - lo) / (hi - lo)) * h;

  // round boundaries
  ctx.strokeStyle = css("--grid");
  ctx.lineWidth = 1;
  for (const m of state.marks) {
    if (m < start) continue;
    ctx.beginPath(); ctx.moveTo(x(m - start), 0); ctx.lineTo(x(m - start), h); ctx.stroke();
  }

  const hline = (price, color, label) => {
    ctx.strokeStyle = color; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(0, y(price)); ctx.lineTo(w - right, y(price)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color; ctx.font = "12px ui-monospace, Menlo, monospace";
    ctx.fillText(label, w - right + 6, y(price) + 4);
  };
  if (t && t.dir !== 0) {
    hline(t.target, css("--good"), "target");
    hline(t.stop, css("--bad"), "stop");
    hline(t.entry, css("--muted"), "entry");
  }

  ctx.strokeStyle = css("--line");
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  view.forEach((p, i) => (i ? ctx.lineTo(x(i), y(p)) : ctx.moveTo(x(i), y(p))));
  ctx.stroke();

  const lastX = x(view.length - 1), lastY = y(view[view.length - 1]);
  ctx.fillStyle = css("--line");
  ctx.beginPath(); ctx.arc(lastX, lastY, 3.5, 0, Math.PI * 2); ctx.fill();
  if (!t || t.dir === 0) {
    ctx.font = "12px ui-monospace, Menlo, monospace";
    ctx.fillText(view[view.length - 1].toFixed(2), Math.min(lastX + 8, w - right + 6), lastY + 4);
  }
}

function render() {
  const dd = Math.max(0, 1 - state.balance / state.peak);
  $("balance").textContent = fmt(state.balance);
  $("peak").textContent = fmt(state.peak);
  $("round").textContent = Math.min(state.round + (state.phase === "ready" ? 1 : 0), CONFIG.rounds) + " / " + CONFIG.rounds;
  $("best").textContent = state.best ? fmt(state.best) : "none yet";
  $("ddText").textContent = (dd * 100).toFixed(1) + "% of " + Math.round(CONFIG.maxDrawdown * 100) + "% limit";
  const fill = $("ddFill");
  const share = Math.min(1, dd / CONFIG.maxDrawdown);
  fill.style.width = (share * 100) + "%";
  fill.dataset.level = share > 0.75 ? "high" : share > 0.4 ? "mid" : "low";

  const ready = state.phase === "ready";
  document.querySelectorAll("#sizes button").forEach((b, i) => {
    b.setAttribute("aria-pressed", i === state.sizeIdx ? "true" : "false");
    b.disabled = !ready;
  });
  ["long", "short", "pass"].forEach((id) => { $(id).disabled = !ready; });
  const riskNow = state.balance * CONFIG.sizes[state.sizeIdx];
  $("riskNote").textContent = "After fees, a stop-out costs " + fmt(riskNow * (1 + CONFIG.fee)) +
    " and a win at target makes " + fmt(riskNow * (CONFIG.rewardRisk - CONFIG.fee)) + ".";
  drawChart();
}

/* ---------- input ---------- */

function setSize(i) {
  if (state.phase !== "ready" || i < 0 || i >= CONFIG.sizes.length) return;
  state.sizeIdx = i;
  render();
}

function buildSizes() {
  const wrap = $("sizes");
  CONFIG.sizes.forEach((s, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = Math.round(s * 100) + "%";
    b.title = "Risk " + Math.round(s * 100) + "% of the account (key " + (i + 1) + ")";
    b.addEventListener("click", () => setSize(i));
    wrap.appendChild(b);
  });
}

$("long").addEventListener("click", () => startRound(1));
$("short").addEventListener("click", () => startRound(-1));
$("pass").addEventListener("click", () => startRound(0));
$("again").addEventListener("click", newGame);
window.addEventListener("resize", () => drawChart());
window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (state.phase === "over") { if (k === "enter" || k === "r") { e.preventDefault(); newGame(); } return; }
  if (k >= "1" && k <= "9") setSize(Number(k) - 1);
  else if (k === "l" || k === "arrowup") { e.preventDefault(); startRound(1); }
  else if (k === "s" || k === "arrowdown") { e.preventDefault(); startRound(-1); }
  else if (k === "p" || k === " ") { e.preventDefault(); startRound(0); }
});

buildSizes();
$("rules").textContent = "You start with " + fmt(CONFIG.startBalance) + " and get " + CONFIG.rounds +
  " rounds. Each round, pick how much of the account to risk, then go long, short or pass. " +
  "A trade stops out at a " + (CONFIG.stopDistance * 100) + "% move against you (you lose the amount risked) " +
  "or takes profit at a " + (CONFIG.stopDistance * CONFIG.rewardRisk * 100) + "% move your way (you make " +
  CONFIG.rewardRisk + "x the amount risked). If neither happens, it closes at the end of the round. " +
  "Every trade also pays fees worth " + Math.round(CONFIG.fee * 100) + "% of the amount risked, so guessing loses money over time. " +
  "The market trends up, trends down or chops sideways, and usually keeps doing what it was just doing, but not always. " +
  "Fall " + Math.round(CONFIG.maxDrawdown * 100) + "% below your highest balance and the run is over.";
newGame();
