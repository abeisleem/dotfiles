import { tool } from "@opencode-ai/plugin";

export default tool({
  description: "Fetches a URL and returns its content as markdown",
  args: {
    url: tool.schema.string().describe("The URL to fetch"),
  },
  async execute(args) {
    let url = args.url;
    if (!url.includes("markdown.new")) {
      url = `https://markdown.new/${url}`;
    }

    const response = await fetch(url);
    return await response.text();
  },
});
