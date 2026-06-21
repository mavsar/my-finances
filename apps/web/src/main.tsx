import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { BlurProvider } from "./contexts/BlurContext";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <BlurProvider>
        <App />
      </BlurProvider>
    </BrowserRouter>
  </StrictMode>
);
