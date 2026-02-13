export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getVercelOidcToken } from "@vercel/oidc";

function mustEnv(name) {
  const v = process.env[name];
  if (!v || String(v).trim() === "") {
    throw new Error(`${name} missing`);
  }
  return v;
}

/**
 * 1) Vercel OIDC -> Google STS access_token
 */
async function getGoogleAccessTokenFromVercelOIDC() {
  const projectNumber = mustEnv("GCP_PROJECT_NUMBER");
  const poolId = mustEnv("GCP_WIF_POOL_ID");
  const providerId = mustEnv("GCP_WIF_PROVIDER_ID");

  const audience = `//iam.googleapis.com/projects/${projectNumber}/locations/global/workloadIdentityPools/${poolId}/providers/${providerId}`;

  const vercelOidc = await getVercelOidcToken();

  const stsUrl = "https://sts.googleapis.com/v1/token";

  const params = new URLSearchParams({
    audience,
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
    scope: "https://www.googleapis.com/auth/cloud-platform",
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    subject_token: vercelOidc,
  });

  const r = await fetch(stsUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await r.json().catch(() => null);

  if (!r.ok || !data?.access_token) {
    return { ok: false, status: r.status, data };
  }

  return { ok: true, accessToken: data.access_token };
}

/**
 * 2) access_token -> ID Token del Service Account (Cloud Run privado)
 */
async function generateIdTokenForCloudRun(accessToken, audienceUrl) {
  const serviceAccount = mustEnv("GCP_SERVICE_ACCOUNT");

  const url =
    `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(serviceAccount)}:generateIdToken`;

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

/**
 * ENDPOINT PRINCIPAL
 */
export async function POST(req) {
  try {
    const ADMIN_KEY = mustEnv("ADMIN_KEY");
    const targetUrl = mustEnv("GCP_TARGET_URL");
    const audience = mustEnv("GCP_AUDIENCE");

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json(
        { ok: false, error: "invalid_json" },
        { status: 400 }
      );
    }

    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const amount = 100000;

    if (!name) {
      return NextResponse.json(
        { ok: false, error: "missing name" },
        { status: 400 }
      );
    }

    if (!email || !email.includes("@")) {
      return NextResponse.json(
        { ok: false, error: "missing email" },
        { status: 400 }
      );
    }

    const consultaId = `web_${Date.now()}`;

    // 1) STS
    const sts = await getGoogleAccessTokenFromVercelOIDC();
    if (!sts.ok) {
      return NextResponse.json(
        { ok: false, error: "sts_exchange_failed", details: sts },
        { status: 500 }
      );
    }

    // 2) ID Token
    const idt = await generateIdTokenForCloudRun(sts.accessToken, audience);
    if (!idt.ok) {
      return NextResponse.json(
        { ok: false, error: "generate_id_token_failed", details: idt },
        { status: 500 }
      );
    }

    // 3) Llamar Cloud Run privado
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
      },
      { status: 500 }
    );
  }
}
