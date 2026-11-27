export function trackLunchViewport() {
  const root=document.documentElement;
  const viewport=window.visualViewport;
  let frameBounds:DOMRectReadOnly|undefined;
  let scheduled=0;

  function update() {
    scheduled=0;
    const layoutHeight=root.clientHeight||window.innerHeight;
    const unzoomed=viewport&&Math.abs(viewport.scale-1)<0.01;
    const top=Math.max(0,unzoomed?viewport.offsetTop:0,frameBounds?.top??0);
    const bottom=Math.min(layoutHeight,unzoomed?viewport.offsetTop+viewport.height:layoutHeight,frameBounds?.bottom??layoutHeight);
    if (bottom<=top) return;
    const height=Math.floor(bottom-top);
    root.style.setProperty("--usable-height",height+"px");
    root.style.setProperty("--viewport-top",Math.floor(top)+"px");
    root.style.setProperty("--viewport-bottom",Math.ceil(layoutHeight-bottom)+"px");
    root.toggleAttribute("data-compact-viewport",height<=460);
  }

  function schedule() {
    if (!scheduled) scheduled=requestAnimationFrame(update);
  }

  // An embedded document's visual viewport can be taller than the visible part of its frame.
  const observer=window.parent!==window&&typeof IntersectionObserver!=="undefined"
    ? new IntersectionObserver(([entry])=>{
      frameBounds=entry.intersectionRect.height>0?entry.intersectionRect:undefined;
      schedule();
    },{threshold:Array.from({length:101},(_,index)=>index/100)})
    : undefined;

  observer?.observe(root);
  window.addEventListener("resize",schedule);
  viewport?.addEventListener("resize",schedule);
  viewport?.addEventListener("scroll",schedule);
  update();
  return ()=>{
    observer?.disconnect();
    window.removeEventListener("resize",schedule);
    viewport?.removeEventListener("resize",schedule);
    viewport?.removeEventListener("scroll",schedule);
    cancelAnimationFrame(scheduled);
    root.style.removeProperty("--usable-height");
    root.style.removeProperty("--viewport-top");
    root.style.removeProperty("--viewport-bottom");
    root.removeAttribute("data-compact-viewport");
  };
}
