"use client";

import { useMemo, useState } from "react";

export default function Home() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  // NUEVO: turno
  const [day, setDay] = useState("Lunes");
  const [time, setTime] = useState("16:00");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const PRICE_ARS = 100000;

  const DAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes"];

  const TIMES = useMemo(() => {
    // 16:00 a 19:30, cada 30 min (último turno arranca 19:30)
    const out = [];
    let h = 16;
    let m = 0;
    while (h < 20) {
      const label = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      // cortamos en 19:30
      if (h === 19 && m === 30) {
        out.push(label);
        break;
      }
      out.push(label);
      m += 30;
      if (m >= 60) {
        m = 0;
        h += 1;
      }
    }
    return out;
  }, []);

  const priceLabel = useMemo(() => {
    try {
      return PRICE_ARS.toLocaleString("es-AR");
    } catch {
      return String(PRICE_ARS);
    }
  }, [PRICE_ARS]);

  const selectedSlotLabel = useMemo(() => {
    return `${day} ${time} hs (AR)`;
  }, [day, time]);

  async function onPay(e) {
    e.preventDefault();
    setErr("");

    const cleanName = String(name || "").trim();
    const cleanEmail = String(email || "").trim().toLowerCase();

    if (!cleanName) return setErr("Por favor ingresá tu nombre y apellido.");
    if (!cleanEmail || !cleanEmail.includes("@")) return setErr("Por favor ingresá un email válido.");
    if (!day) return setErr("Por favor elegí un día.");
    if (!time) return setErr("Por favor elegí un horario.");

    setLoading(true);
    try {
      const r = await fetch("/api/mp/preference", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: cleanName,
          email: cleanEmail,
          slot: { day, time }, // queda listo para usar en backend
        }),
      });

      const data = await r.json().catch(() => null);

      if (!r.ok || !data?.ok) {
        throw new Error(data?.message || data?.error || "No se pudo generar el link de pago.");
      }

      if (!data.init_point) {
        console.error("init_point missing:", data);
        throw new Error("No se pudo generar el link de pago (init_point missing).");
      }

      window.location.href = data.init_point;
    } catch (e2) {
      setErr(e2?.message || "Error generando el link de pago.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        padding: 18,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        background:
          "radial-gradient(1200px 600px at 20% 10%, rgba(17,24,39,0.10), transparent 60%), radial-gradient(900px 450px at 80% 20%, rgba(234,179,8,0.12), transparent 55%), linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 560 }}>
        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 18,
            padding: 22,
            background: "rgba(255,255,255,0.9)",
            boxShadow: "0 18px 50px rgba(0,0,0,0.10)",
            backdropFilter: "blur(6px)",
          }}
        >
          {/* HEADER */}
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 14 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                border: "1px solid #e5e7eb",
                background: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                boxShadow: "0 10px 24px rgba(0,0,0,0.08)",
                flexShrink: 0,
              }}
              title="Merdini Ibire & Asociados"
            >
              <img
                src="/logo.png"
                alt="Merdini Ibire & Asociados"
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            </div>

            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#111827", letterSpacing: -0.2 }}>
                Consulta Jurídica Online
              </h1>
              <p style={{ margin: "6px 0 0 0", color: "#4b5563", lineHeight: 1.35, fontSize: 13 }}>
                Merdini Ibire &amp; Asociados
              </p>
            </div>
          </div>

          {/* INFO */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 14,
                padding: 14,
                background: "#ffffff",
              }}
            >
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Precio único</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#111827" }}>${priceLabel} ARS</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>Pago por Mercado Pago</div>
            </div>

            <div
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 14,
                padding: 14,
                background: "#ffffff",
              }}
            >
              <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>Turno elegido</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>{selectedSlotLabel}</div>
              <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>Duración: 30 min</div>
            </div>
          </div>

          {/* FORM */}
          <form onSubmit={onPay}>
            <label style={{ display: "block", fontSize: 13, color: "#374151", marginBottom: 6 }}>
              Nombre y apellido
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Juan Pérez"
              autoComplete="name"
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                marginBottom: 12,
                outline: "none",
                background: "#fff",
              }}
            />

            <label style={{ display: "block", fontSize: 13, color: "#374151", marginBottom: 6 }}>
              Email
            </label>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              autoComplete="email"
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                marginBottom: 12,
                outline: "none",
                background: "#fff",
              }}
            />

            {/* NUEVO: selector de turno */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 13, color: "#374151", marginBottom: 6 }}>
                  Día
                </label>
                <select
                  value={day}
                  onChange={(e) => setDay(e.target.value)}
                  style={{
                    width: "100%",
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    outline: "none",
                    background: "#fff",
                  }}
                >
                  {DAYS.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: "block", fontSize: 13, color: "#374151", marginBottom: 6 }}>
                  Horario
                </label>
                <select
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  style={{
                    width: "100%",
                    padding: 12,
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    outline: "none",
                    background: "#fff",
                  }}
                >
                  {TIMES.map((t) => (
                    <option key={t} value={t}>
                      {t} hs
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {err ? (
              <div
                style={{
                  marginBottom: 12,
                  padding: 10,
                  borderRadius: 12,
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  color: "#b91c1c",
                  fontSize: 13,
                }}
              >
                {err}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: "100%",
                padding: 12,
                borderRadius: 12,
                border: "none",
                cursor: loading ? "not-allowed" : "pointer",
                fontWeight: 800,
                fontSize: 15,
                background: "#111827",
                color: "white",
                boxShadow: "0 12px 26px rgba(17,24,39,0.22)",
              }}
            >
              {loading ? "Generando link..." : "Pagar consulta"}
            </button>

            <div style={{ marginTop: 14, fontSize: 12, color: "#6b7280", lineHeight: 1.45 }}>
              Luego del pago te llega un email de confirmación del estudio. El link de Zoom se genera automáticamente.
            </div>
          </form>
        </div>

        <div style={{ marginTop: 12, textAlign: "center", fontSize: 11, color: "#9ca3af" }}>
          © {new Date().getFullYear()} Merdini Ibire &amp; Asociados
        </div>
      </div>
    </main>
  );
}
