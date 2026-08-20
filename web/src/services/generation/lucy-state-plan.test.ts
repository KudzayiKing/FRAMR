import { buildLucyStatePlan, splitLucyStatePlanForProvider, withLucyStatePrompt } from "./lucy-state-plan";

const canonicalOnly = buildLucyStatePlan({
  startSeconds: 0,
  endSeconds: 5,
  frameRate: 30,
  references: [{ storageKey: "products/user/canonical.jpg", state: "primary", sortOrder: 0 }],
  masks: [],
});
if (canonicalOnly.length !== 1 || canonicalOnly[0]?.referenceKey !== "products/user/canonical.jpg" || canonicalOnly[0]?.splitReason !== "single-reference") {
  throw new Error("Canonical product-state planning did not preserve the single-reference fallback.");
}

const stateful = buildLucyStatePlan({
  startSeconds: 0,
  endSeconds: 8,
  frameRate: 30,
  references: [
    { storageKey: "products/user/closed.jpg", state: "closed", sortOrder: 0 },
    { storageKey: "products/user/open.jpg", state: "open", sortOrder: 1 },
  ],
  masks: [
    { frameIndex: 100, isOccluded: true },
    { frameIndex: 118, isOccluded: true },
    { frameIndex: 136, isOccluded: true },
  ],
});
if (stateful.length !== 2 || stateful[0]?.state !== "closed" || stateful[1]?.state !== "open" || stateful[0]?.endSeconds !== stateful[1]?.startSeconds) {
  throw new Error("Closed-to-open product-state planning did not create contiguous safe windows.");
}

const providerSafe = splitLucyStatePlanForProvider([
  {
    index: 0,
    state: "open",
    referenceKey: "products/user/without-lid.jpg",
    startSeconds: 1,
    endSeconds: 33.583,
    startFrame: 60,
    endFrame: 2015,
    promptSuffix: "Keep the lid removed.",
    splitReason: "tracked-transition",
  },
], 60);
if (providerSafe.length !== 3 || providerSafe.some((window) => window.endSeconds - window.startSeconds > 15.001) || providerSafe[0]?.startSeconds !== 1 || providerSafe.at(-1)?.endSeconds !== 33.583 || providerSafe.some((window) => window.state !== "open" || window.referenceKey !== "products/user/without-lid.jpg")) {
  throw new Error("Provider-safe state-window chunking did not preserve contiguous open-pot reference guidance.");
}

const statePrompt = withLucyStatePrompt("Replace the yellow pot.", stateful[1]!);
if (!statePrompt.includes("lid removed") || !statePrompt.includes("Replace the yellow pot.")) {
  throw new Error("State-specific Lucy prompt did not preserve the edit instruction and open-state constraint.");
}

const primaryAndOpen = buildLucyStatePlan({
  startSeconds: 0,
  endSeconds: 8,
  frameRate: 30,
  references: [
    { storageKey: "products/user/with-lid.jpg", state: "primary", sortOrder: 0 },
    { storageKey: "products/user/without-lid.jpg", state: "open", sortOrder: 1 },
  ],
  masks: [
    { frameIndex: 30, isOccluded: true },
    { frameIndex: 180, isOccluded: true },
  ],
});
if (primaryAndOpen.length !== 2 || primaryAndOpen[0]?.state !== "closed" || primaryAndOpen[0]?.referenceKey !== "products/user/with-lid.jpg" || primaryAndOpen[0]?.splitReason !== "tracked-transition" || primaryAndOpen[1]?.startFrame !== 30) {
  throw new Error("Primary-plus-open cookware planning did not use the lid-on image before the first tracked transition.");
}

const primaryAndOpenWithoutTransition = buildLucyStatePlan({
  startSeconds: 0,
  endSeconds: 8,
  frameRate: 30,
  references: [
    { storageKey: "products/user/with-lid.jpg", state: "primary", sortOrder: 0 },
    { storageKey: "products/user/without-lid.jpg", state: "open", sortOrder: 1 },
  ],
  masks: [],
});
if (primaryAndOpenWithoutTransition.length !== 1 || primaryAndOpenWithoutTransition[0]?.state !== "closed") {
  throw new Error("Primary-plus-open cookware planning must keep the closed canonical state until a real transition is tracked.");
}
