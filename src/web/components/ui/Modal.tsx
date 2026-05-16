"use client"

interface ModalProps {
  title: string
  children: React.ReactNode
  onCancel: () => void
  onConfirm: () => void
  confirmLabel?: string
  danger?: boolean
}

export function Modal({ title, children, onCancel, onConfirm, confirmLabel = "Confirm", danger }: ModalProps) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999,
    }}>
      <div style={{
        background: "var(--bg1)", border: "1px solid var(--border)",
        borderRadius: 10, padding: "24px", width: "100%", maxWidth: 400,
      }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>{title}</div>
        <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 20 }}>{children}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
          <button onClick={onCancel} style={{
            background: "var(--bg3)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "8px", color: "var(--text)", cursor: "pointer", fontSize: 13,
          }}>
            Cancel
          </button>
          <button onClick={onConfirm} style={{
            background: danger ? "var(--red)" : "var(--green)", border: "none",
            borderRadius: 8, padding: "8px", color: "#000", cursor: "pointer",
            fontWeight: 600, fontSize: 13,
          }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
