import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { studioApiOrigin } from "./lib/lunch-network";

const fromRoot=(path:string)=>fileURLToPath(new URL(path,import.meta.url));

export default defineConfig(({mode})=>{
  const studio=mode==="studio";
  const origin=studio?undefined:loadEnv(mode,fromRoot("./"),"VITE_").VITE_LUNCH_API_ORIGIN?.trim();
  let apiBase=studio?"/api/":studioApiOrigin+"/api/";
  if (origin) {
    const url=new URL(origin);
    if (url.protocol!=="https:" || url.username || url.password || url.pathname!=="/" || url.search || url.hash) {
      throw new Error("VITE_LUNCH_API_ORIGIN must be a public HTTPS origin without a path.");
    }
    apiBase=new URL("/api/",url).href;
  }
  return {
    root:fromRoot("./pages-site"),
    base:"./",
    publicDir:fromRoot("./public"),
    resolve:{alias:{"@":fromRoot("./")}},
    define:{__LUNCH_API_BASE__:JSON.stringify(apiBase)},
    build:{outDir:fromRoot(studio?"./dist/studio/site":"./dist/pages"),emptyOutDir:true},
  };
});
