interface Env {
  CF_VERSION_METADATA: {
    id: string;
    tag?: string;
    timestamp?: string;
  };
}

function json(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        serviceId: "payment",
        status: "HEALTHY",
        versionId: env.CF_VERSION_METADATA.id,
        versionTag: env.CF_VERSION_METADATA.tag ?? "payment-healthy",
        checkedAt: new Date().toISOString(),
      });
    }
    return json({ message: "Payment lab endpoint not found." }, 404);
  },
};
