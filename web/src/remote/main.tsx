import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RemoteApp } from "./app";
import "../index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RemoteApp />
  </StrictMode>,
);
