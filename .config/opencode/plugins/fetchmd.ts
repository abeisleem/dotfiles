import { Plugin } from "@opencode-ai/plugin"

export default Plugin.define({
  id: "abe.fetchmd",
  setup: async (ctx) => {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: "fetchmd",
        description: "Fetches a URL and returns its content as markdown",
        input: {
          type: "object",
          properties: {
            url: { type: "string", description: "The URL to fetch" },
          },
          required: ["url"],
          additionalProperties: false,
        },
        async execute(input) {
          const args = input as { url: string }
          const url = args.url.includes("markdown.new") ? args.url : `https://markdown.new/${args.url}`
          const response = await fetch(url)
          return { content: await response.text() }
        },
      })
    })
  },
})
