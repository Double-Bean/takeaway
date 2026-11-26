import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";

execFileSync(process.execPath,["node_modules/vite/bin/vite.js","build","--config","vite.pages.config.ts","--mode","studio"],{stdio:"inherit"});
execFileSync(process.execPath,["node_modules/typescript/bin/tsc","studio/server.ts","--rootDir",".","--outDir","dist/studio/server","--module","commonjs","--target","es2023","--types","node","--strict","--skipLibCheck"],{stdio:"inherit"});
writeFileSync("dist/studio/server/package.json",JSON.stringify({type:"commonjs"}));
