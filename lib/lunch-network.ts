export const studioApiOrigin="https://jincy0610-takeaway.ms.show";

export function timeoutSignal(milliseconds:number) {
  if (typeof AbortSignal.timeout==="function") return AbortSignal.timeout(milliseconds);
  const controller=new AbortController();
  setTimeout(()=>controller.abort(new DOMException("请求超时","TimeoutError")),milliseconds);
  return controller.signal;
}
