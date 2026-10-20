import fs from 'node:fs'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {build} from 'esbuild'

const root=process.cwd()
const out=path.join(root,'.test-dist')
fs.rmSync(out,{recursive:true,force:true})
fs.mkdirSync(out,{recursive:true})

// Domain modules import each other (engine ← actions ← seed), so bundle each entry point.
const entries={
  manufacturingEngine:'src/domain/manufacturingEngine.ts',
  actions:'src/domain/actions.ts',
  dashboard:'src/domain/dashboard.ts',
  productionControl:'src/domain/productionControl.ts',
  supplierMaterials:'src/domain/supplierMaterials.ts',
  reset:'src/domain/reset.ts',
  mockData:'src/data/mockData.ts',
  exportData:'src/utils/exportData.ts',
  dates:'src/utils/dates.ts',
  access:'src/domain/access.ts',
  auth:'src/domain/auth.ts',
  migrations:'src/domain/migrations.ts',
  crypto:'src/shared/lib/crypto.ts',
  syncedState:'src/shared/lib/syncedState.ts',
}
for(const [name,file] of Object.entries(entries)){
  if(!fs.existsSync(path.join(root,file))){console.error(`Missing source under test: ${file}`);process.exit(1)}
  await build({entryPoints:[path.join(root,file)],outfile:path.join(out,`${name}.mjs`),bundle:true,format:'esm',platform:'node',target:'node18',logLevel:'warning'})
}
const tests=fs.readdirSync(path.join(root,'tests')).filter(f=>f.endsWith('.test.mjs')).map(f=>path.join('tests',f))
const result=spawnSync(process.execPath,['--test',...tests],{stdio:'inherit',cwd:root})
process.exit(result.status??1)
