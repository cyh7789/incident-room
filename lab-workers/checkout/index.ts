type CheckoutBehavior = "broken" | "healthy" | "concurrent";

interface VersionMetadata {
  id: string;
  tag?: string;
  timestamp?: string;
}

interface Env {
  CHECKOUT_BEHAVIOR?: string;
  CF_VERSION_METADATA: VersionMetadata;
}

const fixedCart = {
  cartId: "incident-room-fixed-cart",
  total: 42,
};

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function behaviorFor(env: Env): CheckoutBehavior {
  if (["broken", "healthy", "concurrent"].includes(env.CHECKOUT_BEHAVIOR ?? "")) {
    return env.CHECKOUT_BEHAVIOR as CheckoutBehavior;
  }
  throw new Error("CHECKOUT_BEHAVIOR must be broken, healthy, or concurrent.");
}

function versionTag(env: Env, behavior: CheckoutBehavior): string {
  return env.CF_VERSION_METADATA.tag ?? `checkout-${behavior}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const behavior = behaviorFor(env);
    const versionId = env.CF_VERSION_METADATA.id;
    const tag = versionTag(env, behavior);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        serviceId: "checkout",
        status: behavior === "healthy" ? "HEALTHY" : "DEGRADED",
        versionId,
        versionTag: tag,
        checkedAt: new Date().toISOString(),
      });
    }

    if (request.method === "POST" && url.pathname === "/checkout") {
      const body = (await request.json().catch(() => null)) as {
        cartId?: unknown;
        total?: unknown;
      } | null;
      if (body?.cartId !== fixedCart.cartId || body.total !== fixedCart.total) {
        return json({ message: "Only the fixed Incident Room cart is accepted." }, 400);
      }

      const healthy = behavior === "healthy";
      return json(
        {
          serviceId: "checkout",
          cartId: fixedCart.cartId,
          outcome: healthy ? "accepted" : "checkout_unavailable",
          versionId,
          versionTag: tag,
        },
        healthy ? 200 : 500,
      );
    }

    return json({ message: "Checkout lab endpoint not found." }, 404);
  },
};
