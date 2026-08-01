![Pipeline Status](https://github.com/hubotio/hubot/actions/workflows/pipeline.yml/badge.svg)

![Build Status: MacOS](https://github.com/hubotio/hubot/actions/workflows/nodejs-macos.yml/badge.svg)
![Build Status: Ubuntu](https://github.com/hubotio/hubot/actions/workflows/nodejs-ubuntu.yml/badge.svg)
![Build Status: Window](https://github.com/hubotio/hubot/actions/workflows/nodejs-windows.yml/badge.svg)

# Qrafty: a Slack reputation (plusplus) bot

This repository runs as a Slack bot that tracks reputation points for people in your workspace. It detects `++` and `--` anywhere in a message (see [`scripts/plusplus.mjs`](scripts/plusplus.mjs)):

| You say | What happens |
| --- | --- |
| `@Claude++` | @Claude gets +1 point |
| `@Claude ++` | Same — a space before the `++` also works |
| `@Claude--` (or `@Claude --`) | @Claude loses 1 point |
| `@Claude++ for being a great teammate` | +1 point, and the reason is recorded |
| `@qrafty @Claude` | The bot replies with @Claude's tally and the reasons points were added or deducted |
| `ship it` (anywhere in a message) | The bot posts the ship-it squirrel — bundled with the repo, no external image host needed. Requires the `files:write` bot scope |

After every `++`/`--` event the bot replies in the channel with the delta, the optional reason, and the running total, e.g. `+1 point for @Claude for being a great teammate, total points 4`. Multiple votes in a single message are all counted, and both plain `@name` and raw Slack `<@U12345>` mentions are supported.

Scores persist across restarts in `.data/plusplus.json` (override the location with the `PLUSPLUS_FILE` environment variable).

## Run it against Slack

```sh
npm install
npm install @hubot-friends/hubot-slack
HUBOT_SLACK_APP_TOKEN=xapp-your-app-token \
HUBOT_SLACK_BOT_TOKEN=xoxb-your-bot-token \
HUBOT_NAME=qrafty \
npm start -- -a @hubot-friends/hubot-slack
```

## Try it locally in a terminal

```sh
npm install
HUBOT_NAME=qrafty npm start -- -a Shell
qrafty> @Claude++ for being a great teammate
+1 point for @Claude for being a great teammate, total points 1
qrafty> @qrafty @Claude
@Claude has 1 point:
• +1 for being a great teammate
```

---

# Hubot

**Note: v10.0.4 accidentally contains the removal of CoffeeScript; v10.0.5 puts it back in**
**Note: v11 removes CoffeeScript and converts this codebase to ESM**

Hubot is a framework to build chat bots, modeled after GitHub's Campfire bot of the same name, hubot.
He's pretty cool. He's [extendable with scripts](https://hubotio.github.io/hubot/docs#scripts) and can work
on [many different chat services](https://hubotio.github.io/hubot/adapters.html).

This repository provides a library that's distributed by `npm` that you
use for building your own bots.  See the [documentation](https://hubotio.github.io/hubot/docs.html)
for details on getting up and running with your very own robot friend.

In most cases, you'll probably never have to hack on this repo directly if you
are building your own bot. But if you do, check out [CONTRIBUTING.md](CONTRIBUTING.md)

# Create your own Hubot instance

This will create a directory called `myhubot` in the current working directory.

```sh
npx hubot --create myhubot --adapter @hubot-friends/hubot-slack
npx hubot --create myhubot --adapter @hubot-friends/hubot-discord
npx hubot --create myhubot --adapter @hubot-friends/hubot-ms-teams
npx hubot --create myhubot --adapter @hubot-friends/hubot-irc
```

Review `scripts/example.mjs`. Create more scripts in the `scripts` folder.

## Command bus (robot.commands)

Hubot includes a deterministic command subsystem for slash-style commands. It is safe by default and does not interfere with legacy `hear` and `respond` listeners.

### Basic Command Registration

```mjs
export default (robot) => {
	robot.commands.register({
		id: 'tickets.create',
		description: 'Create a ticket',
		aliases: ['ticket new', 'new ticket'],
		args: {
			title: { type: 'string', required: true },
			priority: { type: 'enum', values: ['low', 'medium', 'high'], default: 'medium' }
		},
		sideEffects: ['creates external ticket'],
		handler: async (ctx) => {
			return `Created ticket: ${ctx.args.title}`
		}
	})
}
```

Invoke with addressing the bot:

- `@hubot tickets.create --title "VPN down" --priority high`
- `@hubot tickets.create title:"VPN down" priority:high`

Commands that declare side effects will require confirmation before execution.

The user is asked to confirm. They do so like so:
```sh
@hubot yes
@hubot no
@hubot cancel
```

Aliases are for discovery and search only. They do not execute commands or create proposals. They are intent utterances.

### Built-in Help Command

Hubot automatically registers a `help` command that provides command discovery and documentation:

```
@hubot help                          # List all commands
@hubot help tickets                  # Filter commands by prefix
@hubot help search "create ticket"   # Search by keyword, alias, description, or example
```

### Search for Commands

```mjs
const results = robot.commands.search('ticket new')
// [{ id: 'tickets.create', score: 100, matchedOn: 'alias' }, ...]
```

### Custom Type Resolvers

Extend validation with custom argument types:

```mjs
export default (robot) => {
	// Register custom type resolver
	robot.commands.registerTypeResolver('project_id', async (value, schema, context) => {
		if (!value.startsWith('PRJ-')) {
			throw new Error('must start with PRJ-')
		}
		return value.toUpperCase()
	})

	// Use it in a command
	robot.commands.register({
		id: 'projects.deploy',
		description: 'Deploy a project',
		args: {
			projectId: { type: 'project_id', required: true }
		},
		handler: async (ctx) => {
			return `Deploying ${ctx.args.projectId}`
		}
	})
}
```

### Configuration Options

When creating a CommandBus instance, you can configure:

- `prefix` - Command prefix (default: '')
- `proposalTTL` - Timeout for pending confirmations in milliseconds (default: 300000 = 5 minutes)
- `logPath` - Path to NDJSON event log file (default: `.data/commands-events.ndjson`)
- `disableLogging` - Disable event logging to disk (default: true - logging is disabled by default)
- `permissionProvider` - Custom permission checking handler (optional)

### Permissions

Control who can execute commands using room-based and role-based permissions.

#### Room-Based Permissions

Restrict command execution to specific chat rooms:

```mjs
robot.commands.register({
	id: 'sensitive.action',
	description: 'Admin-only action',
	permissions: {
		rooms: ['#admin', '#ops']  // Only allowed in these rooms
	},
	handler: async (ctx) => {
		return 'Action executed!'
	}
})
```

Users in other rooms get: `Permission denied: command not allowed in this room`

#### Role-Based Permissions

Restrict command execution to users with specific roles:

```mjs
robot.commands.register({
	id: 'deploy.production',
	description: 'Deploy to production',
	permissions: {
		roles: ['admin', 'devops']  // Only users with these roles
	},
	handler: async (ctx) => {
		return 'Deploying...'
	}
})
```

To enable role checking, provide a `permissionProvider` when creating CommandBus:

```mjs
const commandBus = new CommandBus(robot, {
	permissionProvider: {
		hasRole: async (user, requiredRoles, context) => {
			// Custom logic to check if user has any of the required roles
			const userRoles = await fetchUserRoles(user.id)
			return requiredRoles.some(role => userRoles.includes(role))
		}
	}
})
```

Without a permission provider, role-based permissions are ignored (allow by default). Room-based permissions are always enforced.

## License

See the [LICENSE](LICENSE.md) file for license rights and limitations (MIT).

# Hubot History

[Say hello to Hubot](https://github.blog/2011-10-25-say-hello-to-hubot/)

[Cartoon with Hubot](https://www.youtube.com/watch?v=vq2jYFZVMDA&t=129s)

[The Most Important Startup's Hardest Worker Isn't a Person](https://www.wired.com/2015/10/the-most-important-startups-hardest-worker-isnt-a-person/)

[The Story of Hubot](https://www.youtube.com/watch?v=Je4TjjtFDNU)

[Hubot by Hubotics](https://www.theoldrobots.com/hubot.html)

[Automating Inefficiencies](https://zachholman.com/2011/01/automating-inefficiencies/)

[Getting Started with Hubot](https://www.youtube.com/watch?v=A7fh6RIzGrw)