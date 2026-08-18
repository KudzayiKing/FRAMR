# FRAMR — Full-Stack Platform Build Prompt

You are a senior product designer, full-stack engineer, AI/video infrastructure architect, and UX strategist.

Build **FRAMR**, a modern platform for programmable video product placement.

## 1. Product concept

FRAMR lets creators upload existing short-form vertical videos, identify products/objects inside those videos that can become commercial placement opportunities, replace those products with advertiser products using AI video generation, create multiple versions of the same video, and export the finished video for publishing anywhere.

FRAMR is **not** a social network and does not compete with YouTube, TikTok, Instagram, or other publishing platforms.

The core idea:

> **Change what's in the frame.**

Creators keep their original content and can give it new commercial lives without reshooting.

There are two user funnels from the beginning:

1. **Creators** — create and monetize placements in their existing videos.
2. **Advertisers** — upload products/campaigns and find relevant creator placements.

The first MVP should be focused, polished, and usable rather than overloaded with features.

---

# 2. Brand

## Name

**FRAMR**

The name derives from "frame" with a modern abbreviated spelling.

## Primary positioning

> **Change what's in the frame.**

Supporting positioning:

> **Content stays. Commerce changes.**

Other approved messaging:

> **Make every frame programmable.**

> **Your content isn't finished.**

> **One video. Multiple commercial lives.**

Do not describe FRAMR as merely an "AI video editor." It is a **programmable video / creator monetization / contextual commerce platform**.

---

# 3. Design direction

The website and application should feel like:

**Apple × Linear × modern film studio × premium advertising platform**

Avoid generic AI SaaS aesthetics.

Do NOT use:
- excessive gradients
- purple AI clichés
- glowing blobs
- excessive glassmorphism
- generic dashboard templates
- cartoon illustrations
- excessive rounded cards
- meaningless decorative 3D objects

FRAMR should feel:
- cinematic
- modern
- clean
- premium
- editorial
- creative
- sophisticated
- fast
- trustworthy
- technology-forward

The product should feel like a place creators and advertisers actually want to spend time in.

---

# 4. Visual language

The central visual metaphor is the **frame**.

Use subtle frame-corner motifs throughout the identity:
- video containers
- image containers
- hover states
- selected objects
- buttons where appropriate
- loading states
- transitions

Do not make this gimmicky.

The interface should let the uploaded video provide most of the color.

## Color direction

Start with:
- warm off-white / soft white background
- near-black typography
- one restrained accent color
- neutral grays

Use video/product imagery to introduce visual richness.

Avoid making the entire application brightly colored.

## Typography

Use a modern high-quality sans-serif for UI and body copy.

A subtle editorial serif may be used sparingly for marketing statements, but the UI should remain primarily sans-serif.

Typography should be large, confident, and highly legible.

---

# 5. Technology stack

Use:

## Frontend

- Next.js
- TypeScript
- React
- App Router
- Tailwind CSS
- shadcn/ui where useful
- Lucide icons
- Framer Motion for restrained motion

Do not introduce unnecessary frontend frameworks.

## Backend / data

- Supabase
- PostgreSQL
- Supabase Auth
- Supabase Realtime
- Supabase Queues

## File storage

Use an S3-compatible object-storage architecture.

Preferred production direction:
- Cloudflare R2

However, abstract storage behind a service so it can be changed later.

Store:
- original videos
- generated videos
- thumbnails
- product assets
- intermediate processing assets

Never store large video blobs directly in PostgreSQL.

## Video processing

Use a Python worker service.

Use:
- Python
- FFmpeg
- FFprobe
- OpenCV where appropriate
- PyTorch where required
- SAM 2 / compatible video segmentation pipeline when implemented

## AI generation

The initial provider is **Decart Lucy**.

IMPORTANT:

Do not tightly couple the application to Decart.

Create an abstraction such as:

```ts
interface VideoGenerationProvider {
  generatePlacement(input: PlacementGenerationInput): Promise<GenerationResult>;
}
```

Implement:

```text
DecartProvider
```

The architecture must allow future providers:

```text
OpenModelProvider
OwnModelProvider
```

The application should never need to know which model generated the video.

## Payments

Use Stripe.

Prepare architecture for:
- creator subscriptions/credits
- advertiser campaign payments
- future creator payouts / Stripe Connect

Do not implement complex marketplace payouts unless necessary for the MVP.

---

# 6. Product scope — MVP

The MVP is intentionally narrow.

## Video constraints

- Vertical video
- 15–60 seconds
- optimized for short-form content
- target output: 1080 × 1920 MP4
- one product replacement at a time
- multiple versions supported

Primary initial use case:

**Food/cooking creators**

The system should be designed to expand later to:
- travel
- fashion
- beauty
- fitness
- tech
- lifestyle
- automotive
- etc.

Do not hard-code the product around cooking.

---

# 7. Creator funnel

Creator flow:

```text
Sign up
  ↓
Upload video
  ↓
Video analysis
  ↓
Placement opportunities detected
  ↓
Creator selects placement
  ↓
Choose:
  - Upload my own product
  - Find a sponsor
  ↓
Generate replacement
  ↓
Preview
  ↓
Save version
  ↓
Export MP4
```

The creator should never need to understand AI or video compositing.

---

# 8. Creator dashboard

Create a polished creator dashboard.

Navigation:

```text
FRAMR

Home

Videos
Placements
Versions

Marketplace

Campaigns
Analytics

----------------

Assets
Settings
```

Dashboard should show:

- total videos
- detected placements
- active placements
- sponsored placements
- estimated/actual earnings where applicable
- recent videos
- recent versions
- processing jobs

Example messaging:

> **Your content isn't finished.**

> 12 videos · 31 placements · 4 active versions

The interface should emphasize **commercial inventory**, not follower counts.

---

# 9. Upload flow

Create a beautiful drag-and-drop uploader.

Requirements:
- upload vertical video
- validate duration
- validate format
- show upload progress
- create thumbnail
- show processing state

After upload:

```text
Uploading
↓
Preparing video
↓
Analyzing scenes
↓
Finding placements
↓
Ready
```

Use realtime job status.

Do not freeze the browser during processing.

---

# 10. Placement detection

After processing, show:

> **We found 4 potential product placements.**

Display the actual video prominently.

Overlay subtle markers around detected objects.

Example:

```text
Rice cooker
12.4 sec visible
Excellent placement

Microwave
8.1 sec visible
Good placement

Pan
3.8 sec visible
Limited placement
```

Each placement should have:
- category
- object label
- start time
- end time
- duration
- confidence/quality score
- preview

The creator clicks a placement to work with it.

---

# 11. Placement editor

This is the heart of the MVP.

Show the original vertical video large.

Allow the creator to select:
- placement
- time range
- replacement product

Do not build a full Premiere/CapCut-style editor.

FRAMR is a **placement management interface**, not a traditional video editor.

Show:

```text
Placement
Rice cooker

00:07 ───────────── 00:19

Duration: 12.4 sec
Quality: Excellent
```

Then:

> **Choose product**

Options:
- Upload product
- Select from assets
- Find a sponsor

---

# 12. Product upload

Allow creator or advertiser to upload:
- product image
- product name
- brand
- optional product description
- optional website
- optional additional reference images

Store product assets separately.

The product should be treated as a reusable commercial asset.

---

# 13. AI generation

When the creator clicks Generate:

Show a cinematic but restrained processing experience.

Example:

> **Creating your placement**

> Mapping product to scene  
> Tracking movement  
> Preserving lighting and perspective  
> Rendering final video

Progress states:

```text
Queued
Analyzing
Generating
Finalizing
Complete
```

The backend should create a `GenerationJob`.

Do not block the HTTP request waiting for the video.

Use queue + worker architecture.

---

# 14. Version system

This is one of the most important concepts in FRAMR.

A video should not be treated simply as `video.mp4`.

Model:

```text
Video
  ↓
Placement
  ↓
Placement Versions
```

Example:

```text
Perfect Fried Rice

Original
Brand A
Brand B
Brand C
```

Creator can:
- preview versions
- rename versions
- activate/deactivate versions
- restore original
- create a new version
- export any version

The original source video must never be destroyed.

---

# 15. Before / after experience

Make the comparison visually excellent.

Support:
- side-by-side
- before/after slider
- original vs generated
- version selector

The product replacement should be obvious without becoming distracting.

---

# 16. Export

Allow:

> **Export sponsored version**

Target:
- MP4
- 1080 × 1920
- social-ready
- preserve audio

Provide a clear download/export state.

Eventually prepare architecture for:
- TikTok
- Instagram
- YouTube Shorts
- Snapchat
- Facebook
- X
- websites

Do not implement direct social publishing integrations in MVP unless trivial.

---

# 17. Advertiser funnel

Advertisers should be able to join from the beginning.

Advertiser flow:

```text
Sign up
 ↓
Create brand
 ↓
Upload product
 ↓
Create campaign
 ↓
Define requirements
 ↓
Find placements
 ↓
Review placement
 ↓
Select placement
 ↓
Pay / reserve
 ↓
Creator approval
 ↓
Generate
 ↓
Campaign active
```

Initially, matching can be assisted/manual behind the scenes.

Do NOT attempt to build a sophisticated fully automated ad marketplace in V1.

---

# 18. Advertiser onboarding

Ask:

### What are you selling?

Product upload.

### Where should it appear?

Categories such as:
- Food
- Cooking
- Travel
- Fashion
- Beauty
- Fitness
- Technology
- Lifestyle

### Who should see it?

- country
- optional age range
- optional interests

### Campaign

- budget
- start date
- end date
- placement preferences

---

# 19. Advertiser dashboard

Advertiser navigation:

```text
FRAMR

Overview

Campaigns
Placements
Products

Marketplace

Analytics

----------------

Billing
Settings
```

Show:
- active campaigns
- spend
- selected placements
- estimated impressions
- active creators
- campaign status

Keep it clean and data-rich without becoming a spreadsheet.

---

# 20. Placement marketplace

This should be one of the most visually distinctive parts of FRAMR.

Do NOT make it look like a generic influencer marketplace.

Users should browse actual creator video content.

Example:

```text
AVAILABLE PLACEMENTS

[VIDEO]
Rice cooker
12.4 sec
US audience
Est. 180K views
$320

[VIDEO]
Coffee machine
8.2 sec
UK audience
Est. 90K views
$180

[VIDEO]
Headphones
6.8 sec
US audience
Est. 240K views
$450
```

The advertiser is buying a **placement**, not simply buying a creator.

A placement should have:
- video preview
- creator
- category
- object
- duration
- audience information
- geography
- estimated views
- price
- availability
- placement quality

---

# 21. Matching

For MVP, use basic structured matching.

Match advertisers to placements using:
- product category
- video category
- geography
- audience
- placement category
- availability
- price/budget

Create a service boundary:

```text
PlacementMatchingService
```

Later this can become an ML recommendation system.

Do not build complex machine learning matching for MVP.

---

# 22. Creator sponsorship preferences

Creators should be able to configure:

### Categories I accept

- Kitchen appliances
- Food
- Coffee
- Cooking utensils

### Categories I don't accept

- Gambling
- Alcohol
- Political
- etc.

Also:

**Minimum campaign payout**

This protects creators and makes the marketplace feel creator-first.

---

# 23. Campaign model

Conceptually:

```text
Advertiser
  ↓
Campaign
  ↓
CampaignPlacement
  ↓
Creator Placement
  ↓
Placement Version
  ↓
Generated Video
```

The platform should support creator acceptance/rejection.

Do not automatically place a product into creator content without appropriate creator approval.

---

# 24. Database model

At minimum create entities for:

```text
User
Profile
CreatorProfile
AdvertiserProfile

Video
VideoScene
VideoObject

Placement
PlacementTrack

Product
Brand

PlacementVersion

Campaign
CampaignPlacement

GenerationJob

Asset

Transaction
Subscription
```

Use foreign keys and proper indexes.

Use Supabase Row Level Security.

Creators should only access their own private videos/assets unless a placement is intentionally made available in the marketplace.

Advertisers should only access their own products/campaigns and public/available marketplace data.

---

# 25. API/service architecture

Separate business logic into services.

Examples:

```text
VideoService
VideoAnalysisService
PlacementService
ProductService
GenerationService
VersionService
CampaignService
MatchingService
BillingService
StorageService
```

Do not put all logic into giant Next.js route handlers.

Keep provider integrations isolated.

---

# 26. Video processing architecture

Use:

```text
Upload
 ↓
Storage
 ↓
Create processing job
 ↓
Queue
 ↓
Python worker
 ↓
FFmpeg normalization
 ↓
Scene/object analysis
 ↓
Placement detection
 ↓
Store placement metadata
 ↓
Ready
```

Generation:

```text
Placement selected
 ↓
Create GenerationJob
 ↓
Queue
 ↓
Python worker
 ↓
VideoGenerationProvider
 ↓
Decart Lucy
 ↓
Post-process with FFmpeg
 ↓
Upload generated video
 ↓
Create PlacementVersion
 ↓
Realtime status = complete
```

---

# 27. Model abstraction

Create a clean provider interface.

For example:

```text
VideoGenerationProvider

generatePlacement()
getGenerationStatus()
cancelGeneration()
```

Current implementation:

```text
DecartProvider
```

Future:

```text
OpenModelProvider
OwnModelProvider
```

Never make Decart-specific logic spread across the application.

---

# 28. Cost tracking

Every generation must record:
- provider
- model
- duration
- generation cost if available
- generation time
- status
- error
- video ID
- placement ID
- creator ID

This is essential because video inference economics will determine pricing.

Do not hard-code pricing assumptions.

Create an internal cost accounting layer.

---

# 29. Error handling

AI generation will fail sometimes.

Design excellent states:

- queued
- processing
- complete
- failed
- retrying
- canceled

When generation fails:

> **We couldn't create this version.**

> Try again or choose another reference image.

Never expose raw provider errors to users.

Log detailed errors internally.

---

# 30. Landing page structure

Build a premium marketing homepage.

Navigation:

```text
FRAMR

Creators
Advertisers
How it works

                         Sign in
                         Create a placement
```

Hero:

> **Change what's in the frame.**

Supporting copy:

> FRAMR lets creators turn existing videos into new commercial opportunities — without reshooting.

Primary CTA:

> **Create a placement**

Secondary CTA:

> **Find placements**

Hero should feature a large vertical video demonstration where the product changes while the rest of the video remains consistent.

---

# 31. Homepage sections

Recommended sequence:

## Hero

Large interactive product demonstration.

## One video. Multiple commercial lives.

Show:
Original → Brand A → Brand B → Brand C

## For creators

> **Your content already exists. Make it work again.**

Show:
Upload → Detect → Replace → Export

CTA:
**Start creating**

## For advertisers

> **Don't interrupt the content. Become part of it.**

Show product entering relevant creator content.

CTA:
**Find placements**

## Placement section

Explain commercial inventory.

## Timeline concept

> **Yesterday's video. Tomorrow's sponsor.**

Show the same video changing sponsors over time.

## Final CTA

> **Your content isn't finished.**

> Make it programmable.

Buttons:
**Start creating**
**Find placements**

---

# 32. Homepage interactions

Use motion intentionally.

Important interaction:

**CHANGE**

When users hover/click a product, the video changes to another version.

The website itself should demonstrate the FRAMR concept.

Use:
- smooth transitions
- subtle frame animations
- timeline movement
- object highlighting
- product swaps

Avoid:
- excessive scroll animations
- spinning 3D elements
- distracting parallax

---

# 33. Responsive design

Desktop should be excellent.

Mobile must also be excellent because creators will frequently use phones.

Creator video should remain vertical and visually dominant.

Advertiser marketplace should adapt into a mobile browsing experience.

Do not simply shrink desktop layouts.

---

# 34. Accessibility

Implement:
- semantic HTML
- keyboard navigation
- accessible dialogs
- focus states
- captions/labels where needed
- sufficient contrast
- reduced-motion support

---

# 35. Security

Implement:
- authentication
- Row Level Security
- signed/private asset URLs where appropriate
- file type validation
- upload size limits
- server-side authorization
- rate limiting
- secure provider keys
- never expose Decart/API secrets client-side

---

# 36. Analytics

Prepare product analytics for:

Creator:
- upload
- placement detection
- placement selected
- generation started
- generation completed
- version exported
- sponsor request

Advertiser:
- product uploaded
- campaign created
- placement searched
- placement viewed
- placement selected
- campaign funded
- campaign accepted

Use an analytics abstraction so the provider can be changed later.

---

# 37. Seed/demo data

Create realistic demo content so the application doesn't feel empty.

Seed:
- several creators
- several cooking videos
- several advertiser brands
- several products
- several placement opportunities
- several campaigns
- several generated versions

Use clearly labeled demo/sample data if real commercial data is not available.

The first-run experience should immediately communicate the product.

---

# 38. Important MVP constraints

Do NOT build:
- social network
- creator feed
- chat system
- livestreaming
- direct TikTok/Instagram/YouTube publishing
- automated bidding
- complex ad auctions
- sophisticated recommendation ML
- Kubernetes
- Kafka
- massive microservice architecture
- custom video model training
- arbitrary long-form video editing
- full Premiere/CapCut replacement

The MVP exists to prove:

> **Creator uploads existing vertical video → FRAMR finds placement → product is replaced convincingly → creator creates multiple versions → creator exports → advertiser can eventually buy that placement.**

---

# 39. Code quality

Use:
- strict TypeScript
- clear types
- reusable components
- service boundaries
- environment variables
- schema validation
- clean error handling
- loading/empty/error states
- sensible folder structure

Use Zod or an equivalent schema validation library.

Avoid:
- `any`
- duplicated business logic
- giant components
- hardcoded fake API responses once real services exist
- exposing secrets
- tightly coupled provider code

---

# 40. Build strategy

Build in phases.

## Phase 1 — Foundation

- Next.js app
- authentication
- Supabase
- database schema
- storage abstraction
- dashboard shells
- design system

## Phase 2 — Creator workflow

- video upload
- processing
- video metadata
- placement data model
- placement UI
- product assets
- version model

## Phase 3 — AI generation

- Python worker
- queue
- FFmpeg
- Decart provider
- generation jobs
- realtime progress
- generated video storage

## Phase 4 — Export

- version management
- before/after preview
- MP4 export
- download

## Phase 5 — Advertiser workflow

- advertiser onboarding
- product management
- campaign creation
- marketplace
- placement selection

## Phase 6 — Payments

- Stripe
- creator plans/credits
- advertiser campaign payments

Do not try to finish everything simultaneously.

---

# 41. UX quality bar

Every important action must have:
- clear feedback
- loading state
- success state
- error state
- empty state

The product should feel extremely fast even when AI processing is slow.

Use optimistic UI where appropriate.

Use skeletons rather than blank screens.

Never make users wonder:

> "Did it upload?"

> "Is it processing?"

> "Did generation fail?"

The state should always be obvious.

---

# 42. The most important product principle

FRAMR is not primarily an editing application.

It is:

> **A programmable commercial layer for video.**

The UI should therefore revolve around:

**Videos**

**Placements**

**Products**

**Versions**

**Campaigns**

—not traditional editing timelines.

---

# 43. Final visual/brand rule

Whenever making a design decision, ask:

> Does this make FRAMR feel like a premium new category of media infrastructure?

If not, simplify it.

The application should feel like something that could eventually power a huge amount of global creator commerce.

Start with a beautiful, focused MVP.

Do not overbuild.

Do not use placeholder-looking UI.

Do not make it look like a generic AI SaaS template.

The final experience should make someone think:

> **"I've never seen a platform like this before."**

---

# 44. Deliverable

Build the actual FRAMR platform, not just a static landing page.

The first working version should include:

1. Premium landing page
2. Creator authentication
3. Advertiser authentication
4. Creator dashboard
5. Advertiser dashboard
6. Video upload
7. Video library
8. Placement workflow UI
9. Product asset management
10. Placement version system
11. Generation job architecture
12. Decart provider abstraction
13. Marketplace UI
14. Campaign UI
15. Database schema
16. Storage architecture
17. Queue architecture
18. Realtime job status
19. Export workflow
20. Responsive design
21. Seed/demo data
22. Proper error/loading/empty states

Where a real AI/video service cannot yet be executed in the development environment, implement the service boundary and realistic development adapter rather than faking the architecture. The production adapter must be clearly isolated and ready for credentials/configuration.

Build the foundation so that replacing the development adapter with Decart Lucy requires configuration rather than rewriting the application.

The result should be polished enough to demo to both creators and advertisers.
