import { createBashTool } from "./tools/bash-tool.js";
import { createFileTools } from "./tools/file-tools.js";
import { createSearchTools } from "./tools/search-tools.js";

export function createMemoryTools(context) {
  return [
    ...createFileTools(context),
    ...createSearchTools(context),
    createBashTool(context),
  ];
}
