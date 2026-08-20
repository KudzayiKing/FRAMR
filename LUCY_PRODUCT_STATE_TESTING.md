# Lucy Product-State Preview Testing

## Purpose

This guide tests FRAMR's **state-aware Lucy workflow**. It keeps the source video and original audio immutable while using short, state-consistent Lucy windows for product changes such as a pot moving from **closed** to **open**.

## One-time database setup

Apply the following migrations in the Supabase SQL Editor, in order:

1. `supabase/migrations/0010_shot_aware_lucy_windows.sql`
2. `supabase/migrations/0011_product_state_references.sql`
3. `supabase/migrations/0012_lucy_state_windows.sql`

The first migration persists safe source-shot bounds. The second permits `closed` and `open` private product references. The third persists resumable Lucy state windows and their private intermediate outputs.

## Product preparation

Create a product asset in FRAMR with one clear canonical image. For cookware or other products whose appearance changes during use, add only the extra views visible in the source video:

| Product view | Label in the product dialog | Typical use |
|---|---|---|
| Product with fitted lid | `Closed / canonical view` | Start of a cooking sequence |
| Product with lid removed | `Open state` | Ingredients are added or interior is visible |
| Handle or side visible | `Side / handle view` | Camera rotates or side becomes dominant |
| Branding or texture close-up | `Detail / label view` | A distinct product feature is visible |

Use two to four high-quality product images in total. Each image must be JPEG, PNG, or WebP and no larger than 10 MB. The images remain in the private `products` bucket.

## Automatic behavior

After the creator selects an object and product, FRAMR uses the existing SAM target masks to find the continuous product-visible interval. If both `closed` and `open` references exist, FRAMR looks for a safe tracked occlusion—such as a hand covering the pot while moving the lid—and creates contiguous Lucy windows at that point. The first window receives the closed reference; the following window receives the open reference.

If no reliable transition exists, FRAMR uses the canonical reference for one uninterrupted Lucy window. It never invents a split merely because multiple product photos were uploaded.

## Controlled preview test

1. Start the frame worker for automatic SAM tracking.
2. Start the generation worker only when ready to create a Lucy preview.
3. Upload/select the cooking video, select the detected pot, and choose the product that contains the closed and open images.
4. Create one preview.
5. Confirm that the red pot remains present for the complete tracked interval and that the lid state follows the source action.

The generation worker validates that every Lucy result has a readable duration close to its planned state window. It will not publish a partially generated sequence. The final render is also checked for duration integrity and preserves the source audio.

## Expected fallback behavior

If a state-window provider result fails or has an incompatible duration, FRAMR marks the version failed rather than publishing a partial video. Creator selection and private product references remain saved for a later retry.

## Commands

```bash
# Frame worker: automatic target tracking
cd /Users/kudzayi/Developer/FRAMR/worker
set -a; source .env; set +a
.venv/bin/python -m framr_worker.frame_cli

# Lucy preview worker: only run when intentionally testing a preview
cd /Users/kudzayi/Developer/FRAMR/web
set -a; source ../worker/.env; set +a
npm run worker
```

No provider key belongs in `web/.env.local`; the generation worker receives all provider credentials from `worker/.env`.
