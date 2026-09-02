# VDS

A lightweight, production-ready Discord utility bot focused on three systems: XP leveling, voice join/leave, and reaction roles.

## Systems

- **Leveling** — message XP with per-user cooldown, in-memory accumulation, batched PostgreSQL writes, rank and leaderboard commands.
- **Voice** — `/join` and `/leave` using `@discordjs/voice`; no music or recording.
- **Reaction roles** — map any emoji on an existing message to a role. React to receive the role; remove the reaction to remove it.
- **Production runtime** — environment validation, structured logs, graceful shutdown, PostgreSQL pooling, Docker support.

## Commands

- `/ping`
- `/rank [user]`
- `/leaderboard`
- `/join`
- `/leave`
- `/reactionrole add message:<id> emoji:<emoji> role:<role>`
- `/reactionrole remove message:<id> emoji:<emoji>`
- `/reactionrole list message:<id>`

Reaction-role management requires **Manage Roles**. VDS also validates role hierarchy before making changes.

## Database load design

VDS intentionally does not write XP for every message. A user's XP is loaded once, accumulated in memory, and flushed in a transaction on a short interval. A message cooldown prevents spam from generating XP work. Reaction-role mappings are configuration data; member reactions are not stored in PostgreSQL.

The PostgreSQL schema is created idempotently on startup and contains only three small tables: `guild_members`, `guild_settings`, and `reaction_roles`.

## Setup

Requirements: Node.js 22+, PostgreSQL 14+, and a Discord application.

```bash
npm install
cp .env.example .env
npm run deploy
npm start
```

For local development, set `DEV_GUILD_ID` before `npm run deploy` so slash commands register immediately to one server. Leave it empty for global commands.

### Discord intents

VDS only requests:

- Guilds
- Guild Messages
- Guild Message Reactions
- Guild Voice States

It deliberately does **not** request the privileged Message Content intent. XP is awarded from message events without reading message text.

The bot needs permission to view/send messages, add reactions, connect to voice, and manage roles for reaction-role operation. Its highest role must be above every role it should assign.

## Hosting

The project is ready for any Node.js host that can provide a persistent process and PostgreSQL. Use:

```bash
npm start
```

or the included Dockerfile.

Required environment variables:

```text
DISCORD_TOKEN=
CLIENT_ID=
DATABASE_URL=
```

Optional tuning:

```text
DEV_GUILD_ID=
XP_FLUSH_INTERVAL_MS=30000
XP_MESSAGE_COOLDOWN_MS=60000
XP_MIN=15
XP_MAX=25
LOG_LEVEL=info
```

## Architecture

```text
Discord Gateway
      |
      v
  VDS runtime
   |       |
   |       +--> Voice connection
   |
   +--> XP cache ----batched----> PostgreSQL
   |
   +--> Reaction-role cache ----> PostgreSQL configuration
```

The project intentionally avoids Redis, a web dashboard, queues, or a separate API in V1. Those services would add operational and database overhead without improving the requested systems.

## Inspiration and engineering choices

The architecture was compared against several public Discord bot projects. The useful ideas were adapted rather than copied:

- `qwertyvan/Discord-Bot` — production-oriented separation, environment discipline, PostgreSQL, and modular feature thinking.
- `finonite/Discord.JS-Leveling-Bot` — practical rank/leaderboard leveling concepts; its older SQLite/Canvas stack was intentionally not adopted.
- `makigas/discordjs-reaction-role` — the simple reaction-to-role contract and partial reaction handling.
- `rolereactor/bot` — role hierarchy and production-safety concepts; its much larger feature set was intentionally avoided for VDS.

VDS is an independent implementation. No third-party source code is copied into this repository.

## License

MIT
