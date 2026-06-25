import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Amplify } from "aws-amplify"; //  Added
import outputs from "../amplify_outputs.json"; //  Added
import "./index.css";
import App from "./App";

// Configure Amplify with your backend outputs
Amplify.configure(outputs);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);