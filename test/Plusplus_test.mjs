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
