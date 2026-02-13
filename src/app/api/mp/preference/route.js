export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getVercelOidcToken } from "@vercel/oidc";

// Helper: exige env
function mustEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === "") throw new Error(`${name} missing`);
  return v;
}

// Helper: toma env con fallback
function env(name, fallbackName = null) {
  const v = process.env[name];
  if (v && String(v).trim() !== "") return String(v).trim();
  if (fallbackName) {
    const f = process.env[fallbackName];
    if (f && String(f).trim() !== "") return String(f).trim();
  }
  return "";
}

// 1) Vercel OIDC -> Google STS access_token
async function getGoogleAccessTokenFromVercelOIDC({ projectNumber, poolId, providerId, debug }) {
  const audience = `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;

  // Token OIDC emitido por Vercel
  const vercelOidc = await getVercelOidcToken();

  // Solo para debug: ver issuer/aud (sin exponer token completo)
  let oidcPayload = null;
  try {
    const parts = String(vercelOidc).split(".");
    if (parts.length >= 2) {
      const json = Buffer.from(parts[1], "base64").toString("utf8");
      oidcPayload = JSON.parse(json);
    }
  } catch {
    oidcPayload = null;
  }

  const stsUrl = "https://sts.googleapis.com/v1/token";

  const body = {
    audience,
    grantType: "urn:ietf:params:oauth:grant-type:token-exchange",
    requestedTokenType: "urn:ietf:params:oauth:token-type:access_token",
    scope: "https://www.googleapis.com/auth/cloud-platform",
    // Para Vercel OIDC, esto debe ser id_token
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
    return {
      ok: false,
      where: "sts",
      status: r.status,
      data,
      debug: debug
        ? {
            audience,
            oidc_issuer: oidcPayload?.iss,
            oidc_aud: oidcPayload?.aud,
            oidc_sub: oidcPayload?.sub,
          }
        : undefined,
    };
  }

  return {
    ok: true,
    accessToken: data.access_token,
    debug: debug
      ? {
          audience,
          oidc_issuer: oidcPayload?.iss,
          oidc_aud: oidcPayload?.aud,
          oidc_sub: oidcPayload?.sub,
        }
      : undefined,
  };
}

// 2) access_token -> generateIdToken del Service Account (IAMCredentials)
async function generateIdTokenForCloudRun(accessToken, serviceAccountEmail, audienceUrl) {
  const url =
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccountEmail)}:generateIdToken`;

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
    return { ok: false, where: "generateIdToken", status: r.status, data };
  }

  return { ok: true, idToken: data.token };
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();

    if (!name) return NextResponse.json({ ok: false, error: "missing name" }, { status: 400 });
    if (!email || !email.includes("@")) {
      return NextResponse.json({ ok: false, error: "missing email" }, { status: 400 });
    }

    const amount = 100000;
    const consultaId = `web_${Date.now()}`;

    // 🔎 Debug mode (si mandás {"debug":true} en el body)
    const debug = Boolean(body.debug);

    // ENVs (sin secretos)
    const projectNumber = env("GCP_PROJECT_NUMBER");
    const poolId = env("GCP_WIF_POOL_ID", "GCP_WORKLOAD_IDENTITY_POOL_ID");
    const providerId = env("GCP_WIF_PROVIDER_ID", "GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID");
    const serviceAccount = env("GCP_SERVICE_ACCOUNT", "GCP_SERVICE_ACCOUNT_EMAIL"); // 👈 clave: fallback
    const targetUrl = env("GCP_TARGET_URL", "MP_PREF_URL");
    const audienceUrl = env("GCP_AUDIENCE", "GCP_TARGET_URL") || targetUrl;

    // ADMIN KEY sí es secreta, pero solo validamos existencia
    const adminKey = env("ADMIN_KEY");
    if (!adminKey) throw new Error("ADMIN_KEY missing");

    // Validaciones de env mínimas
    if (!projectNumber) throw new Error("GCP_PROJECT_NUMBER missing");
    if (!poolId) throw new Error("GCP_WIF_POOL_ID missing");
    if (!providerId) throw new Error("GCP_WIF_PROVIDER_ID missing");
    if (!serviceAccount) throw new Error("GCP_SERVICE_ACCOUNT missing");
    if (!targetUrl) throw new Error("GCP_TARGET_URL missing");

    // 1) STS
    const sts = await getGoogleAccessTokenFromVercelOIDC({
      projectNumber,
      poolId,
      providerId,
      debug,
    });

    if (!sts.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "sts_exchange_failed",
          details: sts,
          env: debug
            ? {
                projectNumber,
                poolId,
                providerId,
                serviceAccount,
                targetUrl,
                audienceUrl,
                hasAdminKey: Boolean(adminKey),
              }
            : undefined,
        },
        { status: 500 }
      );
    }

    // 2) generateIdToken
    const idt = await generateIdTokenForCloudRun(sts.accessToken, serviceAccount, audienceUrl);
    if (!idt.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "generate_id_token_failed",
          details: idt,
          env: debug
            ? {
                projectNumber,
                poolId,
                providerId,
                serviceAccount,
                targetUrl,
                audienceUrl,
              }
            : undefined,
          stsDebug: debug ? sts.debug : undefined,
        },
        { status: 500 }
      );
    }

    // 3) Call Cloud Run
    const r = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idt.idToken}`,
        "x-admin-key": adminKey,
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
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: "server_error",
        message: e?.message || "unknown",
        stack: e?.stack,
      },
      { status: 500 }
    );
  }
}
