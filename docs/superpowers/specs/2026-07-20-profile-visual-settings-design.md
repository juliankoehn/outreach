# Profile Visual Settings — Design

**Date:** 2026-07-20
**Status:** approved (brainstorm)

## Problem

Generated post images look too glossy / too "AI". The only lever on image look
today is `CreatorProfile.derived.visualStyle` — a string auto-analyzed from the
creator's past post images. It is **read-only** in the UI (the "Bildsprache"
canvas tile), often empty (no image posts), and only a soft descriptive line.
Nothing lets the creator actively steer image generation toward a natural,
non-glossy look.

## Goal

Give the creator an editable, per-profile visual direction — a look **preset**
plus optional **free-text** refinement — that combines with the auto-derived
visual style to steer every image generated for that profile toward a natural,
believable look.

## Decisions (locked in brainstorm)

- **Control shape:** presets (single-select) + optional free-text ("Feinschliff").
- **Relationship to derived style:** *combined* — both the manual setting and the
  auto-derived `visualStyle` go into the image prompt. On conflict the **manual**
  setting is phrased as the stronger/priority directive (natural wins over glossy).
- **UI location:** a dedicated **"Visuals" card** in the profile workspace
  (`profile/[id]`), shown in both standalone and embedded (account tab) modes.
  The derived style appears inside it as a subtle hint ("Aus deinen Posts
  erkannt: …").
- **Presets** (id → look): `natural` (Natürliche Reportage, default recommendation),
  `editorial`, `minimal`, `monochrome`, `analog`. No preset = free-text + derived only.

## Data model

`CreatorProfile` gains two **user-owned** columns, kept separate from
`derived.visualStyle` so re-analysis never overwrites the creator's choice:

- `visualPreset String?` — selected preset id (null = none)
- `visualDirection String @default("")` — free-text refinement

Migration hand-crafted + `prisma migrate deploy` (repo has pre-existing checksum
drift on `add_feed` that makes `migrate dev` want to reset — must be avoided;
HNSW index `resource_chunk_embedding_hnsw` must stay intact).

## Library (`@outreach/ai`)

- `VISUAL_PRESETS: ReadonlyArray<{ id: string; prompt: string }>` — the canonical
  preset ids and their **strong** English prompt fragments (natural photography,
  real light, muted colour, film grain, anti-gloss). Server-side source of truth;
  the web owns localized labels keyed by id.
- `composeVisualLanguage({ preset, direction, derived }): string` — builds the
  combined visual directive. Order: manual first (preset fragment + direction,
  phrased as a MUST), then the derived `visualStyle` as additional texture.
  Returns `""` when everything is empty. Unknown preset id → ignored.
- `generateImage` / `composeImageBrief` keep their existing `visualStyle` input;
  callers now pass `composeVisualLanguage(...)` instead of the raw derived string.
  `IMAGE_AESTHETIC` (the hard anti-slop ban) is unchanged — the preset reinforces it.

## API

- `updateProfileById` whitelist gains `visualPreset` (string | null) and
  `visualDirection` (string). `PATCH /api/profiles/:id` forwards them (already the
  generic body-forwarding route). Unknown/invalid `visualPreset` → coerced to null.
- `GET /api/profiles/:id` returns the two fields automatically (full-row read).
- Every image-generation call that reads the profile (studio `draft-image`,
  `composeImageBrief` in the studio agent, profile-studio example images) resolves
  the visual directive via `composeVisualLanguage({ preset, direction, derived })`.

## Web

- `CreatorProfile` type (`lib/profile.ts`) gains `visualPreset?: string | null`
  and `visualDirection?: string`.
- New **`VisualsCard`** in the profile workspace: preset chips (single-select,
  includes a "Keine Vorgabe" clear option) + a free-text `Textarea`, saving via
  the existing `PATCH /api/profiles/:id`; optimistic + reload. Shows the derived
  `visualStyle` as a muted hint line.
- The existing read-only "Bildsprache" canvas tile stays (it reflects analysis);
  the new card is the editable control.
- i18n en/de: card title/hint, preset labels (`profile.visualPreset_<id>`),
  free-text placeholder.

## Testing

- **unit (ai):** `composeVisualLanguage` — manual-before-derived ordering, both
  empty → "", preset-only, direction-only, unknown preset ignored; `VISUAL_PRESETS`
  ids resolve to non-empty fragments.
- **api:** `PATCH /profiles/:id` accepts `visualPreset`/`visualDirection`, persists,
  round-trips via GET; invalid preset id → stored as null.
- **web:** typecheck.
- **live:** set preset "natural" + a refinement, generate an image from the studio,
  confirm the output reads more natural / less glossy than before.

## Out of scope

- Per-account (vs per-profile) visual overrides — profile-level is enough now.
- Sliders / numeric style axes — presets + free-text cover the need.
- Changing the fixed `IMAGE_AESTHETIC` ban list.
