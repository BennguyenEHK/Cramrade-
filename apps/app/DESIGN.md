# Cramrade design notes

This is the design plan for the app shell and homepage (task A3). Everything here is encoded in `src/constants/theme.ts`. Change the tokens there, not in screens.

## Who it is for and what it has to feel like

Students, roughly 16 to 25, on a laptop or a phone, often a week or two before an exam and already a bit stressed. The page has to feel like a planner they can trust: calm, orderly, specific. Not a hype landing page, not a chat tool.

## The one bold element

The hero shows the thing Cramrade actually does: a strip of days from today to exam day, with short study sessions placed on it, closer together as the exam gets near. It is drawn from a small fixed plan in code, the same shape the schedule engine will produce. Everything else on the page stays quiet so this one picture carries the idea.

## Palette

The colors mean something. Green is a study session. Red is the exam day. Nothing else is colored.

Light mode

- Paper `#F4F6F2`: page background. A cool, slightly green off-white, deliberately not cream.
- Surface `#FFFFFF`: panels that sit on the paper.
- Line `#D6DBD2`: hairlines and borders.
- Ink `#17202A`: text, the wordmark, primary buttons.
- Ink muted `#5A6672`: secondary text.
- Session green `#148A6A`: study sessions, links, the primary call to action.
- Exam red `#D9472F`: the exam day marker only.

Dark mode

- Paper `#111821`, Surface `#19222D`, Line `#2B3642`, Ink `#EDF0EA`, Ink muted `#9DA8B3`, Session green `#38B48F`, Exam red `#F0735C`.

Focus ring: session green, 3px, 2px offset, on every link and button.

## Typefaces

Two families, with clearly different jobs.

- Headlines: Bricolage Grotesque, weights 700 and 800. A grotesque with real character at large sizes (narrow counters, visible ink traps) that still reads as a tool rather than a magazine. Set tight, negative letter spacing at display sizes.
- Everything else: Atkinson Hyperlegible, weights 400 and 700. Designed by the Braille Institute so that similar letters and numbers cannot be confused. Dates, times and question counts are exactly the content a stressed reader misreads. Figures are proportional, so columns of numbers are aligned by layout, not by the font.

Both are loaded with `useFonts` from `@expo-google-fonts/*`. In Expo SDK 57 each weight is its own font family name, so text styles pick a family (`BricolageGrotesque_700Bold`) and never set `fontWeight`. On web a system fallback stack is appended so there is no invisible text while fonts load.

## Type scale

Ratio about 1.25 from a 16px body. Sizes: 13, 16, 20, 25, 31, 39, 61, plus 42 for the phone display size.

- Display: 42 on phones, 61 on wide screens, line height 1.02, letter spacing -0.02em.
- Headline: 31 / 39, line height 1.1.
- Title: 20 / 25, line height 1.25.
- Body: 16, line height 26 (Atkinson wants generous leading).
- Small: 13, line height 20.

Text measure stays under 70 characters: body paragraphs are capped at 560px.

## Spacing and radii

Spacing in a 4px grid: 4, 8, 12, 16, 24, 32, 48, 64, 96. Section gaps are 64 on phones and 96 on wide screens.

Radii carry hierarchy instead of being the same everywhere: 4 for small chips and the exam marker, 8 for buttons and inputs, 12 for panels. No pill shapes, no shadows.

## Layout

- Content column: max 1120px, 20px gutters on phones, 32px from 760px up.
- Left aligned throughout. Centered text is not used.
- Top bar: wordmark on the left, three links on the right. On phones the links stay in a row (there are only three) and the wordmark shrinks.
- Hero: headline and one paragraph in a 640px column, the call to action under them, then the full-width day strip.
- How it works: four rows separated by hairlines, each with a step number on the left and a title and sentence on the right. This is a real sequence, so numbers are justified.
- What makes it different: two columns on wide screens, stacked on phones. Plain headings and text, no cards.
- Closing: an ink block with one sentence and the sign-in button.
- Footer: one line.

Wireframe, wide screen:

```
Cramrade                                  Home   Workspace   Sign in
--------------------------------------------------------------------
Your notes, planned
backwards from exam day.

Add the date and your own notes. Cramrade places short
sessions between now and then, and asks you questions
made from what you wrote.

[Start a plan]

Today                                                   Exam day
 |  .   .    .   .  .  . . . . .. .. ... .... .....   |■
 week 1              week 2               week 3

1  Add the exam date            ........................
2  Add your notes               ........................
3  Study in short sessions      ........................
4  Quiz your group              ........................

Built around the date          |  Questions from your notes
..............                 |  ..............

[ink block]  Got an exam coming up?    [Sign in]
```

## Motion

One moment: on the homepage the session bars in the hero rise into place once, about 600ms, staggered left to right so the eye reads the strip toward exam day. If the system asks for reduced motion the strip is drawn in place with no animation. Nothing else moves on its own.

## Writing

Sentence case everywhere. Plain verbs. The reader is "you". Buttons say what happens: "Start a plan", "Sign in". No eyebrow labels above headings, no all caps, no arrows in button text, no dashes between fragments.

## Directions considered and not taken

- Graph paper: a pale blue grid background, cobalt ink, red pen marks. Lost because blue on white is the default look of every productivity tool, and the grid would be decoration on a page whose one picture already is a timetable.
- Night library: a deep navy page with a warm amber accent, like a desk lamp. Lost because a dark page is heavy for a reader who is already anxious, and dark plus one warm accent is now one of the most common generated looks.

Chosen direction: light paper, ink, and two meaningful colors (green session, red exam day), with the day strip as the single bold element.
