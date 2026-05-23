interface AuthScreenProps {
  mode: "setup" | "unlock";
  password: string;
  error: string;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
}

export function AuthScreen({ mode, password, error, onPasswordChange, onSubmit }: AuthScreenProps) {
  const isSetup = mode === "setup";
  return (
    <div className="auth-page">
      <div className="auth-card">
        <h1>API Vault</h1>
        <p>{isSetup ? "Set a master password to encrypt your API keys." : "Enter your master password to unlock."}</p>
        <input
          type="password"
          placeholder={isSetup ? "Master password (8+ chars)" : "Master password"}
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && onSubmit()}
        />
        <button onClick={onSubmit}>{isSetup ? "Initialize Vault" : "Unlock"}</button>
        {error && <div className="error-msg">{error}</div>}
      </div>
    </div>
  );
}
