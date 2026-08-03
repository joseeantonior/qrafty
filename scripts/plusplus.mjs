// Description:
//   Reputation (karma) points for your team, in the spirit of
//   hubot-plusplus-expanded. Detects `++` and `--` anywhere in a message:
//   `@user++`, `@user ++`, `@user--`, `@user --`, optionally followed by a
//   reason (e.g. `@user++ for being a great teammate`). Group votes with
//   `{@user1, @user2}++`. Works with plain `@name` mentions and Slack-style
//   `<@U12345>` mentions. After each event the bot replies with the delta,
//   the reason (if given) and the running total. Self-plusplus is blocked and
//   rapid repeat votes to the same person are spam-filtered.
//
// Configuration:
//   PLUSPLUS_FILE - Path of the JSON file used to persist scores. Defaults to
//                   .data/plusplus.json in the working directory.
//   PLUSPLUS_SPAM_WINDOW_SECONDS - Seconds a voter must wait before sending
//                   the same person another point. Defaults to 30; 0 disables.
//
// Commands:
//   @<user>++ [reason] - Award a point to <user>, optionally recording a reason.
//   @<user>-- [reason] - Deduct a point from <user>, optionally recording a reason.
//   {@<user1>, @<user2>}++ [reason] - Award a point to several users at once.
//   hubot @<user> - Show <user>'s point tally and the reasons points were added or deducted.
//   hubot top <amount> - Show the highest scoring users.
//   hubot bottom <amount> - Show the lowest scoring users.
//   hubot erase @<user> [reason] - Erase a user's score, or just the points for one reason.
//   hubot how much are points worth - The eternal question.
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
const GROUP_VOTE = '\\{(?<grp>[^{}]+)\\}[ \\t]*(?<gop>\\+\\+|--)'

const keyAndDisplayFor = groups => {
  if (groups.id) {
    // Reply with <@ID> so Slack renders it as a mention.
    return { key: `id:${groups.id}`, display: `<@${groups.id}>` }
  }
  return { key: groups.name.toLowerCase(), display: `@${groups.name}` }
}

// Every vote in the message, in order of appearance. A vote is either a
// single mention or a {curly, brace}++ group targeting several users.
const collectVotes = text => {
  const votes = []
  for (const m of text.matchAll(new RegExp(VOTE, 'g'))) {
    votes.push({
      index: m.index,
      end: m.index + m[0].length,
      delta: m.groups.op === '++' ? 1 : -1,
      targets: [keyAndDisplayFor(m.groups)]
    })
  }
  for (const m of text.matchAll(new RegExp(GROUP_VOTE, 'g'))) {
    const targets = [...m.groups.grp.matchAll(new RegExp(MENTION, 'g'))]
      .map(g => keyAndDisplayFor(g.groups))
    if (targets.length > 0) {
      votes.push({
        index: m.index,
        end: m.index + m[0].length,
        delta: m.groups.gop === '++' ? 1 : -1,
        targets
      })
    }
  }
  return votes.sort((a, b) => a.index - b.index)
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

const isSelf = (user, target) => {
  if (user == null) return false
  if (target.key === `id:${user.id}`) return true
  return user.name != null && target.key === String(user.name).toLowerCase()
}

export default async robot => {
  const storagePath = process.env.PLUSPLUS_FILE ?? path.join('.data', 'plusplus.json')
  const spamWindowMs = 1000 * (process.env.PLUSPLUS_SPAM_WINDOW_SECONDS != null
    ? Number(process.env.PLUSPLUS_SPAM_WINDOW_SECONDS)
    : 30)
  const recentVotes = new Map()

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
  robot.listen(
    message => {
      if (typeof message.text !== 'string') return false
      const votes = collectVotes(message.text)
      return votes.length > 0 ? votes : false
    },
    async res => {
      const text = res.message.text
      const votes = res.match
      const voter = res.message.user
      let changed = false
      for (let i = 0; i < votes.length; i++) {
        const vote = votes[i]
        const reasonEnd = i + 1 < votes.length ? votes[i + 1].index : text.length
        const reason = extractReason(text, vote.end, reasonEnd)
        for (const target of vote.targets) {
          if (vote.delta > 0 && isSelf(voter, target)) {
            await res.send(`Hey ${target.display}, no cheating — you can't give yourself points!`)
            continue
          }
          if (spamWindowMs > 0 && voter != null) {
            const spamKey = `${voter.id}|${target.key}`
            const last = recentVotes.get(spamKey)
            if (last != null && Date.now() - last < spamWindowMs) {
              await res.send(`Looks like you hit the spam filter — you recently sent ${target.display} a point. Please slow your roll.`)
              continue
            }
            recentVotes.set(spamKey, Date.now())
          }

          const entry = scores[target.key] ?? { display: target.display, score: 0, log: [] }
          scores[target.key] = entry
          entry.display = target.display
          entry.score += vote.delta
          entry.log.push({
            delta: vote.delta,
            reason: reason || null,
            by: voter?.name ?? null,
            at: new Date().toISOString()
          })
          changed = true

          const flare = entry.score !== 0 && entry.score % 100 === 0 ? ' :100:' : ''
          await res.send(`${vote.delta > 0 ? '+1' : '-1'} point for ${target.display}${reason ? ` ${reason}` : ''}, total points ${entry.score}${flare}`)
        }
      }
      if (changed) {
        robot.brain.set(BRAIN_KEY, scores)
        persist()
      }
    }
  )

  // Leaderboards: "@bot top 5" / "@bot bottom 5".
  robot.respond(/(top|bottom)\s+(\d+)\s*$/i, async res => {
    const direction = res.match[1].toLowerCase()
    const amount = Math.max(1, Math.min(25, parseInt(res.match[2], 10)))
    const ranked = Object.values(scores)
      .sort((a, b) => (direction === 'top' ? b.score - a.score : a.score - b.score))
      .slice(0, amount)
    if (ranked.length === 0) {
      await res.send('No scores yet — get out there and ++ somebody!')
      return
    }
    const lines = ranked.map((entry, i) => `${i + 1}. ${entry.display}: ${entry.score}`)
    await res.send(lines.join('\n'))
  })

  // Erase a user's score entirely, or only the points tied to one reason.
  robot.respond(new RegExp(`erase\\s+${MENTION}(?:\\s+(?<why>.+?))?\\s*$`, 'i'), async res => {
    const { key, display } = keyAndDisplayFor(res.match.groups)
    const why = res.match.groups.why?.trim()
    const entry = scores[key]
    if (!entry) {
      await res.send(`${display} has no points to erase.`)
      return
    }
    if (why) {
      const matching = entry.log.filter(e => (e.reason ?? '').toLowerCase() === why.toLowerCase())
      if (matching.length === 0) {
        await res.send(`${display} has no points ${why}.`)
        return
      }
      const removed = matching.reduce((sum, e) => sum + e.delta, 0)
      entry.log = entry.log.filter(e => (e.reason ?? '').toLowerCase() !== why.toLowerCase())
      entry.score -= removed
      await res.send(`Erased ${matching.length} entr${matching.length === 1 ? 'y' : 'ies'} (${removed > 0 ? '+' : ''}${removed}) ${why} for ${display}, total points ${entry.score}`)
    } else {
      delete scores[key]
      await res.send(`Erased all points for ${display}. A clean slate!`)
    }
    robot.brain.set(BRAIN_KEY, scores)
    persist()
  })

  // The eternal question.
  robot.respond(/how much (?:are|is).*points?.*worth\s*\??\s*$/i, async res => {
    await res.send('Points are made up and redeemable for absolutely nothing — except eternal glory, of course. :trophy:')
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
