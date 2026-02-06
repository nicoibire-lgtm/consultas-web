import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const body = await req.json();

    const consultaId = body.consultaId;
    const title = body.title || "Consulta Jurídica Online";
    const amount = Number(body.amount || 0);

    if (!consultaId || !amount || amount <= 0) {
      return NextResponse.json({ ok: false, error: "missing consultaId/amount" }, { status: 400 });
    }

    const url = process.env.CREATE_MP_PREFERENCE_URL;
    const adminKey = process.env.ADMIN_KEY;

    if (!url) return NextResponse.json({ ok: false, error: "missing CREATE_MP_PREFERENCE_URL" }, { status: 500 });
    if (!adminKey) return NextResponse.json({ ok: false, error: "missing ADMIN_KEY" }, { status: 500 });

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": adminKey,
      },
      body: JSON.stringify({ consultaId, title, amount }),
    });

    const data = await r.json();
    return NextResponse.json(data, { status: 200 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
