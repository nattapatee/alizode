import { Component, StrictMode } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/global.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: "#ff5050", background: "#0a0a0a", fontFamily: "monospace", fontSize: 13, whiteSpace: "pre-wrap", height: "100vh", overflow: "auto" }}>
          <h2 style={{ color: "#ff8844", margin: "0 0 16px" }}>React Error</h2>
          <div style={{ color: "#ccc" }}>{this.state.error.message}</div>
          <pre style={{ marginTop: 16, fontSize: 11, color: "#888" }}>{this.state.error.stack}</pre>
          <button onClick={() => this.setState({ error: null })} style={{ marginTop: 16, padding: "8px 16px", background: "#222", color: "#5af0c8", border: "1px solid #5af0c8", borderRadius: 6, cursor: "pointer", fontFamily: "monospace" }}>
            retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
