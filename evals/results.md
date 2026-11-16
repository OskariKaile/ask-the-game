# Eval results (2026-11-16)

28 questions, see evals/cases.ts.

| Model | Correct | Median latency | Cost per question |
|---|---|---|---|
| deepseek/deepseek-v4.1-flash (reasoning {"effort":"low"}) | 28/28 | 1.22 s | $0.00011 |
| deepseek/deepseek-v4-flash-0731 (reasoning {"effort":"low"}) | 28/28 | 2.05 s | $0.00028 |
| openai/gpt-oss-20b (reasoning {"effort":"low"}) | 21/28 | 0.82 s | $0.00002 |
| openai/gpt-5-nano (reasoning {"effort":"low"}) | 17/28 | 3.93 s | $0.00013 |
| qwen/qwen3.7-flash | 21/28 | 3.49 s | $0.00004 |
| z-ai/glm-5.3-flash | 28/28 | 0.94 s | $0.00008 |
| inclusionai/ling-3.0-flash | 24/28 | 1.82 s | $0.00005 |
| mistralai/mistral-small-3.2-24b-instruct | 23/28 | 1.47 s | $0.00013 |
| google/gemma-4-26b-a4b-it | 9/28 | 0.49 s | $0.00007 |
| anthropic/claude-haiku-5.5 | 28/28 | 0.78 s | $0.00016 |

### deepseek/deepseek-v4.1-flash: misses

- none

### deepseek/deepseek-v4-flash-0731: misses

- none

### openai/gpt-oss-20b: misses

- "Saves by Saarinen in the last five minutes of the 3rd" → `{"events":["save"],"team":"HPK","goalie":"Saarinen","periods":[3],"from":"15:00","to":"20:00"}`
- "Ässät:n maalit kuudella viittä vastaan" → `{"events":["goal"],"team":"Ässät","goalie":"#5"}`
- "Blocked shots by Määttä" → `{"events":["block"],"players":["Määttä"]}`
- "Shot attempts by HPK in the first 10 minutes of the game" → `{"events":["attempts"],"team":"HPK","from":"00:00","to":"10:00"}`
- "Kostilainen's points" → `{"events":["goal","assist"],"players":["Kostilainen"]}`
- "Goals in the last minute of regulation" → `{"events":["goal"],"periods":[1,2,3],"from":"19:00","to":"20:00"}`
- "Goals in the 5th period" → `{"unsupported":["Goals in the 5th period"]}`

### openai/gpt-5-nano: misses

- "Ässät:n maalit kuudella viittä vastaan" → `{"events":["goal"],"team":"Ässät","strength":["PP"]}`
- "HPK penalties in the third period" → `ERROR Error: empty answer (length)`
- "Blocked shots by Määttä" → `{"events":["block"],"players":["Määttä"]}`
- "Shorthanded shots" → `ERROR Error: empty answer (length)`
- "Shots on Taponen when the score was tied" → `ERROR Error: empty answer (length)`
- "Kostilainen's points" → `ERROR Error: empty answer (length)`
- "Goals in the last minute of regulation" → `ERROR Error: empty answer (length)`
- "Shots by #8" → `ERROR Error: empty answer (length)`
- "Hits by Hakulinnen" → `ERROR Error: empty answer (length)`
- "Goals in the 5th period" → `ERROR Error: empty answer (length)`
- "Every 2-on-1 rush in the second period" → `ERROR Error: empty answer (length)`

### qwen/qwen3.7-flash: misses

- "Dangerous Ässät chances while they were trailing" → `ERROR Error: empty answer (length)`
- "Saves by Saarinen in the last five minutes of the 3rd" → `ERROR Error: empty answer (length)`
- "Ässät:n maalit kuudella viittä vastaan" → `{"events":["goal"],"team":"Ässät","strength":["PP"]}`
- "Blocked shots by Määttä" → `ERROR Error: empty answer (length)`
- "Kostilainen's points" → `{"events":["goal"],"players":["Kostilainen"],"playerRole":"any","unsupported":["points"]}`
- "Shots by Hakulinen while HPK was leading" → `ERROR Error: empty answer (length)`
- "Hits by Hakulinnen" → `ERROR Error: empty answer (length)`

### z-ai/glm-5.3-flash: misses

- none

### inclusionai/ling-3.0-flash: misses

- "Ässät:n maalit kuudella viittä vastaan" → `ERROR Error: empty answer (length)`
- "Schüsse von Pinard im zweiten Drittel" → `{"events":["shots"],"players`
- "Blocked shots by Määttä" → `ERROR Error: empty answer (stop)`
- "Shots with an xG over 0.3" → `{"events":["shots"],"minXG":0.3}`

### mistralai/mistral-small-3.2-24b-instruct: misses

- "Ässät:n maalit kuudella viittä vastaan" → `{"events":["goal"],"team":"Ässät","strength":["PP"],"goaliePulled":true}`
- "Blocked shots by Määttä" → `{"events":["block"],"players":["Määttä"]}`
- "Shot attempts by HPK in the first 10 minutes of the game" → `{"events":["attempts"],"team":"HPK","from":"00:00","to":"10:00"}`
- "Kostilainen's points" → `{"events":["goal"],"players":["Kostilainen"],"playerRole":["primary","assist"]}`
- "Goals in the last minute of regulation" → `{"events":["goal"],"periods":[1,2,3],"from":"19:00","to":"20:00"}`

### google/gemma-4-26b-a4b-it: misses

- "Dangerous Ässät chances while they were trailing" → `{"events": [{"minXg": 0.15}], "team": "Ässät", "scoreState": "trailing", "unsupported": ["chances"]}`
- "Saves by Saarinen in the last five minutes of the 3rd" → `{"events=[": ["save"], "goalie": "Saarinen", "from": "15:00", "to": "20:00", "periods": [3]}`
- "Alle Tore in der Verlängerung" → `{"events=[": ["goal"], "periods": [4]}`
- "Skott av HPK i tredje perioden" → `{"events:[": ["shots"], "team": "HPK", "periods": [3]}`
- "Schüsse von Pinard im zweiten Drittel" → `{"events:[": ["shots"], "players": ["Pinard"], "periods": [2]}`
- "HPK:n ylivoimamaalit" → `{"events=[": ["goal"], "team": "HPK", "strength": ["PP"]}`
- "HPK penalties in the third period" → `{"events=[": ["penalty"], "team": "HPK", "periods": [3]}`
- "Blocked shots by Määttä" → `{"events:[": ["block"], "players": ["Määttä"]}`
- "How many shots did Kukkonen take?" → `{"events:[": ["shots"], "players": ["Kukkonen"]}`
- "Shot attempts by HPK in the first 10 minutes of the game" → `{"events:[": ["attempts"], "team": "HPK", "from": "00:00", "to": "10:00"}`
- "Ässät goals on the power play" → `{"events=[": ["goal"], "team": "Ässät", "strength": ["PP"]}`
- "Shorthanded shots" → `{"events:[": ["shots"], "strength": ["SH"]}`
- "Shots on Taponen when the score was tied" → `{"events:[": ["shots"], "goalie": "Taponen", "scoreState": "tied"}`
- "Kostilainen's points" → `{"events=[": ["goal", "assist"], "players": ["Kostilainen"], "playerRole": "any"}`
- "Goals assisted by Päivärinta" → `{"events=[": ["goal"], "players": ["Päivärinta"], "playerRole": "assist"}`
- "Shots with an xG over 0.3" → `{"events:[": ["shots"], "minXg": 0.3}`
- "Goals in the last minute of regulation" → `{"events=[": ["goal"], "from": "19:00", "to": "20:00"}`
- "Shots by Hakulinen while HPK was leading" → `{"events=[": ["shots"], "players": ["Hakulinen"], "scoreState": "leading"}`
- "Tappara goals in the second" → `{"events=[": ["goal"], "periods": [2]}`

### anthropic/claude-haiku-5.5: misses

- none

## Re-runs, same day (to check the 28/28 results were not luck)

| Model | Correct | Median latency | Cost per question |
|---|---|---|---|
| z-ai/glm-5.3-flash | 27/28 | 0.91 s | $0.00007 |
| z-ai/glm-5.3-flash | 27/28 | 0.90 s | $0.00006 |
| deepseek/deepseek-v4.1-flash (reasoning {"effort":"low"}) | 28/28 | 0.86 s | $0.00009 |

### z-ai/glm-5.3-flash: misses

- "Blocked shots by Määttä" → `{"events":["block"],"players":["Määttä"]}`

### z-ai/glm-5.3-flash: misses

- "Blocked shots by Määttä" → `{"events":["block"],"players":["Määttä"]}`

### deepseek/deepseek-v4.1-flash: misses

- none
