# WordleScoreBot

A self-hosted Discord bot that turns the server's daily Wordle results into points, keeps
the scoreboard in a **personal role** named after the score (`13.5 points`), and locks a
**spoiler channel** until you have finished the day's puzzle.

## The basics

1. Register once with the total you are starting from: `/wordle-register points:0`
2. Play `/wordle`, then `/share` (or paste the result) **in any channel**.
3. At midnight, first place earns **10 points**. Ties split the prize, rounded to the
   nearest half point — a 3-way tie pays 3.5 each.
4. Your total lives in your personal role. It updates at the close of the day, and 0 or
   negative totals are normal — they get a role too.

Finishing the puzzle (even with an X/6) unlocks `#wordle-spoilers` until the next
midnight.

The bot also reads the Activity's **daily summary** each morning. That summary lists every
player's score, so registered members are scored even if they never post a share — shares
are what unlock the spoiler channel during the day.

The server's **streak** — consecutive days with at least one solver — is tracked too;
`/wordle-streak` reports it, and an admin can seed it with the number you had before the
bot (`/wordle-streak count:105`).

The bot never reads points from names and never edits nicknames.

## Commands

**For everyone**

| Command | What it does |
|---|---|
| `/wordle-register points:` | Join the game and set your starting total |
| `/wordle-unregister [user:]` | Leave and drop your role (admins can remove others) |
| `/points [user:]` | Your total, wins, and today's standing |
| `/wordle-leaderboard [scope:]` | Today's ranking, or the all-time board |
| `/wordle-streak [count:]` | The server's day streak; admins can set it (0 clears) |
| `/wordle-status` | Configuration, registered count, today's shares |

**For admins**

| Command | What it does |
|---|---|
| `/wordle-setup spoilers:` | Pick the channel that stays hidden until you finish |
| `/wordle-close` | End today now and award points (later shares today do not count) |
| `/wordle-reopen` | Undo a close and let later shares count again |
| `/wordle-award user: points:` | Correct a total; halves and negatives allowed |
| `/wordle-resync` | Re-apply stored totals to roles (e.g. after a rename) |

## How points work

- Only **solvers** place. An X/6 finishes the puzzle and unlocks spoilers but scores 0.
- Your **best** share of the day counts: 5/6 followed by 3/6 keeps the 3/6.
- Results come from two places: the share you post during the day, and the Activity's
  daily summary the next morning. They are merged per player, keeping the better score.
- Only **registered** members are scored. Unregistered players in the summary are ignored,
  so they never take the prize.
- First place is the fewest guesses. The 10 points split as 1→10, 2→5, 3→3.5, 4→2.5,
  6→1.5, rounded to the nearest 0.5 with a floor of 0.5. Rounding can pay out slightly
  more than 10 in total (a 3-way tie pays 10.5).
- A day ends at local midnight (`America/Indianapolis` by default). If the bot was
  offline, it closes missed days on the next start. Admins can close or reopen a day
  early.

## Streak

- A day counts if **at least one member solved** the puzzle. Consecutive counted days make
  the streak.
- The streak only breaks once a day is over: if nobody has solved yet today, yesterday's
  streak still stands.
- The streak **starts at the highest group streak** reported around setup (the initial scan
  collects every channel's summary), then counts server-wide: each day with at least one
  winner adds one. Later Activity numbers do not move it. `/wordle-streak count:` can
  override it manually.
- A group's own summary can disagree with the server-wide streak (different channel,
  different group). When it does, the bot posts a short correction in that channel:
  *"Um, actually — the server-wide streak is N days."*

## Roles and spoilers

- One role per registered member, named `<total> points` (`13.5 points`, `0 points`,
  `-114 points`), created with no permissions. Colours band the totals: grey under 10,
  green 10–24.5, blue 25–49.5, gold 50+.
- The role is renamed whenever the total changes; no nickname is used, so renaming yourself
  needs no resync.
- The role shows as a member's badge only if it is their highest role.
- `/wordle-unregister` is the only thing that removes a role — not a zero total.
- The spoiler channel is denied to `@everyone` and opened per member when their share is
  recorded; it re-locks at the next midnight.

---

## Hosting it yourself

### Requirements

- Node.js 20.11 or newer.
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
TZ=America/Indianapolis  # day boundary, read on first run
```

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

Then, in the server, once:

```
/wordle-setup spoilers:#wordle-spoilers
```

Members register themselves with `/wordle-register points:0` (or their existing total) and
delete any points text from their own nicknames.

### Development

```powershell
npm test          # 161 offline tests, no token or network needed
npm run typecheck # strict TypeScript
npm run build     # tsc -> dist/
npm run demo      # simulated Wordle day, prints the whole flow
```

The core (`src/core`, `src/services`) never imports `discord.js`; the tests drive the real
services through fake Discord ports.

### Data

State lives in `./data/wordle.json` (override with `DATA_DIR`): configuration, daily
entries, totals, registration flags and role ids. Writes are atomic and a corrupt file is
moved aside rather than deleted — back it up if you care about the leaderboard.
