export type ProductState = "primary" | "closed" | "open" | "side" | "detail" | "front" | "rear" | "packaging" | "other";

export type ProductReference = {
  storageKey: string;
  state: ProductState;
  sortOrder: number;
};

export type MaskSample = {
  frameIndex: number;
  isOccluded: boolean;
};

export type LucyStateWindow = {
  index: number;
  state: ProductState;
  referenceKey: string;
  startSeconds: number;
  endSeconds: number;
  startFrame: number;
  endFrame: number;
  promptSuffix: string;
  splitReason: "single-reference" | "tracked-transition";
};

type WindowInput = {
  startSeconds: number;
  endSeconds: number;
  frameRate: number;
  references: ProductReference[];
  masks: MaskSample[];
};

const stateDirections: Record<ProductState, string> = {
  primary: "Use the canonical reference; preserve its construction and details.",
  closed: "Use the closed reference: keep the lid fitted and the interior covered.",
  open: "Use the open reference: keep the lid removed or open and the interior visible.",
  side: "Use the side reference; preserve handles and viewing angle.",
  detail: "Use the detail reference; preserve markings and texture.",
  front: "Use the front reference; preserve front-facing geometry.",
  rear: "Use the rear reference; preserve rear-facing geometry.",
  packaging: "Use packaging only where it appears in the source.",
  other: "Use the supplied reference; preserve its visible geometry.",
};

function preferredReference(references: ProductReference[], state: ProductState) {
  return references.find((reference) => reference.state === state)
    ?? references.find((reference) => reference.state === "primary")
    ?? references[0]
    ?? null;
}

function stableTransitionFrame(masks: MaskSample[], startFrame: number, endFrame: number, minimumMarginFrames: number) {
  const candidates = masks
    .filter((mask) => mask.isOccluded && mask.frameIndex > startFrame && mask.frameIndex < endFrame - minimumMarginFrames)
    .map((mask) => mask.frameIndex)
    .sort((a, b) => a - b);
  if (!candidates.length) return null;

  // The first sustained hand/lid transition is the safest point to switch from
  // the closed reference to the open reference. Choosing the first candidate
  // avoids a later ingredient or utensil occlusion causing the lid to return.
  return candidates[0] ?? null;
}

export function buildLucyStatePlan(input: WindowInput): LucyStateWindow[] {
  const frameRate = Number.isFinite(input.frameRate) && input.frameRate > 0 ? input.frameRate : 30;
  const startFrame = Math.max(0, Math.floor(input.startSeconds * frameRate));
  const endFrame = Math.max(startFrame, Math.ceil(input.endSeconds * frameRate) - 1);
  const openReference = input.references.find((reference) => reference.state === "open") ?? null;
  const closedReference = input.references.find((reference) => reference.state === "closed")
    ?? preferredReference(input.references, "primary");
  if (!closedReference) throw new Error("The selected product needs a private reference image.");

  // Product creation stores its canonical photo as primary. When an open-state
  // photo is also present, that canonical image represents the closed starting
  // state unless the creator supplied an explicit closed image.
  const canonical: ProductReference = openReference && closedReference.state === "primary"
    ? { ...closedReference, state: "closed" }
    : closedReference;
  const minimumWindowFrames = Math.max(18, Math.round(frameRate));
  const observedTransitionFrame = openReference
    ? stableTransitionFrame(input.masks, startFrame, endFrame, minimumWindowFrames)
    : null;
  // A lid can be removed almost immediately. Preserve at least one second for
  // the closed reference, but do not discard that early observation and switch
  // much later during ingredient handling.
  const transitionFrame = observedTransitionFrame === null
    ? null
    : Math.max(startFrame + minimumWindowFrames, observedTransitionFrame);

  if (!openReference || transitionFrame === null) {
    return [{
      index: 0,
      state: canonical.state,
      referenceKey: canonical.storageKey,
      startSeconds: input.startSeconds,
      endSeconds: input.endSeconds,
      startFrame,
      endFrame,
      promptSuffix: stateDirections[canonical.state],
      splitReason: "single-reference",
    }];
  }

  const transitionSeconds = transitionFrame / frameRate;
  const firstEndSeconds = Math.max(input.startSeconds + 1, Math.min(input.endSeconds - 1, transitionSeconds));
  const secondStartSeconds = firstEndSeconds;
  if (firstEndSeconds - input.startSeconds < 1 || input.endSeconds - secondStartSeconds < 1) {
    return [{
      index: 0,
      state: canonical.state,
      referenceKey: canonical.storageKey,
      startSeconds: input.startSeconds,
      endSeconds: input.endSeconds,
      startFrame,
      endFrame,
      promptSuffix: stateDirections[canonical.state],
      splitReason: "single-reference",
    }];
  }

  return [
    {
      index: 0,
      state: canonical.state,
      referenceKey: canonical.storageKey,
      startSeconds: input.startSeconds,
      endSeconds: firstEndSeconds,
      startFrame,
      endFrame: Math.max(startFrame, transitionFrame - 1),
      promptSuffix: stateDirections[canonical.state],
      splitReason: "tracked-transition",
    },
    {
      index: 1,
      state: "open",
      referenceKey: openReference.storageKey,
      startSeconds: secondStartSeconds,
      endSeconds: input.endSeconds,
      startFrame: transitionFrame,
      endFrame,
      promptSuffix: stateDirections.open,
      splitReason: "tracked-transition",
    },
  ];
}

export function splitLucyStatePlanForProvider(
  plan: LucyStateWindow[],
  frameRate: number,
  maximumWindowSeconds = 15,
): LucyStateWindow[] {
  const safeFrameRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  const maximum = Number.isFinite(maximumWindowSeconds) && maximumWindowSeconds >= 1 ? maximumWindowSeconds : 15;
  const windows: LucyStateWindow[] = [];
  for (const window of plan) {
    let startSeconds = window.startSeconds;
    while (window.endSeconds - startSeconds > maximum + 0.001) {
      const endSeconds = Math.min(window.endSeconds, startSeconds + maximum);
      windows.push({
        ...window,
        index: windows.length,
        startSeconds,
        endSeconds,
        startFrame: Math.round(startSeconds * safeFrameRate),
        endFrame: Math.max(Math.round(startSeconds * safeFrameRate), Math.round(endSeconds * safeFrameRate) - 1),
      });
      startSeconds = endSeconds;
    }
    windows.push({
      ...window,
      index: windows.length,
      startSeconds,
      endSeconds: window.endSeconds,
      startFrame: Math.round(startSeconds * safeFrameRate),
      endFrame: Math.max(Math.round(startSeconds * safeFrameRate), Math.ceil(window.endSeconds * safeFrameRate) - 1),
    });
  }
  return windows;
}

export function withLucyStatePrompt(basePrompt: string, window: Pick<LucyStateWindow, "state" | "promptSuffix">) {
  return `${basePrompt}\n\nState: ${window.promptSuffix} Keep this state throughout this clip.`;
}
