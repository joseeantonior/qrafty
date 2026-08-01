// Description:
//   Posts the ship-it squirrel whenever someone says "ship it" (or "shipit")
//   anywhere in a message. The image ships with the repo as base64
//   (assets/ship-it.jpg.b64) and is uploaded to Slack directly, so there is no
//   dependency on any external image host.
//
// Configuration:
//   HUBOT_SLACK_BOT_TOKEN - Bot token used to upload the image to Slack.
//                           Requires the files:write scope. Without a token
//                           (e.g. Shell adapter) a text fallback is sent.
//
// Commands:
//   ship it - Replies with the ship-it squirrel image.
//
// Author:
//   qrafty

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const IMAGE_PATH = path.join(__dirname, '..', 'assets', 'ship-it.jpg.b64')
export const FALLBACK_TEXT = ':shipit: SHIP IT! :rocket:'

const defaultUploader = robot => {
  let web = null
  return async (image, res) => {
    const token = process.env.HUBOT_SLACK_BOT_TOKEN
    if (!token) {
      await res.send(FALLBACK_TEXT)
      return
    }
    try {
      if (!web) {
        const { WebClient } = await import('@slack/web-api')
        web = new WebClient(token, { logLevel: 'error' })
      }
      // The hyphen in the filename matters: it keeps the file-share event
      // Slack echoes back from re-matching the "ship it" listener.
      await web.filesUploadV2({
        channel_id: res.message.user.room,
        file: image,
        filename: 'ship-it.jpg'
      })
    } catch (error) {
      robot.logger.error(`shipit: upload failed: ${error.message}`)
      await res.send(FALLBACK_TEXT)
    }
  }
}

export default async robot => {
  let image = null
  try {
    image = Buffer.from(fs.readFileSync(IMAGE_PATH, 'utf8'), 'base64')
  } catch (error) {
    robot.logger.error(`shipit: could not read ${IMAGE_PATH}: ${error.message}`)
  }

  robot.hear(/\bship\s?it\b/i, async res => {
    if (!image) {
      await res.send(FALLBACK_TEXT)
      return
    }
    const upload = robot.shipItUploader ?? defaultUploader(robot)
    await upload(image, res)
  })
}
