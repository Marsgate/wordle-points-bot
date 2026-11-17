# WordleScoreBot

A self-hosted Discord bot that turns the server's daily Wordle results into points, keeps
the scoreboard in a **personal role** (`𝓐𝓭𝓪 ✦ · 13.5 pts`), and locks a **spoiler
channel** until you have finished the day's puzzle.

## The basics

1. Register once with the total you are starting from: `/wordle-register points:0`
2. Play `/wordle`, then `/share` (or paste the result) **in any channel**.
3. At midnight, first place earns **10 points**. Ties split the prize, rounded to the
   nearest half point — a 3-way tie pays 3.5 each.
4. Your total lives in your personal role. It updates at the close of the day, and 0 or
   negative totals are normal — they get a role too.

Finishing the puzzle (even with an X/6) unlocks `#wordle-spoilers` until the next
midnight.

The bot never reads points from names and never edits nicknames.

## Commands

**For everyone**

| Command | What it does |
|---|---|
| `/wordle-register points:` | Join the game and set your starting total |
| `/wordle-unregister [user:]` | Leave and drop your role (admins can remove others) |
| `/points [user:]` | Your total, wins, and today's standing |
| `/wordle-leaderboard [scope:]` | Today's ranking, or the all-time board |
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
- First place is the fewest guesses. The 10 points split as 1→10, 2→5, 3→3.5, 4→2.5,
  6→1.5, rounded to the nearest 0.5 with a floor of 0.5. Rounding can pay out slightly
  more than 10 in total (a 3-way tie pays 10.5).
- A day ends at local midnight (`America/Indianapolis` by default). If the bot was
  offline, it closes missed days on the next start. Admins can close or reopen a day
  early.

## Roles and spoilers

- One role per registered member, named `<their name> · <total> pts`, created with no
  permissions. Colours band the totals: grey under 10, green 10–24.5, blue 25–49.5, gold
  50+.
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
git clone <this-repo>
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
`402721792` (View Channels, Send Messages, Read Message History, Manage Roles):

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&permissions=402721792&scope=bot%20applications.commands
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
npm test          # 128 offline tests, no token or network needed
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
