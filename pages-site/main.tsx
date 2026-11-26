import { createRoot } from "react-dom/client";
import LunchApp from "@/components/lunch-app";
import { createPagesTransport } from "@/lib/lunch-pages-transport";
import "@/app/globals.css";

declare const __LUNCH_API_BASE__:string|null;
const transport=createPagesTransport(__LUNCH_API_BASE__??undefined);
const root=document.getElementById("root");
if (!root) throw new Error("Missing application root.");
createRoot(root).render(<LunchApp transport={transport} />);
