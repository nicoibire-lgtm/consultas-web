import { NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();

    // ✅ PRECIO FIJO
    const amount = 100000;

    if (!name) {
      return NextResponse.json({ ok: false, error: "missing name" }, { status: 400 });
    }

    if (!email || !email.includes("@")) {
      return NextResponse.json({ ok: false, error: "missing email" }, { status: 400 });
    }

    const url = process.env.MP_PREF_URL;
    if (!url) {
      return NextResponse.json(
        { ok: false, error: "missing_env", message: "MP_PREF_URL not set" },
        { status: 500 }
      );
    }

    // ✅ Generar ID de consulta (lo usa MP external_reference y Firestore doc id)
    const consultaId = `web_${Date.now()}`;

    // ✅ Identity Token (Cloud Run / Cloud Functions v2)
    const auth = new GoogleAuth();
    const client = await auth.getIdTokenClient(url);

    // google-auth-library a veces devuelve Headers() y a veces un objeto normal
    const headersObj = await client.getRequestHeaders();
    const authHeader =
      headersObj?.Authorization ||
      headersObj?.authorization ||
      (typeof headersObj?.get === "function"
        ? headersObj.get("authorization") || headersObj.get("Authorization")
        : "");

    if (!authHeader) {
      return NextResponse.json(
        { ok: false, error: "invalid_grant", message: "No se pudo obtener Identity Token (authorization vacío)" },
        { status: 401 }
      );
    }

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader, // 👈 MUY IMPORTANTE
        "x-admin-key": process.env.ADMIN_KEY || "", // opcional (si lo usás)
      },
      body: JSON.stringify({
        consultaId,
        title: "Consulta Jurídica",
        amount, // 100.000 fijo
        email,
        name,
      }),
    });

    const raw = await r.text();
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch {
      data = null;
    }

    if (!r.ok || !data?.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "cloud_run_error",
          status: r.status,
          statusText: r.statusText,
          raw,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      consultaId: data.consultaId || consultaId,
      preferenceId: data.preferenceId,
      init_point: data.init_point,
      sandbox_init_point: data.sandbox_init_point,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "server_error", message: e?.message || "unknown" },
      { status: 500 }
    );
  }
}
