// Deployed to the "gut log" Supabase project (iftxfnhwdyqzllzmjoca) with
// verify_jwt disabled - Stripe calls this directly (not a signed-in user),
// so it authenticates the request via the Stripe-Signature header instead
// of a JWT, same pattern as send-reminders' CRON_SHARED_SECRET check.
//
// Requires two manually-configured secrets this deploy tool can't set
// itself (Supabase Edge Function secrets are write-only, dashboard-only -
// open this project's Edge Functions -> Secrets to add them):
//   - STRIPE_WEBHOOK_SECRET: the signing secret for the Stripe webhook
//     endpoint that points at this function's URL (Stripe Dashboard ->
//     Developers -> Webhooks -> this endpoint -> Signing secret, starts
//     with "whsec_"). Until it's set, every invocation returns a clean
//     500 "Webhook not configured" rather than processing anything.
//   - STRIPE_SECRET_KEY: this app's checkout buttons are static Stripe
//     Payment Links (js/pricing.js), which never attach custom metadata
//     to the resulting Checkout Session - so `session.metadata.plan` is
//     always empty in practice, and resolvePlanFromPaymentLink() below
//     (which needs this key to call the Stripe API) is the ONLY path
//     that ever resolves which plan was purchased. Despite reading as an
//     optional fallback in the code, this key is required for premium
//     upgrades to work at all, not just a nice-to-have.
//
// Both were confirmed missing/required by a live probe against the
// deployed function (a request with a bogus signature) during a
// production-readiness audit - see that audit's notes for how to verify
// this after adding the secrets.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Payment Link URL -> plan key. Static Stripe Payment Links can't carry
// custom metadata through checkout, so when metadata.plan is missing we
// resolve the plan by looking up which of these links created the session.
const PAYMENT_LINK_PLANS: Record<string, string> = {
  "https://buy.stripe.com/4gMbJ3d8a2ei0tS8Me97G05": "monthly",
  "https://buy.stripe.com/00w4gBece8CGb8wbYq97G04": "annual",
  "https://buy.stripe.com/5kQbJ35FI3imfoMgeG97G02": "lifetime",
};

async function resolvePlanFromPaymentLink(paymentLinkId: string): Promise<string | null> {
  const secretKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!secretKey) return null;
  try {
    const res = await fetch(`https://api.stripe.com/v1/payment_links/${paymentLinkId}`, {
      headers: { "Authorization": `Bearer ${secretKey}` },
    });
    if (!res.ok) return null;
    const link = await res.json();
    return PAYMENT_LINK_PLANS[link.url] || null;
  } catch (e) {
    console.error("payment link lookup failed", e);
    return null;
  }
}

async function verifyStripeSignature(payload: string, sigHeader: string, secret: string): Promise<boolean> {
  const parts = Object.fromEntries(sigHeader.split(",").map((p) => p.split("=")));
  const timestamp = parts["t"];
  const sig = parts["v1"];
  if (!timestamp || !sig) return false;
  const signedPayload = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const expected = Array.from(new Uint8Array(sigBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return expected === sig;
}

Deno.serve(async (req: Request) => {
  const payload = await req.text();
  const sig = req.headers.get("Stripe-Signature") || "";
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";

  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET not configured");
    return new Response("Webhook not configured", { status: 500 });
  }

  const valid = await verifyStripeSignature(payload, sig, secret);
  if (!valid) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const userId = session.metadata?.user_id || session.client_reference_id;
      let plan = session.metadata?.plan;
      if (!plan && session.payment_link) {
        plan = await resolvePlanFromPaymentLink(session.payment_link);
      }
      if (userId && plan) {
        await supabaseAdmin.from("profiles").upsert({
          id: userId,
          tier: plan,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription || null,
        });
      } else {
        console.error("checkout.session.completed missing userId or plan", { userId, plan, sessionId: session.id });
      }
    } else if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object;
      await supabaseAdmin.from("profiles").update({ tier: "free" }).eq("stripe_subscription_id", sub.id);
    } else if (event.type === "customer.subscription.updated") {
      const sub = event.data.object;
      if (sub.status === "canceled" || sub.status === "unpaid") {
        await supabaseAdmin.from("profiles").update({ tier: "free" }).eq("stripe_subscription_id", sub.id);
      }
    }
  } catch (e) {
    console.error("webhook handling error", e);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
