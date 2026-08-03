'use strict'

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Robot } from '../index.mjs'
import dummyRobot from './doubles/DummyAdapter.mjs'

describe('plusplus reputation script', () => {
  let robot = null
  let user = null
  let sent = null
  let tmpDir = null

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'plusplus-'))
    process.env.PLUSPLUS_FILE = path.join(tmpDir, 'plusplus.json')
    process.env.PLUSPLUS_SPAM_WINDOW_SECONDS = '0'
    robot = new Robot(dummyRobot, false, 'qrafty')
    await robot.loadAdapter()
    await robot.run()
    await robot.loadFile('./scripts', 'plusplus.mjs')
    user = robot.brain.userForId('test-user', { name: 'tester' })
    sent = []
    robot.on('send', (envelope, ...strings) => {
      sent.push(strings.join(''))
    })
  })

  afterEach(() => {
    delete process.env.PLUSPLUS_FILE
    delete process.env.PLUSPLUS_SPAM_WINDOW_SECONDS
    robot.shutdown()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const say = async message => {
    await robot.adapter.say(user, message, 'general')
  }

  it('awards a point for @user++', async () => {
    await say('@Claude++')
    assert.deepEqual(sent, ['+1 point for @Claude, total points 1'])
  })

  it('awards a point for the spaced variant @user ++', async () => {
    await say('@Claude ++')
    assert.deepEqual(sent, ['+1 point for @Claude, total points 1'])
  })

  it('deducts a point for @user--', async () => {
    await say('@Claude--')
    assert.deepEqual(sent, ['-1 point for @Claude, total points -1'])
  })

  it('deducts a point for the spaced variant @user --', async () => {
    await say('@Claude --')
    assert.deepEqual(sent, ['-1 point for @Claude, total points -1'])
  })

  it('records the reason when one is given', async () => {
    await say('@Claude++ for being a great teammate')
    assert.deepEqual(sent, ['+1 point for @Claude for being a great teammate, total points 1'])
  })

  it('keeps a running total across events', async () => {
    await say('@Claude++')
    await say('@Claude++ for shipping the release')
    await say('@Claude--')
    assert.deepEqual(sent, [
      '+1 point for @Claude, total points 1',
      '+1 point for @Claude for shipping the release, total points 2',
      '-1 point for @Claude, total points 1'
    ])
  })

  it('detects votes anywhere in a message', async () => {
    await say('huge thanks to @Claude++')
    assert.deepEqual(sent, ['+1 point for @Claude, total points 1'])
  })

  it('handles Slack-style <@ID> mentions', async () => {
    await say('<@U12345>++ for the code review')
    assert.deepEqual(sent, ['+1 point for <@U12345> for the code review, total points 1'])
  })

  it('handles Slack-style <@ID|name> mentions', async () => {
    await say('<@U12345|claude> ++')
    assert.deepEqual(sent, ['+1 point for <@U12345>, total points 1'])
  })

  it('handles multiple votes in one message', async () => {
    await say('@alice++ for helping out @bob-- for breaking the build')
    assert.deepEqual(sent, [
      '+1 point for @alice for helping out, total points 1',
      '-1 point for @bob for breaking the build, total points -1'
    ])
  })

  it('treats user names as case-insensitive', async () => {
    await say('@Claude++')
    await say('@claude++')
    assert.equal(sent[1], '+1 point for @claude, total points 2')
  })

  it('does not treat email addresses as votes', async () => {
    await say('ping me at test@example.com++')
    assert.deepEqual(sent, [])
  })

  it('replies with the tally and reasons when asked about a user', async () => {
    await say('@Claude++ for being a great teammate')
    await say('@Claude++ for being a great teammate')
    await say('@Claude-- for missing standup')
    await say('@Claude++')
    sent = []
    await say('@qrafty @Claude')
    assert.equal(sent.length, 1)
    assert.equal(sent[0], [
      '@Claude has 2 points:',
      '• +2 for being a great teammate',
      '• -1 for missing standup',
      '• +1 (no reason given)'
    ].join('\n'))
  })

  it('replies when a user has no points yet', async () => {
    await say('@qrafty @nobody')
    assert.deepEqual(sent, ['@nobody has no points yet.'])
  })

  it('awards points to several users with {curly, brace} groups', async () => {
    await say('{@alice, @bob}++ for great pairing')
    assert.deepEqual(sent, [
      '+1 point for @alice for great pairing, total points 1',
      '+1 point for @bob for great pairing, total points 1'
    ])
  })

  it('deducts points from a group too', async () => {
    await say('{@alice, @bob}-- for breaking prod')
    assert.deepEqual(sent, [
      '-1 point for @alice for breaking prod, total points -1',
      '-1 point for @bob for breaking prod, total points -1'
    ])
  })

  it('blocks giving yourself a point', async () => {
    await say('@tester++ for being awesome')
    assert.deepEqual(sent, ["Hey @tester, no cheating — you can't give yourself points!"])
    sent = []
    await say('@qrafty @tester')
    assert.deepEqual(sent, ['@tester has no points yet.'])
  })

  it('still allows self-deprecation with --', async () => {
    await say('@tester-- for missing the meeting')
    assert.deepEqual(sent, ['-1 point for @tester for missing the meeting, total points -1'])
  })

  it('spam-filters rapid repeat votes to the same person', async () => {
    process.env.PLUSPLUS_SPAM_WINDOW_SECONDS = '60'
    const robot2 = new Robot(dummyRobot, false, 'qrafty')
    await robot2.loadAdapter()
    await robot2.run()
    await robot2.loadFile('./scripts', 'plusplus.mjs')
    const sent2 = []
    robot2.on('send', (envelope, ...strings) => {
      sent2.push(strings.join(''))
    })
    const user2 = robot2.brain.userForId('test-user', { name: 'tester' })
    await robot2.adapter.say(user2, '@Claude++', 'general')
    await robot2.adapter.say(user2, '@Claude++', 'general')
    robot2.shutdown()
    assert.deepEqual(sent2, [
      '+1 point for @Claude, total points 1',
      'Looks like you hit the spam filter — you recently sent @Claude a point. Please slow your roll.'
    ])
  })

  it('shows top and bottom leaderboards', async () => {
    await say('@alice++')
    await say('@alice++')
    await say('@bob++')
    await say('@carol--')
    sent = []
    await say('@qrafty top 2')
    assert.deepEqual(sent, ['1. @alice: 2\n2. @bob: 1'])
    sent = []
    await say('@qrafty bottom 1')
    assert.deepEqual(sent, ['1. @carol: -1'])
  })

  it('erases a user completely', async () => {
    await say('@alice++')
    sent = []
    await say('@qrafty erase @alice')
    assert.deepEqual(sent, ['Erased all points for @alice. A clean slate!'])
    sent = []
    await say('@qrafty @alice')
    assert.deepEqual(sent, ['@alice has no points yet.'])
  })

  it('erases only the points for one reason', async () => {
    await say('@alice++ for helping')
    await say('@alice++ for helping')
    await say('@alice++ for snacks')
    sent = []
    await say('@qrafty erase @alice for helping')
    assert.deepEqual(sent, ['Erased 2 entries (+2) for helping for @alice, total points 1'])
  })

  it('knows how much points are worth', async () => {
    await say('@qrafty how much are points worth?')
    assert.deepEqual(sent, ['Points are made up and redeemable for absolutely nothing — except eternal glory, of course. :trophy:'])
  })

  it('persists scores to disk and loads them on startup', async () => {
    await say('@Claude++')
    const saved = JSON.parse(fs.readFileSync(process.env.PLUSPLUS_FILE, 'utf8'))
    assert.equal(saved.claude.score, 1)

    const robot2 = new Robot(dummyRobot, false, 'qrafty')
    await robot2.loadAdapter()
    await robot2.run()
    await robot2.loadFile('./scripts', 'plusplus.mjs')
    const sent2 = []
    robot2.on('send', (envelope, ...strings) => {
      sent2.push(strings.join(''))
    })
    await robot2.adapter.say(robot2.brain.userForId('test-user', { name: 'tester' }), '@Claude++', 'general')
    robot2.shutdown()
    assert.deepEqual(sent2, ['+1 point for @Claude, total points 2'])
  })
})
