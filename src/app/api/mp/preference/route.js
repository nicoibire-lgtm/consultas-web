export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getVercelOidcToken } from "@vercel/oidc";

function mustEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === "") throw new Error(`${name} missing`);
  return v;
}

// 1) Vercel OIDC -> Google STS access_token (Workload Identity Federation)
async function getGoogleAccessTokenFromVercelOIDC() {
  const projectNumber = mustEnv("GCP_PROJECT_NUMBER");
  const poolId = mustEnv("GCP_WIF_POOL_ID");
  const providerId = mustEnv("GCP_WIF_PROVIDER_ID");

  const audience = `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;

  const vercelOidc = await getVercelOidcToken();

  const stsUrl = "https://sts.googleapis.com/v1/token";

  // ✅ JSON consistente. OIDC token => subjectTokenType = id_token
  const body = {
    audience,
    grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
    requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
    scope: "https://www.googleapis.com/auth/cloud-platform",
    subjectTokenType: "urn:ietf:params:oauth:token-type:id_token",
    subjectToken: vercelOidc,
  };

  const r = await fetch(stsUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await r.json().catch(() => null);

  if (!r.ok || !data?.access_token) {
    return { ok: false, status: r.status, data };
  }

  return { ok: true, accessToken: data.access_token };
}

// 2) access_token -> generar ID token del Service Account para invocar Cloud Run privado
async function generateIdTokenForCloudRun(accessToken, audienceUrl) {
  const serviceAccount = mustEnv("GCP_SERVICE_ACCOUNT"); // email del SA

  const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(
    serviceAccount
  )}:generateIdToken`;

  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      audience: audienceUrl,
      includeEmail: true,
    }),
  });

  const data = await r.json().catch(() => null);

  if (!r.ok || !data?.token) {
    return { ok: false, status: r.status, data };
  }

  return { ok: true, idToken: data.token };
}

export async function POST(req) {
  try {
    const ADMIN_KEY = mustEnv("ADMIN_KEY");

    const targetUrl = mustEnv("GCP_TARGET_URL"); // https://createmppreference-...run.app
    const audience = mustEnv("GCP_AUDIENCE"); // normalmente IGUAL a targetUrl

    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });

    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();

    if (!name) return NextResponse.json({ ok: false, error: "missing_name" }, { status: 400 });
    if (!email || !email.includes("@"))
      return NextResponse.json({ ok: false, error: "missing_email" }, { status: 400 });

    // ✅ Precio real fijo (producción)
    let amount = 100000;

    // ✅ TEST MODE ultra-seguro: SOLO si debug=true + x-admin-key correcta + email permitido
    const debug = body.debug === true;
    const adminHeader = String(req.headers.get("x-admin-key") || "");
    const allowedTestEmails = new Set([
      "estudiojuridico@merdini-ibire.com.ar",
      // si querés agregar otro tuyo, lo sumás acá:
      // "nico@tudominio.com.ar",
    ]);

    if (debug) {
      if (adminHeader !== ADMIN_KEY) {
        return NextResponse.json({ ok: false, error: "debug_not_allowed" }, { status: 403 });
      }
      if (!allowedTestEmails.has(email)) {
        return NextResponse.json({ ok: false, error: "debug_email_not_allowed" }, { status: 403 });
      }
      // ✅ monto test (por defecto 1). Permitimos override para que elijas 10/100/etc.
      const wanted = Number(body.testAmount ?? 1);
      amount = Number.isFinite(wanted) && wanted > 0 ? wanted : 1;
    }

    const consultaId = `web_${Date.now()}`;

    // 1) STS
    const sts = await getGoogleAccessTokenFromVercelOIDC();
    if (!sts.ok) {
      return NextResponse.json({ ok: false, error: "sts_exchange_failed", details: sts }, { status: 500 });
    }

    // 2) ID token
    const idt = await generateIdTokenForCloudRun(sts.accessToken, audience);
    if (!idt.ok) {
      return NextResponse.json({ ok: false, error: "generate_id_token_failed", details: idt }, { status: 500 });
    }

    // 3) Call Cloud Run
    const r = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idt.idToken}`,
        "x-admin-key": ADMIN_KEY,
      },
      body: JSON.stringify({
        consultaId,
        title: "Consulta Jurídica",
        amount,
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
        { ok: false, error: "cloud_run_error", status: r.status, statusText: r.statusText, raw },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      consultaId: data.consultaId || consultaId,
      preferenceId: data.preferenceId,
      init_point: data.init_point,
      sandbox_init_point: data.sandbox_init_point,
      amount_used: amount, // útil para ver si fue test o real
      debug_used: debug,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: "server_error", message: e?.message || "unknown" },
      { status: 500 }
    );
  }
}
