import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RemoteApp } from "./app";
import { registerWorker } from "./push";
import "../index.css";

// for push notifications (and Android's "Install app")
registerWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RemoteApp />
  </StrictMode>,
);
