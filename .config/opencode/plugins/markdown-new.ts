import type { Plugin } from "@opencode-ai/plugin";

export const MarkdownNewPlugin: Plugin = async () => {
  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool === "webfetch") {
        const url = output.args.url;
        if (url && !url.includes("markdown.new")) {
          output.args.url = `https://markdown.new/${url}`;
        }
      }
    },
  };
};
