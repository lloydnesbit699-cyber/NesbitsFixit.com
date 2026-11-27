(function () {
  function register() {
    var mc =
      (typeof document !== "undefined" && document.modelContext) ||
      (typeof navigator !== "undefined" && navigator.modelContext);
    if (!mc || typeof mc.registerTool !== "function") return;

    mc.registerTool({
      name: "world_status",
      description: "Reports whether the Crumbs World agent interface is live.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: true },
      execute: async function () {
        var r = await fetch("/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "world_status", arguments: {} },
          }),
        });
        var j = await r.json();
        return j.result;
      },
    });

    mc.registerTool({
      name: "search_site",
      description: "Searches Crumbs Vault site content and returns matching Markdown excerpts.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      annotations: { readOnlyHint: true },
      execute: async function (args) {
        var r = await fetch("/.well-known/search?q=" + encodeURIComponent(args.query || ""));
        var text = await r.text();
        return { content: [{ type: "text", text: text }] };
      },
    });

    mc.registerTool({
      name: "open_crumbs_world",
      description: "Opens the Crumbs World front door in this tab.",
      inputSchema: { type: "object", properties: {} },
      execute: async function () {
        window.location.href = "/crumbs-world/";
        return { content: [{ type: "text", text: "Opening Crumbs World." }] };
      },
    });
  }

  if (document.readyState === "complete") register();
  else window.addEventListener("load", register);
})();
