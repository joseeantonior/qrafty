// Description:
//   Reputation (karma) points for your team. Detects `++` and `--` anywhere in a
//   message: `@user++`, `@user ++`, `@user--`, `@user --`, optionally followed by
//   a reason (e.g. `@user++ for being a great teammate`). Works with plain
//   `@name` mentions and Slack-style `<@U12345>` / `<@U12345|name>` mentions.
//   After each event the bot replies with the delta, the reason (if given) and
//   the user's running total. Ask the bot about a user (`@bot @user`) to get
//   their tally and the reasons behind it.
//
// Configuration:
//   PLUSPLUS_FILE - Path of the JSON file used to persist scores. Defaults to
//                   .data/plusplus.json in the working directory.
//
// Commands:
//   @<user>++ [reason] - Award a point to <user>, optionally recording a reason.
//   @<user>-- [reason] - Deduct a point from <user>, optionally recording a reason.
//   hubot @<user> - Show <user>'s point tally and the reasons points were added or deducted.
//
// Author:
//   qrafty

import fs from 'node:fs'
import path from 'node:path'

export const BRAIN_KEY = 'plusplus'

// A mention is either a raw Slack mention (<@U123> or <@U123|display>) or a
// plain @name. Kept as a source string so each listener gets its own RegExp.
const MENTION = '(?:<@(?<id>[^>|\\s]+)(?:\\|(?<label>[^>]*))?>|@(?<name>[\\w.\\-]+))'
// The lookbehind keeps things like `user@example.com++` from being counted as
// a vote for `@example.com`.
const VOTE = `(?<![\\w@])${MENTION}[ \\t]*(?<op>\\+\\+|--)`

const keyAndDisplayFor = groups => {
  if (groups.id) {
    // Reply with <@ID> so Slack renders it as a mention.
    return { key: `id:${groups.id}`, display: `<@${groups.id}>` }
  }
  return { key: groups.name.toLowerCase(), display: `@${groups.name}` }
}

// The reason is whatever follows the operator on the same line, up to the next
// vote in the message. Leading/trailing separators are dropped.
const extractReason = (text, from, to) => {
  return text.slice(from, to)
    .split('\n')[0]
    .replace(/^[\s,;:!.]+/, '')
    .replace(/[\s,;]+$/, '')
    .trim()
}

const formatReasons = entry => {
  const totals = new Map()
  for (const event of entry.log) {
    const reason = event.reason || '(no reason given)'
    totals.set(reason, (totals.get(reason) ?? 0) + event.delta)
  }
  return [...totals.entries()].map(([reason, net]) => {
    return `• ${net > 0 ? '+' : ''}${net} ${reason}`
  })
}

export default async robot => {
  const storagePath = process.env.PLUSPLUS_FILE ?? path.join('.data', 'plusplus.json')

  let scores = {}
  try {
    scores = JSON.parse(fs.readFileSync(storagePath, 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      robot.logger.error(`plusplus: could not read ${storagePath}: ${error.message}`)
    }
  }
  robot.brain.set(BRAIN_KEY, scores)

  const persist = () => {
    try {
      fs.mkdirSync(path.dirname(storagePath), { recursive: true })
      fs.writeFileSync(storagePath, JSON.stringify(scores, null, 2))
    } catch (error) {
      robot.logger.error(`plusplus: could not write ${storagePath}: ${error.message}`)
    }
  }

  // Award/deduct points: matches every vote in the message, wherever it appears.
  robot.hear(new RegExp(VOTE), async res => {
    const text = res.message.text ?? ''
    const votes = [...text.matchAll(new RegExp(VOTE, 'g'))]
    for (let i = 0; i < votes.length; i++) {
      const vote = votes[i]
      const { key, display } = keyAndDisplayFor(vote.groups)
      const delta = vote.groups.op === '++' ? 1 : -1
      const reasonEnd = i + 1 < votes.length ? votes[i + 1].index : text.length
      const reason = extractReason(text, vote.index + vote[0].length, reasonEnd)

      const entry = scores[key] ?? { display, score: 0, log: [] }
      scores[key] = entry
      entry.display = display
      entry.score += delta
      entry.log.push({
        delta,
        reason: reason || null,
        by: res.message.user?.name ?? null,
        at: new Date().toISOString()
      })

      await res.send(`${delta > 0 ? '+1' : '-1'} point for ${display}${reason ? ` ${reason}` : ''}, total points ${entry.score}`)
    }
    if (votes.length > 0) {
      robot.brain.set(BRAIN_KEY, scores)
      persist()
    }
  })

  // Tally lookup: "@bot @user" (or "@bot score @user" / "@bot score for @user")
  // replies with the user's total and the reasons behind it.
  robot.respond(new RegExp(`(?:score\\s+(?:for\\s+)?)?${MENTION}\\s*$`, 'i'), async res => {
    const { key, display } = keyAndDisplayFor(res.match.groups)
    const entry = scores[key]
    if (!entry || entry.log.length === 0) {
      await res.send(`${display} has no points yet.`)
      return
    }
    const lines = [`${entry.display} has ${entry.score} point${entry.score === 1 || entry.score === -1 ? '' : 's'}:`]
    lines.push(...formatReasons(entry))
    await res.send(lines.join('\n'))
  })
}
