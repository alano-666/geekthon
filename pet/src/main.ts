import { getCurrentWindow } from "@tauri-apps/api/window";
import { fetch } from "@tauri-apps/plugin-http";

// All requests go through the Tauri http plugin (Rust side), so there is no
// browser CORS to worry about for either the mock service or Hermes.
const MOCK_TODAY = "http://localhost:4100/scores/today";
const HERMES_CHAT = "http://localhost:8642/v1/chat/completions";
const HERMES_KEY = "change-me-local-dev"; // must match Hermes API_SERVER_KEY
const HERMES_MODEL = "hermes-agent";
const POLL_MS = 5000;

type PetState = "thriving" | "good" | "slacking" | "resting";
const STATES: PetState[] = ["thriving", "good", "slacking", "resting"];
const STATE_LABEL: Record<PetState, string> = {
  thriving: "今天超棒！两项都达标 🎉",
  good: "不错哦，达标了一项 💪",
  slacking: "今天还没达标，加把劲～",
  resting: "休息中… zzz",
};

const petImg = document.getElementById("pet") as HTMLImageElement;
const bubble = document.getElementById("bubble") as HTMLDivElement;
const chatForm = document.getElementById("chat") as HTMLFormElement;
const chatInput = document.getElementById("chat-input") as HTMLInputElement;

let lastState: PetState | undefined;
let bubbleTimer: number | undefined;

function isPetState(s: unknown): s is PetState {
  return typeof s === "string" && (STATES as string[]).includes(s);
}

function setPet(state: PetState) {
  petImg.src = `/cats/${state}.svg`;
}

function showBubble(text: string, autoHideMs = 4000) {
  bubble.textContent = text;
  bubble.classList.remove("hidden");
  if (bubbleTimer !== undefined) {
    clearTimeout(bubbleTimer);
    bubbleTimer = undefined;
  }
  if (autoHideMs > 0) {
    bubbleTimer = window.setTimeout(
      () => bubble.classList.add("hidden"),
      autoHideMs,
    );
  }
}

// Poll the scores service; the pet's expression is driven by petState, which the
// scoring service computes by RULE (docs/CONTRACT.md §3.3). The pet only maps
// state → picture; it never derives state itself.
async function pollScores() {
  try {
    const res = await fetch(MOCK_TODAY, { method: "GET" });
    if (!res.ok) return;
    const data = (await res.json()) as { petState?: string };
    if (!isPetState(data.petState)) return;
    setPet(data.petState);
    if (data.petState !== lastState) {
      lastState = data.petState;
      showBubble(STATE_LABEL[data.petState]); // auto-bubble on state change
    }
  } catch {
    // scores service (:4100) offline — keep the last expression
  }
}

async function askHermes(question: string) {
  showBubble("思考中…", 0);
  try {
    const res = await fetch(HERMES_CHAT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${HERMES_KEY}`,
      },
      body: JSON.stringify({
        model: HERMES_MODEL,
        messages: [{ role: "user", content: question }],
      }),
    });
    if (!res.ok) {
      showBubble(`Hermes 出错了（HTTP ${res.status}）`, 6000);
      return;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const reply = data.choices?.[0]?.message?.content?.trim();
    showBubble(reply || "（没有回复）", 9000);
  } catch {
    showBubble("连不上 Hermes —— :8642 的 API server 开了吗？", 6000);
  }
}

// ── click vs drag on the cat ──────────────────────────────────────────────────
// Hold-and-move drags the pet around the desktop; a plain click opens the chat.
const appWindow = getCurrentWindow();
let downX = 0;
let downY = 0;
let dragged = false;

petImg.addEventListener("mousedown", (e) => {
  downX = e.clientX;
  downY = e.clientY;
  dragged = false;
});
petImg.addEventListener("mousemove", (e) => {
  if (e.buttons !== 1 || dragged) return;
  if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) {
    dragged = true;
    void appWindow.startDragging();
  }
});
petImg.addEventListener("click", () => {
  if (dragged) return; // it was a drag, not a click
  chatForm.classList.toggle("hidden");
  if (!chatForm.classList.contains("hidden")) {
    chatInput.focus();
  }
});

chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = chatInput.value.trim();
  if (!q) return;
  chatInput.value = "";
  chatForm.classList.add("hidden");
  void askHermes(q);
});

// ── boot ──────────────────────────────────────────────────────────────────────
setPet("resting");
void pollScores();
setInterval(() => void pollScores(), POLL_MS);
