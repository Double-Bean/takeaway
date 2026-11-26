import { createRoot } from "react-dom/client";
import LunchApp, { type LunchTransport } from "@/components/lunch-app";
import { applyAction, freshen } from "@/lib/lunch-actions";
import { seed } from "@/lib/lunch-engine";
import { models } from "@/lib/lunch-models";
import type { Session } from "@/lib/lunch-types";
import "@/app/globals.css";

const storageKey="takeaway-lunch-session-v2";
const localModel=models({});
let current:Session|undefined;

function restore():Session {
  try {
    const saved=localStorage.getItem(storageKey);
    if (saved) {
      const session=JSON.parse(saved) as Session;
      if (session.preferencesVersion===2 && session.profile && Array.isArray(session.orders)) return session;
    }
  } catch {
    // Private browsing or a corrupted value can still start a fresh session.
  }
  return seed();
}

function save(session:Session):Session {
  current=session;
  try {
    localStorage.setItem(storageKey,JSON.stringify(session));
  } catch {
    // If storage is unavailable, keep the current tab functional in memory.
  }
  return session;
}

const transport:LunchTransport={
  async load() {
    return save(await freshen(current??restore(),localModel));
  },
  async act(path, body) {
    const session=await freshen(structuredClone(current??restore()),localModel);
    return save(await applyAction(session,localModel,path,body));
  },
};

const root=document.getElementById("root");
if (!root) throw new Error("Missing application root.");
createRoot(root).render(<LunchApp transport={transport} />);
