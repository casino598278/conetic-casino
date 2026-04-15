import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }

  reset = () => {
    this.setState({ error: null });
  };

  override render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: "var(--text)", textAlign: "center" }}>
          <h2 style={{ marginBottom: 12 }}>Something broke</h2>
          <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16 }}>
            {this.state.error.message}
          </p>
          <button
            className="primary"
            onClick={() => {
              this.reset();
              window.location.reload();
            }}
            style={{
              background: "var(--accent)",
              color: "#04101a",
              border: "none",
              borderRadius: 999,
              padding: "10px 22px",
              fontWeight: 700,
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
