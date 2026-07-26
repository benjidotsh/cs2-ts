import { expect, test } from 'bun:test'
import { $ } from 'bun'
import { serializeVmap } from '../../src/vmap/document'

const CS2 = '/mnt/c/Program Files (x86)/Steam/steamapps/common/Counter-Strike Global Offensive'
const CS2_WIN = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Counter-Strike Global Offensive'
const ADDON = 'cs2ts_it'
const enabled = process.env.CS2TS_INTEGRATION === '1'

test.if(enabled)('a generated vmap compiles to a vpk', async () => {
  const solids = [{
    kind: 'box' as const,
    min: [-256, -256, -16] as [number, number, number],
    max: [256, 256, 0] as [number, number, number],
    material: 'materials/dev/reflectivity_30.vmat',
  }]
  const text = serializeVmap({ name: 'it', solids, entities: [] })

  await $`mkdir -p ${`${CS2}/content/csgo_addons/${ADDON}/maps`}`
  await $`mkdir -p ${`${CS2}/game/csgo_addons/${ADDON}`}`
  await Bun.write(`${CS2}/game/csgo_addons/${ADDON}/addoninfo.txt`,
    '"AddonInfo"\n{\n\t"IsPlayable"\t"1"\n}\n')
  await Bun.write(`${CS2}/content/csgo_addons/${ADDON}/maps/it.vmap`, text)

  const result = await $`${`${CS2}/game/bin/win64/resourcecompiler.exe`} -nop4 \
    -game ${`${CS2_WIN}\\game\\csgo`} -world -phys \
    -i ${`${CS2_WIN}\\content\\csgo_addons\\${ADDON}\\maps\\it.vmap`}`
    .cwd(`${CS2}/game/bin/win64`).nothrow().quiet()

  expect(result.exitCode).toBe(0)
  expect(await Bun.file(`${CS2}/game/csgo_addons/${ADDON}/maps/it.vpk`).exists()).toBe(true)

  await $`rm -rf ${`${CS2}/content/csgo_addons/${ADDON}`} ${`${CS2}/game/csgo_addons/${ADDON}`}`
}, 300_000)
