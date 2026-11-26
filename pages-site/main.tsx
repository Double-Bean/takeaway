import { createRoot } from "react-dom/client";
import LunchApp from "@/components/lunch-app";
import { createPagesTransport } from "@/lib/lunch-pages-transport";
import "@/app/globals.css";

const transport=createPagesTransport("https://lunch-chat-5529.cladswan16.chatgpt.site/api/");
const root=document.getElementById("root");
if (!root) throw new Error("Missing application root.");
createRoot(root).render(<LunchApp transport={transport} />);
