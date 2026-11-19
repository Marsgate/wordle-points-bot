# WordleScoreBot

A self-hosted Discord bot that turns the server's daily Wordle results into points and keeps
the scoreboard in a **personal role** named after the score (`13.5 points`). Results come from
the Wordle Activity's daily summary, so nobody has to paste share text.

## The basics

1. Play Wordle through Discord's `/wordle` Activity. The first summary that names you
   joins you at **0 points** and creates your role — there is nothing to sign up for.
2. Play Wordle through Discord's `/wordle` Activity — that is the only source of results.
3. Each morning the bot reads the Activity's **daily summary** for yesterday and awards
   **10 points** to first place. Ties split the prize, rounded to the nearest half point —
   a 3-way tie pays 3.5 each.
4. Your total lives in your personal role. It updates when the summary is applied, and 0 or
   negative totals are normal — they get a role too.

The bot reads the Activity summary only; pasted share text is ignored.

The server's **streak** — consecutive days with at least one solver — is tracked too;
`/wordle-streak` reports it, and an admin can seed it with the number you had before the
bot (`/wordle-streak count:105`).

The bot never reads points from names and never edits nicknames.

## Commands

**For everyone**

| Command | What it does |
|---|---|
| `/wordle-leaderboard` | The all-time point totals |
| `/wordle-streak [count:]` | The server's day streak; admins can set it (0 clears) |

**For admins**

| Command | What it does |
|---|---|
| `/wordle-award user: points:` | Correct a total; halves and negatives allowed |

**Developer tools** (off by default): set `DEBUG_TOOLS=true` in `.env` and restart to
register `/wordle-close` and `/wordle-reopen`. They end or undo the current day early —
handy for testing, not needed in normal play.

## How points work

- Only **solvers** place. An X/6 finishes the puzzle but scores 0.
- Results come from the Activity's **daily summary**, one per group/channel; they are
  merged per day and ranked together, so a better score from another channel takes the
  prize. New Wordle channels are discovered by scanning all readable text channels.
- Everyone who finishes is a player: the first time a summary names someone, the bot
  registers them at **0 points**, creates their role, and pays their share of the split.
  Nobody has to sign up before their first game, and nobody is ever prompted to.
- Every summary is followed by the **all-time board**, posted by the bot directly under
  the Activity's score in the same channel — one board per day, however many channels
  report that day.
- The bot never pings anyone: mentions are rendered without a notification, so nobody is
  notified by the summary, the leaderboard or a command reply.
- First place is the fewest guesses. The 10 points split as 1→10, 2→5, 3→3.5, 4→2.5,
  5→2, 6→1.5, rounded to the nearest 0.5 with a floor of 0.5. Rounding can pay out
  slightly more than 10 in total (a 3-way tie pays 10.5).
- A day ends at local midnight (`America/Indianapolis` by default). If the bot was
  offline, it closes missed days on the next start.

## Streak

- A day counts if **at least one player solved** the puzzle. A solver the bot has never
  seen before counts too: the summary names them, so they join at 0 points on the spot.
- The streak only breaks once a day is over: if nobody has solved yet today, yesterday's
  streak still stands.
- The streak **starts at the highest group streak** reported when the bot first scans the
  channels, then counts server-wide: each day with at least one winner adds one. Later
  Activity numbers do not move it. `/wordle-streak count:` can override it manually.
- A group's own summary can disagree with the server-wide streak (different channel,
  different group). When it does, the bot posts one short correction for the day, in the
  Wordle channel — a day summarised in several channels still gets a single correction:
  *"Um, actually 🤓☝️ — the streak is N days."* It is recorded in the store before it is
  posted, so restarting the bot cannot repeat it.

## Roles

- One role per player, named `<total> points` (`13.5 points`, `0 points`,
  `-114 points`), created with no permissions. Colours band the totals: grey under 10,
  green 10–24.5, blue 25–49.5, gold 50+.
- The role is renamed whenever the total changes; no nickname is used, so renaming yourself
  needs nothing extra.
- The role shows as a member's badge only if it is their highest role.
- The bot does not remove roles; a zero total keeps its `0 points` role.

---

## Hosting it yourself

### Requirements

- Node.js 20.11 or newer.
- One Discord server per bot; the store is single-guild (set `DISCORD_GUILD_ID` if the bot
  is in more than one).
- A Discord application with a bot user, invited with the **`bot`** scope.
- Privileged intents enabled in the Developer Portal → **Bot**: **Message Content** and
  **Server Members**.
- Bot permissions: **Manage Roles**, **View Channels**, **Send Messages**,
  **Read Message History**.

The bot's role must sit above the points roles it creates. New roles land at the bottom of
the list by default, so this normally works as-is.

### Setup

```powershell
git clone https://github.com/Marsgate/wordle-points-bot.git
cd wordle-points-bot
npm install
Copy-Item .env.example .env
```

Fill in `.env`:

```
DISCORD_TOKEN=...        # Developer Portal → Bot → Reset Token
DISCORD_GUILD_ID=...     # optional: register slash commands instantly
DISCORD_WORDLE_CHANNEL_ID=...  # optional: where server-wide notices are posted
DATA_DIR=./data          # optional: where the JSON store lives
TZ=America/Indianapolis  # day boundary, read on first run
DEBUG_TOOLS=false        # optional: enable /wordle-close and /wordle-reopen
```

`DISCORD_WORDLE_CHANNEL_ID` is the channel the bot brings up server-wide news in (the
streak correction). It is the channel Wordle is played in; leave it empty and that message
answers in the channel the summary came from. The board always follows the summary itself.

Invite the bot with the `bot` and `applications.commands` scopes and permission integer
`268504064` (View Channels, Send Messages, Read Message History, Manage Roles):

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&permissions=268504064&scope=bot%20applications.commands
```

Run it:

```powershell
npm run build
npm start
```

On first start the bot records the guild and the day it joined, so there is no setup
command to run. Players are added automatically the first time a summary mentions them,
at 0 points.

### Running unattended (Windows)

To keep the bot running outside any terminal, after logging in:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-bot-task.ps1
```

That registers a **WordleScoreBot** scheduled task which starts at logon, hides its
window, restarts the bot if it exits, and appends output to `logs\bot.log`. Undo it with:

```powershell
Unregister-ScheduledTask -TaskName "WordleScoreBot" -Confirm:$false
```

Run only one copy at a time — two instances would fight over the store.

### Development

```powershell
npm test          # 131 offline tests, no token or network needed
npm run typecheck # strict TypeScript
npm run build     # tsc -> dist/
npm run demo      # simulated Activity summary, prints the whole flow
```

The core (`src/core`, `src/services`) never imports `discord.js`; the tests drive the real
services through fake Discord ports.

### Data

State lives in `./data/wordle.json` (override with `DATA_DIR`): configuration, daily
entries, totals and role ids. Writes are atomic and a corrupt file is
moved aside rather than deleted — back it up if you care about the leaderboard.
