/**
 * Writes a one-box map into a scratch CS2 addon and compiles it.
 * Run: bun scripts/spike-compile.ts
 */
import { $ } from 'bun'
import { serializeVmap } from '../packages/sdk/src/vmap/document'

const CS2 = '/mnt/c/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'
const CS2_WIN = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive'
const ADDON = 'cs2ts_spike'

const floor = {
  kind: 'box' as const,
  min: [-512, -512, -16] as [number, number, number],
  max: [512, 512, 0] as [number, number, number],
  material: 'materials/dev/reflectivity_30.vmat',
}
const wall = {
  kind: 'box' as const,
  min: [-512, 496, 0] as [number, number, number],
  max: [512, 512, 192] as [number, number, number],
  material: 'materials/dev/reflectivity_30.vmat',
}

const text = serializeVmap({
  name: 'spike',
  solids: [floor, wall],
  entities: [
    { classname: 'info_player_terrorist', origin: [-128, 0, 8], angles: [0, 0, 0], properties: {} },
    { classname: 'info_player_counterterrorist', origin: [128, 0, 8], angles: [0, 180, 0], properties: {} },
  ],
})

await $`mkdir -p ${`${CS2}/content/csgo_addons/${ADDON}/maps`}`
await $`mkdir -p ${`${CS2}/game/csgo_addons/${ADDON}`}`
await Bun.write(`${CS2}/game/csgo_addons/${ADDON}/addoninfo.txt`,
  '"AddonInfo"\n{\n\t"IsPlayable"\t"1"\n}\n')
await Bun.write(`${CS2}/content/csgo_addons/${ADDON}/maps/spike.vmap`, text)

const result = await $`${`${CS2}/game/bin/win64/resourcecompiler.exe`} -nop4 \
  -game ${`${CS2_WIN}\\game\\csgo`} -world -phys \
  -i ${`${CS2_WIN}\\content\\csgo_addons\\${ADDON}\\maps\\spike.vmap`}`
  .cwd(`${CS2}/game/bin/win64`).nothrow()

console.log(result.stdout.toString())
console.error(result.stderr.toString())
console.log('exit code:', result.exitCode)
console.log('vpk exists:',
  await Bun.file(`${CS2}/game/csgo_addons/${ADDON}/maps/spike.vpk`).exists())
