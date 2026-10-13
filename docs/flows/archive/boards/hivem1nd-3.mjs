// HIVEM1ND 3.0: the screens approved on 2026-10-10, drawn as a board. One window in three modes (Map,
// Blueprint and Void), plus the simplified phone view on the home network. The top row wears Modern, the
// default look; the bottom row wears High contrast, the option in Settings. Both rows are the same screens:
// each look is a palette of roles handed to the screen root as its theme, plus the few shapes that differ
// (Modern floats its panels with larger radii; High contrast rules them with lines). The sample is
// invented: its units, machines, tasks and times are examples.

import { board } from "blueprint/board.mjs";
import { LOOKS, windowOf, mapBody, chatsBody, blueprintBody, voidBody, focus, phoneHierarchy, phoneChat } from "../kit/h3.mjs";

// ---- the board ------------------------------------------------------------------------------------

const NOTES = {
  map: "Free circles on an open field; a selected Executor with its chat on the right, and a drag connecting executor-site to overlord-web.",
  chats: "A drag on empty space selects three units; their group chat opens on the right. Chats keeps every conversation, pinned first.",
  blueprint: "A board with its attached agents. Watch is on, so the agent draws live and its cursor shows; comments sit on the right.",
  void: "The Document view, the default. Watch is off: the agent works off screen and its change waits in the comment. Focus opens the real Void.",
  focus: "Pure black, the interface hidden; the arrows move through the text and the mouse brings the tools back. Esc returns to the Document view.",
  phoneHierarchy: "The phone on the home network: see, chat and approve, no editing. The access closes after 12 hours.",
  phoneChat: "A unit's chat on the phone, with its asks answered in place.",
};

const STEP = 1440 + 200;
const ROW = 900 + 320;

const screens = LOOKS.flatMap((L, r) => {
  const y = r * ROW;
  const suffix = L.m ? "" : ", High contrast";
  return [
    { id: `${L.id}-map`, title: `1. Map${suffix}`, x: 0, y, root: windowOf(L, "Map", 2, mapBody), note: NOTES.map },
    { id: `${L.id}-chats`, title: `2. Chats${suffix}`, x: STEP, y, root: windowOf(L, "Map", 2, chatsBody), note: NOTES.chats },
    { id: `${L.id}-blueprint`, title: `3. Blueprint${suffix}`, x: STEP * 2, y, root: windowOf(L, "Blueprint", 1, blueprintBody), note: NOTES.blueprint },
    { id: `${L.id}-void`, title: `4. Void, Document view${suffix}`, x: STEP * 3, y, root: windowOf(L, "Void", 1, voidBody), note: NOTES.void },
    { id: `${L.id}-focus`, title: `5. Void, Focus${suffix}`, x: STEP * 4, y, root: focus(L), note: NOTES.focus },
    { id: `${L.id}-phone-hierarchy`, title: `6. Phone, Hierarchy${suffix}`, x: STEP * 5, y, w: 390, h: 844, root: phoneHierarchy(L), note: NOTES.phoneHierarchy },
    { id: `${L.id}-phone-chat`, title: `7. Phone, a chat${suffix}`, x: STEP * 5 + 390 + 120, y, w: 390, h: 844, root: phoneChat(L), note: NOTES.phoneChat },
  ];
});

export default board({
  id: "hivem1nd-3",
  title: "HIVEM1ND 3.0: the approved screens",
  note:
    "HIVEM1ND 3.0 as approved on 2026-10-10. Top row: Modern, the default look. Bottom row: High contrast, the option in Settings. " +
    "Present plays the Modern row: Chats from the Map, the modes in the bar, Focus from Void and the phone. The sample is invented.",
  screens,
  links: [
    { from: "modern-map", to: "modern-chats", at: "tab-chats", label: "Chats" },
    { from: "modern-map", to: "modern-blueprint", at: "mode-blueprint", label: "Blueprint" },
    { from: "modern-blueprint", to: "modern-void", at: "mode-void", label: "Void" },
    { from: "modern-void", to: "modern-focus", at: "focus", label: "Focus" },
    { from: "modern-focus", to: "modern-void", label: "Esc" },
    { from: "modern-map", to: "modern-phone-hierarchy", at: "phone", label: "Open on the phone" },
    { from: "modern-phone-hierarchy", to: "modern-phone-chat", at: "row-executor-shop", label: "executor-shop" },
  ],
});
