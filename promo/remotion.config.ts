import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('png')
Config.setCodec('h264')
// Pixel art: keep the encoder from smearing hard edges.
Config.setCrf(16)
