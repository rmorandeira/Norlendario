// Thin wrapper over Resend's REST API — no SDK dependency needed, just fetch.
// No-ops (logs a warning) if RESEND_API_KEY isn't set, so the app still runs
// locally without email configured.

async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set — skipping email send to", to);
    return { skipped: true };
  }

  const from = process.env.RESEND_FROM || "Norlendario <onboarding@resend.dev>";
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from, to: [to], subject, html })
  });

  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Resend API error ${r.status}: ${body}`);
  }
  return r.json();
}

module.exports = { sendEmail };
