import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";

const fromRoot=(path:string)=>fileURLToPath(new URL(path,import.meta.url));

export default defineConfig(({mode})=>{
  const origin=loadEnv(mode,fromRoot("./"),"VITE_").VITE_LUNCH_API_ORIGIN?.trim();
  let apiBase:string|null=null;
  if (origin) {
    const url=new URL(origin);
    if (url.protocol!=="https:" || url.username || url.password || url.pathname!=="/" || url.search || url.hash) {
      throw new Error("VITE_LUNCH_API_ORIGIN must be the Worker's HTTPS origin without a path.");
    }
    apiBase=new URL("/api/",url).href;
  }
  return {
    root:fromRoot("./pages-site"),
    base:"./",
    publicDir:fromRoot("./public"),
    resolve:{alias:{"@":fromRoot("./")}},
    define:{__LUNCH_API_BASE__:JSON.stringify(apiBase)},
    build:{outDir:fromRoot("./dist/pages"),emptyOutDir:true},
  };
});
