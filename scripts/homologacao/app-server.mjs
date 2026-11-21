import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { loopback } from "./lib/safety.mjs";

export async function freePort() {
  const server=createServer();
  await new Promise((res,rej)=>{server.once("error",rej);server.listen(0,"127.0.0.1",res);});
  const port=server.address().port; await new Promise(res=>server.close(res)); return port;
}
export async function startApp(env,root) {
  if(!loopback(env.NEXT_PUBLIC_SUPABASE_URL,["http:"])) throw new Error("LOCAL_APP_TARGET_FAILED");
  const port=await freePort();
  const child=spawn(process.execPath,[resolve(root,"node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port",String(port)],{cwd:root,env,windowsHide:true,shell:false,stdio:["ignore","ignore","ignore"]});
  let exited=false; child.once("error",()=>{exited=true;});child.once("exit",()=>{exited=true;});
  const stop=async()=>{if(!exited){child.kill();await Promise.race([new Promise(res=>child.once("exit",res)),new Promise(res=>setTimeout(res,5000))]);}};
  const url=`http://127.0.0.1:${port}`;
  const deadline=Date.now()+60_000;
  while(Date.now()<deadline&&!exited){
    try{ const response=await fetch(`${url}/login`,{signal:AbortSignal.timeout(2000)}); if(response.ok)return {url,stop}; }catch{ /* bounded readiness */ }
    await new Promise(res=>setTimeout(res,500));
  }
  await stop();throw new Error("LOCAL_APP_START_BLOCKED");
}
