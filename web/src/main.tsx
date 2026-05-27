import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import Dashboard from "./pages/Dashboard";
import Landing from "./pages/Landing";
import Chat from "./pages/Chat";
import Link from "./pages/Link";
import Builds from "./pages/Builds";
import Optimizer from "./pages/Optimizer";
import Play from "./pages/Play";
import Fireteam from "./pages/Fireteam";
import Diagnostic from "./pages/Diagnostic";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />}>
          <Route index element={<Landing />} />
          <Route path="app" element={<Dashboard />} />
          <Route path="chat" element={<Chat />} />
          <Route path="link" element={<Link />} />
          <Route path="builds" element={<Builds />} />
          <Route path="optimizer" element={<Optimizer />} />
          <Route path="play" element={<Play />} />
          <Route path="fireteam" element={<Fireteam />} />
          <Route path="diagnostic" element={<Diagnostic />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
