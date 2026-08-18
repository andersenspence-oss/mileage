// Small DOM helpers plus the copy behaviour the whole app is built around.

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    // A textarea ignores a value attribute, and form controls generally behave
    // better when the property is assigned rather than the attribute set.
    else if (k === "value" && "value" in node) node.value = v;
    else node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

// The async clipboard API needs a secure context and a user gesture. Both hold
// when this runs from a button tap on the hosted page, but older iOS Safari
// still needs the selection fallback.
export async function copyText(text) {
  const value = String(text ?? "");
  if (!value) return false;

  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      /* fall through to the legacy path */
    }
  }

  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  // Kept on-screen but invisible: iOS refuses to copy from a hidden node.
  area.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;padding:0;border:0;";
  document.body.appendChild(area);
  const selection = document.getSelection();
  const previous = selection && selection.rangeCount ? selection.getRangeAt(0) : null;

  area.focus();
  area.select();
  area.setSelectionRange(0, value.length);

  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }

  document.body.removeChild(area);
  if (previous && selection) {
    selection.removeAllRanges();
    selection.addRange(previous);
  }
  return ok;
}

let toastTimer = null;
export function toast(message, kind = "ok") {
  let node = document.getElementById("toast");
  if (!node) {
    node = el("div", { id: "toast" });
    document.body.appendChild(node);
  }
  node.textContent = message;
  node.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.className = "";
  }, 1900);
}

// A copy button that confirms on the button itself, so on a phone the feedback
// is where the thumb already is.
export function copyButton(label, getText, { className = "copy", title } = {}) {
  // A label like "Copy tags" is already a sentence; only labels that name the
  // thing alone need the verb prepended.
  const spoken = title || (/^copy\b/i.test(label) ? label : `Copy ${label.toLowerCase()}`);
  const button = el("button", {
    class: className,
    type: "button",
    title: spoken,
    "aria-label": spoken,
  });
  const icon = el("span", { class: "copy-ico", html: COPY_ICON });
  const text = el("span", { class: "copy-label", text: label });
  button.append(icon, text);

  button.addEventListener("click", async (event) => {
    event.stopPropagation();
    const payload = typeof getText === "function" ? getText() : getText;
    const ok = await copyText(payload);
    button.classList.toggle("copied", ok);
    button.classList.toggle("failed", !ok);
    text.textContent = ok ? "Copied" : "Press and hold to copy";
    icon.innerHTML = ok ? CHECK_ICON : COPY_ICON;
    toast(ok ? "Copied" : "Could not copy automatically", ok ? "ok" : "err");
    setTimeout(() => {
      button.classList.remove("copied", "failed");
      text.textContent = label;
      icon.innerHTML = COPY_ICON;
    }, 1800);
  });

  return button;
}

const COPY_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="12" rx="2"></rect><path d="M5 15V5a2 2 0 0 1 2-2h8"></path></svg>';
const CHECK_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12.5 9 17.5 20 6.5"></path></svg>';

export function download(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
