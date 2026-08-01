'use strict'

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { Robot } from '../index.mjs'
import dummyRobot from './doubles/DummyAdapter.mjs'
import { FALLBACK_TEXT } from '../scripts/shipit.mjs'

describe('ship it script', () => {
  let robot = null
  let user = null
  let sent = null
  let uploads = null

  beforeEach(async () => {
    robot = new Robot(dummyRobot, false, 'qrafty')
    await robot.loadAdapter()
    await robot.run()
    await robot.loadFile('./scripts', 'shipit.mjs')
    user = robot.brain.userForId('test-user', { name: 'tester' })
    sent = []
    robot.on('send', (envelope, ...strings) => {
      sent.push(strings.join(''))
    })
    uploads = []
    robot.shipItUploader = async (image, res) => {
      uploads.push({ image, room: res.message.user.room })
    }
  })

  afterEach(() => {
    robot.shutdown()
  })

  const say = async message => {
    await robot.adapter.say(user, message, 'general')
  }

  it('uploads the squirrel when someone says ship it', async () => {
    await say('ship it')
    assert.equal(uploads.length, 1)
    assert.equal(uploads[0].room, 'general')
  })

  it('uploads the same bytes as the committed base64 asset', async () => {
    await say('ship it')
    const expected = Buffer.from(
      fs.readFileSync(path.join('assets', 'ship-it.jpg.b64'), 'utf8'),
      'base64'
    )
    assert.ok(uploads[0].image.equals(expected))
    assert.equal(uploads[0].image.subarray(0, 2).toString('hex'), 'ffd8')
    assert.equal(uploads[0].image.subarray(-2).toString('hex'), 'ffd9')
  })

  it('detects ship it anywhere in a message, any casing', async () => {
    await say('LGTM, Ship It! :rocket:')
    assert.equal(uploads.length, 1)
  })

  it('detects the shipit variant', async () => {
    await say('shipit')
    assert.equal(uploads.length, 1)
  })

  it('ignores words that merely contain ship', async () => {
    await say('the shipment is late')
    await say('what a hardship it was')
    assert.equal(uploads.length, 0)
    assert.deepEqual(sent, [])
  })

  it('falls back to text when no Slack token is available', async () => {
    delete robot.shipItUploader
    const token = process.env.HUBOT_SLACK_BOT_TOKEN
    delete process.env.HUBOT_SLACK_BOT_TOKEN
    try {
      await say('ship it')
    } finally {
      if (token) process.env.HUBOT_SLACK_BOT_TOKEN = token
    }
    assert.deepEqual(sent, [FALLBACK_TEXT])
  })
})
