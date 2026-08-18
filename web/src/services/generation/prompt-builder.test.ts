import { buildPlacementReplacementPrompt } from "./prompt-builder";

const prompt = buildPlacementReplacementPrompt(
  { objectLabel: "Rice cooker", category: "Kitchen appliances", startSeconds: 7, endSeconds: 19 },
  { name: "Model A", brand: "Auris", description: "A matte white compact rice cooker." },
);

if (!prompt.includes("Rice cooker") || !prompt.includes("00:07 to 00:19") || !prompt.includes("Auris Model A")) {
  throw new Error("Prompt builder did not preserve required placement and product context.");
}
