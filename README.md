# Ask the game

**Live:** https://ask-the-game.portawebia.workers.dev

A small hockey query demo: ask one real game a question in plain language and get the exact events
back. The game is **HPK 5–4 Ässät (OT), Liiga, 26 Sep 2026**, from Liiga's public game feed.

Type a question like *"Ässät power play shots in the third"*, *"every goal #94 was involved in"* or
*"Ässät:n maalit kuudella viittä vastaan"*. You get the matching events as a list, plotted on a rink,
with the official clip for every goal and a clip list (CSV) you could hand to video.

## How it works

```
question ──► LLM ──► draft filter (JSON) ──► code check ──► search ──► list + rink
             (Worker)                         (TypeScript)    (TypeScript)
```

1. **Draft.** A small LLM turns the question into a JSON filter. It runs behind a Cloudflare Worker,
   so the API key never reaches the browser. The prompt holds the two teams and the periods, **not the
   roster and not a single event**. The model translates language into structure; it cannot "know"
   a player or a count.
2. **Check.** Plain TypeScript resolves every value against the game before anything runs
   (`src/shared/check.ts`). The page shows the model's raw JSON next to the result of every check,
   so a coach sees exactly what was searched.
3. **Search.** Plain filtering over 110 events (`src/shared/query.ts`). Counts, xG totals and the
   rink come from the data only.
4. **Video sync.** The events are tied to the video by reading the broadcast scoreboard in the goal
   clips (below), so an event opens at the right second and the player shows the game clock.

## Video sync: reading the scoreboard

The event data says *when* in the game something happened; the video only knows its own seconds.
`scripts/sync-clips.ts` connects the two, the same way the filter check treats the language model:
**a model reads, plain code verifies.**

1. ffmpeg samples 4 frames per second from each goal clip and crops the scoreboard: clock, period,
   score, and the strip below it ("5 VS 3", "Ässät | Tyhjä maali").
2. **Tesseract**, an LSTM neural-network OCR (`tesseract.js`, runs locally), reads every crop.
3. Plain code keeps only readings that fit a clock running one second per video second, times the
   moments the digits flip to get a sub-second offset, and checks the result against Liiga's feed.

Result on the 9 goal clips (`src/data/clip-sync.json`, also covered by `tests/sync.test.ts`):

| Check | Result |
|---|---|
| Clip synced to the game clock | 9 / 9 |
| Clock freezes at Liiga's exact goal second | 8 / 9 (in the 9th the camera leaves the scoreboard just before) |
| Period on screen = feed | 9 / 9 |
| Score on screen before the goal = feed | 9 / 9 (and the change after the goal, where visible) |
| "5 VS 4", "5 VS 3", "Tyhjä maali" strips = my derived power-play / pulled-goalie labels | 3 / 3 |

It took three rounds to get there, which is the useful part: the first run read the period wrong on
two clips because replay frames without a scoreboard produced confident-looking junk, and a narrow
"1." touching the crop edge was read as "A". Fixes: only trust readings from frames where the clock
was read too, and give Tesseract clean black-on-white crops with a margin. The goal positions came
out identical in all three runs.

It ran once, offline; the page only reads the saved JSON. In the clip player you see the game clock
follow the video, a jump to the goal, and every other event inside the clip (three shots right
before goals get their own **▶ Video** button). The CSV export carries the clip and the second.

## What the check catches

| Question | What happens |
|---|---|
| "Shots by #8" | Two players wore #8 → *Which one?* with one button per player |
| "Shots by Hakulinnen" | Close typo → uses Anrei Hakulinen, **and says so** (amber, never silent) |
| "Goals by Mäkinen" | On HPK's roster but didn't dress → stopped, with the reason |
| "Hits by #94" | The feed has no hit events → stopped instead of answering "0 hits" |
| "Every 2-on-1 rush" | No rush tagging in public data → stopped (that's tracking-data territory) |
| "Goals in the 5th period" | No shootout: the game was decided in overtime |
| "HPK shots on Saarinen" | Saarinen is HPK's goalie → contradiction, offers "Ässät shots on Saarinen" |
| "Pinard's goals for HPK" | Pinard plays for Ässät → offers the right team or no team |
| "xG over 20" | Read as 20 % → 0.20, shown as an auto-fix |
| `"shotType": "slap"` | The model invented a field → stopped, "search without it" |

The rule behind all of these: **if the question can't be answered exactly, don't answer a
different one.** Errors block the search and come with one-click fixes; auto-corrections are
shown in amber. You can also edit the JSON by hand and run it through the same check.

## The data

`scripts/build-game.ts` turns three public Liiga endpoints (game, shot map, game stats) into one
event list (`src/data/game.json`, bundled into the page). The raw responses were downloaded once and
live in `public/liiga/<gameId>/`, so the build is reproducible offline and the site serves its own
copy: the "Data source" panel links both Liiga's live URLs and these copies. Answering a question
never touches Liiga's servers.

The 9 official goal clips are copied too: `npm run clips` (`scripts/fetch-clips.ts`, needs ffmpeg)
downloads each 720p clip without its pre-roll ad and cuts it, without re-encoding, into HLS under
`public/clips/<id>/` (6-second pieces + poster). HLS instead of one MP4 because Cloudflare's static
assets ignore Range requests, so an MP4 couldn't seek and wouldn't play on iPhones. The player uses
this copy first, Liiga's own stream as a fallback, and says so plainly if both fail. The clips
(175 MB) are git-ignored; the script recreates them.

- **Shots** (saved, missed, blocked, goals) with rink position, xG and, for 89 of the 103 shots, the positions of all
  12 players when the shot was taken. Click a shot to see them.
- **Goals** merged with their shot (matched by team and time), plus assists and the clip URL.
- **Penalties**, **goalie pulls**.
- **Derived per event:** strength (PP / SH / EV and manpower like 5v3 or 6v5) from the penalty
  timeline, score state, the goalie in net, and coordinates rotated so the home team always attacks
  right. As a check, my power-play label agrees with the feed's own label on all 103 shots.

## Which model, measured

`evals/cases.ts` has 28 questions (English, Finnish, German, Swedish, plus trick questions) with the
filter a hockey person would expect. A case passes only if the *whole* checked filter matches, since
an extra constraint changes the answer. `npm run eval` runs them all through the real prompt and
the real check (16 Nov 2026, the 28/28 models run several times):

| Model | Correct | Median latency | Cost per question |
|---|---|---|---|
| **deepseek/deepseek-v4.1-flash**, reasoning low (used) | 28/28 on 3 runs | 0.86–1.22 s | $0.00006–0.00011 |
| anthropic/claude-haiku-5.5 (backup) | 28/28 on 2 runs | 0.78–0.96 s | $0.00016 |
| z-ai/glm-5.3-flash | 28, 27, 27 | 0.90 s | $0.00007 |
| deepseek/deepseek-v4-flash-0731, reasoning low | 28/28 | 2.05 s | $0.00028 |
| inclusionai/ling-3.0-flash | 24/28 | 1.82 s | $0.00005 |
| mistralai/mistral-small-3.2-24b-instruct | 23/28 | 1.47 s | $0.00013 |
| qwen/qwen3.7-flash | 21/28 | 3.49 s | $0.00004 |
| openai/gpt-oss-20b, reasoning low | 21/28 | 0.82 s | $0.00002 |
| openai/gpt-5-nano, reasoning low | 17/28 | 3.93 s | $0.00013 |
| google/gemma-4-26b-a4b-it | 9/28 | 0.49 s | $0.00007 |

The misses were telling: several models read "blocked shots by Määttä" as *his shots that got
blocked* instead of *shots he blocked*. That passes the check (both are valid filters), so it is
exactly the kind of error the eval set exists for. GLM-5.3 Flash is cheaper still but made that
mistake on two of three runs. Full list in `evals/results.md`.

## Run it

```bash
npm install
npm test              # 28 tests: data build, the check, the saved video sync
npm run dev           # build + local Worker on http://localhost:4230 (key in .dev.vars)
npm run eval          # model bake-off, needs OPENROUTER_API_KEY
npm run data -- <gameId> <season>   # rebuild for another Liiga game
npm run clips         # copy the goal clips (needs ffmpeg)
npm run sync          # read the scoreboards, write src/data/clip-sync.json (ffmpeg + tesseract.js)
npm run deploy
```

Stack: TypeScript, Vite, one Cloudflare Worker (static assets + `/api/parse`), OpenRouter. No
framework. Fonts are bundled, so the page loads nothing from other sites.

**Spam and cost guard.** Every question passes one Durable Object (`Guard` in `worker/index.ts`),
a single counter for the whole world, so the limits are exact however many connections a script
opens: 30 requests a minute per visitor, 10 *new* questions a minute and 100 a day per visitor,
and 1,500 model calls a day in total. That last one caps the bill at about $0.15–0.25 a day. A
question that was asked before is answered from the Guard's cache without a model call, and
requests from other websites are refused. If the main model fails or times out, the backup answers.

The OpenRouter key is the demo's own: capped at $3 a month, expiring after a year, and tied to an
OpenRouter guardrail that allows only the two models above, so even a leaked key can't do much.
`scripts/set-key.ps1` installs a new key from the clipboard into the Worker and `.dev.vars`.

## What I'd do next

- **Sync the whole game video, not just goal clips.** The same scoreboard reader works on a full
  broadcast; then every search result becomes a playlist of exact moments, not only goals.
- **Look at the picture, not just the scoreboard.** Next steps on the video side: detect players
  and the puck in the frames and compare them with Liiga's tracked positions at each shot, or let a
  video model describe each goal (rebound, deflection, screen) and check what can be checked
  against the feed.
- **Tracking events as new fields.** Rushes, 2-on-1s and zone entries are exactly what the check
  rejects today. Each one becomes a new filter field plus a validator rule, and the eval set grows
  with it.
- **Many games.** "All Ässät power-play goals this season" needs the same check against a season
  roster, plus opponent and date filters.
- **Ask back instead of erroring** when the question is ambiguous, in the coach's own language.
- **Log every failed check** (with consent) and turn real coach questions into new eval cases.

Data and goal clips: Liiga public game feed and Liiga's video service. Built by Oskari Kaile.
