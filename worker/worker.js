export default {
  async fetch(request) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }

    const APPS_SCRIPT_WEBAPP_URL = "YOUR_APPS_SCRIPT_WEBAPP_URL";

    if (APPS_SCRIPT_WEBAPP_URL === "YOUR_APPS_SCRIPT_WEBAPP_URL") {
      return new Response(JSON.stringify({
        ok: false,
        error: "APPS_SCRIPT_WEBAPP_URL_NOT_SET"
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders
        }
      });
    }

    try {
      const bodyText = request.method === "POST" ? await request.text() : null;
      const queryString = new URL(request.url).searchParams.toString();
      const targetUrl = queryString
        ? `${APPS_SCRIPT_WEBAPP_URL}?${queryString}`
        : APPS_SCRIPT_WEBAPP_URL;

      const upstream = await fetch(targetUrl, {
        method: request.method,
        headers: {
          "Content-Type": request.headers.get("Content-Type") || "application/json"
        },
        body: request.method === "POST" ? bodyText : null
      });

      const text = await upstream.text();

      return new Response(text, {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
          ...corsHeaders
        }
      });
    } catch (error) {
      return new Response(JSON.stringify({
        ok: false,
        error: String(error && error.message ? error.message : error)
      }), {
        status: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ...corsHeaders
        }
      });
    }
  }
};
