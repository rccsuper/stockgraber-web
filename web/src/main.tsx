import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

window.addEventListener("error", (e) => {
  const d = document.createElement("pre");
  d.id = "err-overlay";
  d.style.cssText = "position:fixed;top:0;left:0;right:0;background:#400;color:#fff;padding:12px;z-index:9999;font:11px monospace;white-space:pre-wrap;max-height:50vh;overflow:auto";
  d.textContent = "ERR: " + (e.error?.stack || e.message);
  document.body.appendChild(d);
});
window.addEventListener("unhandledrejection", (e) => {
  const d = document.createElement("pre");
  d.id = "err-overlay-rej";
  d.style.cssText = "position:fixed;top:50vh;left:0;right:0;background:#404;color:#fff;padding:12px;z-index:9999;font:11px monospace;white-space:pre-wrap;max-height:50vh;overflow:auto";
  d.textContent = "REJ: " + (e.reason?.stack || String(e.reason));
  document.body.appendChild(d);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
