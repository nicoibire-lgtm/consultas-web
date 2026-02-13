export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getVercelOidcToken } from "@vercel/oidc";
import { ExternalAccountClient, Impersonated } from "google-auth-library";

function mustEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === "") throw new Error(`${name} missing`);
  return String(v).trim();
}

// 1) Vercel OIDC -> Google WIF (ExternalAccountClient) -> Impersonated -> ID Token para Cloud Run
async function getCloudRunIdToken(targetAudienceUrl) {
  const projectNumber = mustEnv("GCP_PROJECT_NUMBER");
  const poolId = mustEnv("GCP_WIF_POOL_ID");
  const providerId = mustEnv("GCP_WIF_PROVIDER_ID");
  const serviceAccount = mustEnv("GCP_SERVICE_ACCOUNT"); // email del SA

  const audience = `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;

  // Cliente externo (WIF) que usa el token OIDC de Vercel como subject token
  const externalClient = ExternalAccountClient.fromJSON({
    type: "external_account",
    audience,
    subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
    token_url: "https://sts.googleapis.com/v1/token",
    service_account_impersonation_url: `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${serviceAccount}:generateAccessToken`,
    subject_token_supplier: {
      // Vercel provee el OIDC token en runtime (x-vercel-oidc-token)
      getSubjectToken: getVercelOidcToken,
    },
  });

  // Impersonación del service account para poder pedir ID token (Cloud Run)
  const impersonated = new Impersonated({
    sourceClient: externalClient,
    targetPrincipal: serviceAccount,
    lifetime: 300, // segundos
    delegates: [],
    targetScopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const idToken = await impersonated.fetchIdToken(targetAudienceUrl);
  if (!idToken) throw new Error("Failed to fetch ID token");
  return idToken;
}

export async function POST(req) {
  try {
    const ADMIN_KEY = mustEnv("ADMIN_KEY");
    const targetUrl = mustEnv("GCP_TARGET_URL"); // ej: https://createmppreference-....run.app
    const audienceUrl = mustEnv("GCP_AUDIENCE"); // normalmente igual al targetUrl

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
    }

    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();

    const amount = 100000; // precio fijo

    if (!name) return NextResponse.json({ ok: false, error: "missing_name" }, { status: 400 });
    if (!email || !email.includes("@")) {
      return NextResponse.json({ ok: false, error: "missing_email" }, { status: 400 });
    }

    const consultaId = `web_${Date.now()}`;

    // 1) Conseguir ID token para Cloud Run privado usando WIF (Vercel OIDC)
    const idToken = await getCloudRunIdToken(audienceUrl);

    // 2) Llamar Cloud Run
    const r = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
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
        {
          ok: false,
          error: "cloud_run_error",
          status: r.status,
          statusText: r.statusText,
          raw,
        },
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
        // esto ayuda MUCHO a diagnosticar en Vercel logs
        stack: e?.stack || "",
      },
      { status: 500 }
    );
  }
}
