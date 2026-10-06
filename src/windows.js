// Small bounded desktop for contextual, draggable in-app detail windows.
export function createWindows(host) {
  const items = new Map();
  let z = 20;
  function open(id, title, html) {
    let entry = items.get(id);
    if (!entry) {
      if (items.size >= 6) close(items.keys().next().value);
      const element = document.createElement("section");
      element.className = "detail-window";
      element.setAttribute("aria-label", title);
      const bar = document.createElement("div");
      bar.className = "window-title";
      const name = document.createElement("strong");
      name.textContent = title;
      const button = document.createElement("button");
      button.textContent = "×";
      button.setAttribute("aria-label", "Close " + title);
      button.onclick = () => close(id);
      const popout = document.createElement("button");
      popout.className = "popout-button";
      popout.textContent = "Pop out ↗";
      popout.setAttribute(
        "aria-label",
        "Open " + title + " in a separate window or tab",
      );
      popout.onclick = () => {
        const external = window.open(
          "",
          "_blank",
          "popup,width=640,height=800",
        );
        if (!external) {
          popout.textContent = "Allow popups ↗";
          return;
        }
        external.opener = null;
        external.document.write(
          '<!doctype html><html><head><meta charset="utf-8"><title>Market Nexus detail</title><style>body{margin:0;padding:24px;background:#09152a;color:#dbf7ef;font:14px system-ui}h1{font-size:18px;color:#85ffe0}.kv{display:flex;justify-content:space-between;gap:25px;padding:9px 0;border-bottom:1px solid #274158}p{color:#9ab7cc}img{width:100%;height:auto}small{color:#7fb6bc}button{display:none}</style></head><body><h1></h1><small>Market Nexus v7 · Source details · updates while the original card is open</small><main></main></body></html>',
        );
        external.document.close();
        entry.external = external;
        syncEntry(entry);
      };
      bar.append(name, popout, button);
      const body = document.createElement("div");
      body.className = "window-body";
      element.append(bar, body);
      host.append(element);
      entry = { element, body, name };
      items.set(id, entry);
      element.style.left =
        Math.max(
          10,
          Math.min(innerWidth - 360, innerWidth - 390 - (items.size - 1) * 28),
        ) + "px";
      element.style.top = 220 + (items.size - 1) * 28 + "px";
      element.onpointerdown = () => (element.style.zIndex = ++z);
      let drag;
      bar.onpointerdown = (e) => {
        if (e.target.closest("button")) return;
        const rect = element.getBoundingClientRect();
        drag = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top };
        bar.setPointerCapture(e.pointerId);
      };
      bar.onpointermove = (e) => {
        if (!drag) return;
        element.style.left =
          Math.max(
            0,
            Math.min(innerWidth - 100, drag.left + e.clientX - drag.x),
          ) + "px";
        element.style.top =
          Math.max(
            0,
            Math.min(innerHeight - 60, drag.top + e.clientY - drag.y),
          ) + "px";
      };
      bar.onpointerup = bar.onpointercancel = () => (drag = null);
    }
    entry.name.textContent = title;
    entry.body.innerHTML = html;
    entry.element.style.zIndex = ++z;
    return entry.body;
  }
  function update(id, html) {
    const entry = items.get(id);
    if (entry) entry.body.innerHTML = html;
  }
  function syncEntry(entry) {
    if (!entry.external || entry.external.closed) return;
    try {
      const copy = entry.body.cloneNode(true),
        original = [...entry.body.querySelectorAll("canvas")];
      [...copy.querySelectorAll("canvas")].forEach((canvas, i) => {
        const img = document.createElement("img");
        img.src = original[i].toDataURL();
        img.alt = "Recorded chart";
        canvas.replaceWith(img);
      });
      entry.external.document.title =
        entry.name.textContent + " · Market Nexus v7";
      entry.external.document.querySelector("h1").textContent =
        entry.name.textContent;
      entry.external.document.querySelector("main").replaceChildren(copy);
    } catch {
      entry.external = null;
    }
  }
  function syncPopouts() {
    for (const entry of items.values()) syncEntry(entry);
  }
  function close(id) {
    items.get(id)?.element.remove();
    items.delete(id);
  }
  function clear() {
    for (const id of [...items.keys()]) close(id);
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && items.size) {
      const top = [...items].sort(
        (a, b) =>
          Number(b[1].element.style.zIndex) - Number(a[1].element.style.zIndex),
      )[0];
      close(top[0]);
    }
  });
  return {
    open,
    update,
    close,
    clear,
    syncPopouts,
    has: (id) => items.has(id),
  };
}
