import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const fromRoot=(path:string)=>fileURLToPath(new URL(path,import.meta.url));

export default defineConfig({
  root:fromRoot("./pages-site"),
  base:"./",
  publicDir:fromRoot("./public"),
  resolve:{alias:{"@":fromRoot("./")}},
  build:{outDir:fromRoot("./dist/pages"),emptyOutDir:true},
});
