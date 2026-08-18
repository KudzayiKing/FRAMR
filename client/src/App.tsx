/** Design reference: the app switches from editorial landing to the source's role-specific product workspaces. */
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Workspace from "./pages/Workspace";

function App() {
  const [role, setRole] = useState<"landing" | "creator" | "advertiser">("landing");
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><Toaster richColors position="bottom-center" />{role === "landing" ? <Home onEnter={setRole} /> : <Workspace role={role} onExit={() => setRole("landing")} />}</ThemeProvider></ErrorBoundary>;
}

export default App;
